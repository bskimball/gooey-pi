import { CapabilityBridge, type CapabilityClaim } from 'apex-core/lib/capability-bridge'
import { canonicalSessionPath } from 'apex-core/session-paths'
import type { BackgroundJob, BackgroundJobEvent, BackgroundJobSnapshot, BackgroundJobStatus } from 'apex-core/types/api'
import { requireRecord, requireString } from 'apex-core/validation'

const OUTPUT_CAP = 256_000
const MAX_EVENTS = 200
const MAX_JOBS = 64
const SETTLED_STATUSES = new Set<BackgroundJobStatus>(['completed', 'failed', 'killed'])

interface Entry { job: BackgroundJob; output: string; token: string; stopRequested: boolean }

function tail(text: string): string {
  return text.length > OUTPUT_CAP ? text.slice(-OUTPUT_CAP) : text
}

/** Process output may legitimately contain NUL bytes; drop them instead of rejecting the batch. */
function outputText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1_000_000) throw new TypeError('output must be a string of at most 1,000,000 characters')
  return value.replaceAll('\0', '')
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be a number`)
  return value
}

/**
 * Receives the bg-process extension's job events (started/output/settled) for
 * each agent runtime and mirrors them to the renderer's terminal drawer. Stop
 * requests from the UI ride back on the next sync response; the extension stays
 * the only owner of the processes.
 */
export class BackgroundJobBridge extends CapabilityBridge {
  protected readonly rateLimit = 900
  protected readonly rateLimitError = 'Background job mirror rate limit exceeded'
  private readonly entries = new Map<string, Entry>()
  private readonly sessions = new Map<string, string>()

  constructor(private readonly notify: (event: BackgroundJobEvent) => void) { super() }

  protected environmentEntries(url: string, token: string): NodeJS.ProcessEnv {
    return { APEX_BACKGROUND_JOBS_URL: url, APEX_BACKGROUND_JOBS_TOKEN: token }
  }

  bindSession(token: string | undefined, sessionFile: string | undefined): void {
    if (token && sessionFile && this.claimForToken(token)) this.sessions.set(token, sessionFile)
  }

  list(): BackgroundJobSnapshot[] {
    return [...this.entries.values()].map(({ job, output }) => ({ ...job, output }))
  }

  stopJob(key: unknown): boolean {
    const entry = this.entries.get(requireString(key, 'job key', { min: 1, max: 8192 }))
    if (!entry || entry.job.status !== 'running' || !entry.job.connected) return false
    entry.stopRequested = true
    this.update(entry, { stopping: true })
    return true
  }

  dismissJob(key: unknown): boolean {
    const id = requireString(key, 'job key', { min: 1, max: 8192 })
    const entry = this.entries.get(id)
    if (!entry || entry.job.status === 'running') return false
    this.entries.delete(id)
    this.notify({ type: 'removed', key: id })
    return true
  }

  protected override onClaimRevoked(claim: CapabilityClaim): void {
    this.sessions.delete(claim.token)
    for (const entry of this.entries.values()) {
      if (entry.token !== claim.token || entry.job.status !== 'running') continue
      entry.stopRequested = false
      // The extension kills its non-persistent jobs on shutdown; persistent jobs keep
      // running in their detached runner until a resumed runtime re-announces them.
      if (entry.job.persistent) this.update(entry, { connected: false, stopping: false })
      else this.update(entry, { status: 'killed', connected: false, stopping: false, endedAt: Date.now() })
    }
  }

  protected async dispatch(method: string, params: Record<string, unknown>, claim: CapabilityClaim): Promise<unknown> {
    if (method !== 'sync') throw new TypeError(`Unsupported background job method ${method}`)
    const sessionFile = this.sessions.get(claim.token) ?? claim.sessionPath
    if (!sessionFile) throw new Error('Background job mirror is not ready for this runtime')
    const events = params.events ?? []
    if (!Array.isArray(events) || events.length > MAX_EVENTS) throw new TypeError(`events must be an array of at most ${MAX_EVENTS}`)
    const sessionKey = canonicalSessionPath(sessionFile)
    for (const raw of events) this.apply(requireRecord(raw, 'event'), claim.token, sessionKey, sessionFile)
    const stop: string[] = []
    for (const entry of this.entries.values()) {
      if (entry.token !== claim.token || !entry.stopRequested) continue
      entry.stopRequested = false
      if (entry.job.status === 'running') stop.push(entry.job.id)
    }
    return { stop }
  }

  private apply(event: Record<string, unknown>, token: string, sessionKey: string, sessionFile: string): void {
    const type = requireString(event.type, 'event type', { min: 1, max: 16 })
    if (type === 'started') {
      const raw = requireRecord(event.job, 'job')
      const id = requireString(raw.id, 'job id', { min: 1, max: 128 })
      const key = `job:${sessionKey}:${id}`
      const previous = this.entries.get(key)
      const output = event.output === undefined ? previous?.output ?? '' : tail(outputText(event.output))
      const job: BackgroundJob = {
        key,
        id,
        sessionFile,
        title: requireString(raw.title, 'job title', { min: 1, max: 512 }),
        command: requireString(raw.command, 'job command', { min: 1, max: 64 * 1024 }),
        cwd: requireString(raw.cwd, 'job cwd', { min: 1, max: 4096 }),
        pid: optionalNumber(raw.pid, 'job pid'),
        persistent: raw.persistent === true,
        startedAt: optionalNumber(raw.startedAt, 'job startedAt') ?? Date.now(),
        status: 'running',
        exitCode: null,
        signal: null,
        stopping: false,
        connected: true,
      }
      if (previous?.job.status === 'running' && previous.token === token && event.output === undefined) {
        // Metadata refresh (for example the pid became known): keep the view and stop state.
        this.update(previous, { ...job, stopping: previous.job.stopping })
        return
      }
      this.entries.delete(key)
      this.entries.set(key, { job, output, token, stopRequested: false })
      this.prune()
      this.notify({ type: 'started', job, output })
      return
    }
    const key = `job:${sessionKey}:${requireString(event.id, 'job id', { min: 1, max: 128 })}`
    const entry = this.entries.get(key)
    if (!entry || entry.token !== token) return
    if (type === 'output') {
      const data = outputText(event.data)
      if (!data) return
      entry.output = tail(entry.output + data)
      this.notify({ type: 'output', key, data })
      return
    }
    if (type === 'settled') {
      const status = requireString(event.status, 'job status', { min: 1, max: 16 }) as BackgroundJobStatus
      if (!SETTLED_STATUSES.has(status)) throw new TypeError('job status is invalid')
      entry.stopRequested = false
      this.update(entry, {
        status,
        exitCode: optionalNumber(event.exitCode, 'exit code') ?? null,
        signal: typeof event.signal === 'string' ? event.signal.slice(0, 32) : null,
        stopping: false,
        endedAt: Date.now(),
      })
      return
    }
    if (type === 'detached') {
      // The runtime stopped following a still-running persistent job (session switch).
      entry.stopRequested = false
      if (entry.job.status === 'running') this.update(entry, { connected: false, stopping: false })
      return
    }
    throw new TypeError(`Unsupported background job event ${type}`)
  }

  private update(entry: Entry, patch: Partial<BackgroundJob>): void {
    entry.job = { ...entry.job, ...patch }
    this.notify({ type: 'updated', job: entry.job })
  }

  private prune(): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= MAX_JOBS) return
      if (entry.job.status === 'running') continue
      this.entries.delete(key)
      this.notify({ type: 'removed', key })
    }
  }
}
