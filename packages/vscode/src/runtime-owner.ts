import { basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  assertSessionNotOwnedElsewhere,
  acquireRuntimeSession,
  RuntimeSessionClaims,
  publishRuntimeOwner,
  readRuntimeOwners,
  removeRuntimeOwner,
  requestSessionRelease,
  runtimeOwnerOf,
  RUNTIME_OWNER_HEARTBEAT_MS,
  type RuntimeOwnerIdentity,
} from 'apex-core/sessions/runtime-owners'

const SELF: RuntimeOwnerIdentity = { app: 'vscode', pid: process.pid }
// Apex desktop checks release requests every 5s, then stops the runtime.
const DESKTOP_RELEASE_WAIT_MS = 15_000
const DESKTOP_RELEASE_POLL_MS = 250

/** Publishes the session this window's Pi runtime holds, so Apex desktop does not attach a second runtime to it. */
export class VsCodeRuntimeOwner {
  private sessionPath: string | null = null
  private readonly claims = new RuntimeSessionClaims((path) => acquireRuntimeSession(path, { ...SELF, label: `VS Code · ${basename(this.cwd())}` }))
  private readonly timer: NodeJS.Timeout
  // Writes run one at a time so an older snapshot can never land after a newer one.
  private publishing: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(private readonly cwd: () => string) {
    this.timer = setInterval(() => { void this.publish() }, RUNTIME_OWNER_HEARTBEAT_MS)
    this.timer.unref?.()
  }

  reserve(sessionPath: string): () => void {
    if (this.disposed) throw new Error('Runtime ownership has ended')
    return this.claims.reserve(sessionPath)
  }

  set(sessionPath: string | null): void {
    if (this.disposed) return
    this.claims.confirm(sessionPath)
    if (sessionPath === this.sessionPath) return
    this.sessionPath = sessionPath
    void this.publish()
  }

  private publish(): Promise<void> {
    this.publishing = this.publishing.then(() => {
      if (this.disposed) return
      const sessions = this.sessionPath ? [this.sessionPath] : []
      return publishRuntimeOwner({ ...SELF, label: `VS Code · ${basename(this.cwd())}`, sessions }).catch(() => undefined)
    })
    return this.publishing
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.claims.dispose()
    clearInterval(this.timer)
    await this.publishing
    removeRuntimeOwner(SELF)
  }
}

/** Throws when another app holds `sessionPath`. Apex desktop is first asked to release an idle runtime on it. */
export async function assertSessionFree(sessionPath: string): Promise<void> {
  if (runtimeOwnerOf(await readRuntimeOwners(SELF), sessionPath)?.app !== 'desktop') return assertSessionNotOwnedElsewhere(sessionPath, SELF)
  const withdraw = await requestSessionRelease(sessionPath)
  try {
    const deadline = Date.now() + DESKTOP_RELEASE_WAIT_MS
    while (Date.now() < deadline) {
      await delay(DESKTOP_RELEASE_POLL_MS)
      const owner = runtimeOwnerOf(await readRuntimeOwners(SELF), sessionPath)
      if (!owner) return
      if (owner.app !== 'desktop') return assertSessionNotOwnedElsewhere(sessionPath, SELF)
    }
  } finally {
    withdraw()
  }
  throw new Error('This session is busy in Apex desktop. Stop the run there or wait for it to finish, then open it again.')
}

/** Labels of other Apex apps holding sessions, keyed by session path. */
export async function sessionOwnerLabels(): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  for (const owner of await readRuntimeOwners(SELF)) for (const session of owner.sessions) labels.set(session, owner.label)
  return labels
}
