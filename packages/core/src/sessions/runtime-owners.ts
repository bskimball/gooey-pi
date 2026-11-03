import { createHash, randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { canonicalSessionPath } from '../session-paths'
import { isRecord } from '../validation'
import { piSessionRoot } from './pi'

/**
 * Which app holds a live Pi runtime on which session files. Apex desktop and
 * Apex for VS Code each spawn their own Pi process, and two processes appending
 * to one session file fork its entry tree, so each app publishes the sessions
 * it holds and refuses to attach to a session another live app holds.
 *
 * Per-process records provide display metadata. Exclusive per-session claims
 * provide admission control and never expire on heartbeat delays.
 */
export type RuntimeOwnerApp = 'desktop' | 'vscode'
export interface RuntimeOwner {
  app: RuntimeOwnerApp
  /** Display name, for example "Apex desktop" or "VS Code · pi-desktop". */
  label: string
  pid: number
  updatedAt: string
  /** Canonical session file paths with a live runtime in this process. */
  sessions: string[]
}
export interface RuntimeOwnerIdentity { app: RuntimeOwnerApp; pid: number }

export const RUNTIME_OWNER_HEARTBEAT_MS = 30_000
export const RUNTIME_OWNER_STALE_MS = 90_000
export const SESSION_RELEASE_REQUEST_TTL_MS = 30_000
const MAX_SESSIONS = 64
const RECORD_NAME = /^(desktop|vscode)-(\d+)\.json$/
const RELEASE_REQUEST_NAME = /^[a-f0-9]{64}\.release\.json$/

const sessionKey = (canonicalSession: string) => createHash('sha256').update(canonicalSession).digest('hex')

export function runtimeOwnersDir(sessionRoot = piSessionRoot()): string {
  return join(dirname(sessionRoot), 'apex-runtime-owners')
}

const recordPath = (dir: string, owner: RuntimeOwnerIdentity) => join(dir, `${owner.app}-${owner.pid}.json`)

export async function publishRuntimeOwner(owner: Omit<RuntimeOwner, 'updatedAt'>, dir = runtimeOwnersDir()): Promise<void> {
  const record: RuntimeOwner = {
    ...owner,
    sessions: [...new Set(owner.sessions.map(canonicalSessionPath))].slice(0, MAX_SESSIONS),
    updatedAt: new Date().toISOString(),
  }
  await mkdir(dir, { recursive: true })
  const target = recordPath(dir, owner)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

/** Synchronous so it can run from a process `exit` handler. */
export function removeRuntimeOwner(owner: RuntimeOwnerIdentity, dir = runtimeOwnersDir()): void {
  try { rmSync(recordPath(dir, owner), { force: true }) } catch { /* A leftover record expires on its own. */ }
}

function parseRuntimeOwner(value: unknown): RuntimeOwner | undefined {
  if (!isRecord(value)) return undefined
  const { app, label, pid, updatedAt, sessions } = value
  if (app !== 'desktop' && app !== 'vscode') return undefined
  if (typeof label !== 'string' || !label || label.length > 200) return undefined
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return undefined
  if (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))) return undefined
  if (!Array.isArray(sessions) || sessions.length > MAX_SESSIONS) return undefined
  if (!sessions.every((path): path is string => typeof path === 'string' && path.length > 0 && path.length <= 4096)) return undefined
  return { app, label, pid, updatedAt, sessions }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Live owners other than `self`. Records of exited processes are removed. */
export async function readRuntimeOwners(self?: RuntimeOwnerIdentity, dir = runtimeOwnersDir(), _now = Date.now()): Promise<RuntimeOwner[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const owners: RuntimeOwner[] = []
  for (const name of names) {
    const match = RECORD_NAME.exec(name)
    const claim = /^[a-f0-9]{64}\.claim\.json$/.test(name)
    if (!match && !claim) continue
    let owner: RuntimeOwner | undefined
    try {
      owner = parseRuntimeOwner(JSON.parse(await readFile(join(dir, name), 'utf8')))
    } catch {
      continue
    }
    if (!owner || (!claim && `${owner.app}-${owner.pid}.json` !== name)) continue
    if (self && owner.app === self.app && owner.pid === self.pid) continue
    if (!processAlive(owner.pid)) {
      if (!claim) await rm(join(dir, name), { force: true }).catch(() => undefined)
      continue
    }
    // A stalled heartbeat is not evidence that the runtime stopped writing.
    const existing = owners.find((entry) => entry.app === owner.app && entry.pid === owner.pid)
    if (existing) existing.sessions = [...new Set([...existing.sessions, ...owner.sessions])]
    else owners.push(owner)
  }
  return owners
}

/** Atomic admission. Only the returned release function may remove this claim.
 * Abandoned claims fail closed: a dead host PID does not prove its child exited.
 * They require cleanup after confirming no writer remains, never TTL takeover.
 */
export function acquireRuntimeSession(sessionPath: string, owner: RuntimeOwnerIdentity & { label: string }, dir = runtimeOwnersDir()): () => void {
  const session = canonicalSessionPath(sessionPath)
  const target = join(dir, `${sessionKey(session)}.claim.json`)
  mkdirSync(dir, { recursive: true })
  let fd: number
  try {
    fd = openSync(target, 'wx', 0o600)
  } catch (error) {
    if (!isRecord(error) || error.code !== 'EEXIST') throw error
    let holder: RuntimeOwner | undefined
    try { holder = parseRuntimeOwner(JSON.parse(readFileSync(target, 'utf8'))) } catch { /* An incomplete claim still excludes another writer. */ }
    throw new Error(`This session is open in ${holder?.label ?? 'another Apex runtime'}. Release it there first. If that app exited unexpectedly, confirm its Pi child has exited before removing ${target}.`)
  }
  try {
    writeFileSync(fd, JSON.stringify({ ...owner, sessions: [session], updatedAt: new Date().toISOString() }))
  } catch (error) {
    closeSync(fd)
    rmSync(target, { force: true })
    throw error
  }
  closeSync(fd)
  let released = false
  return () => {
    if (released) return
    rmSync(target, { force: true })
    released = true
  }
}

/** One runtime's current session plus its in-flight attach reservations. */
export class RuntimeSessionClaims {
  private readonly claims = new Map<string, () => void>()
  private readonly pending = new Map<string, number>()
  private current: string | null = null
  private closed = false

  constructor(private readonly acquire: (path: string) => () => void) {}

  reserve(path: string): () => void {
    if (this.closed) throw new Error('Runtime ownership has ended')
    const key = canonicalSessionPath(path)
    this.ensure(key)
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1)
    let finished = false
    return () => {
      if (finished) return
      finished = true
      const count = (this.pending.get(key) ?? 1) - 1
      if (count) this.pending.set(key, count)
      else this.pending.delete(key)
      this.releaseUnused(key)
    }
  }

  confirm(path: string | null): void {
    if (this.closed) return
    const key = path ? canonicalSessionPath(path) : null
    if (key) this.ensure(key)
    const previous = this.current
    this.current = key
    if (previous) this.releaseUnused(previous)
  }

  dispose(): void {
    this.closed = true
    this.current = null
    this.pending.clear()
    for (const release of this.claims.values()) release()
    this.claims.clear()
  }

  private ensure(path: string): void {
    if (!this.claims.has(path)) this.claims.set(path, this.acquire(path))
  }

  private releaseUnused(path: string): void {
    if (path === this.current || this.pending.has(path)) return
    this.claims.get(path)?.()
    this.claims.delete(path)
  }
}

export function runtimeOwnerOf(owners: readonly RuntimeOwner[], sessionPath: string): RuntimeOwner | undefined {
  const wanted = canonicalSessionPath(sessionPath)
  return owners.find((owner) => owner.sessions.includes(wanted))
}

/**
 * Asks Apex desktop to stop its idle runtime on `sessionPath`. Desktop keeps
 * runtimes for recently viewed sessions as a warm cache; a busy runtime keeps
 * its session. The returned function withdraws the request.
 */
export async function requestSessionRelease(sessionPath: string, dir = runtimeOwnersDir()): Promise<() => void> {
  const session = canonicalSessionPath(sessionPath)
  const target = join(dir, `${sessionKey(session)}.release.json`)
  await mkdir(dir, { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ session, requestedAt: new Date().toISOString() }), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
  return () => { try { rmSync(target, { force: true }) } catch { /* The request expires on its own. */ } }
}

export interface SessionReleaseRequest {
  session: string
  /** Removes the request once it has been honored. */
  remove(): void
}

/** Pending release requests. Expired or malformed requests are removed. */
export async function readSessionReleaseRequests(dir = runtimeOwnersDir(), now = Date.now()): Promise<SessionReleaseRequest[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const requests: SessionReleaseRequest[] = []
  for (const name of names) {
    if (!RELEASE_REQUEST_NAME.test(name)) continue
    const path = join(dir, name)
    const remove = () => { try { rmSync(path, { force: true }) } catch { /* expires on its own */ } }
    let value: unknown
    try {
      value = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (error instanceof SyntaxError) remove()
      continue
    }
    const session = isRecord(value) && typeof value.session === 'string' ? value.session : undefined
    const requestedAt = isRecord(value) && typeof value.requestedAt === 'string' ? Date.parse(value.requestedAt) : Number.NaN
    if (!session || `${sessionKey(session)}.release.json` !== name || !(Math.abs(now - requestedAt) < SESSION_RELEASE_REQUEST_TTL_MS)) {
      remove()
      continue
    }
    requests.push({ session, remove })
  }
  return requests
}

/** Throws when another live app holds `sessionPath`, naming that app and how to hand the session over. */
export async function assertSessionNotOwnedElsewhere(sessionPath: string, self: RuntimeOwnerIdentity, dir = runtimeOwnersDir()): Promise<void> {
  const owner = runtimeOwnerOf(await readRuntimeOwners(self, dir), sessionPath)
  if (!owner) return
  const handOff = owner.app === 'vscode'
    ? 'Run "Apex: Continue in Apex Desktop" in that VS Code window first.'
    : 'Use "Continue in VS Code" on the session in Apex desktop first, or open it there.'
  throw new Error(`This session is open in ${owner.label}. ${handOff}`)
}
