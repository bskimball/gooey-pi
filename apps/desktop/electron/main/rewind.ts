import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { relative, isAbsolute, sep } from 'node:path'
import { canonicalSessionPath } from 'apex-core/session-paths'
import { isRecord, rejectUnknownKeys, requireId, requireRecord, requireString } from 'apex-core/validation'
import type { RewindPreview, RewindResult, RuntimeOwnerView, SessionRecord } from '../../src/types/api'
import type { AgentRpcManager } from './agent-rpc'
import type { RpcRuntime } from './agent-rpc/runtime'
import type { RestorePreview } from './checkout-snapshots'
import { listGitWorktrees } from './git'
import type { RepositoryUseGate } from './repository-use-gate'
import type { RunReceipts } from './run-receipts'

interface Reservation { runtimeId: string; session: string; preview: RewindPreview; checkpoint?: RestorePreview; expires: number }
const warning = 'Restoring includes your own checkout edits since the checkpoint. Shell and external effects are not reversible. Other external writers are not locked.'
function canonical(path: string): string {
  const result = realpathSync(path)
  return process.platform === 'win32' ? result.toLowerCase() : result
}
function overlaps(a: string, b: string): boolean {
  const within = (root: string, path: string) => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) }
  return within(a, b) || within(b, a)
}
async function forkMessages(runtime: RpcRuntime): Promise<Array<{ entryId: string; text: string }>> {
  const response = await runtime.command({ type: 'get_fork_messages' })
  if (!isRecord(response.data) || !Array.isArray(response.data.messages) || !response.data.messages.every((item: unknown) => isRecord(item) && typeof item.entryId === 'string' && typeof item.text === 'string')) throw new Error('Pi fork messages are unavailable')
  return response.data.messages
}

export class RewindService {
  private readonly tokens = new Map<string, Reservation>()
  constructor(
    private readonly manager: AgentRpcManager,
    private readonly receipts: RunReceipts,
    private readonly gate: RepositoryUseGate,
    private readonly sessions: () => Promise<SessionRecord[]>,
    private readonly otherOwners: () => Promise<RuntimeOwnerView[]>,
  ) {}
  private async worktree(checkout: string, runtimeId: string): Promise<{ linked: boolean; primary: boolean; reason?: string }> {
    const root = canonical(checkout)
    const trees = await listGitWorktrees(root)
    const index = trees.findIndex((tree) => canonical(tree.path) === root)
    if (index < 0) return { linked: false, primary: false, reason: 'Checkout is not a registered worktree' }
    if (index === 0) return { linked: false, primary: true, reason: 'Checkpoint restore is unavailable in the primary worktree' }
    if (!this.gate.hasRuntime(root, runtimeId)) return { linked: true, primary: false, reason: 'The owning runtime is not registered for this worktree' }
    if (this.gate.overlappingOwners(root, runtimeId).length) return { linked: true, primary: false, reason: 'Another local agent or terminal is using this worktree' }
    const owners = await this.otherOwners()
    if (owners.length) {
      const catalog = await this.sessions()
      for (const session of owners.flatMap((owner) => owner.sessions)) {
        const record = catalog.find((item) => canonicalSessionPath(item.filePath) === canonicalSessionPath(session))
        if (!record) return { linked: true, primary: false, reason: 'Another registered session could not be located' }
        if (overlaps(root, canonical(record.projectPath))) return { linked: true, primary: false, reason: 'Another registered session is using this worktree' }
      }
    }
    return { linked: true, primary: false }
  }
  async preview(runtimeIdValue: unknown, sessionValue: unknown, entryValue: unknown): Promise<RewindPreview> {
    const runtimeId = requireId(runtimeIdValue, 'runtime id')
    const session = requireString(sessionValue, 'session path', { min: 1, max: 4096 })
    const selected = requireId(entryValue, 'user entry id')
    return this.manager.withRewind(runtimeId, session, async (runtime) => {
      const messages = await forkMessages(runtime)
      if (!messages.some((message) => message.entryId === selected)) throw new Error('User entry is not available for fork')
      const checkpoint = await this.receipts.checkpoint(session, selected)
      const anchor = checkpoint?.receipt.anchorUserEntryId ?? selected
      const prompt = messages.find((message) => message.entryId === anchor)?.text
      if (prompt === undefined) throw new Error('Run anchor is not available for fork')
      const checkout = runtime.snapshot().cwd
      let facts: { linked: boolean; primary: boolean; reason?: string } = { linked: false, primary: false }
      let snapshot: RestorePreview | undefined
      let reason = checkpoint ? undefined : 'No completed checkpoint is available for this message'
      try { facts = await this.worktree(checkout, runtimeId); reason ??= facts.reason }
      catch (error) { reason ??= error instanceof Error ? error.message : String(error) }
      if (checkpoint) {
        try { snapshot = this.receipts.previewCheckpoint(checkout, checkpoint.before) }
        catch (error) { reason ??= error instanceof Error ? error.message : String(error) }
      }
      const token = randomUUID()
      const preview: RewindPreview = { token, selectedUserEntryId: selected, anchorUserEntryId: anchor, prompt, rewindToRunStart: anchor !== selected, receipt: checkpoint?.receipt, checkout, worktree: { linked: facts.linked, primary: facts.primary }, restore: { available: Boolean(snapshot) && !reason, reason, fingerprint: snapshot?.fingerprint, changes: snapshot?.changes ?? [] }, warning }
      for (const [key, value] of this.tokens) if (value.expires < Date.now()) this.tokens.delete(key)
      if (this.tokens.size >= 100) this.tokens.delete(this.tokens.keys().next().value!)
      this.tokens.set(token, { runtimeId, session: canonicalSessionPath(session), preview, checkpoint: snapshot, expires: Date.now() + 5 * 60_000 })
      return structuredClone(preview)
    })
  }
  async execute(runtimeIdValue: unknown, sessionValue: unknown, tokenValue: unknown, optionsValue: unknown = { restoreFiles: false }): Promise<RewindResult> {
    const runtimeId = requireId(runtimeIdValue, 'runtime id')
    const session = requireString(sessionValue, 'session path', { min: 1, max: 4096 })
    const token = requireId(tokenValue, 'preview token')
    const options = requireRecord(optionsValue, 'rewind options')
    rejectUnknownKeys(options, ['restoreFiles', 'confirmation', 'fingerprint'], 'rewind options')
    if (typeof options.restoreFiles !== 'boolean') throw new TypeError('restoreFiles must be a boolean')
    const reservation = this.tokens.get(token)
    if (!reservation || reservation.expires < Date.now() || reservation.runtimeId !== runtimeId || reservation.session !== canonicalSessionPath(session)) throw new Error('Rewind preview is invalid or expired')
    if (options.restoreFiles && (options.confirmation !== 'restore' || !reservation.preview.restore.available || !reservation.checkpoint || options.fingerprint !== reservation.checkpoint.fingerprint)) throw new Error('Confirmed matching checkpoint preview is required')
    this.tokens.delete(token)
    return this.manager.withRewind(runtimeId, session, async (runtime, fork) => {
      const preview = reservation.preview
      const messages = await forkMessages(runtime)
      if (!messages.some((item) => item.entryId === preview.anchorUserEntryId && item.text === preview.prompt)) throw new Error('Rewind preview is stale')
      const run = async (): Promise<RewindResult> => {
        const checkpoint = reservation.checkpoint
        if (options.restoreFiles && checkpoint) {
          const facts = await this.worktree(preview.checkout, runtimeId)
          if (facts.reason) throw new Error(facts.reason)
          const fresh = this.receipts.previewCheckpoint(preview.checkout, checkpoint.snapshotId)
          if (fresh.fingerprint !== checkpoint.fingerprint || JSON.stringify(fresh.changes) !== JSON.stringify(checkpoint.changes)) throw new Error('Stale restore preview')
        }
        const response = await fork(preview.anchorUserEntryId)
        if (!isRecord(response.data) || typeof response.data.cancelled !== 'boolean') throw new Error('Fork result is unavailable; session may have changed')
        if (response.data.cancelled) return { kind: 'cancelled' }
        const result = runtime.snapshot()
        if (!result.sessionFile || !result.sessionId || canonicalSessionPath(result.sessionFile) === canonicalSessionPath(session)) throw new Error('Fork completed but a new session identity is unavailable; files were not restored')
        const base = { sessionFile: result.sessionFile, sessionId: result.sessionId, prompt: typeof response.data.text === 'string' ? response.data.text : preview.prompt }
        if (!options.restoreFiles || !checkpoint) return { kind: 'rewound', ...base, files: 'kept' }
        let restoring = false
        try {
          const facts = await this.worktree(preview.checkout, runtimeId)
          if (facts.reason) throw new Error(facts.reason)
          if (!this.manager.has(runtimeId)) throw new Error('Runtime exited after fork; files were not restored')
          const fresh = this.receipts.previewCheckpoint(preview.checkout, checkpoint.snapshotId)
          if (fresh.fingerprint !== checkpoint.fingerprint || JSON.stringify(fresh.changes) !== JSON.stringify(checkpoint.changes)) throw new Error('Stale restore preview')
          restoring = true
          this.receipts.restoreCheckpoint(preview.checkout, checkpoint)
          return { kind: 'rewound', ...base, files: 'restored' }
        } catch (error) {
          return { kind: 'restore-failed', ...base, error: error instanceof Error ? error.message : String(error), filesMayBePartial: restoring }
        }
      }
      return options.restoreFiles ? this.gate.runExclusiveWorktree(preview.checkout, runtimeId, run) : run()
    })
  }
}
