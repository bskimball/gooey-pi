import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentCollaborationBridge } from '../../apps/desktop/electron/main/collaboration/agent-bridge'
import { configureGooeyPiAgentMessageSigning, parseGooeyPiAgentMessage } from 'apex-core/collaboration/message-envelope'
import type { AgentRpcManager } from '../../apps/desktop/electron/main/agent-rpc'
import type { ApexEventEnvelope, HarnessId, RuntimeInfo, SessionRecord, TranscriptMessage } from '../../apps/desktop/src/types/api'

const bridges: AgentCollaborationBridge[] = []
configureGooeyPiAgentMessageSigning(Buffer.alloc(32, 7))

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
})

const source: SessionRecord = {
  id: '019f0000-0000-7000-8000-000000000001', harness: 'pi', filePath: '/sessions/source.jsonl', projectPath: '/project', title: 'Planner',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'running', depth: 0,
}
const target: SessionRecord = {
  id: '019f0000-0000-7000-8000-000000000002', harness: 'pi', filePath: '/sessions/target.jsonl', projectPath: '/project', title: 'API owner',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z', status: 'idle', depth: 0,
}
const foreign: SessionRecord = {
  ...target, id: '019f0000-0000-7000-8000-000000000003', filePath: '/sessions/foreign.jsonl', projectPath: '/other', title: 'Other project',
}
const child: SessionRecord = {
  ...target, id: '019f0000-0000-7000-8000-000000000004', filePath: '/sessions/child.jsonl', title: 'Child agent', depth: 1,
}
const archived: SessionRecord = {
  ...target, id: '019f0000-0000-7000-8000-000000000005', filePath: '/sessions/archived.jsonl', title: 'Archived peer', archived: true,
}
const created: SessionRecord = {
  ...target, id: '019f0000-0000-7000-8000-000000000006', filePath: '/sessions/created.jsonl', title: 'Model reviewer', status: 'running',
}

function service(records: SessionRecord[], transcripts: Record<string, TranscriptMessage[]> = {}) {
  return {
    list: vi.fn(async (_projectPath?: unknown, includeArchived?: unknown) => includeArchived ? records : records.filter((record) => !record.archived)),
    read: vi.fn(async (filePath: unknown) => transcripts[String(filePath)] ?? []),
  }
}

function manager(runtime?: RuntimeInfo, onCreate?: () => void) {
  let current = runtime
  const listeners = new Set<(envelope: ApexEventEnvelope) => void>()
  const dialogs: Record<string, unknown>[] = []
  return {
    listeners,
    dialogs,
    subscribe: (listener: (envelope: ApexEventEnvelope) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    emit: (runtimeId: string, event: Record<string, unknown>) => { for (const listener of listeners) listener({ runtimeId, event }) },
    sessionSnapshot: vi.fn((_runtimeId: string) => ({ dialogs })),
    getForSession: vi.fn((filePath: string) => current?.sessionFile === filePath ? current : undefined),
    start: vi.fn(async ({ cwd, sessionPath, model, fast }: { cwd: string; sessionPath?: string; model?: string; fast?: boolean }) => {
      if (sessionPath) current = { runtimeId: 'runtime-awakened', harness: target.harness, sessionId: target.id, sessionFile: sessionPath, cwd, isStreaming: false }
      else {
        onCreate?.()
        const fastModeSupported = model === 'openai-codex/gpt-5.6-sol'
        current = {
          runtimeId: 'runtime-created', harness: created.harness, sessionId: created.id, sessionFile: created.filePath, cwd, isStreaming: false,
          availableThinkingLevels: ['low', 'high'], fastModeSupported,
          ...(fast ? { fastModeAvailable: fastModeSupported, serviceTier: fastModeSupported ? 'priority' : 'default' } : {}),
        }
      }
      return current
    }),
    command: vi.fn(async () => ({ ok: true })),
    list: vi.fn(() => current ? [current] : []),
    stop: vi.fn(async () => true),
  }
}

const defaultTargetTranscript: TranscriptMessage[] = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Implement the API.' }] },
  { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'The endpoint is ready.' }] },
]

interface ScheduledFakeTimer {
  callback: () => void
  requestedAt: number
  delayMs: number
  dueAt: number
  unref: () => void
}

class FakeCollaborationWaitClock {
  private readonly pending: ScheduledFakeTimer[] = []
  private readonly waiters: Array<(timer: ScheduledFakeTimer) => void> = []

  constructor(private currentTime = 10_000) {}

  readonly now = (): number => this.currentTime

  readonly setTimeout = (callback: () => void, delayMs: number): { unref(): void } => {
    const timer: ScheduledFakeTimer = {
      callback,
      requestedAt: this.currentTime,
      delayMs,
      dueAt: this.currentTime + delayMs,
      unref: vi.fn(),
    }
    const waiter = this.waiters.shift()
    if (waiter) waiter(timer)
    else this.pending.push(timer)
    return timer
  }

  readonly clearTimeout = vi.fn((timer: { unref(): void }) => {
    const index = this.pending.findIndex((entry) => entry === timer)
    if (index >= 0) this.pending.splice(index, 1)
  })

  takeNextTimer(): Promise<ScheduledFakeTimer> {
    const timer = this.pending.shift()
    if (timer) return Promise.resolve(timer)
    return new Promise((resolveTimer) => this.waiters.push(resolveTimer))
  }

  fireAt(timer: ScheduledFakeTimer, timestamp: number): void {
    this.currentTime = timestamp
    timer.callback()
  }
}

async function fixture(
  live = true,
  targetTranscript: TranscriptMessage[] = defaultTargetTranscript,
  waitClock?: FakeCollaborationWaitClock,
  projects?: ConstructorParameters<typeof AgentCollaborationBridge>[0]['projects'],
) {
  const records = [source, target, foreign, child, archived]
  const apexSessions = service(records, {
    [target.filePath]: targetTranscript,
  })
  const targetRuntime: RuntimeInfo | undefined = live ? {
    runtimeId: 'runtime-target', harness: 'pi', sessionId: target.id, sessionFile: target.filePath, cwd: '/project', isStreaming: false,
  } : undefined
  const apexManager = manager(targetRuntime, () => records.push(created))
  const bridge = new AgentCollaborationBridge({
    extensionPath: '/app/extensions/apex-collaboration.ts',
    sessions: { pi: apexSessions },
    agents: { pi: apexManager as unknown as AgentRpcManager },
    catalogs: {
      pi: {
        catalog: vi.fn(async (_force = false, disabled: ReadonlySet<string> = new Set(), disabledModels: ReadonlySet<string> = new Set()) => ({
          apexVersion: 'test', refreshedAt: '2026-01-01T00:00:00.000Z',
          providers: [
            { id: 'openai-codex', name: 'OpenAI Codex', authMethod: 'oauth' as const, configured: true, modelCount: 1, availableModelCount: 1, enabled: !disabled.has('openai-codex') },
            { id: 'hidden', name: 'Hidden', authMethod: 'api_key' as const, configured: true, modelCount: 1, availableModelCount: 1, enabled: !disabled.has('hidden') },
          ],
          models: [{
            key: 'openai-codex/gpt-5.6-sol', provider: 'openai-codex', id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol',
            reasoning: true, input: ['text'] as const, contextWindow: 128_000, maxTokens: 16_000,
            availableThinkingLevels: ['low', 'high', 'max'] as const, fastModeSupported: true, available: true, enabled: !disabledModels.has('openai-codex/gpt-5.6-sol'),
          }, {
            key: 'hidden/secret', provider: 'hidden', id: 'secret', name: 'Secret', reasoning: true, input: ['text'] as const,
            contextWindow: 128_000, maxTokens: 16_000, availableThinkingLevels: ['high'] as const, fastModeSupported: false, available: true, enabled: !disabledModels.has('hidden/secret'),
          }, {
            key: 'openai-codex/desktop-hidden', provider: 'openai-codex', id: 'desktop-hidden', name: 'Desktop Hidden', reasoning: false, input: ['text'] as const,
            contextWindow: 128_000, maxTokens: 16_000, availableThinkingLevels: ['off'] as const, fastModeSupported: false, available: true, enabled: !disabledModels.has('openai-codex/desktop-hidden'),
          }],
        })),
      },
    } as unknown as ConstructorParameters<typeof AgentCollaborationBridge>[0]['catalogs'],
    disabledProviders: { pi: () => new Set(['hidden']) },
    disabledModels: { pi: () => new Set(['openai-codex/desktop-hidden']) },
    ...(waitClock ? { waitClock } : {}),
    ...(projects ? { projects } : {}),
  })
  await bridge.start()
  bridges.push(bridge)
  const environment = bridge.environmentFor({ cwd: '/project', sessionPath: source.filePath, harness: 'pi' })
  const call = async (method: string, params: Record<string, unknown> = {}, token = environment.GOOEYPI_COLLABORATION_TOKEN, signal?: AbortSignal) => {
    const response = await fetch(environment.GOOEYPI_COLLABORATION_URL!, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ method, params }), signal,
    })
    return { status: response.status, body: await response.json() as { ok: boolean; result?: Record<string, unknown> | Array<Record<string, unknown>>; error?: string } }
  }
  return { bridge, call, environment, apexManager, apexSessions, records }
}

describe('AgentCollaborationBridge', () => {
  it('serializes three concurrent HTTP creates', async () => {
    const { call, apexManager } = await fixture()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const original = apexManager.start.getMockImplementation()!
    apexManager.start.mockImplementationOnce(async (args) => { await gate; return original(args) })
    const first = call('create', { prompt: 'one' })
    await vi.waitFor(() => expect(apexManager.start).toHaveBeenCalledTimes(1))
    const rest = [call('create', { prompt: 'two' }), call('create', { prompt: 'three' })]
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(apexManager.start).toHaveBeenCalledTimes(1)
    release()
    const results = await Promise.all([first, ...rest])
    expect(results.map((result) => result.status)).toEqual([200, 200, 200])
    expect(apexManager.start).toHaveBeenCalledTimes(3)
  })

  it('bounds pending creations and rejects them immediately on revocation', async () => {
    const { call, apexManager, bridge, environment } = await fixture()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const original = apexManager.start.getMockImplementation()!
    apexManager.start.mockImplementationOnce(async (args) => { await gate; return original(args) })
    const first = call('create', { prompt: 'one' })
    await vi.waitFor(() => expect(apexManager.start).toHaveBeenCalledTimes(1))
    const pending = Array.from({ length: 4 }, (_, index) => call('create', { prompt: `pending ${index}` }))
    const queues = (bridge as unknown as { creationQueues: Map<string, { pending: unknown[] }> }).creationQueues
    await vi.waitFor(() => expect(queues.get(environment.GOOEYPI_COLLABORATION_TOKEN!)?.pending).toHaveLength(4))
    const overflow = await call('create', { prompt: 'overflow' })
    expect(overflow.status).toBe(409)
    expect(overflow.body.error).toMatch(/Too many/)
    bridge.revoke(environment.GOOEYPI_COLLABORATION_TOKEN)
    expect((await Promise.all(pending)).map((result) => result.status)).toEqual([409, 409, 409, 409])
    release()
    expect((await first).status).toBe(409)
    expect(apexManager.start).toHaveBeenCalledTimes(1)
    expect(apexManager.command).not.toHaveBeenCalled()
    expect(apexManager.stop).toHaveBeenCalledWith('runtime-created')
  })

  it('binds an ordinary new runtime when its first session file is actually reported by the manager', async () => {
    const { call, bridge, apexManager, records } = await fixture()
    const environment = bridge.environmentFor({ cwd: source.projectPath, harness: 'pi' })
    bridge.bindSession(environment.GOOEYPI_COLLABORATION_TOKEN, undefined, 'ordinary-runtime')
    expect((await call('list', {}, environment.GOOEYPI_COLLABORATION_TOKEN)).body.error).toContain('not available yet')
    records.push(created)
    apexManager.list.mockReturnValue([{ runtimeId: 'ordinary-runtime', harness: 'pi', cwd: source.projectPath, sessionFile: created.filePath, isStreaming: false }])
    apexManager.emit('ordinary-runtime', { type: 'session_persisted', sessionFile: foreign.filePath })
    const bound = await call('list', {}, environment.GOOEYPI_COLLABORATION_TOKEN)
    expect(bound.status).toBe(200)
    expect(bound.body.result).toEqual(expect.arrayContaining([expect.objectContaining({ id: source.id }), expect.objectContaining({ id: target.id })]))
    expect(bound.body.result).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]))
  })

  it('binds source authority to the runtime cwd and refuses a replacement project grant', async () => {
    let owner = 'original-grant'
    const collaborationScope = vi.fn(async (cwd: string) => ({ projectId: cwd === '/project' ? owner : 'other-project', folders: [cwd] }))
    const { call, records, apexManager } = await fixture(true, defaultTargetTranscript, undefined, { collaborationScope })
    records[0] = { ...source, projectPath: '/other' }
    expect((await call('list')).body.error).toContain('project grant changed')
    records[0] = source
    expect((await call('models')).status).toBe(200)
    owner = 'replacement-grant'
    expect((await call('list')).body.error).toContain('project grant changed')
    expect(apexManager.start).not.toHaveBeenCalled()
    expect(apexManager.command).not.toHaveBeenCalled()
  })

  it('starts in an authorized linked folder and hides coordinators only from list', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'apex-collab-'))
    try {
      const canonical = realpathSync(folder)
      const collaborationScope = vi.fn(async (cwd: string) => {
        if (cwd === '/project' || cwd === canonical || cwd === folder) return { projectId: 'a', folders: ['/project', canonical] }
        throw new TypeError('not granted')
      })
      const { call, apexManager, records } = await fixture(true, defaultTargetTranscript, undefined, { collaborationScope })
      records.push({ ...target, id: '019f0000-0000-7000-8000-000000000009', filePath: '/sessions/coordinator.jsonl', role: 'coordinator' } as SessionRecord)
      const listed = await call('list')
      expect(JSON.stringify(listed.body.result)).not.toContain('019f0000-0000-7000-8000-000000000009')
      expect((await call('read', { target_session_id: '019f0000-0000-7000-8000-000000000009' })).status).toBe(200)
      expect((await call('create', { prompt: 'linked task', cwd: folder })).status).toBe(200)
      expect(apexManager.start).toHaveBeenCalledWith({ cwd: canonical })
    } finally { rmSync(folder, { recursive: true, force: true }) }
  })

  it('uses project identity for peers and denies a different create cwd', async () => {
    const collaborationScope = vi.fn(async (cwd: string) => {
      if (cwd === '/project' || cwd === '/other') return { projectId: 'project-a', folders: ['/project', '/other'] }
      if (cwd === '/foreign') return { projectId: 'project-b', folders: ['/foreign'] }
      throw new TypeError('not granted')
    })
    const { call, apexManager } = await fixture(true, defaultTargetTranscript, undefined, { collaborationScope })
    const listed = await call('list')
    expect(listed.body.result).toEqual(expect.arrayContaining([expect.objectContaining({ id: foreign.id })]))
    const denied = await call('create', { prompt: 'no', cwd: '/foreign' })
    expect(denied.status).toBe(400)
    expect(apexManager.start).not.toHaveBeenCalled()
  })

  it('revokes a runtime claim and clears its cached and pending session bindings', async () => {
    const { bridge, call, environment } = await fixture()
    const token = environment.GOOEYPI_COLLABORATION_TOKEN!
    const active = bridge.environmentFor({ cwd: '/project', sessionPath: source.filePath, harness: 'pi' })
    await expect(call('list')).resolves.toMatchObject({ status: 200 })
    bridge.bindSession(token, undefined, 'runtime-pending')

    const state = bridge as unknown as {
      sourcesByToken: Map<string, unknown>
      pendingRuntimeTokens: Map<string, string>
    }
    expect(state.sourcesByToken.has(token)).toBe(true)
    expect(state.pendingRuntimeTokens.get('runtime-pending')).toBe(token)

    expect(bridge.revoke(token)).toBe(true)
    expect(bridge.revoke(token)).toBe(false)
    expect(state.sourcesByToken.has(token)).toBe(false)
    expect(state.pendingRuntimeTokens.has('runtime-pending')).toBe(false)
    bridge.bindSession(token, undefined, 'runtime-late')
    expect(state.pendingRuntimeTokens.has('runtime-late')).toBe(false)
    await expect(call('list')).resolves.toMatchObject({ status: 401 })
    await expect(call('list', {}, active.GOOEYPI_COLLABORATION_TOKEN)).resolves.toMatchObject({ status: 200 })
  })

  it('lists and reads only same-project peers through bounded snapshots', async () => {
    const { call, environment } = await fixture()
    expect(environment.GOOEYPI_COLLABORATION_EXTENSION_PATH).toBe('/app/extensions/apex-collaboration.ts')
    const listed = await call('list')
    expect(listed.status).toBe(200)
    expect(listed.body.result).toEqual([expect.objectContaining({ id: target.id, title: 'API owner', live: true })])

    const read = await call('read', { target_session_id: target.id })
    expect(read.status).toBe(200)
    expect(read.body.result).toMatchObject({
      session: { id: target.id, harness: 'pi' },
      live: true,
      estimated_tokens: expect.any(Number),
      token_limit: 30_000,
      truncated: false,
    })
    expect(JSON.stringify(read.body.result)).toContain('The endpoint is ready.')

    const denied = await call('read', { target_session_id: foreign.id })
    expect(denied.status).toBe(409)
    expect(denied.body.error).toContain('not found in this working directory')
    const childDenied = await call('read', { target_session_id: child.id })
    expect(childDenied.status).toBe(409)
    expect(childDenied.body.error).toContain('not found in this working directory')
    const archivedDenied = await call('read', { target_session_id: archived.id })
    expect(archivedDenied.status).toBe(409)
    expect(archivedDenied.body.error).toContain('not found in this working directory')
  })

  it('keeps conversational I/O separate from bounded tool outcome summaries', async () => {
    const toolOnly: TranscriptMessage[] = Array.from({ length: 45 }, (_, index) => ({
      id: `tool-${index}`,
      role: 'tool',
      parts: [{ type: 'toolResult', name: 'shell', text: `SECRET_TOOL_RESULT_${index}` }],
    }))
    const { call } = await fixture(true, [
      { id: 'input', role: 'user', parts: [{ type: 'text', text: 'VISIBLE_USER_INPUT' }, { type: 'image' }] },
      ...toolOnly,
      { id: 'internal', role: 'system', parts: [{ type: 'text', text: 'SECRET_SYSTEM_TEXT' }] },
      { id: 'goal', role: 'goal', parts: [{ type: 'text', text: 'SECRET_GOAL_TEXT' }] },
      { id: 'output', role: 'assistant', parts: [
        { type: 'thinking', text: 'VISIBLE_THINKING' },
        { type: 'toolCall', name: 'dangerous_tool', args: { secret: 'SECRET_TOOL_ARGUMENT' } },
        { type: 'toolResult', name: 'dangerous_tool', text: 'SECRET_INLINE_TOOL_RESULT' },
        { type: 'compaction', status: 'done', summary: 'SECRET_COMPACTION_SUMMARY' },
        { type: 'text', text: 'VISIBLE_ASSISTANT_OUTPUT' },
      ] },
    ])

    const read = await call('read', { target_session_id: target.id })
    expect(read.status).toBe(200)
    expect(read.body.result).toMatchObject({ token_limit: 30_000, truncated: false })
    const snapshot = read.body.result as Record<string, unknown>
    expect(snapshot.operations).toMatchObject({ truncated: true, character_limit: 6000, summaries: expect.any(Array) })
    const serialized = JSON.stringify(snapshot.messages)
    expect(serialized).toContain('VISIBLE_USER_INPUT')
    expect(serialized).toContain('[image omitted]')
    expect(serialized).toContain('[thinking]\\nVISIBLE_THINKING')
    expect(serialized).toContain('VISIBLE_ASSISTANT_OUTPUT')
    expect(serialized).not.toContain('SECRET_TOOL_RESULT')
    expect(serialized).not.toContain('SECRET_SYSTEM_TEXT')
    expect(serialized).not.toContain('SECRET_GOAL_TEXT')
    expect(serialized).not.toContain('SECRET_TOOL_ARGUMENT')
    expect(serialized).not.toContain('SECRET_INLINE_TOOL_RESULT')
    expect(serialized).not.toContain('SECRET_COMPACTION_SUMMARY')
  })

  it('bounds tool-only errors and todo summaries independently of conversational history', async () => {
    const { call } = await fixture(true, [
      ...Array.from({ length: 12 }, (_, index): TranscriptMessage => ({ id: `operation-${index}`, role: 'tool', parts: [{ type: 'toolResult', name: 'bash', text: 'x'.repeat(10_000), isError: true }] })),
      { id: 'todo', role: 'assistant', parts: [{ type: 'toolCall', name: 'todo_write', args: { todos: [{ content: 'Fix compiler error', status: 'in_progress' }] } }] },
    ])
    const read = await call('read', { target_session_id: target.id })
    expect(read.status).toBe(200)
    const snapshot = read.body.result as { messages: unknown[]; operations: { summaries: Array<{ kind: string; name: string; status: string; text: string }>; truncated: boolean; character_limit: number } }
    expect(snapshot.messages).toEqual([])
    expect(snapshot.operations.summaries).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'todo', text: 'in_progress: Fix compiler error' }), expect.objectContaining({ kind: 'tool', status: 'error' })]))
    expect(snapshot.operations.summaries.length).toBeLessThanOrEqual(10)
    expect(snapshot.operations.summaries.reduce((sum, item) => sum + item.name.length + item.text.length + item.status.length, 0)).toBeLessThanOrEqual(6000)
    expect(snapshot.operations.truncated).toBe(true)
  })

  it('caps session reads at 30,000 estimated tokens and marks truncation', async () => {
    const { call } = await fixture(true, [
      { id: 'older', role: 'user', parts: [{ type: 'text', text: `START_${'a'.repeat(79_988)}_END` }] },
      { id: 'newer', role: 'assistant', parts: [{ type: 'text', text: 'b'.repeat(80_000) }] },
    ])

    const read = await call('read', { target_session_id: target.id })
    expect(read.status).toBe(200)
    expect(read.body.result).toMatchObject({ estimated_tokens: 30_000, token_limit: 30_000, truncated: true })
    const messages = (read.body.result as { messages: Array<{ text: string }> }).messages
    expect(messages.map(({ text }) => text).join('').length).toBe(120_000)
    expect(messages[0]?.text).toContain('[...message truncated...]')
    expect(messages[0]?.text).toContain('START_')
    expect(messages[0]?.text).toContain('_END')
  })

  it('delivers attributed messages to a live target and returns a wait cursor', async () => {
    const { call, apexManager } = await fixture()
    const sent = await call('send', { target_session_id: target.id, message: 'Please claim src/api.ts.' })
    expect(sent.status).toBe(200)
    expect(sent.body.result).toMatchObject({ delivered: true, target_session_id: target.id, queued: false })
    expect(sent.body.result).toHaveProperty('cursor_before')
    expect(apexManager.command).toHaveBeenCalledWith('runtime-target', expect.objectContaining({ type: 'prompt' }))
    const delivered = (apexManager.command.mock.calls[0] as unknown as [string, { message: string }])[1]
    expect(delivered.message).toContain(`"from_session_id":"${source.id}"`)
    expect(delivered.message).toContain('"reply_with":"gooeypi_session_send"')
    expect(delivered.message).not.toContain('"from_title"')
    expect(delivered.message).not.toContain('"from_harness"')
    expect(delivered.message).not.toContain(source.title)
    expect(delivered.message).not.toContain(target.title)
    expect(delivered.message).not.toContain('Implement the API.')
    expect(delivered.message).not.toContain('The endpoint is ready.')
    const metadata = JSON.parse(delivered.message.split('\n')[1]!) as Record<string, unknown>
    expect(Object.keys(metadata).sort()).toEqual([
      'from_session_id', 'nonce', 'reply_with', 'sent_at', 'signature', 'version',
    ])
    expect(metadata.version).toBe(3)
    expect(parseGooeyPiAgentMessage(delivered.message)).toEqual({
      fromSessionId: source.id,
      text: 'Please claim src/api.ts.',
    })

    const waited = await call('wait', { target_session_id: target.id, timeout_ms: 100 })
    expect(waited.status).toBe(200)
    expect(waited.body.result).toMatchObject({ timed_out: false, live: true })
  })

  it('lists GUI-visible models and creates a readable peer with the selected model and reasoning', async () => {
    const { bridge, call, apexManager } = await fixture()
    const createdEnvironment = bridge.environmentFor({ cwd: '/project', harness: 'pi' })
    bridge.bindSession(createdEnvironment.GOOEYPI_COLLABORATION_TOKEN, undefined, 'runtime-created')
    const models = await call('models', { query: 'GPT five six sol' })
    expect(models.status).toBe(200)
    expect(models.body.result).toMatchObject({
      models: [{ key: 'openai-codex/gpt-5.6-sol', reasoning_levels: ['low', 'high', 'max'] }],
      matched: 1,
    })
    expect(JSON.stringify(models.body.result)).not.toContain('Secret')
    const visible = await call('models')
    expect(JSON.stringify(visible.body.result)).not.toContain('Desktop Hidden')

    const response = await call('create', {
      prompt: 'Review the model integration.', title: 'Model reviewer', model: 'GPT five six sol', reasoning: 'very high', fast: true,
    })
    expect(response.status).toBe(200)
    expect(response.body.result).toMatchObject({
      created: true,
      session: { id: created.id, harness: 'pi', title: 'Model reviewer', live: true },
      runtime_id: 'runtime-created',
      model: { key: 'openai-codex/gpt-5.6-sol' },
      reasoning: 'max',
      fast_mode: { requested: true, enabled: true, available: true },
    })
    expect(apexManager.start).toHaveBeenCalledWith({
      cwd: '/project', model: 'openai-codex/gpt-5.6-sol', thinking: 'max', fast: true,
    })
    expect(apexManager.command).toHaveBeenNthCalledWith(1, 'runtime-created', {
      type: 'prompt', message: expect.any(String), streamingBehavior: 'followUp',
    })
    const initialPrompt = (apexManager.command.mock.calls[0] as unknown as [string, { message: string }])[1].message
    expect(parseGooeyPiAgentMessage(initialPrompt)).toEqual({
      fromSessionId: source.id, text: 'Review the model integration.',
    })
    expect(apexManager.command).toHaveBeenCalledWith('runtime-created', { type: 'set_session_name', name: 'Model reviewer' })
    expect(apexManager.command).toHaveBeenCalledWith('runtime-created', { type: 'get_state' })
    const createdList = await call('list', {}, createdEnvironment.GOOEYPI_COLLABORATION_TOKEN)
    expect(createdList.status).toBe(200)
    expect(createdList.body.result).toEqual(expect.arrayContaining([expect.objectContaining({ id: target.id })]))
    expect(createdList.body.result).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]))
  })

  it('rejects an MCP auth creation prompt before starting a peer runtime', async () => {
    const { call, apexManager } = await fixture()

    const response = await call('create', { prompt: '/mcp-auth notion' })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('Network MCP authentication is managed outside Apex')
    expect(apexManager.start).not.toHaveBeenCalled()
  })

  it('rejects an MCP auth delivery before waking or queuing a peer runtime', async () => {
    const { call, apexManager } = await fixture(false)

    const response = await call('send', { target_session_id: target.id, message: '/mcp-auth notion' })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('Network MCP authentication is managed outside Apex')
    expect(apexManager.start).not.toHaveBeenCalled()
    expect(apexManager.command).not.toHaveBeenCalled()
  })

  it('starts normally and reports unavailable when fast mode is requested without model support', async () => {
    const { call, apexManager } = await fixture()
    const response = await call('create', { prompt: 'Review the fallback.', fast: true })
    expect(response.status).toBe(200)
    expect(response.body.result).toMatchObject({
      created: true,
      fast_mode: { requested: true, enabled: false, available: false },
    })
    expect(apexManager.start).toHaveBeenCalledWith({ cwd: '/project', fast: true })
  })

  it('serializes concurrent deliveries to the same target', async () => {
    const { call, apexManager } = await fixture()
    let releaseFirst!: () => void
    apexManager.command
      .mockImplementationOnce(() => new Promise((resolveCommand) => { releaseFirst = () => resolveCommand({ ok: true }) }))
      .mockResolvedValue({ ok: true })
    const first = call('send', { target_session_id: target.id, message: 'First' })
    await vi.waitFor(() => expect(apexManager.command).toHaveBeenCalledTimes(1))
    const second = call('send', { target_session_id: target.id, message: 'Second' })
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
    expect(apexManager.command).toHaveBeenCalledTimes(1)
    releaseFirst()
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 200 }), expect.objectContaining({ status: 200 }),
    ])
    expect(apexManager.command).toHaveBeenCalledTimes(2)
  })

  it('allows only one active wait per target and reads idle transcripts only at admission and deadline', async () => {
    const { call, apexSessions } = await fixture()
    const read = await call('read', { target_session_id: target.id })
    const cursor = (read.body.result as Record<string, unknown>).cursor
    const readsBefore = apexSessions.read.mock.calls.length
    const first = call('wait', { target_session_id: target.id, after_cursor: cursor, timeout_ms: 150 })
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
    const duplicate = await call('wait', { target_session_id: target.id, after_cursor: cursor, timeout_ms: 150 })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error).toContain('already active')
    const completed = await first
    expect(completed.body.result).toMatchObject({ timed_out: true })
    expect(apexSessions.read.mock.calls.length - readsBefore).toBeLessThanOrEqual(2)
  })

  it('re-arms an early timeout wake without polling the transcript early', async () => {
    const clock = new FakeCollaborationWaitClock()
    const { call, apexSessions } = await fixture(true, defaultTargetTranscript, clock)
    const read = await call('read', { target_session_id: target.id })
    const cursor = (read.body.result as Record<string, unknown>).cursor
    const readsBefore = apexSessions.read.mock.calls.length
    const waiting = call('wait', { target_session_id: target.id, after_cursor: cursor, timeout_ms: 150 })

    const firstTimer = await clock.takeNextTimer()
    expect(firstTimer).toMatchObject({ requestedAt: 10_000, delayMs: 150, dueAt: 10_150 })
    expect(firstTimer.unref).toHaveBeenCalledOnce()
    expect(apexSessions.read.mock.calls.length - readsBefore).toBe(1)

    clock.fireAt(firstTimer, firstTimer.dueAt - 25)
    const replacementTimer = await clock.takeNextTimer()
    expect(replacementTimer).toMatchObject({ requestedAt: 10_125, delayMs: 25, dueAt: 10_150 })
    expect(replacementTimer.unref).toHaveBeenCalledOnce()
    expect(apexSessions.read.mock.calls.length - readsBefore).toBe(1)

    clock.fireAt(replacementTimer, replacementTimer.dueAt)
    const completed = await waiting
    expect(completed.body.result).toMatchObject({ timed_out: true })
    expect(clock.now()).toBe(10_150)
    expect(apexSessions.read.mock.calls.length - readsBefore).toBe(2)
  })

  it('reports a transcript change found by the final deadline snapshot', async () => {
    const changedTranscript: TranscriptMessage[] = [
      ...defaultTargetTranscript,
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'The deadline update is ready.' }] },
    ]
    const clock = new FakeCollaborationWaitClock()
    const { call, apexSessions } = await fixture(true, defaultTargetTranscript, clock)
    let reads = 0
    apexSessions.read.mockImplementation(async () => {
      reads += 1
      return reads >= 3 ? changedTranscript : defaultTargetTranscript
    })
    const read = await call('read', { target_session_id: target.id })
    const cursor = (read.body.result as Record<string, unknown>).cursor

    const waiting = call('wait', { target_session_id: target.id, after_cursor: cursor, timeout_ms: 50 })
    const deadlineTimer = await clock.takeNextTimer()
    expect(deadlineTimer).toMatchObject({ requestedAt: 10_000, delayMs: 50, dueAt: 10_050 })
    expect(deadlineTimer.unref).toHaveBeenCalledOnce()
    clock.fireAt(deadlineTimer, deadlineTimer.dueAt)
    const completed = await waiting

    expect(completed.body.result).toMatchObject({ timed_out: false })
    expect((completed.body.result as Record<string, unknown>).messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'a2', text: 'The deadline update is ready.' }),
    ]))
    expect(clock.now()).toBe(10_050)
    expect(reads).toBe(3)
  })

  it('waits on three busy targets without polling and wakes for sanitized human input or runtime errors', async () => {
    const { call, apexManager, apexSessions, records } = await fixture()
    records[2] = { ...foreign, projectPath: source.projectPath }
    records.push(created)
    const peers = [target, records[2], created]
    const runtimes = peers.map((session, index): RuntimeInfo => ({ runtimeId: `run-${index}`, harness: 'pi', cwd: source.projectPath, sessionId: session.id, sessionFile: session.filePath, isStreaming: true }))
    apexManager.getForSession.mockImplementation((path) => runtimes.find((runtime) => runtime.sessionFile === path))
    apexManager.list.mockImplementation(() => runtimes)
    const pending = call('wait', { target_session_ids: peers.map((session) => session.id), timeout_ms: 5_000 })
    await vi.waitFor(() => expect(apexSessions.read).toHaveBeenCalledTimes(3))
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30))
    expect(apexSessions.read).toHaveBeenCalledTimes(3)
    expect(apexManager.listeners.size).toBe(2)
    apexManager.sessionSnapshot.mockImplementation((runtimeId) => ({ dialogs: runtimeId === 'run-0' ? [{ id: 'private-answer-id', method: 'confirm', title: 'Deploy?', message: 'Private prompt', options: ['secret'], deadline: Date.now() + 60_000 }] : [] }))
    apexManager.emit('run-0', { type: 'extension_ui_request', id: 'private-answer-id', method: 'confirm' })
    const ready = await pending
    expect(ready.status).toBe(200)
    expect(ready.body.result).toMatchObject({ timed_out: false, changed_session_ids: [target.id], snapshots: expect.arrayContaining([expect.objectContaining({ session: expect.objectContaining({ id: target.id, status: 'waiting' }), waiting_for_user: { count: 1, method: 'confirm', title: 'Deploy?', deadline: expect.any(Number) } })]) })
    const snapshots = (ready.body.result as { snapshots: Array<{ token_limit: number; operations: { character_limit: number } }> }).snapshots
    expect(snapshots.map((snapshot) => snapshot.token_limit)).toEqual([10_000, 10_000, 10_000])
    expect(snapshots.map((snapshot) => snapshot.operations.character_limit)).toEqual([2_000, 2_000, 2_000])
    expect(JSON.stringify(ready.body)).not.toContain('private-answer-id')
    expect(JSON.stringify(ready.body)).not.toContain('secret')
    expect(JSON.stringify(ready.body)).not.toContain('Private prompt')
    expect(apexManager.listeners.size).toBe(1)
    apexManager.sessionSnapshot.mockReturnValue({ dialogs: [] })
    const errorWait = call('wait', { target_session_id: created.id, timeout_ms: 5_000 })
    await vi.waitFor(() => expect(apexManager.listeners.size).toBe(2))
    apexManager.emit('run-2', { type: 'error', error: 'Compiler rejected the change' })
    expect((await errorWait).body.result).toMatchObject({ timed_out: false, last_error: 'Compiler rejected the change', session: { id: created.id, status: 'failed' } })
    expect(apexManager.listeners.size).toBe(1)
  })

  it('cancels wait subscriptions and deadlines on HTTP disconnect and token revocation', async () => {
    const clock = new FakeCollaborationWaitClock()
    const { call, bridge, environment, apexManager } = await fixture(true, defaultTargetTranscript, clock)
    const cursor = ((await call('read', { target_session_id: target.id })).body.result as Record<string, unknown>).cursor
    const controller = new AbortController()
    const disconnected = call('wait', { target_session_id: target.id, after_cursor: cursor }, environment.GOOEYPI_COLLABORATION_TOKEN, controller.signal)
    await vi.waitFor(() => expect(apexManager.listeners.size).toBe(2))
    controller.abort()
    await expect(disconnected).rejects.toThrow()
    await vi.waitFor(() => expect(apexManager.listeners.size).toBe(1))
    expect(clock.clearTimeout).toHaveBeenCalledOnce()
    const revoked = call('wait', { target_session_id: target.id, after_cursor: cursor })
    await vi.waitFor(() => expect(apexManager.listeners.size).toBe(2))
    bridge.revoke(environment.GOOEYPI_COLLABORATION_TOKEN)
    expect((await revoked).body.error).toContain('Capability expired')
    expect(apexManager.listeners.size).toBe(1)
    expect(clock.clearTimeout).toHaveBeenCalledTimes(2)
  })

  it('steers and aborts only authorized peer turns, without answering dialogs or waking stopped peers', async () => {
    const { call, apexManager } = await fixture()
    const runtime = apexManager.list()[0]
    apexManager.getForSession.mockReturnValue({ ...runtime, isStreaming: true })
    expect((await call('steer', { target_session_id: target.id, message: 'Use the new acceptance criteria.' })).status).toBe(200)
    expect(apexManager.command).toHaveBeenLastCalledWith(runtime.runtimeId, { type: 'steer', message: expect.any(String) })
    const envelope = (apexManager.command.mock.calls[0] as unknown as [string, { message: string }])[1].message
    expect(parseGooeyPiAgentMessage(envelope)).toEqual({ fromSessionId: source.id, text: 'Use the new acceptance criteria.' })
    expect((await call('stop', { target_session_id: target.id })).body.result).toMatchObject({ stopped: true })
    expect(apexManager.command).toHaveBeenLastCalledWith(runtime.runtimeId, { type: 'abort' })
    expect((await call('stop', { target_session_id: foreign.id })).status).toBe(409)
    expect((await call('steer', { target_session_id: foreign.id, message: 'No' })).status).toBe(409)
    expect((await call('extension_ui_response', { target_session_id: target.id, id: 'approval', confirmed: true })).status).toBe(400)
    apexManager.getForSession.mockReturnValue(undefined)
    expect((await call('stop', { target_session_id: target.id })).body.result).toMatchObject({ stopped: false })
    expect(apexManager.command).toHaveBeenCalledTimes(2)
    expect(apexManager.start).not.toHaveBeenCalled()
    expect(apexManager.stop).not.toHaveBeenCalled()
  })

  it('rejects ambiguous, repeated, cross-project, or excessive wait targets', async () => {
    const { call } = await fixture()
    expect((await call('wait', { target_session_id: target.id, target_session_ids: [target.id] })).status).toBe(400)
    expect((await call('wait', { target_session_ids: [target.id], after_cursor: 'cursor' })).status).toBe(400)
    expect((await call('wait', { target_session_ids: [target.id, target.id] })).status).toBe(400)
    expect((await call('wait', { target_session_ids: Array.from({ length: 17 }, () => target.id) })).status).toBe(400)
    expect((await call('wait', { target_session_ids: [target.id, foreign.id] })).status).toBe(409)
  })

  it('wakes an offline target while rejecting missing source scope and invalid tokens', async () => {
    const { bridge, call, environment } = await fixture(false)
    const offline = await call('send', { target_session_id: target.id, message: 'Hello' })
    expect(offline.status).toBe(200)
    expect(offline.body.result).toMatchObject({ delivered: true, awakened: true })
    expect((await call('list', {}, 'wrong')).status).toBe(401)

    const unbound = bridge.environmentFor({ cwd: '/project', harness: 'pi' as HarnessId })
    const response = await fetch(unbound.GOOEYPI_COLLABORATION_URL!, {
      method: 'POST', headers: { authorization: `Bearer ${unbound.GOOEYPI_COLLABORATION_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'list', params: {} }),
    })
    expect(response.status).toBe(409)
    expect((await response.json() as { error: string }).error).toContain('not available yet')
    expect(environment.GOOEYPI_COLLABORATION_TOKEN).not.toBe(unbound.GOOEYPI_COLLABORATION_TOKEN)
  })

  it('rejects a subagent source even when its runtime token is otherwise valid', async () => {
    const { bridge, environment } = await fixture()
    const childEnvironment = bridge.environmentFor({ cwd: '/project', sessionPath: child.filePath, harness: 'pi' })
    const response = await fetch(environment.GOOEYPI_COLLABORATION_URL!, {
      method: 'POST', headers: { authorization: `Bearer ${childEnvironment.GOOEYPI_COLLABORATION_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'list', params: {} }),
    })
    expect(response.status).toBe(409)
    expect((await response.json() as { error: string }).error).toContain('top-level sessions')
  })
})
