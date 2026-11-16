import { watch } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { SessionChangeEvent, SpecialistRosterEntry, TranscriptMessage } from '../../src/types/api'
import { extractPiSpecialistSessions } from 'apex-core/specialists/records'

/** Bounds keep one window from turning the registry into an unbounded set of reads or watchers. */
export const MAX_TRACKED_SESSIONS = 64
export const MAX_WATCHED_WORKERS = 8
const ROSTER_DEBOUNCE_MS = 250
const WORKER_DEBOUNCE_MS = 150

export interface SpecialistWatcher {
  close(): void
  on(event: 'error', listener: (error: Error) => void): SpecialistWatcher
}

export type SpecialistWatchFactory = (path: string, listener: () => void) => SpecialistWatcher

const watchDirectory: SpecialistWatchFactory = (path, listener) => watch(path, { persistent: false }, () => listener())

export interface SpecialistRegistryDeps {
  /** Reads a session transcript through the session service's path authorization. */
  read(filePath: string): Promise<TranscriptMessage[]>
  /** Canonical, authorized session path; throws for anything outside the session root. */
  requireSessionPath(filePath: string): Promise<string>
  watchDirectory?: SpecialistWatchFactory
}

export type SpecialistPush =
  | { channel: 'specialists:changed'; payload: { filePath: string; specialists: SpecialistRosterEntry[] } }
  | { channel: 'specialists:worker-changed'; payload: { workerFile: string } }

interface WorkerWatch { canonical: string; watcher: SpecialistWatcher | null; timer: NodeJS.Timeout | null }

interface Subscriber {
  send(push: SpecialistPush): void
  /** Requested path → canonical path, so pushes echo the path the window asked for. */
  sessions: Map<string, string>
  workers: Map<string, WorkerWatch>
  /** Each replace call bumps these, so a slower earlier call cannot overwrite a newer one. */
  trackGeneration: number
  workerGeneration: number
}

export function rosterFromMessages(messages: TranscriptMessage[]): SpecialistRosterEntry[] {
  return extractPiSpecialistSessions(messages).map((specialist) => ({
    id: specialist.id,
    agent: specialist.agent,
    mission: specialist.mission,
    status: specialist.status,
    ...(specialist.activity ? { activity: specialist.activity } : {}),
    ...(specialist.model ? { model: specialist.model } : {}),
    ...(specialist.sessionFile ? { sessionFile: specialist.sessionFile } : {}),
    ...(specialist.instanceId ? { instanceId: specialist.instanceId } : {}),
  }))
}

/** Session events and authorized paths can differ in drive-letter case on Windows. */
const pathKey = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)

const signature = (roster: readonly SpecialistRosterEntry[]) => JSON.stringify(roster)

function requirePathList(value: unknown, max: number, label: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  if (value.length > max) throw new RangeError(`${label} may hold at most ${max} paths`)
  return [...new Set(value.map((item) => {
    if (typeof item !== 'string' || !item || item.length > 4096) throw new TypeError(`${label} must contain session paths`)
    return item
  }))]
}

/**
 * The sub-agents each session delegated to, owned by the main process. Rosters come from the
 * parent's saved task_* receipts and are pushed whenever that session file changes; worker
 * transcripts a window is showing are watched directly so the window re-reads on change
 * instead of polling.
 */
export class SpecialistRegistry {
  private readonly subscribers = new Map<number, Subscriber>()
  private readonly rosters = new Map<string, string>()
  private readonly rosterTimers = new Map<string, NodeJS.Timeout>()
  private readonly watchDirectory: SpecialistWatchFactory

  constructor(private readonly deps: SpecialistRegistryDeps) {
    this.watchDirectory = deps.watchDirectory ?? watchDirectory
  }

  async list(filePath: unknown): Promise<SpecialistRosterEntry[]> {
    if (typeof filePath !== 'string') throw new TypeError('filePath must be a string')
    const canonical = await this.deps.requireSessionPath(filePath)
    const roster = rosterFromMessages(await this.deps.read(canonical))
    this.rosters.set(canonical, signature(roster))
    return roster
  }

  /** Replaces the subscriber's tracked sessions and returns their current rosters keyed by requested path. */
  async track(subscriberId: number, send: Subscriber['send'], value: unknown): Promise<Record<string, SpecialistRosterEntry[]>> {
    const requested = requirePathList(value, MAX_TRACKED_SESSIONS, 'sessionFiles')
    const subscriber = this.subscriber(subscriberId, send)
    const generation = ++subscriber.trackGeneration
    const resolved = await Promise.all(requested.map(async (path) => {
      try { return [path, await this.deps.requireSessionPath(path)] as const } catch { return null }
    }))
    if (subscriber.trackGeneration !== generation || this.subscribers.get(subscriberId) !== subscriber) return {}
    subscriber.sessions = new Map(resolved.filter((entry): entry is readonly [string, string] => entry !== null))
    const rosters: Record<string, SpecialistRosterEntry[]> = {}
    await Promise.all([...subscriber.sessions].map(async ([path, canonical]) => {
      try { rosters[path] = await this.list(canonical) } catch { /* Unreadable sessions simply have no roster. */ }
    }))
    return rosters
  }

  /** Replaces the worker transcripts the subscriber is showing. */
  async watchWorkers(subscriberId: number, send: Subscriber['send'], value: unknown): Promise<void> {
    const requested = requirePathList(value, MAX_WATCHED_WORKERS, 'workerFiles')
    const subscriber = this.subscriber(subscriberId, send)
    const generation = ++subscriber.workerGeneration
    const wanted = new Set(requested)
    for (const [path, worker] of subscriber.workers) {
      if (wanted.has(path)) continue
      this.closeWorker(worker)
      subscriber.workers.delete(path)
    }
    for (const path of requested) {
      if (subscriber.workers.has(path)) continue
      let canonical: string
      try { canonical = await this.deps.requireSessionPath(path) } catch { continue }
      if (subscriber.workerGeneration !== generation || this.subscribers.get(subscriberId) !== subscriber) return
      if (subscriber.workers.has(path)) continue
      const worker: WorkerWatch = { canonical, watcher: null, timer: null }
      const notify = () => {
        if (worker.timer) return
        worker.timer = setTimeout(() => {
          worker.timer = null
          if (subscriber.workers.get(path) === worker) subscriber.send({ channel: 'specialists:worker-changed', payload: { workerFile: path } })
        }, WORKER_DEBOUNCE_MS)
        worker.timer.unref?.()
      }
      try {
        // Workers rotate to a newer JSONL in the same directory, so watch the directory.
        const watcher = this.watchDirectory(dirname(canonical), notify)
        watcher.on('error', () => {
          watcher.close()
          if (worker.watcher === watcher) worker.watcher = null
          notify()
        })
        worker.watcher = watcher
      } catch { /* A missing worker directory leaves the window on its last read. */ }
      subscriber.workers.set(path, worker)
    }
  }

  release(subscriberId: number): void {
    const subscriber = this.subscribers.get(subscriberId)
    if (!subscriber) return
    for (const worker of subscriber.workers.values()) this.closeWorker(worker)
    this.subscribers.delete(subscriberId)
  }

  dispose(): void {
    for (const id of [...this.subscribers.keys()]) this.release(id)
    for (const timer of this.rosterTimers.values()) clearTimeout(timer)
    this.rosterTimers.clear()
    this.rosters.clear()
  }

  private subscriber(id: number, send: Subscriber['send']): Subscriber {
    let subscriber = this.subscribers.get(id)
    if (!subscriber) {
      subscriber = { send, sessions: new Map(), workers: new Map(), trackGeneration: 0, workerGeneration: 0 }
      this.subscribers.set(id, subscriber)
    } else subscriber.send = send
    return subscriber
  }

  private closeWorker(worker: WorkerWatch): void {
    worker.watcher?.close()
    worker.watcher = null
    if (worker.timer) clearTimeout(worker.timer)
    worker.timer = null
  }

  private isTracked(canonical: string): boolean {
    for (const subscriber of this.subscribers.values()) for (const tracked of subscriber.sessions.values()) if (pathKey(tracked) === pathKey(canonical)) return true
    return false
  }

  /** Fed from the session service's change stream, which the IPC layer already listens to. */
  notifySessionChange(event: SessionChangeEvent): void {
    const changed = event.filePath
    if (!changed) {
      // Catalog-wide refreshes cannot name a file, so recheck every tracked session.
      for (const subscriber of this.subscribers.values()) for (const canonical of subscriber.sessions.values()) this.scheduleRoster(canonical)
      return
    }
    for (const subscriber of this.subscribers.values()) for (const canonical of subscriber.sessions.values()) if (pathKey(canonical) === pathKey(changed)) { this.scheduleRoster(canonical); return }
  }

  private scheduleRoster(canonical: string): void {
    if (this.rosterTimers.has(canonical)) return
    const timer = setTimeout(() => {
      this.rosterTimers.delete(canonical)
      void this.refreshRoster(canonical)
    }, ROSTER_DEBOUNCE_MS)
    timer.unref?.()
    this.rosterTimers.set(canonical, timer)
  }

  private async refreshRoster(canonical: string): Promise<void> {
    if (!this.isTracked(canonical)) return
    let roster: SpecialistRosterEntry[]
    try { roster = rosterFromMessages(await this.deps.read(canonical)) } catch { return }
    const next = signature(roster)
    if (this.rosters.get(canonical) === next) return
    this.rosters.set(canonical, next)
    for (const subscriber of this.subscribers.values()) {
      for (const [path, tracked] of subscriber.sessions) {
        if (pathKey(tracked) === pathKey(canonical)) subscriber.send({ channel: 'specialists:changed', payload: { filePath: path, specialists: roster } })
      }
    }
  }
}
