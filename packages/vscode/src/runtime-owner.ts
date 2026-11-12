import { basename } from 'node:path'
import {
  assertSessionNotOwnedElsewhere,
  acquireRuntimeSession,
  RuntimeSessionClaims,
  publishRuntimeOwner,
  readRuntimeOwners,
  removeRuntimeOwner,
  RUNTIME_OWNER_HEARTBEAT_MS,
  type RuntimeOwnerIdentity,
} from 'apex-core/sessions/runtime-owners'

const SELF: RuntimeOwnerIdentity = { app: 'vscode', pid: process.pid }

/** Publishes the session this window's Pi runtime holds, so Apex desktop does not attach a second runtime to it. */
export class VsCodeRuntimeOwner {
  private sessionPath: string | null = null
  private readonly claims = new RuntimeSessionClaims((path) => acquireRuntimeSession(path, { ...SELF, label: `VS Code · ${basename(this.cwd())}`, childPid: this.childPid?.() }))
  private readonly timer: NodeJS.Timeout
  // Writes run one at a time so an older snapshot can never land after a newer one.
  private publishing: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(private readonly cwd: () => string, private readonly childPid?: () => number | undefined) {
    this.timer = setInterval(() => { void this.publish() }, RUNTIME_OWNER_HEARTBEAT_MS)
    this.timer.unref?.()
  }

  reserve(sessionPath: string): () => void {
    if (this.disposed) throw new Error('Runtime ownership has ended')
    this.claims.setChildPid(this.childPid?.())
    return this.claims.reserve(sessionPath)
  }

  set(sessionPath: string | null): void {
    if (this.disposed) return
    this.claims.setChildPid(this.childPid?.())
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

/** A failed attachment must never silently request a Desktop runtime shutdown. */
export async function assertSessionFree(sessionPath: string): Promise<void> {
  await assertSessionNotOwnedElsewhere(sessionPath, SELF)
}

/** Labels of other Apex apps holding sessions, keyed by session path. */
export async function sessionOwnerLabels(): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  for (const owner of await readRuntimeOwners(SELF)) for (const session of owner.sessions) labels.set(session, owner.label)
  return labels
}
