import { describe, expect, it, vi } from 'vitest'
import { createSessionSummarySelector, extractPiSessionWidgets, summarizeTranscript } from '../../apps/desktop/src/components/inspector/session-summary'
import { extractPiSpecialistSessions } from '../../apps/desktop/src/components/inspector/SpecialistsPanel'
import type { MessagePart, TranscriptMessage } from '../../apps/desktop/src/types/api'

const message = (id: string, parts: MessagePart[]): TranscriptMessage => ({ id, role: 'assistant', parts })
const fullSummary = (messages: TranscriptMessage[]) => ({ ...summarizeTranscript(messages), ...extractPiSessionWidgets(messages) })

describe('recorded specialist outcomes', () => {
  it.each([
    { tool: 'task_wait', text: 'lifecycle: failed\nkill_reason: limit exceeded', expected: 'error' },
    { tool: 'task_abort', text: 'lifecycle: aborted', expected: 'stopped' },
    { tool: 'task_wait', text: 'lifecycle: settled\n--- result ---\nCompleted report', expected: 'done' },
    { tool: 'task_status', text: 'lifecycle: running', expected: 'closed' },
  ])('preserves $expected when a worker is closed', ({ tool, text, expected }) => {
    const messages = [message('start', [
      { type: 'toolCall', id: 'start-1', name: 'task_start', args: { agent: 'scout', prompt: 'Inspect the project' } },
      { type: 'toolResult', name: 'task_start', text: 'Worker launched', details: { worker: { id: 'task_1' } } },
    ]), message('outcome', [
      { type: 'toolCall', name: tool, args: { id: 'task_1' } },
      { type: 'toolResult', name: tool, text },
      { type: 'toolCall', name: 'task_close', args: { id: 'task_1' } },
      { type: 'toolResult', name: 'task_close', text: 'lifecycle: closed' },
    ])]
    expect(extractPiSessionWidgets(messages).specialists[0]).toMatchObject({ id: 'task_1', status: expected })
    expect(extractPiSpecialistSessions(messages)[0]).toMatchObject({ id: 'task_1', status: expected })
  })

  it('uses structured lifecycle and chain status consistently, and retains older agents for transcript navigation', () => {
    const parts: MessagePart[] = Array.from({ length: 10 }, (_, index): MessagePart[] => [
      { type: 'toolCall', id: `start-${index}`, name: 'task_start', args: { agent: 'scout', prompt: `Mission ${index}` } },
      { type: 'toolResult', name: 'task_start', text: `started task_${index}` },
    ]).flat()
    parts.push(
      { type: 'toolCall', name: 'task_status', args: { id: 'task_0' } },
      { type: 'toolResult', name: 'task_status', text: 'Worker snapshot', details: { worker: { lifecycle: 'failed' } } },
      { type: 'toolCall', id: 'chain', name: 'task_chain', args: { steps: [{ agent: 'scout', prompt: 'First' }, { agent: 'oracle', prompt: 'Second' }] } },
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

  it('distinguishes a final report from interim text and preserves it through close receipts', () => {
    const messages = [message('run', [
      { type: 'toolCall', name: 'task_start', args: { agent: 'scout', prompt: 'Inspect' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_1' },
      { type: 'toolCall', name: 'task_status', args: { id: 'task_1' } },
      { type: 'toolResult', name: 'task_status', text: 'lifecycle: running', details: { worker: { latestText: 'Still investigating' } } },
    ])]
    expect(extractPiSpecialistSessions(messages)[0].finalReport).toBeUndefined()
    messages.push(message('finished', [
      { type: 'toolCall', name: 'task_wait', args: { id: 'task_1' } },
      { type: 'toolResult', name: 'task_wait', text: 'lifecycle: settled\n--- result ---\nFull final report' },
      { type: 'toolCall', name: 'task_close', args: { id: 'task_1' } },
      { type: 'toolResult', name: 'task_close', text: 'lifecycle: closed\n--- result (truncated tail) ---\nreport' },
    ]))
    expect(extractPiSpecialistSessions(messages)[0].finalReport).toBe('Full final report')
  })
})

describe('incremental inspector summary', () => {
  it('does not reread historical parts or reparse widgets during text-only updates', () => {
    const select = createSessionSummarySelector()
    const readParts = vi.fn((): MessagePart[] => [{ type: 'toolCall', name: 'Read', args: { path: 'a.ts' } }])
    const history = Array.from({ length: 1000 }, (_, index): TranscriptMessage => ({ id: `history-${index}`, role: 'assistant', get parts() { return readParts() } }))
    const readArgs = vi.fn(() => ({ agent: 'scout', prompt: 'Inspect the project' }))
    const start: MessagePart = { type: 'toolCall', id: 'start', name: 'task_start', get args() { return readArgs() } }
    const result: MessagePart = { type: 'toolResult', name: 'task_start', text: 'started task_1' }
    const tail = (text: string) => message('tail', [start, result, { type: 'text', text }])
    const initial = select([...history, tail('Initial')])
    expect(initial.toolCount).toBe(1001)
    expect(initial.specialists[0]?.id).toBe('task_1')
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
      [start], [start, wait], [start, wait, running], [start, wait, settled, todos],
      [start, wait, settled, updatedTodos], [updatedTodos, start, wait, settled],
      [start, wait], [], [todos], [message('start', [{ type: 'text', text: 'Another session' }])],
    ]) expect(select(messages)).toEqual(fullSummary(messages))
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
