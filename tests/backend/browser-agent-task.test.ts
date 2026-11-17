import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { GenerationTask, Harness, createRegistry, type TaskId, type SubmissionId } from '@earendil-works/pi-durable'
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node'
import { hostModels } from '../../apps/desktop/browser-agent/host-provider'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runBrowserTask } from '../../apps/desktop/browser-agent/agent'
import type { BrowserTaskInput } from '../../apps/desktop/browser-agent/agent'
import type { HostRegistry } from '../../apps/desktop/browser-agent/host-provider'

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
const seededSessionId = 'a117a307-07f1-4185-9e8b-5ba7c8f9b15b'
const options = () => ({ registry, broker, stateDir, sessionId: seededSessionId })
beforeAll(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'apex-browser-task-'))
  vi.stubEnv('PI_CODING_AGENT_DIR', stateDir)
  vi.stubEnv('APEX_BROWSER_AGENT_CLASSIFIER', undefined)
  const seed = await Harness.open(await openNodeJsonlStorage(join(stateDir, seededSessionId), BACKGROUND_CONTEXT), { models: hostModels(registry, model), registry: createRegistry() }, BACKGROUND_CONTEXT)
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
    const observer = await Harness.open(await openNodeJsonlStorage(join(stateDir, seededSessionId), BACKGROUND_CONTEXT, { readOnly: true }), { models: hostModels(registry, model), registry: createRegistry(), readOnly: true }, BACKGROUND_CONTEXT)
    try {
      expect(await observer.inspect(BACKGROUND_CONTEXT)).toMatchObject({ tasks: [], submissions: [] })
      expect(await observer.getTask(unfinishedTask, BACKGROUND_CONTEXT)).toMatchObject({ state: { status: 'terminal', outcome: { status: 'aborted' } } })
      const oldSubmission = await observer.submission(unfinishedSubmission, BACKGROUND_CONTEXT)
      expect(await oldSubmission?.status(BACKGROUND_CONTEXT)).toMatchObject({ status: 'unanswered' })
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
  it('rejects a missing state directory', async () => {
    await expect(runBrowserTask(input(), { ...options(), stateDir: '' })).rejects.toThrow('stateDir')
  })
  it('isolates concurrent sessions even when their stores allocate the same conversation ID', async () => {
    let arrived = 0
    let release!: () => void
    const bothReading = new Promise<void>(resolve => { release = resolve })
    const results = await Promise.all(['concurrent-a', 'concurrent-b'].map(async sessionId => {
      const provider = fauxProvider({ provider: sessionId, tokensPerSecond: Infinity })
      const selected = provider.getModel()
      provider.setResponses([
        toolMessage(fauxToolCall('read_page', {})),
        toolMessage(fauxToolCall('run', { steps: [{ action: 'click', target: { name: sessionId } }] })),
        fauxAssistantMessage(`Finished ${sessionId}`),
      ])
      const localRegistry: HostRegistry = {
        ...registry, stream: provider.provider.stream, streamSimple: provider.provider.streamSimple,
        getAvailable: () => [selected], find: (name, id) => name === selected.provider && id === selected.id ? selected : undefined,
      }
      let firstRead = true
      const localBroker = { call: vi.fn(async (method: string, params: Record<string, unknown>) => {
        expect(params.tabId).toBe(sessionId)
        if (method === 'read_page' && firstRead) {
          firstRead = false
          if (++arrived === 2) release()
          await bothReading
        }
        return method === 'read_page' ? { url: 'https://example.test/', title: sessionId, elements: [{ ref: 0, tag: 'button', name: sessionId }] } : { ok: true }
      }) }
      const result = await runBrowserTask(input({ model: selected, tab_id: sessionId }), { ...options(), sessionId, registry: localRegistry, broker: localBroker })
      expect(result).toMatchObject({ ok: true, answer: `Finished ${sessionId}`, tool_calls: 2 })
      expect(localBroker.call.mock.calls.filter(([method]) => method === 'click')).toHaveLength(1)
      return result
    }))
    expect(results[0].conversation_id).toBe(results[1].conversation_id)
  })
  it('switches between case- and punctuation-distinct sessions without sharing stores', async () => {
    const directory = await mkdtemp(join(stateDir, 'switching-'))
    const sessions = ['Issue42', 'issue42', 'issue.42', 'issue_42']
    const turns = [...sessions, sessions[0]]
    const results = []
    for (const [index, sessionId] of turns.entries()) {
      const answer = `Answer ${index} for ${sessionId}`
      faux.setResponses([fauxAssistantMessage(answer)])
      const result = await runBrowserTask(input(), { ...options(), stateDir: directory, sessionId })
      expect(result).toMatchObject({ ok: true, answer })
      results.push(result)
    }
    expect(results.at(-1)?.conversation_id).not.toBe(results[0].conversation_id)

    const paths = (await readdir(directory, { recursive: true })).filter(path => path.endsWith('main.jsonl'))
    expect(paths).toHaveLength(sessions.length)
    const stores = await Promise.all(paths.map(async path => ({ path, transcript: await readFile(join(directory, path), 'utf8') })))
    for (const [index, sessionId] of sessions.entries()) {
      const store = stores.find(({ transcript }) => transcript.includes(`Answer ${index} for ${sessionId}`))
      if (!store) throw new Error(`Missing transcript for ${sessionId}`)
      for (const [otherIndex, otherSession] of turns.entries()) {
        expect(store.transcript.includes(`Answer ${otherIndex} for ${otherSession}`)).toBe(otherSession === sessionId)
      }
      const observer = await Harness.open(await openNodeJsonlStorage(join(directory, dirname(store.path)), BACKGROUND_CONTEXT, { readOnly: true }), { models: hostModels(registry, model), registry: createRegistry(), readOnly: true }, BACKGROUND_CONTEXT)
      try {
        expect(await observer.inspect(BACKGROUND_CONTEXT)).toMatchObject({ tasks: [], submissions: [] })
      } finally {
        await observer.close(BACKGROUND_CONTEXT)
      }
    }
  })
})
