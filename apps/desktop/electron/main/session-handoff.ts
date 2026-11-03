import { basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { canonicalSessionPath } from 'apex-core/session-paths'
import {
  assertSessionNotOwnedElsewhere,
  acquireRuntimeSession,
  publishRuntimeOwner,
  readRuntimeOwners,
  readSessionReleaseRequests,
  removeRuntimeOwner,
  RUNTIME_OWNER_HEARTBEAT_MS,
  runtimeOwnersDir,
  type RuntimeOwnerIdentity,
} from 'apex-core/sessions/runtime-owners'
import type { RuntimeOwnerView } from '../../src/types/api'
import type { AgentRpcManager } from './agent-rpc'
import type { ProjectService } from './projects'
import type { SessionService } from './sessions'

const SELF: RuntimeOwnerIdentity = { app: 'desktop', pid: process.pid }
const CHANGE_POLL_MS = 5_000
const VSCODE_SESSION_URI = 'vscode://bdkinc.apex-vscode/open'
// VS Code delivers extension URIs to its focused window; the folder's window needs a moment to take focus.
const VSCODE_FOCUS_DELAY_MS = 1_200

interface SessionHandoffDeps {
  agents: Pick<AgentRpcManager, 'list' | 'getForSession' | 'stopForSession' | 'releaseIdleSession' | 'setSessionAttachGuard' | 'setSessionClaimProvider'>
  sessions: Pick<SessionService, 'requireSessionPath' | 'list'>
  projects: Pick<ProjectService, 'authorizePath'>
  openExternal(url: string): Promise<void>
  ownersDir?: string
  focusDelayMs?: number
}

/** Names a desktop session for the browser extension popup: app, project folder, and session title. */
export function describeDesktopSession(sessions: Pick<SessionService, 'list'>) {
  return async (sessionKey: string): Promise<string> => {
    const session = (await sessions.list(undefined, true)).find((candidate) => canonicalSessionPath(candidate.filePath) === sessionKey)
    return session ? `Apex desktop · ${basename(session.projectPath)} · ${session.title}` : 'Apex desktop'
  }
}

/**
 * Publishes which sessions this app's Pi runtimes hold, refuses to attach a
 * runtime to a session another live Apex app holds, hands a session to Apex
 * for VS Code, and releases idle sessions VS Code asks for.
 */
export class SessionHandoff {
  private disposed = false
  private releasing: Promise<void> | null = null
  private published = ''
  private publishedAt = 0
  // Writes run one at a time so an older snapshot can never land after a newer one.
  private publishing: Promise<void> = Promise.resolve()
  private readonly timer: NodeJS.Timeout
  private readonly ownersDir: string

  constructor(private readonly deps: SessionHandoffDeps) {
    const ownersDir = deps.ownersDir ?? runtimeOwnersDir()
    this.ownersDir = ownersDir
    deps.agents.setSessionAttachGuard((sessionPath) => assertSessionNotOwnedElsewhere(sessionPath, SELF, ownersDir))
    deps.agents.setSessionClaimProvider((sessionPath) => acquireRuntimeSession(sessionPath, { ...SELF, label: 'Apex desktop' }, ownersDir))
    this.timer = setInterval(() => {
      void this.publish()
      void this.releaseRequestedSessions().catch(() => undefined)
    }, CHANGE_POLL_MS)
    this.timer.unref()
    process.once('exit', () => removeRuntimeOwner(SELF, ownersDir))
    void this.publish(true)
  }

  publish(force = false): Promise<void> {
    const run = this.publishing.then(() => this.write(force))
    this.publishing = run.catch(() => undefined)
    return run
  }

  private async write(force: boolean): Promise<void> {
    if (this.disposed) return
    const sessions = this.deps.agents.list().flatMap((runtime) => (runtime.sessionFile ? [canonicalSessionPath(runtime.sessionFile)] : [])).sort()
    const key = sessions.join('\0')
    const now = Date.now()
    if (!force && key === this.published && now - this.publishedAt < RUNTIME_OWNER_HEARTBEAT_MS) return
    this.published = key
    this.publishedAt = now
    await publishRuntimeOwner({ ...SELF, label: 'Apex desktop', sessions }, this.ownersDir).catch(() => undefined)
  }

  /** Stops idle runtimes on sessions Apex for VS Code asked for. A busy runtime keeps its session. */
  releaseRequestedSessions(): Promise<void> {
    this.releasing ??= this.releaseIdle().finally(() => { this.releasing = null })
    return this.releasing
  }

  private async releaseIdle(): Promise<void> {
    let released = false
    for (const request of await readSessionReleaseRequests(this.ownersDir)) {
      if (this.disposed) return
      if (!this.deps.agents.getForSession(request.session)) continue
      if (!(await this.deps.agents.releaseIdleSession(request.session))) continue
      request.remove()
      released = true
    }
    if (released) await this.publish(true)
  }

  async otherOwners(): Promise<RuntimeOwnerView[]> {
    return (await readRuntimeOwners(SELF, this.ownersDir)).map(({ app, label, sessions }) => ({ app, label, sessions }))
  }

  async continueInVsCode(filePath: unknown): Promise<void> {
    const sessionPath = await this.deps.sessions.requireSessionPath(filePath)
    const runtime = this.deps.agents.getForSession(sessionPath)
    if (runtime?.isStreaming || runtime?.isCompacting) throw new Error('Stop the current run or wait for it to finish before continuing in VS Code.')
    const wanted = canonicalSessionPath(sessionPath)
    const session = (await this.deps.sessions.list(undefined, true)).find((candidate) => canonicalSessionPath(candidate.filePath) === wanted)
    if (!session) throw new Error('This session is not in the session catalog.')
    const folder = await this.deps.projects.authorizePath(session.projectPath)
    await this.deps.agents.stopForSession(sessionPath)
    await this.publish(true)
    await this.deps.openExternal(`vscode://file${pathToFileURL(folder).pathname}`)
    await delay(this.deps.focusDelayMs ?? VSCODE_FOCUS_DELAY_MS)
    await this.deps.openExternal(`${VSCODE_SESSION_URI}?session=${encodeURIComponent(sessionPath)}`)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    clearInterval(this.timer)
    await this.publishing
    removeRuntimeOwner(SELF, this.ownersDir)
  }
}
