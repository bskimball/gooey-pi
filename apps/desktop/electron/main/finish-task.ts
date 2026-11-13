import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { canonicalSessionPath } from 'apex-core/session-paths'
import { isRecord, requireId } from 'apex-core/validation'
import type { FinishLocalUse, FinishObservation, FinishReview, FinishedTask, RuntimeOwnerView, SessionRecord } from '../../src/types/api'
import type { AgentRpcManager } from './agent-rpc'
import { listGitWorktrees, resolveGitRepositoryRoot, type GitService } from './git'
import type { RepositoryUseGate } from './repository-use-gate'
import type { WorktreeProvenance } from './worktree-provenance'

interface Reservation { runtimeId: string; session: string; observation: FinishObservation; expires: number }
function canonical(path: string): string {
  let value: string
  try { value = realpathSync(path) } catch { value = resolve(path) }
  return process.platform === 'win32' ? value.toLowerCase() : value
}
function overlaps(a: string, b: string): boolean {
  const inside = (root: string, child: string) => { const rel = relative(root, child); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) }
  return inside(a, b) || inside(b, a)
}

/** Finish records are user confirmations, not claims that integration or cleanup happened. */
export class FinishTaskService {
  private readonly reservations = new Map<string, Reservation>()
  constructor(
    private readonly directory: string,
    private readonly manager: AgentRpcManager,
    private readonly git: Pick<GitService, 'reviewIntegration'>,
    private readonly gate: RepositoryUseGate,
    private readonly requireSession: (path: unknown) => Promise<string>,
    private readonly sessions: () => Promise<SessionRecord[]>,
    private readonly otherOwners: () => Promise<RuntimeOwnerView[]>,
    private readonly provenance?: WorktreeProvenance,
  ) { mkdirSync(directory, { recursive: true, mode: 0o700 }) }
  private path(session: string): string { return join(this.directory, `${createHash('sha256').update(canonicalSessionPath(session)).digest('hex')}.json`) }
  private read(path: string): FinishedTask | null {
    let text: string
    try { text = readFileSync(path, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    const value: unknown = JSON.parse(text)
    if (!isRecord(value) || value.status !== 'finished' || typeof value.sessionFile !== 'string' || typeof value.finishedAt !== 'string' || !isRecord(value.review) || value.review.sessionFile !== value.sessionFile) throw new Error('Invalid finished task metadata')
    return value as unknown as FinishedTask
  }
  clearForAcceptedPrompt(session: string): void {
    const key = canonicalSessionPath(session)
    for (const [token, reservation] of this.reservations) if (reservation.session === key) this.reservations.delete(token)
    rmSync(this.path(session), { force: true })
  }
  async get(sessionValue: unknown): Promise<FinishedTask | null> {
    const session = await this.requireSession(sessionValue)
    const result = this.read(this.path(session))
    if (result && canonicalSessionPath(result.sessionFile) !== canonicalSessionPath(session)) throw new Error('Finished task metadata does not match the session')
    return result
  }
  async list(): Promise<FinishedTask[]> {
    return readdirSync(this.directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).map((name) => this.read(join(this.directory, name))).filter((item): item is FinishedTask => item !== null)
  }
  private async observe(runtimeId: string, sessionFile: string, cwd: string): Promise<FinishObservation> {
    const git = await this.git.reviewIntegration(cwd)
    let root: string | undefined
    let kind: FinishObservation['worktree']['kind'] = 'unknown'
    let head: string | undefined
    if (git.status.isRepo && !git.status.error) {
      root = await resolveGitRepositoryRoot(cwd)
      const trees = await listGitWorktrees(root)
      const index = trees.findIndex((tree) => canonical(tree.path) === canonical(root!))
      if (index >= 0) { kind = index === 0 ? 'primary' : 'linked'; head = trees[index]!.head }
    }
    const location = canonical(root ?? cwd)
    const conflicts: FinishLocalUse[] = this.gate.overlappingOwners(location, runtimeId)
    const owners = await this.otherOwners()
    if (owners.length) {
      const catalog = await this.sessions()
      for (const owner of owners) for (const session of owner.sessions) {
        const record = catalog.find((item) => canonicalSessionPath(item.filePath) === canonicalSessionPath(session))
        if (!record || overlaps(location, canonical(record.projectPath))) conflicts.push({ kind: 'external-session', app: owner.app, label: owner.label, session, ...(record ? { projectPath: record.projectPath } : {}) })
      }
    }
    const created = kind === 'linked' && root !== undefined && this.provenance?.isCreated(root) === true
    const ownershipReason = created ? 'Created by Apex; directory and Git link identities match' : 'Worktree provenance is unknown; Apex cannot distinguish created from adopted or legacy worktrees'
    const reasons: string[] = []
    if (!created) reasons.push(ownershipReason)
    if (kind === 'primary') reasons.push('Primary worktree must not be cleaned up')
    if (kind === 'unknown') reasons.push('Registered worktree could not be identified')
    if (!this.gate.hasRuntime(location, runtimeId)) reasons.push('The task runtime is not registered for this worktree')
    if (conflicts.length) reasons.push('Other registered local uses overlap this worktree or cannot be located')
    if (!git.status.isRepo || git.status.error || git.status.truncated) reasons.push('Git status is unavailable or incomplete')
    else if (git.status.files.length) reasons.push('Uncommitted changes remain')
    if (git.integration.kind === 'unknown') reasons.push('Integration target or result is unknown')
    else if (git.integration.kind !== 'integrated') reasons.push('Current HEAD is not integrated into the configured target')
    const nextActions: string[] = []
    if (git.status.files.length) nextActions.push('Review and handle the uncommitted changes manually')
    if (git.status.error || git.status.truncated || !git.status.isRepo) nextActions.push('Resolve the unavailable or incomplete Git status')
    if (git.integration.kind !== 'integrated') nextActions.push('Review the configured integration target and integrate manually if appropriate')
    if (git.integration.kind !== 'unknown' && git.integration.evidence === 'local-cached-remote-tracking-ref') nextActions.push('Remote-tracking evidence is locally cached; verify the remote separately if needed')
    nextActions.push('Stop the task runtime and review manually before any worktree cleanup; Apex will not remove it')
    return { sessionFile, cwd, git, worktree: { root, kind, head, ownership: created ? 'apex-created' : 'unknown', ownershipReason }, conflicts, cleanup: { eligible: reasons.length === 0, reasons }, nextActions }
  }
  async review(runtimeValue: unknown, sessionValue: unknown): Promise<FinishReview> {
    const runtimeId = requireId(runtimeValue, 'runtime id')
    const session = await this.requireSession(sessionValue)
    return this.manager.withRewind(runtimeId, session, async (runtime) => {
      const observation = await this.observe(runtimeId, session, runtime.snapshot().cwd)
      const token = randomUUID(); const expires = Date.now() + 5 * 60_000
      for (const [key, value] of this.reservations) if (value.expires < Date.now()) this.reservations.delete(key)
      if (this.reservations.size >= 100) this.reservations.delete(this.reservations.keys().next().value!)
      this.reservations.set(token, { runtimeId, session: canonicalSessionPath(session), observation, expires })
      return { ...structuredClone(observation), token, expiresAt: new Date(expires).toISOString() }
    })
  }
  async finish(runtimeValue: unknown, sessionValue: unknown, tokenValue: unknown, confirmation: unknown): Promise<FinishedTask> {
    const runtimeId = requireId(runtimeValue, 'runtime id')
    const session = await this.requireSession(sessionValue)
    const token = requireId(tokenValue, 'finish token')
    if (confirmation !== 'finish') throw new Error('Finish requires explicit confirmation')
    const reservation = this.reservations.get(token)
    if (!reservation || reservation.expires < Date.now() || reservation.runtimeId !== runtimeId || reservation.session !== canonicalSessionPath(session)) throw new Error('Finish review is invalid or expired')
    this.reservations.delete(token)
    return this.manager.withRewind(runtimeId, session, async (runtime) => {
      const fresh = await this.observe(runtimeId, session, runtime.snapshot().cwd)
      if (JSON.stringify(fresh) !== JSON.stringify(reservation.observation)) throw new Error('Finish review is stale; review again')
      const record: FinishedTask = { status: 'finished', sessionFile: session, finishedAt: new Date().toISOString(), review: fresh }
      const destination = this.path(session); const temporary = `${destination}.${randomUUID()}.tmp`
      try { writeFileSync(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); renameSync(temporary, destination) }
      finally { rmSync(temporary, { force: true }) }
      return record
    })
  }
}
