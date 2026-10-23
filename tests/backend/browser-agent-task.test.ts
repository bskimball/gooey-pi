import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { GenerationTask, Harness, createRegistry, type TaskId, type SubmissionId } from '@earendil-works/pi-durable'
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node'
import { hostModels } from '../../browser-agent/host-provider'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runBrowserTask } from '../../browser-agent/agent'
import type { BrowserTaskInput } from '../../browser-agent/agent'
import type { HostRegistry } from '../../browser-agent/host-provider'

const faux = fauxProvider({ provider: 'browser-test', tokensPerSecond: Infinity })
const model = faux.getModel()
const toolMessage = (call: ReturnType<typeof fauxToolCall>) => fauxAssistantMessage(call, { stopReason: 'toolUse' })
const registry: HostRegistry = {
  stream: faux.provider.stream,
  streamSimple: faux.provider.streamSimple,
  getAvailable: () => [model],
  find: (provider, id) => provider === model.provider && id === model.id ? model : undefined,
  getModelOfType: () => undefined,
  classify: async () => { throw new Error('No classifier configured') },
}
let stateDir: string
let unfinishedTask: TaskId
let unfinishedSubmission: SubmissionId
let saved = false
const broker = { call: vi.fn(async (method: string) => {
  if (method === 'click') saved = true
  return method === 'read_page' ? { url: 'https://example.test/ticket', title: 'Ticket', text: saved ? 'Ticket saved' : 'Draft', elements: [{ ref: 0, tag: 'button', name: 'Save' }] } : { ok: true }
}) }
let request = 0
const input = (extra: Partial<BrowserTaskInput> = {}): BrowserTaskInput => ({ goal: 'Save the ticket', model, request_id: `test-${++request}`, timeout_ms: 5000, ...extra })
const options = () => ({ registry, broker, stateDir, sessionId: 'test' })
beforeAll(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'apex-browser-task-'))
  vi.stubEnv('PI_CODING_AGENT_DIR', stateDir)
  vi.stubEnv('APEX_BROWSER_AGENT_CLASSIFIER', undefined)
  const seed = await Harness.open(await openNodeJsonlStorage(join(stateDir, 'test'), BACKGROUND_CONTEXT), { models: hostModels(registry, model), registry: createRegistry() }, BACKGROUND_CONTEXT)
  const conversation = await seed.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: model.provider, modelId: model.id } } }, BACKGROUND_CONTEXT)
  unfinishedTask = await conversation.commit((tx) => tx.createTask(GenerationTask, {}, { ownership: { kind: 'conversation' } }), BACKGROUND_CONTEXT)
  unfinishedSubmission = await conversation.commit(async (tx) => (await tx.createSubmission({ conversationId: conversation.id, type: 'input', status: 'queued' })).id, BACKGROUND_CONTEXT)
  expect(await seed.inspect(BACKGROUND_CONTEXT)).toMatchObject({ scheduling: 'paused', tasks: [expect.anything()], submissions: [expect.anything()] })
  await seed.close(BACKGROUND_CONTEXT)
})
afterAll(async () => {
  vi.unstubAllEnvs()
  await rm(stateDir, { recursive: true, force: true })
})

describe('durable browser task', () => {
  it('runs real assistant tool events through read_page and run, reporting progress and the answer', async () => {
    saved = false
    faux.setResponses([
      toolMessage(fauxToolCall('read_page', {})),
      toolMessage(fauxToolCall('run', { steps: [{ action: 'click', target: { name: 'Save' }, expect: { text_includes: 'Ticket saved' } }] })),
      fauxAssistantMessage('Saved the ticket. https://example.test/ticket, Ticket. Verified Ticket saved.'),
    ])
    const onProgress = vi.fn()
    const result = await runBrowserTask(input({ tab_id: 'tab' }), { ...options(), onProgress })
    expect(result).toMatchObject({ ok: true, status: 'done', tool_calls: 2, model: `${model.provider}/${model.id}` })
    expect(result.answer).toContain('Verified Ticket saved')
    expect(result.conversation_id).not.toBe('')
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0)
    expect(onProgress.mock.calls.flat()).toEqual(['read_page: 1 elements', 'run: 1/1 ok'])
    expect(saved).toBe(true)
    // Opening the seeded store must abort old work before any scheduling starts.
    expect(faux.state.callCount).toBe(3)
    const observer = await Harness.open(await openNodeJsonlStorage(join(stateDir, 'test'), BACKGROUND_CONTEXT), { models: hostModels(registry, model), registry: createRegistry() }, BACKGROUND_CONTEXT)
    try {
      expect(await observer.inspect(BACKGROUND_CONTEXT)).toMatchObject({ tasks: [], submissions: [] })
      expect(await observer.getTask(unfinishedTask, BACKGROUND_CONTEXT)).toMatchObject({ state: { status: 'terminal', outcome: { status: 'aborted' } } })
      const oldSubmission = await observer.submission(unfinishedSubmission, BACKGROUND_CONTEXT)
      expect(await oldSubmission?.wait(BACKGROUND_CONTEXT)).toMatchObject({ status: 'unanswered' })
    } finally {
      await observer.close(BACKGROUND_CONTEXT)
    }
  })
  it('blocks tools beyond budget without executing their side effects', async () => {
    saved = false
    faux.setResponses([
      toolMessage(fauxToolCall('read_page', {})),
      toolMessage(fauxToolCall('run', { steps: [{ action: 'click', target: { name: 'Save' } }] })),
      fauxAssistantMessage('Tool budget exhausted; ticket not saved.'),
    ])
    const result = await runBrowserTask(input({ max_tool_calls: 1 }), options())
    expect(result).toMatchObject({ ok: false, status: 'budget', tool_calls: 1 })
    expect(saved).toBe(false)
  })
  it('returns timeout while a tool is waiting', async () => {
    faux.setResponses([toolMessage(fauxToolCall('run', { steps: [{ action: 'wait', ms: 5000 }] }))])
    const result = await runBrowserTask(input({ timeout_ms: 80 }), options())
    expect(result).toMatchObject({ ok: false, status: 'timeout' })
    expect(result.answer).toContain('timeout')
  })
  it('honors external abort without requesting a model response', async () => {
    const controller = new AbortController()
    controller.abort()
    const count = faux.state.callCount
    const result = await runBrowserTask(input(), { ...options(), signal: controller.signal })
    expect(result).toMatchObject({ ok: false, status: 'aborted', tool_calls: 0 })
    expect(faux.state.callCount).toBe(count)
  })
  it('cancels an active task on external abort and preserves completed progress', async () => {
    const controller = new AbortController()
    faux.setResponses([toolMessage(fauxToolCall('read_page', {}))])
    const result = await runBrowserTask(input(), { ...options(), signal: controller.signal, onProgress: () => controller.abort() })
    expect(result).toMatchObject({ ok: false, status: 'aborted', tool_calls: 1 })
    expect(result.answer).toContain('read_page: 1 elements')
  })
  it('lets the agent report a missing judge classifier', async () => {
    faux.setResponses([toolMessage(fauxToolCall('judge', { condition: 'Ticket saved' })), fauxAssistantMessage('Cannot judge without a classifier.')])
    const result = await runBrowserTask(input(), options())
    expect(result.answer).toContain('Cannot judge')
    expect(result.tool_calls).toBe(1)
  })
  it.each([
    [{ goal: '' }, 'goal'], [{ goal: 'x'.repeat(4001) }, 'goal'], [{ request_id: '' }, 'request_id'], [{ max_tool_calls: 0 }, 'max_tool_calls'], [{ max_tool_calls: 61 }, 'max_tool_calls'], [{ timeout_ms: 600001 }, 'timeout_ms'],
  ])('rejects invalid task input %j', async (extra, message) => {
    await expect(runBrowserTask(input(extra), options())).rejects.toThrow(message)
  })
  it('rejects missing state directory and switching an open session', async () => {
    await expect(runBrowserTask(input(), { ...options(), stateDir: '' })).rejects.toThrow('stateDir')
    await expect(runBrowserTask(input(), { ...options(), sessionId: 'different' })).rejects.toThrow('already open')
  })
})
