import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalSessionPath } from 'apex-core/session-paths'
import { isRecord, requireId, requireString } from 'apex-core/validation'
import type { RunHistoricalContent, RunHistoricalFile, RunReceipt } from '../../src/types/api'
import { CheckoutSnapshotStore, type RestorePreview, type SnapshotEntry } from './checkout-snapshots'
import { RpcCommandRejectedError, type RpcRuntime } from './agent-rpc/runtime'
import type { RpcObject } from './agent-rpc/types'

interface StoredReceipt extends RunReceipt { checkout: string; before?: string; after?: string; baselineLeaf: string | null }
interface OpenRun { receipt: StoredReceipt; generation: number; admissions: number; hinted: boolean; settled: boolean; retrying: boolean }
interface RawState { sessionId: string; sessionFile?: string; idle: boolean }

function rawState(response: RpcObject): RawState {
  const data = response.data
  if (response.success !== true || !isRecord(data) || typeof data.sessionId !== 'string' || typeof data.isStreaming !== 'boolean' || typeof data.isCompacting !== 'boolean' || typeof data.pendingMessageCount !== 'number' || !Number.isSafeInteger(data.pendingMessageCount) || data.pendingMessageCount < 0) throw new Error('Pi did not provide a complete run state')
  return { sessionId: data.sessionId, sessionFile: typeof data.sessionFile === 'string' ? data.sessionFile : undefined, idle: !data.isStreaming && !data.isCompacting && data.pendingMessageCount === 0 }
}
function entries(response: RpcObject): { leafId: string | null; entries: Record<string, unknown>[] } {
  const data = response.data
  if (response.success !== true || !isRecord(data) || !Array.isArray(data.entries) || !(data.leafId === null || typeof data.leafId === 'string') || !data.entries.every(isRecord)) throw new Error('Pi did not provide persisted session entries')
  return { leafId: data.leafId, entries: data.entries }
}
function userEntries(data: ReturnType<typeof entries>, baseline: string | null): string[] {
  const byId = new Map(data.entries.filter((entry) => typeof entry.id === 'string').map((entry) => [entry.id, entry]))
  const result: string[] = []
  let id = data.leafId
  const seen = new Set<string>()
  while (id !== baseline) {
    if (!id || seen.has(id)) throw new Error('Unable to reconcile run transcript entries')
    seen.add(id)
    const entry = byId.get(id)
    if (!entry || !(entry.parentId === null || typeof entry.parentId === 'string')) throw new Error('Unable to reconcile run transcript entries')
    if (entry.type === 'message' && isRecord(entry.message) && entry.message.role === 'user') result.push(id)
    id = entry.parentId
  }
  result.reverse()
  if (!result.length) throw new Error('No persisted user entry found for run')
  return result
}
function content(entry: SnapshotEntry | undefined): RunHistoricalContent {
  if (!entry) return null
  if (entry.kind === 'symlink') return { kind: 'symlink', target: entry.target }
  const bytes = Buffer.from(entry.data, 'base64')
  return { kind: 'file', base64: entry.data, binary: bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes), size: bytes.length }
}

export class RunReceipts {
  private readonly snapshots: CheckoutSnapshotStore
  private readonly receiptsDir: string
  private readonly queues = new Map<string, Promise<void>>()
  private readonly open = new Map<string, OpenRun>()
  private readonly activity = new Map<string, number>()
  constructor(directory: string, private readonly validateSession: (path: string) => Promise<string>, private readonly onTerminalChange: (sessionFile: string) => void = () => {}) {
    this.receiptsDir = join(directory, 'receipts')
    mkdirSync(this.receiptsDir, { recursive: true, mode: 0o700 })
    this.snapshots = new CheckoutSnapshotStore(join(directory, 'snapshots'))
  }
  private save(receipt: StoredReceipt): void {
    const file = join(this.receiptsDir, `${receipt.id}.json`)
    const temp = `${file}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 })
    renameSync(temp, file)
  }
  private notifyTerminal(receipt: StoredReceipt): void {
    if (receipt.sessionFile) this.onTerminalChange(receipt.sessionFile)
  }
  private boundary<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve()
    const current = previous.then(task, task)
    const tail = current.then(() => undefined, () => undefined)
    this.queues.set(id, tail)
    void tail.then(() => { if (this.queues.get(id) === tail) this.queues.delete(id) })
    return current
  }
  async admit(runtime: RpcRuntime, command: RpcObject, forward: (command: RpcObject) => Promise<RpcObject>): Promise<RpcObject> {
    const id = runtime.runtimeId
    const admitted = await this.boundary(id, async () => {
      let run = this.open.get(id)
      if (!run) {
        const initial = runtime.snapshot()
        const generation = this.activity.get(id) ?? 0
        const receipt: StoredReceipt = { id: randomUUID(), sessionId: initial.sessionId ?? '', sessionFile: initial.sessionFile, checkout: initial.cwd, startedAt: new Date().toISOString(), state: 'open', memberUserEntryIds: [], inputs: [], baselineLeaf: null, attribution: 'observed-checkout' }
        try {
          const state = rawState(await runtime.command({ type: 'get_state' }))
          receipt.sessionId = state.sessionId
          receipt.sessionFile = state.sessionFile
          if (!state.idle) throw new Error('Run started while Pi was already busy')
          receipt.baselineLeaf = entries(await runtime.command({ type: 'get_entries' })).leafId
          receipt.before = this.snapshots.capture(receipt.checkout)
          const confirmed = rawState(await runtime.command({ type: 'get_state' }))
          if (!confirmed.idle || confirmed.sessionId !== state.sessionId || (state.sessionFile && confirmed.sessionFile !== state.sessionFile) || (this.activity.get(id) ?? 0) !== generation) throw new Error('Session or activity changed during pre-run capture')
        } catch (error) { receipt.error = error instanceof Error ? error.message : String(error) }
        this.save(receipt)
        run = { receipt, generation: 0, admissions: 0, hinted: false, settled: false, retrying: false }
        this.open.set(id, run)
      }
      if (command.type === 'attached_prompt') {
        command.type = run.admissions || run.generation ? command.intent === 'steer' ? 'steer' : 'follow_up' : 'prompt'
        delete command.intent
      }
      run.generation++
      run.admissions++
      run.settled = false
      const kind = command.type === 'steer' ? 'steer' : command.type === 'follow_up' ? 'follow_up' : 'prompt'
      const input: RunReceipt['inputs'][number] = { kind, disposition: 'pending' }
      run.receipt.inputs.push(input)
      this.save(run.receipt)
      const response = forward(command)
      return { run, response, input }
    })
    try {
      const response = await admitted.response
      const disposition = isRecord(response.data) ? response.data.disposition : undefined
      admitted.input.disposition = response.success !== true ? 'rejected' : disposition === 'started' || disposition === 'queued' || disposition === 'handled' ? disposition : 'uncertain'
      if (admitted.input.disposition === 'uncertain') admitted.run.receipt.error = 'Prompt delivery disposition is uncertain'
      return response
    } catch (error) {
      admitted.input.disposition = error instanceof RpcCommandRejectedError ? 'rejected' : 'uncertain'
      if (admitted.input.disposition === 'uncertain') admitted.run.receipt.error = 'Prompt delivery is uncertain'
      throw error
    } finally {
      admitted.run.admissions--
      const wasOpen = this.open.get(id) === admitted.run
      if (wasOpen && !admitted.run.admissions && !admitted.run.receipt.inputs.some((input) => input.disposition === 'started' || input.disposition === 'queued')) {
        admitted.run.receipt.state = 'incomplete'
        admitted.run.receipt.error ??= 'No confirmed agent run was started'
        admitted.run.receipt.finishedAt = new Date().toISOString()
        if (this.open.get(id) === admitted.run) this.open.delete(id)
      }
      this.save(admitted.run.receipt)
      if (wasOpen && admitted.run.receipt.state === 'incomplete') this.notifyTerminal(admitted.run.receipt)
      if (admitted.run.hinted) this.schedule(runtime)
    }
  }
  async mutate(runtime: RpcRuntime, forward: () => Promise<RpcObject>): Promise<RpcObject> {
    const dispatched = await this.boundary(runtime.runtimeId, async () => {
      const run = this.open.get(runtime.runtimeId)
      if (run) {
        run.receipt.state = 'incomplete'
        run.receipt.error = 'Session or checkout mutation interrupted run observation'
        run.receipt.finishedAt = new Date().toISOString()
        this.save(run.receipt)
        this.open.delete(runtime.runtimeId)
        this.notifyTerminal(run.receipt)
      }
      return { response: forward() }
    })
    return dispatched.response
  }
  event(runtime: RpcRuntime, event: RpcObject): void {
    const activity = ['agent_start', 'turn_start', 'message_start', 'tool_execution_start', 'auto_compaction_start'].includes(String(event.type))
    if (activity) this.activity.set(runtime.runtimeId, (this.activity.get(runtime.runtimeId) ?? 0) + 1)
    const run = this.open.get(runtime.runtimeId)
    if (!run) { if (event.type === 'runtime_exit') this.activity.delete(runtime.runtimeId); return }
    const sessionFile = runtime.snapshot().sessionFile
    if (sessionFile && !run.receipt.sessionFile) { run.receipt.sessionFile = sessionFile; this.save(run.receipt) }
    if (event.type === 'runtime_exit' || event.type === 'transport_error') {
      run.receipt.state = 'incomplete'; run.receipt.error = 'Runtime exited before run capture completed'; run.receipt.finishedAt = new Date().toISOString()
      this.save(run.receipt); this.open.delete(runtime.runtimeId); this.activity.delete(runtime.runtimeId); this.notifyTerminal(run.receipt); return
    }
    if (event.type === 'agent_end' || event.type === 'agent_settled') { run.hinted = true; if (event.type === 'agent_settled') run.settled = true; this.schedule(runtime) }
    else if (activity) { run.generation++; run.settled = false }
  }
  private schedule(runtime: RpcRuntime): void {
    void this.boundary(runtime.runtimeId, async () => {
      const run = this.open.get(runtime.runtimeId)
      if (!run || run.admissions || !run.settled) return
      run.hinted = false
      try {
        const state = rawState(await runtime.command({ type: 'get_state' }))
        if (!state.idle) {
          if (!run.retrying) {
            run.retrying = true
            const timer = setTimeout(() => { run.retrying = false; if (this.open.get(runtime.runtimeId) === run) this.schedule(runtime) }, 250)
            timer.unref()
          }
          return
        }
        if (state.sessionId !== run.receipt.sessionId) throw new Error('Session changed during run')
        const generation = run.generation
        const after = this.snapshots.capture(run.receipt.checkout)
        const transcript = entries(await runtime.command({ type: 'get_entries' }))
        const final = rawState(await runtime.command({ type: 'get_state' }))
        if (!final.idle || final.sessionId !== state.sessionId || run.generation !== generation || run.admissions) throw new Error('Run changed during post-run capture')
        if (run.receipt.sessionFile && final.sessionFile && canonicalSessionPath(run.receipt.sessionFile) !== canonicalSessionPath(final.sessionFile)) throw new Error('Session file changed during run')
        run.receipt.sessionFile = final.sessionFile ?? state.sessionFile
        if (!run.receipt.sessionFile) throw new Error('Session file is unavailable')
        run.receipt.memberUserEntryIds = userEntries(transcript, run.receipt.baselineLeaf)
        run.receipt.anchorUserEntryId = run.receipt.memberUserEntryIds[0]
        run.receipt.after = after
        if (!run.receipt.before || run.receipt.error) throw new Error(run.receipt.error ?? 'Pre-run snapshot unavailable')
        run.receipt.changes = this.snapshots.diff(run.receipt.before, after)
        run.receipt.state = 'complete'
      } catch (error) {
        run.receipt.state = 'incomplete'; run.receipt.error = error instanceof Error ? error.message : String(error)
      }
      if (this.open.get(runtime.runtimeId) !== run) return
      run.receipt.finishedAt = new Date().toISOString()
      this.save(run.receipt)
      this.open.delete(runtime.runtimeId)
      this.notifyTerminal(run.receipt)
    }).catch((error) => console.error('[run-receipts] completion failed:', error))
  }
  private async forSession(path: string): Promise<StoredReceipt[]> {
    const session = canonicalSessionPath(await this.validateSession(requireString(path, 'session path', { min: 1, max: 4096 })))
    return readdirSync(this.receiptsDir).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name)).map((name) => {
      const receipt: StoredReceipt = JSON.parse(readFileSync(join(this.receiptsDir, name), 'utf8'))
      return receipt
    }).filter((receipt) => receipt.sessionFile && canonicalSessionPath(receipt.sessionFile) === session)
  }
  async list(path: string): Promise<RunReceipt[]> {
    const active = new Set([...this.open.values()].map((run) => run.receipt.id))
    return (await this.forSession(path)).map(({ checkout: _checkout, before: _before, after: _after, baselineLeaf: _baseline, ...receipt }): RunReceipt =>
      receipt.state === 'open' && !active.has(receipt.id)
        ? { ...receipt, state: 'incomplete', error: 'Run observation was interrupted before completion' }
        : receipt)
  }
  async checkpoint(session: string, entryId: string): Promise<{ receipt: RunReceipt; before: string } | undefined> {
    requireId(entryId, 'user entry id')
    const receipt = (await this.forSession(session)).find((item) => item.memberUserEntryIds.includes(entryId))
    if (!receipt || receipt.state !== 'complete' || !receipt.before || !receipt.anchorUserEntryId) return undefined
    const { before, after: _after, checkout: _checkout, baselineLeaf: _baseline, ...publicReceipt } = receipt
    return { receipt: publicReceipt, before }
  }
  previewCheckpoint(checkout: string, before: string): RestorePreview {
    return this.snapshots.previewRestore(checkout, before)
  }
  restoreCheckpoint(checkout: string, preview: RestorePreview): void {
    this.snapshots.restore(checkout, preview, 'restore')
  }
  async file(session: string, entryId: string, path: string): Promise<RunHistoricalFile> {
    requireId(entryId, 'user entry id')
    requireString(path, 'path', { min: 1, max: 4096 })
    const receipt = (await this.forSession(session)).find((item) => item.memberUserEntryIds.includes(entryId))
    if (!receipt || receipt.state !== 'complete' || !receipt.before || !receipt.after || !receipt.changes?.some((change) => change.path === path)) throw new Error('Historical run file is unavailable')
    return { before: content(this.snapshots.content(receipt.before, path)), after: content(this.snapshots.content(receipt.after, path)) }
  }
}
