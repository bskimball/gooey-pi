import { describe, expect, it, vi } from 'vitest'
import { observedPath, specialistEvidence } from '../../apps/desktop/src/lib/specialist-evidence'
import { createSessionSummarySelector, extractPiSessionWidgets, summarizeTranscript } from '../../apps/desktop/src/components/inspector/session-summary'
import { createReadinessSelector, extractReadiness } from '../../apps/desktop/src/components/inspector/readiness'
import { specialistMarkState, specialistOutcome, specialistStatusLabel, specialistStepStatus, type SpecialistStatus } from '../../apps/desktop/src/lib/specialist-status'
import { extractPiSpecialistSessions } from '../../apps/desktop/src/components/inspector/SpecialistsPanel'
import type { MessagePart, TranscriptMessage } from '../../apps/desktop/src/types/api'

const message = (id: string, parts: MessagePart[]): TranscriptMessage => ({ id, role: 'assistant', parts })
const fullSummary = (messages: TranscriptMessage[]) => ({ ...summarizeTranscript(messages), ...extractPiSessionWidgets(messages) })

describe('observed specialist source references', () => {
  it('preserves recorded positions without guessing files from shell commands or prompt text', () => {
    const evidence = specialistEvidence(
      [
        message('tools', [
          { type: 'text', text: 'I will edit imaginary.ts' },
          { type: 'toolCall', name: 'bash', args: { command: 'cat ignored.ts', path: 'ignored.ts' } },
          { type: 'toolCall', name: 'functions.read', args: { path: 'src/a.ts', offset: 7 } },
          { type: 'toolCall', name: 'edit', args: { path: 'src/a.ts' } },
          { type: 'toolCall', name: 'editor_open', args: { uri: 'file:///C:/work/a%20b.ts', line: 12 } },
        ]),
      ],
      '/repo',
    )
    expect(evidence.files).toEqual([
      { path: '/repo/src/a.ts', tool: 'edit', line: undefined },
      { path: 'C:/work/a b.ts', tool: 'editor_open', line: 12 },
    ])
    expect(observedPath('relative.ts')).toBeUndefined()
    expect(observedPath('file://%')).toBeUndefined()
    expect(observedPath('file://server/share/a.ts')).toBe('//server/share/a.ts')
  })
})

describe('recorded specialist outcomes', () => {
  it.each([
    { tool: 'task_wait', text: 'lifecycle: failed\nkill_reason: limit exceeded', expected: 'error' },
    { tool: 'task_abort', text: 'lifecycle: aborted', expected: 'stopped' },
    { tool: 'task_wait', text: 'lifecycle: settled\n--- result ---\nCompleted report', expected: 'done' },
    { tool: 'task_status', text: 'lifecycle: running', expected: 'closed' },
  ])('preserves $expected when a worker is closed', ({ tool, text, expected }) => {
    const messages = [
      message('start', [
        { type: 'toolCall', id: 'start-1', name: 'task_start', args: { agent: 'scout', prompt: 'Inspect the project' } },
        { type: 'toolResult', name: 'task_start', text: 'Worker launched', details: { worker: { id: 'task_1' } } },
      ]),
      message('outcome', [
        { type: 'toolCall', name: tool, args: { id: 'task_1' } },
        { type: 'toolResult', name: tool, text },
        { type: 'toolCall', name: 'task_close', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_close', text: 'lifecycle: closed' },
      ]),
    ]
    expect(extractPiSessionWidgets(messages).specialists[0]).toMatchObject({ id: 'start-1', taskId: 'task_1', status: expected })
    expect(extractPiSpecialistSessions(messages)[0]).toMatchObject({ id: 'start-1', taskId: 'task_1', status: expected })
  })

  it('uses structured lifecycle and chain status consistently, and retains older agents for transcript navigation', () => {
    const parts: MessagePart[] = Array.from({ length: 10 }, (_, index): MessagePart[] => [
      { type: 'toolCall', id: `start-${index}`, name: 'task_start', args: { agent: 'scout', prompt: `Mission ${index}` } },
      { type: 'toolResult', name: 'task_start', text: `started task_${index}` },
    ]).flat()
    parts.push(
      { type: 'toolCall', name: 'task_status', args: { id: 'task_0' } },
      { type: 'toolResult', name: 'task_status', text: 'Worker snapshot', details: { worker: { lifecycle: 'failed' } } },
      {
        type: 'toolCall',
        id: 'chain',
        name: 'task_chain',
        args: {
          steps: [
            { agent: 'scout', prompt: 'First' },
            { agent: 'oracle', prompt: 'Second' },
          ],
        },
      },
      { type: 'toolResult', name: 'task_chain', text: 'Chain snapshot', streaming: true, details: { steps: [{ status: 'done' }, { status: 'aborted' }] } },
    )
    const messages = [message('all', parts)]
    const summary = extractPiSessionWidgets(messages).specialists
    const details = extractPiSpecialistSessions(messages)
    expect(summary).toHaveLength(12)
    expect(summary.map(({ id, status }) => ({ id, status }))).toEqual(details.map(({ id, status }) => ({ id, status })))
    expect(summary[0].status).toBe('error')
    expect(summary.slice(-2).map((item) => item.status)).toEqual(['done', 'stopped'])
  })

  it('keeps terminal outcomes until a new generation, and agrees on waiting and mode-less sends', () => {
    const start: MessagePart[] = [
      { type: 'toolCall', id: 'start-1', name: 'task_start', args: { agent: 'scout', prompt: 'Inspect' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_1', details: { worker: { id: 'task_1', waiting_ui_requests: [{ id: 'q1' }] } } },
    ]
    const waiting = [message('m', start)]
    expect(extractPiSessionWidgets(waiting).specialists[0].status).toBe('waiting')
    expect(extractPiSpecialistSessions(waiting)[0].status).toBe('waiting')

    const settledThenAborted = [
      message('m', [
        ...start,
        { type: 'toolCall', name: 'task_wait', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_wait', text: 'lifecycle: settled', details: { worker: { waiting_ui_requests: [] } } },
        { type: 'toolCall', name: 'task_abort', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_abort', text: 'lifecycle: aborted' },
        { type: 'toolCall', name: 'task_send', args: { id: 'task_1', message: 'note' } },
        { type: 'toolResult', name: 'task_send', text: 'queued' },
      ]),
    ]
    expect(extractPiSessionWidgets(settledThenAborted).specialists[0].status).toBe('done')
    expect(extractPiSpecialistSessions(settledThenAborted)[0].status).toBe('done')

    const reprompted = [
      message('m', [
        ...settledThenAborted[0].parts,
        { type: 'toolCall', name: 'task_send', args: { id: 'task_1', mode: 'prompt', message: 'Next' } },
        { type: 'toolResult', name: 'task_send', text: 'prompt sent' },
      ]),
    ]
    expect(extractPiSessionWidgets(reprompted).specialists[0].status).toBe('running')
  })

  it('distinguishes a final report from interim text and preserves it through close receipts', () => {
    const messages = [
      message('run', [
        { type: 'toolCall', name: 'task_start', args: { agent: 'scout', prompt: 'Inspect' } },
        { type: 'toolResult', name: 'task_start', text: 'started task_1' },
        { type: 'toolCall', name: 'task_status', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_status', text: 'lifecycle: running', details: { worker: { latestText: 'Still investigating' } } },
      ]),
    ]
    expect(extractPiSpecialistSessions(messages)[0].finalReport).toBeUndefined()
    messages.push(
      message('finished', [
        { type: 'toolCall', name: 'task_wait', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_wait', text: 'lifecycle: settled\n--- result ---\nFull final report' },
        { type: 'toolCall', name: 'task_close', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_close', text: 'lifecycle: closed\n--- result (truncated tail) ---\nreport' },
      ]),
    )
    expect(extractPiSpecialistSessions(messages)[0].finalReport).toBe('Full final report')
  })

  it('pairs parallel same-tool calls in one message and settles task_wait({ ids }) through close', () => {
    const parallel = [
      message('p', [
        { type: 'toolCall', id: 'c1', name: 'task_start', args: { agent: 'scout', prompt: 'One' } },
        { type: 'toolCall', id: 'c2', name: 'task_start', args: { agent: 'oracle', prompt: 'Two' } },
        { type: 'toolResult', name: 'task_start', text: 'started task_1' },
        { type: 'toolResult', name: 'task_start', text: 'started task_2' },
        { type: 'toolCall', id: 'w1', name: 'task_wait', args: { id: 'task_1' } },
        { type: 'toolCall', id: 'w2', name: 'task_wait', args: { id: 'task_2' } },
        { type: 'toolResult', name: 'task_wait', text: 'lifecycle: settled' },
        { type: 'toolResult', name: 'task_wait', text: 'lifecycle: settled' },
      ]),
    ]
    expect(extractPiSessionWidgets(parallel).specialists.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'c1', status: 'done' },
      { id: 'c2', status: 'done' },
    ])

    const waitIdsClosed = [
      message('w', [
        { type: 'toolCall', id: 's1', name: 'task_start', args: { agent: 'scout', prompt: 'One' } },
        { type: 'toolResult', name: 'task_start', text: 'started task_1' },
        { type: 'toolCall', id: 's2', name: 'task_start', args: { agent: 'oracle', prompt: 'Two' } },
        { type: 'toolResult', name: 'task_start', text: 'started task_2' },
        { type: 'toolCall', name: 'task_wait', args: { ids: ['task_1', 'task_2'] } },
        { type: 'toolResult', name: 'task_wait', text: 'task_1 settled\nothers: task_2 running', details: { worker: { id: 'task_1', lifecycle: 'settled' } } },
        { type: 'toolCall', name: 'task_close', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_close', text: 'lifecycle: closed' },
      ]),
    ]
    expect(extractPiSessionWidgets(waitIdsClosed).specialists.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 's1', status: 'done' },
      { id: 's2', status: 'running' },
    ])
  })

  it('applies Async Task Settled tool results and Async RPC worker settled text through task_close and selector', () => {
    const start1 = message('s1', [
      { type: 'toolCall', id: 's1', name: 'task_start', args: { agent: 'machinist', prompt: 'Build' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_1' },
    ])
    const start2 = message('s2', [
      { type: 'toolCall', id: 's2', name: 'task_start', args: { agent: 'oracle', prompt: 'Review' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_2' },
    ])
    const settledTool = message('async-tool', [{ type: 'toolResult', name: 'Async Task Settled', text: 'task_1: settled\ntask_2: failed' }])
    const closeBoth = message('close', [
      { type: 'toolCall', name: 'task_close', args: { id: 'task_1' } },
      { type: 'toolResult', name: 'task_close', text: 'lifecycle: closed' },
      { type: 'toolCall', name: 'task_close', args: { id: 'task_2' } },
      { type: 'toolResult', name: 'task_close', text: 'lifecycle: closed' },
    ])
    const select = createSessionSummarySelector()
    const toolMessages = [start1, start2, settledTool, closeBoth]
    expect(select(toolMessages).specialists.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 's1', status: 'done' },
      { id: 's2', status: 'error' },
    ])

    const settledText = message('async-text', [{ type: 'text', text: 'Async RPC worker settled:\ntask_1: settled\ntask_2: failed' }])
    const selectText = createSessionSummarySelector()
    expect(selectText([start1, start2, settledText, closeBoth]).specialists.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 's1', status: 'done' },
      { id: 's2', status: 'error' },
    ])
  })

  it('keeps recycled handles separate and applies receipts to the current worker', () => {
    const launch = (callId: string, id: string, instanceId: string, agent: string, verb = 'started') => message(callId, [
      { type: 'toolCall', id: callId, name: 'task_start', args: { agent, prompt: callId } },
      { type: 'toolResult', name: 'task_start', text: `${verb} ${id}`, details: { worker: { id, instanceId } } },
    ])
    const first = launch('First scout', 'task_1', 'scout-instance', 'scout')
    const historical = [
      first,
      launch('First advisor', 'task_7', 'advisor-instance', 'advisor'),
      message('parent-reset', [
        { type: 'toolCall', name: 'task_list', args: { include_settled: true } },
        { type: 'toolResult', name: 'task_list', text: 'No async RPC workers.', details: { list: { includeSettled: true, total: 0, workers: [] } } },
      ]),
    ]
    expect(extractPiSpecialistSessions(historical).map(({ id, status }) => [id, status])).toEqual([['worker:scout-instance', 'closed'], ['worker:advisor-instance', 'closed']])

    const second = launch('Second worker', 'task_1', 'machinist-instance', 'machinist')
    const recent = [...historical, second, message('receipts', [
      { type: 'toolCall', name: 'task_status', args: { id: 'task_1' } },
      { type: 'toolResult', name: 'task_status', text: 'lifecycle: failed', details: { worker: { id: 'task_1', instanceId: 'scout-instance', lifecycle: 'failed' } } },
      { type: 'toolResult', name: 'Async Task Settled', text: 'Async RPC worker settled:\ntask_1: failed  agent=scout  gen=1  turns=2' },
      { type: 'toolCall', name: 'task_wait', args: { ids: ['task_1'] } },
      { type: 'toolResult', name: 'task_wait', text: 'task_1 settled\n--- result ---\nSecond worker report' },
    ])]
    const records = extractPiSpecialistSessions(recent)
    expect(records.map(({ id, agent, instanceId, status, finalReport }) => ({ id, agent, instanceId, status, finalReport }))).toEqual([
      { id: 'worker:scout-instance', agent: 'scout', instanceId: 'scout-instance', status: 'closed', finalReport: undefined },
      { id: 'worker:advisor-instance', agent: 'advisor', instanceId: 'advisor-instance', status: 'closed', finalReport: undefined },
      { id: 'worker:machinist-instance', agent: 'machinist', instanceId: 'machinist-instance', status: 'done', finalReport: 'Second worker report' },
    ])
    expect(records.at(-1)).toMatchObject({ taskId: 'task_1', launchCallId: 'Second worker' })
    expect(createSessionSummarySelector()(recent).specialists.map(({ id, status }) => ({ id, status }))).toEqual(records.map(({ id, status }) => ({ id, status })))

    expect(extractPiSpecialistSessions([second])[0]?.id).toBe(records.at(-1)?.id)

    const reused = launch('Follow-up mission', 'task_1', 'machinist-instance', 'machinist', 'reused')
    const replacement = launch('Fresh mission', 'task_1', 'oracle-instance', 'oracle')
    const reusedRecords = extractPiSpecialistSessions([...recent, reused])
    expect(reusedRecords).toHaveLength(3)
    expect(reusedRecords.at(-1)).toMatchObject({ id: 'worker:machinist-instance', status: 'running', mission: 'Follow-up mission' })
    expect(reusedRecords.at(-1)?.messages.filter(({ role }) => role === 'user')).toHaveLength(2)
    expect(extractPiSpecialistSessions([...recent, reused, replacement]).slice(-2).map(({ id, status }) => [id, status])).toEqual([
      ['worker:machinist-instance', 'closed'], ['worker:oracle-instance', 'running'],
    ])
  })

  it('shows a failed launch without taking the handle from the active instance', () => {
    const records = extractPiSpecialistSessions([message('m', [
      { type: 'toolCall', id: 'active', name: 'task_start', args: { agent: 'scout', prompt: 'Active mission' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_3', details: { worker: { id: 'task_3', instanceId: 'active-worker' } } },
      { type: 'toolCall', id: 'failed', name: 'task_start', args: { agent: 'oracle', prompt: 'Failed mission' } },
      { type: 'toolResult', name: 'task_start', text: 'reused task_3', details: { worker: { id: 'task_3', instanceId: 'active-worker' } }, isError: true },
      { type: 'toolCall', name: 'task_wait', args: { id: 'task_3' } },
      { type: 'toolResult', name: 'task_wait', text: 'task_3 settled' },
      { type: 'toolCall', id: 'first-error', name: 'task_start', args: { agent: 'scribe', prompt: 'Another failure' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_4', isError: true },
    ])])
    expect(records.map(({ id, taskId, agent, status }) => ({ id, taskId, agent, status }))).toEqual([
      { id: 'worker:active-worker', taskId: 'task_3', agent: 'scout', status: 'done' },
      { id: 'failed', taskId: 'task_3', agent: 'oracle', status: 'error' },
      { id: 'first-error', taskId: 'task_4', agent: 'scribe', status: 'error' },
    ])
    expect(records[1]?.instanceId).toBeUndefined()

    const [orphanFailure] = extractPiSpecialistSessions([message('failed-reuse', [
      { type: 'toolCall', id: 'attempt', name: 'task_start', args: { agent: 'oracle' } },
      { type: 'toolResult', name: 'task_start', text: 'reused task_3', isError: true, details: { worker: { id: 'task_3', instanceId: 'someone-else', sessionFile: '/other/worker.jsonl' } } },
    ])])
    expect(orphanFailure).toMatchObject({ id: 'attempt', status: 'error' })
    expect(orphanFailure?.instanceId).toBeUndefined()
    expect(orphanFailure?.sessionFile).toBeUndefined()
  })

  it('keeps legacy launch keys when an older worker with the same handle leaves the transcript window', () => {
    const launch = (id: string) => message(id, [
      { type: 'toolCall', id, name: 'task_start', args: { agent: 'scout' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_1' },
    ])
    const recent = launch('new-call')
    const full = extractPiSpecialistSessions([launch('old-call'), recent])
    expect(full[0]?.id).not.toBe(full[1]?.id)
    expect(extractPiSpecialistSessions([recent])[0]?.id).toBe(full[1]?.id)
  })

  it('routes the next control through a successful rebind without changing the UI key', () => {
    const messages = [message('m', [
      { type: 'toolCall', id: 'old', name: 'task_start', args: { agent: 'scout', prompt: 'First mission' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_1', details: { worker: { id: 'task_1', instanceId: 'scout-instance' } } },
      { type: 'toolCall', name: 'task_rebind', args: {} },
      { type: 'toolResult', name: 'task_rebind', text: 'rebound task_6 instance=scout-instance session_dir=/workers/scout' },
      { type: 'toolCall', name: 'task_wait', args: { id: 'task_6' } },
      { type: 'toolResult', name: 'task_wait', text: 'task_6 settled' },
    ])]
    const records = extractPiSpecialistSessions(messages)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ id: 'worker:scout-instance', taskId: 'task_6', status: 'done' })
  })

  it('ignores failed todo_write, merges by id when merge=true, and extracts codemode todo_write', () => {
    const messages = [
      message('todos', [
        {
          type: 'toolCall',
          name: 'todo_write',
          args: {
            todos: [
              { id: 't1', content: 'First', status: 'in_progress' },
              { id: 't2', content: 'Second', status: 'pending' },
            ],
          },
        },
        { type: 'toolResult', name: 'todo_write', text: 'ok' },
        { type: 'toolCall', name: 'todo_write', args: { todos: [{ id: 'bad', content: 'Broken', status: 'pending' }] } },
        { type: 'toolResult', name: 'todo_write', text: 'validation failed', isError: true },
        {
          type: 'toolCall',
          name: 'todo_write',
          args: {
            merge: true,
            todos: [
              { id: 't1', content: 'First', status: 'completed' },
              { id: 't3', content: 'Third', status: 'pending' },
            ],
          },
        },
        { type: 'toolResult', name: 'todo_write', text: 'ok' },
        {
          type: 'toolCall',
          name: 'codemode',
          args: { code: "await tools.todo_write({ merge: true, todos: [{ id: 't2', content: 'Second', status: 'completed' }, { id: 't3', content: 'Third', status: 'completed' }] })" },
        },
        { type: 'toolResult', name: 'codemode', text: 'ok' },
      ]),
    ]
    expect(extractPiSessionWidgets(messages).todos).toEqual([
      { id: 't1', content: 'First', status: 'completed', note: undefined },
      { id: 't2', content: 'Second', status: 'completed', note: undefined },
      { id: 't3', content: 'Third', status: 'completed', note: undefined },
    ])
  })
})

describe('incremental inspector summary', () => {
  it('does not reread historical parts or reparse widgets during text-only updates', () => {
    const select = createSessionSummarySelector()
    const readParts = vi.fn((): MessagePart[] => [{ type: 'toolCall', name: 'Read', args: { path: 'a.ts' } }])
    const history = Array.from({ length: 1000 }, (_, index): TranscriptMessage => ({
      id: `history-${index}`,
      role: 'assistant',
      get parts() {
        return readParts()
      },
    }))
    const readArgs = vi.fn(() => ({ agent: 'scout', prompt: 'Inspect the project' }))
    const start: MessagePart = {
      type: 'toolCall',
      id: 'start',
      name: 'task_start',
      get args() {
        return readArgs()
      },
    }
    const result: MessagePart = { type: 'toolResult', name: 'task_start', text: 'started task_1' }
    const tail = (text: string) => message('tail', [start, result, { type: 'text', text }])
    const initial = select([...history, tail('Initial')])
    expect(initial.toolCount).toBe(1001)
    expect(initial.specialists[0]?.id).toBe('start')
    readParts.mockClear()
    readArgs.mockClear()
    for (let index = 0; index < 10; index++) {
      const summary = select([...history, tail(`Update ${index}`)])
      expect(summary.lastText).toBe(`Update ${index}`)
      expect(summary.specialists).toBe(initial.specialists)
      expect(summary.todos).toBe(initial.todos)
    }
    expect(readParts).not.toHaveBeenCalled()
    expect(readArgs).not.toHaveBeenCalled()
  })

  it('matches complete derivation for streaming results, edits, reordering and removals', () => {
    const select = createSessionSummarySelector()
    const start = message('start', [
      { type: 'toolCall', id: 'start-call', name: 'task_start', args: { agent: 'scout', prompt: 'Inspect' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_1' },
    ])
    const wait = message('wait', [{ type: 'toolCall', name: 'task_wait', args: { id: 'task_1' } }])
    const running = message('result', [{ type: 'toolResult', name: 'task_wait', text: 'lifecycle=running\nactivity: read: a.ts', streaming: true }])
    const settled = message('result', [{ type: 'toolResult', text: 'task_1 settled' }])
    const todos = message('todos', [{ type: 'toolCall', name: 'todo_write', args: { todos: [{ content: 'Test', status: 'pending' }] } }])
    const updatedTodos = message('todos', [{ type: 'toolCall', name: 'todo_write', args: { todos: [{ content: 'Test', status: 'completed' }] } }])
    for (const messages of [
      [start],
      [start, wait],
      [start, wait, running],
      [start, wait, settled, todos],
      [start, wait, settled, updatedTodos],
      [updatedTodos, start, wait, settled],
      [start, wait],
      [],
      [todos],
      [message('start', [{ type: 'text', text: 'Another session' }])],
    ])
      expect(select(messages)).toEqual(fullSummary(messages))
  })

  it('keeps the summary identity for no-op snapshots and irrelevant reasoning updates', () => {
    const select = createSessionSummarySelector()
    const original = [message('text', [{ type: 'text', text: '' }])]
    const summary = select(original)
    expect(select([...original])).toBe(summary)
    expect(select([...original, message('thinking', [{ type: 'thinking', text: 'Thinking' }])])).toBe(summary)
    expect(select([...original, message('thinking', [{ type: 'thinking', text: 'More thinking' }])])).toBe(summary)
    expect(summary.lastText).toBe('')
  })
})

describe('readiness extraction', () => {
  const run = (id: string, command: string, text: string, extra: { isError?: boolean; details?: unknown } = {}): TranscriptMessage[] => [
    message(`${id}-call`, [{ type: 'toolCall', id, name: 'bash', args: { command } }]),
    message(`${id}-result`, [{ type: 'toolResult', name: 'bash', text, ...extra }]),
  ]
  const edit = (id: string) => message(id, [{ type: 'toolCall', id, name: 'edit', args: { path: 'a.ts' } }])
  const task = (id: string, agent: string, text: string) =>
    message(id, [
      { type: 'toolCall', id, name: 'task', args: { agent, prompt: 'Verdict: PASS please' } },
      { type: 'toolResult', name: 'task', text },
    ])
  const outcomes = (messages: TranscriptMessage[]) => extractReadiness(messages).checks.map(({ kind, outcome }) => [kind, outcome])

  it('reports nothing when no verification ran', () => {
    expect(extractReadiness([edit('e1')])).toEqual({ checks: [], reviews: [], lastEditIndex: 0 })
  })

  it('counts only real invocations, never mentions of a tool', () => {
    for (const command of ['echo vitest', 'grep -r vitest src', 'git commit -m "fix vitest"', 'cat tests/vitest.config.ts', 'echo "npm test"']) {
      expect(extractReadiness(run('m', command, 'ok')).checks).toEqual([])
    }
    for (const command of ['npx vitest run', 'cd app && pnpm exec vitest', 'node_modules/.bin/vitest', 'python -m pytest -q', 'FOO=1 npm run test']) {
      expect(outcomes(run('m', command, 'ok'))).toEqual([['test', 'passed']])
    }
    const overwritten = extractReadiness([...run('t1', 'npm test', 'exited with code 1'), ...run('t2', 'echo vitest', 'vitest')])
    expect(overwritten.checks[0].outcome).toBe('failed')
  })

  it('marks a passed check as possibly stale once files change afterwards', () => {
    expect(extractReadiness(run('t1', 'npx vitest run', 'ok')).checks).toEqual([{ kind: 'test', outcome: 'passed', changesSince: 0 }])
    const stale = extractReadiness([...run('t1', 'npx vitest run', 'ok'), edit('e1'), edit('e2')])
    expect(stale.checks).toEqual([{ kind: 'test', outcome: 'passed', changesSince: 2 }])
  })

  it('treats shell writes and writer-agent results as later changes but not read-only commands', () => {
    const base = run('t1', 'npm test', 'ok')
    const changesAfter = (...more: TranscriptMessage[]) => extractReadiness([...base, ...more]).checks[0].changesSince
    expect(changesAfter(...run('r', 'git status && ls && cat a.ts | head', 'x'))).toBe(0)
    expect(changesAfter(...run('lint', 'npm run lint', 'ok'))).toBe(0)
    for (const command of ['printf hi > a.ts', 'sed -i s/a/b/ a.ts', 'rm a.ts', 'git checkout .', 'npm install', 'git commit -m x']) {
      expect(changesAfter(...run('w', command, 'ok'))).toBe(1)
    }
    for (const command of ['npx eslint --fix a.ts', 'npm run lint -- --fix', 'npx eslint "--fix" a.ts']) {
      expect(changesAfter(...run('f', command, 'ok'))).toBe(1)
    }
    expect(changesAfter(task('m', 'machinist', 'changed files'))).toBe(1)
    expect(changesAfter(task('s', 'scout', 'found'))).toBe(0)
  })

  it('fails on isError, any non-zero exit text, or details.exitCode', () => {
    expect(outcomes(run('t', 'npm test', 'boom', { isError: true }))).toEqual([['test', 'failed']])
    expect(outcomes(run('t', 'npm test', 'child exited with code 0\nCommand exited with code 1'))).toEqual([['test', 'failed']])
    expect(outcomes(run('t', 'npm test', 'quiet', { details: { exitCode: 1 } }))).toEqual([['test', 'failed']])
    expect(outcomes(run('t', 'npm test', 'exited with code 0'))).toEqual([['test', 'passed']])
  })

  it('reports masked exit status as unknown and keeps an earlier failure unless a later run passes', () => {
    for (const command of [
      'npm test || true',
      'npm test | tail -n 1',
      'npm test; echo done',
      'npm test || :',
      'npm test | tee out.log',
      'npm test && echo done || true',
      'npm test && echo done; echo done',
      'npm test && echo done',
      'npm test && npx eslint a.ts > a.ts',
      'npm test && npx eslint "--fix" a.ts',
      'npm test & npm run lint & wait',
    ]) {
      expect(outcomes(run('t', command, 'ok'))[0]).toEqual(['test', 'unknown'])
    }
    expect(outcomes(run('t', 'npm test && npx eslint --fix a.ts', 'ok'))).toEqual([
      ['test', 'unknown'],
      ['lint', 'passed'],
    ])
    const failedThenUnknown = extractReadiness([...run('t1', 'npm test', 'exited with code 1'), ...run('t2', 'npm test || true', 'ok')])
    expect(failedThenUnknown.checks[0].outcome).toBe('failed')
    const failedThenPassed = extractReadiness([...run('t1', 'npm test', 'exited with code 1'), ...run('t2', 'npm test', 'ok')])
    expect(failedThenPassed.checks[0].outcome).toBe('passed')
    expect(extractReadiness([...run('t1', 'npm test', 'ok'), ...run('t2', 'npm test || true', 'ok')]).checks[0].outcome).toBe('unknown')
  })

  it('counts a compound command for every kind and reports running without a result', () => {
    expect(outcomes(run('c1', 'npm run typecheck && npm run lint', 'ok'))).toEqual([
      ['lint', 'passed'],
      ['typecheck', 'passed'],
    ])
    const pending = extractReadiness([message('p', [{ type: 'toolCall', id: 'p', name: 'bash', args: { command: 'npm run build' } }])])
    expect(pending.checks).toEqual([{ kind: 'build', outcome: 'running', changesSince: 0 }])
  })

  it('reads verdicts only from the first line-anchored result line', () => {
    const verdictOf = (text: string) => extractReadiness([task('r', 'oracle', text)]).reviews[0]?.verdict
    expect(verdictOf('Verdict: advisory\nnotes')).toBe('ADVISORY')
    expect(verdictOf('Outcome - BLOCKED\nnotes')).toBe('BLOCKED')
    expect(verdictOf('The prompt said "Verdict: PASS".\nVerdict: BLOCK')).toBe('BLOCK')
    expect(verdictOf('Previous report excerpt:\n```text\nVerdict: PASS\n```\nVerdict: BLOCK')).toBe('BLOCK')
    expect(verdictOf('> Verdict: PASS\nVerdict: ADVISORY')).toBe('ADVISORY')
    expect(verdictOf('```text\nVerdict: PASS\n```')).toBeUndefined()
    expect(verdictOf('  ```\nVerdict: PASS\n  ```\nVerdict: BLOCK')).toBe('BLOCK')
    expect(verdictOf('Quoted:\n```\nVerdict: PASS\nVerdict: BLOCK')).toBeUndefined()
    expect(verdictOf('```markdown\n```text\nVerdict: PASS\n```\nVerdict: BLOCK')).toBe('BLOCK')
    expect(verdictOf('no BLOCK found')).toBeUndefined()
    expect(verdictOf('started task_3\nVerdict: PASS')).toBeUndefined()
    expect(verdictOf('lifecycle: running\nVerdict: PASS')).toBeUndefined()
    expect(extractReadiness([task('r', 'scout', 'Verdict: BLOCK')]).reviews).toEqual([])
  })

  it('marks reviews stale after later changes', () => {
    const review = task('r1', 'oracle', 'Verdict: PASS')
    expect(extractReadiness([review]).reviews).toEqual([{ agent: 'oracle', verdict: 'PASS', changesSince: 0 }])
    expect(extractReadiness([review, edit('e1')]).reviews[0].changesSince).toBe(1)
  })

  it('keeps selector identity while relevant parts are unchanged', () => {
    const select = createReadinessSelector()
    const messages = run('t1', 'npm test', 'ok')
    const first = select(messages)
    const chatter = message('chat', [{ type: 'text', text: 'hi' }])
    expect(select([...messages, chatter])).toBe(first)
    expect(select([...messages, chatter, edit('e1')])).not.toBe(first)
  })

  it('pairs parallel bash calls, unnamed parallel results, and partial parallel runs followed by later calls', () => {
    const parallel = [
      message('par', [
        { type: 'toolCall', id: 'b1', name: 'bash', args: { command: 'npm run typecheck' } },
        { type: 'toolCall', id: 'b2', name: 'bash', args: { command: 'npm run lint' } },
        { type: 'toolResult', name: 'bash', text: 'ok' },
        { type: 'toolResult', name: 'bash', text: 'exited with code 1' },
      ]),
    ]
    expect(outcomes(parallel)).toEqual([
      ['lint', 'failed'],
      ['typecheck', 'passed'],
    ])

    const unnamed = [
      message('unnamed', [
        { type: 'toolCall', id: 'u1', name: 'bash', args: { command: 'npm run typecheck' } },
        { type: 'toolCall', id: 'u2', name: 'bash', args: { command: 'npm run lint' } },
        { type: 'toolResult', text: 'ok' },
        { type: 'toolResult', text: 'exited with code 1' },
      ]),
    ]
    expect(outcomes(unnamed)).toEqual([
      ['lint', 'failed'],
      ['typecheck', 'passed'],
    ])

    const partialThenLater = [
      message('partial', [
        { type: 'toolCall', id: 'p1', name: 'bash', args: { command: 'npm run typecheck' } },
        { type: 'toolCall', id: 'p2', name: 'bash', args: { command: 'npm run lint' } },
        { type: 'toolResult', name: 'bash', text: 'ok' },
        { type: 'toolCall', id: 'p3', name: 'bash', args: { command: 'npm test' } },
        { type: 'toolResult', name: 'bash', text: 'ok' },
      ]),
    ]
    expect(outcomes(partialThenLater)).toEqual([
      ['test', 'passed'],
      ['lint', 'passed'],
      ['typecheck', 'running'],
    ])
  })

  it('recognizes repo/ecosystem checks, pre-check pipes, and subshells', () => {
    expect(outcomes(run('c', 'npm run check', 'ok'))).toEqual([['lint', 'passed']])
    expect(outcomes(run('e', 'npm run test:e2e:hermetic', 'ok'))).toEqual([['test', 'passed']])
    expect(outcomes(run('b', 'npm run build:all', 'ok'))).toEqual([['build', 'passed']])
    expect(outcomes(run('f', 'oxfmt -c .', 'ok'))).toEqual([['format', 'passed']])
    expect(outcomes(run('n', 'node --test', 'ok'))).toEqual([['test', 'passed']])
    expect(outcomes(run('p1', 'git status | head && npm test', 'ok'))).toEqual([['test', 'passed']])
    expect(outcomes(run('p2', 'killPort || true; npm run typecheck', 'ok'))).toEqual([['typecheck', 'passed']])
    expect(outcomes(run('sub', '(cd apps/desktop && npm run typecheck)', 'ok'))).toEqual([['typecheck', 'passed']])
  })

  it('handles task_wait({ ids }) oracle verdicts, Async Task Settled writer staleness, and codemode bash checks', () => {
    const messages = [
      message('start', [
        { type: 'toolCall', id: 's1', name: 'task_start', args: { agent: 'oracle', prompt: 'Review' } },
        { type: 'toolResult', name: 'task_start', text: 'started task_1' },
        { type: 'toolCall', id: 's2', name: 'task_start', args: { agent: 'machinist', prompt: 'Edit' } },
        { type: 'toolResult', name: 'task_start', text: 'started task_2' },
      ]),
      message('cm', [
        { type: 'toolCall', id: 'cm1', name: 'codemode', args: { code: "await tools.bash({ command: 'npm run typecheck' })" } },
        { type: 'toolResult', name: 'codemode', text: 'ok' },
      ]),
      message('wait', [
        { type: 'toolCall', id: 'w1', name: 'task_wait', args: { ids: ['task_1'] } },
        { type: 'toolResult', name: 'task_wait', text: 'Verdict: PASS', details: { worker: { id: 'task_1' } } },
      ]),
      message('settled', [
        { type: 'toolCall', id: 'a1', name: 'Async Task Settled', args: {} },
        { type: 'toolResult', name: 'Async Task Settled', text: 'task_2: settled' },
      ]),
    ]
    const readiness = extractReadiness(messages)
    expect(readiness.checks).toEqual([{ kind: 'typecheck', outcome: 'passed', changesSince: 1 }])
    expect(readiness.reviews).toEqual([{ agent: 'oracle', verdict: 'PASS', changesSince: 1 }])
  })
})

describe('specialist record details', () => {
  const start = (extra: Record<string, unknown>, text = 'started task_1'): MessagePart[] => [
    { type: 'toolCall', id: 'start-1', name: 'task_start', args: { agent: 'scout', prompt: '  Inspect   the project  ', cwd: '/repo' } },
    { type: 'toolResult', name: 'task_start', text, details: extra },
  ]

  it('reads every worker field a receipt reports and ignores ones that are missing or implausible', () => {
    const [record] = extractPiSpecialistSessions([
      message(
        'm',
        start({
          close: { sessionFile: '/workers/closed.jsonl' },
          worker: {
            id: 'task_1',
            cwd: '/work',
            instanceId: 'inst-1',
            sessionFile: '/workers/task_1.jsonl',
            model: 'm1',
            thinking: 'high',
            turns: 4,
            maxTurns: 900,
            generation: 2,
            killReason: 'budget',
            waiting_ui_requests: [{ id: 'q' }],
          },
        }),
      ),
    ])
    expect(record).toMatchObject({
      id: 'worker:inst-1',
      taskId: 'task_1',
      agent: 'scout',
      mission: 'Inspect the project',
      prompt: 'Inspect   the project',
      cwd: '/work',
      instanceId: 'inst-1',
      sessionFile: '/workers/task_1.jsonl',
      model: 'm1',
      thinking: 'high',
      turns: 4,
      maxTurns: 900,
      generation: 2,
      killReason: 'budget',
      status: 'waiting',
    })

    const [guarded] = extractPiSpecialistSessions([
      message('m', [
        ...start({ close: { sessionFile: '' }, worker: { id: 'task_1', instanceId: '', maxTurns: 200_000 } }, 'Worker launched'),
        { type: 'toolCall', name: 'task_wait', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_wait', text: 'activity: read_file: src/a.ts', details: { worker: { maxTurns: 200_000, waiting_ui_requests: [] } } },
      ]),
    ])
    expect(guarded.maxTurns).toBeUndefined()
    expect(guarded.instanceId).toBeUndefined()
    expect(guarded.sessionFile).toBeUndefined()
    expect(guarded.activity).toBe('read_file: src/a.ts')
  })

  it('turns worker activity into transcript parts, including running labels, durations and JSON args', () => {
    const [record] = extractPiSpecialistSessions([
      message(
        'm',
        start({
          worker: {
            id: 'task_1',
            activities: [
              { tool: 'read_file', status: 'running', summary: 'src/a.ts' },
              { tool: 'bash', status: 'error', args: '{"command":"npm test"}', duration: 12 },
              { tool: '', status: 'completed' },
              { tool: 'grep', status: 'running' },
              'not-a-record',
            ],
          },
        }),
      ),
    ])
    // The label follows the last running activity, which here carries no summary.
    expect(record.activity).toBe('grep')
    const [assistant] = record.messages.filter((entry) => entry.role === 'assistant')
    expect(assistant.parts).toEqual([
      { type: 'toolCall', id: 'spec-act-1', name: 'read_file', args: { command: 'src/a.ts' } },
      { type: 'toolResult', name: 'read_file', text: 'src/a.ts', isError: false, streaming: true },
      { type: 'toolCall', id: 'spec-act-2', name: 'bash', args: { command: 'npm test' } },
      { type: 'toolResult', name: 'bash', text: '{"command":"npm test"}\n\nDuration: 12ms', isError: true, streaming: false },
      { type: 'toolCall', id: 'spec-act-4', name: 'grep', args: { command: '' } },
      { type: 'toolResult', name: 'grep', text: '', isError: false, streaming: true },
    ])
  })

  it('ignores control receipts for unknown workers and failed sends', () => {
    const messages = [
      message('m', [
        { type: 'toolCall', name: 'task_wait', args: { id: 'task_9' } },
        { type: 'toolResult', name: 'task_wait', text: 'lifecycle: settled' },
        ...start({ worker: { id: 'task_1' } }),
        { type: 'toolCall', name: 'task_send', args: { id: 'task_1', mode: 'prompt', message: 'Next' } },
        { type: 'toolResult', name: 'task_send', text: 'not settled', isError: true },
      ]),
    ]
    const [record] = extractPiSpecialistSessions(messages)
    expect(record).toMatchObject({ id: 'start-1', taskId: 'task_1', status: 'running', mission: 'Inspect the project' })
  })

  it('reads chain steps from their own details and settled result bodies', () => {
    const records = extractPiSpecialistSessions([
      message('m', [
        {
          type: 'toolCall',
          id: 'chain-1',
          name: 'task_chain',
          args: { steps: [{ agent: 'scout', prompt: 'First' }, { agent: 'oracle', prompt: 'Second' }, { agent: 'scribe', prompt: 'Third' }, { prompt: 'no agent' }] },
        },
        {
          type: 'toolResult',
          name: 'task_chain',
          text: 'step 1 ok\nstep 2 failed',
          details: { steps: [{ status: 'done', report: 'Step one report', activities: [{ tool: 'read', status: 'completed' }] }, { status: 'aborted' }, { status: 'running' }] },
        },
      ]),
    ])
    expect(records.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'chain-1-step-1', status: 'done' },
      { id: 'chain-1-step-2', status: 'stopped' },
      { id: 'chain-1-step-3', status: 'running' },
    ])
    expect(records[0].finalReport).toBe('Step one report')
  })

  it('preserves unstructured task and chain result text as the report', () => {
    const withBody = extractPiSpecialistSessions([
      message('m', [
        { type: 'toolCall', name: 'task', args: { agent: 'scout', prompt: 'Inspect' } },
        { type: 'toolResult', name: 'task', text: 'lifecycle: settled\n--- result ---\nBody text' },
      ]),
    ])[0]
    expect(withBody.finalReport).toBe('lifecycle: settled\n--- result ---\nBody text')

    const empty = extractPiSpecialistSessions([
      message('m', [
        { type: 'toolCall', name: 'task', args: { agent: 'scout', prompt: 'Inspect' } },
        { type: 'toolResult', name: 'task', text: '--- result ---\n(empty)' },
      ]),
    ])[0]
    expect(empty.finalReport).toBe('--- result ---\n(empty)')
    expect(empty.status).toBe('done')

    const chainEmpty = extractPiSpecialistSessions([
      message('m', [
        { type: 'toolCall', name: 'task_chain', args: { steps: [{ agent: 'scout', prompt: 'First' }] } },
        { type: 'toolResult', name: 'task_chain', text: 'step 1 ok\n--- result ---\n(empty)' },
      ]),
    ])[0]
    expect(chainEmpty.finalReport).toBe('step 1 ok\n--- result ---\n(empty)')
  })
})

describe('specialist status rules', () => {
  const statusOf = (parts: MessagePart[]): string => extractPiSessionWidgets([message('m', parts)]).specialists[0].status
  const started: MessagePart[] = [
    { type: 'toolCall', name: 'task_start', args: { agent: 'scout', prompt: 'Inspect' } },
    { type: 'toolResult', name: 'task_start', text: 'started task_1', details: { worker: { id: 'task_1' } } },
  ]

  it('maps each status to one mark, with stopped and closed reading as stale rather than pending', () => {
    const statuses: SpecialistStatus[] = ['running', 'waiting', 'done', 'error', 'stopped', 'closed']
    expect(statuses.map(specialistMarkState)).toEqual(['running', 'running', 'done', 'failed', 'stale', 'stale'])
    expect(specialistStatusLabel.waiting).toBe('Waiting for input')
  })

  it('reads step status words, and treats unknown words as absent', () => {
    expect(['completed', 'ok', 'failed', 'timeout', 'aborted', 'cancelled', 'starting', 'retrying'].map(specialistStepStatus)).toEqual([
      'done',
      'done',
      'error',
      'error',
      'stopped',
      'stopped',
      'running',
      'running',
    ])
    expect(specialistStepStatus('queued')).toBeUndefined()
    expect(specialistStepStatus(undefined)).toBeUndefined()
  })

  it('takes the lifecycle from details, then from receipt text, and ignores a missing result', () => {
    expect(specialistOutcome({ previous: 'running', tool: 'task_wait' })).toBe('running')
    expect(specialistOutcome({ previous: 'running', tool: 'task_wait', result: { type: 'toolResult', name: 'task_wait', text: 'lifecycle: failed' } })).toBe('error')
    expect(specialistOutcome({ previous: 'running', tool: 'task_wait', result: { type: 'toolResult', name: 'task_wait', text: 'LIFECYCLE=failed' } })).toBe('error')
    expect(specialistOutcome({ previous: 'running', tool: 'task_wait', result: { type: 'toolResult', name: 'task_wait', text: 'still going' } })).toBe('running')
  })

  it('closes a worker without claiming its outcome, and keeps a generation start busy', () => {
    expect(statusOf([...started, { type: 'toolCall', name: 'task_close', args: { id: 'task_1' } }, { type: 'toolResult', name: 'task_close', text: 'closed' }])).toBe('closed')
    expect(
      statusOf([
        ...started,
        { type: 'toolCall', name: 'task_close', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_close', text: 'closed' },
        { type: 'toolCall', name: 'task_send', args: { id: 'task_1', mode: 'prompt', message: 'Again' } },
        { type: 'toolResult', name: 'task_send', text: 'prompt sent' },
      ]),
    ).toBe('running')
  })

  it('reports a kill reason as a failure but not while a new generation starts', () => {
    expect(statusOf([...started, { type: 'toolCall', name: 'task_status', args: { id: 'task_1' } }, { type: 'toolResult', name: 'task_status', text: 'kill_reason: budget' }])).toBe('error')
    expect(
      statusOf([
        ...started,
        { type: 'toolCall', name: 'task_send', args: { id: 'task_1', mode: 'prompt', message: 'Continue' } },
        { type: 'toolResult', name: 'task_send', text: 'kill_reason: budget' },
      ]),
    ).toBe('running')
  })

  it('treats a streaming receipt with no running lifecycle as no news', () => {
    expect(statusOf([...started, { type: 'toolCall', name: 'task_wait', args: { id: 'task_1' } }, { type: 'toolResult', name: 'task_wait', text: 'waiting', streaming: true }])).toBe('running')
  })

  it('clears waiting when a later receipt reports no pending dialogs', () => {
    expect(
      statusOf([
        ...started,
        { type: 'toolCall', name: 'task_status', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_status', text: 'asking', details: { worker: { waiting_ui_requests: [{ id: 'q' }] } } },
      ]),
    ).toBe('waiting')
    expect(
      statusOf([
        ...started,
        { type: 'toolCall', name: 'task_status', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_status', text: 'asking', details: { worker: { waiting_ui_requests: [{ id: 'q' }] } } },
        { type: 'toolCall', name: 'task_status', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_status', text: 'answered', details: { worker: { waiting_ui_requests: [] } } },
      ]),
    ).toBe('running')
  })
})
