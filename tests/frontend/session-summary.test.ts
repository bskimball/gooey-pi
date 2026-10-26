import { describe, expect, it, vi } from 'vitest'
import { createSessionSummarySelector, extractPiSessionWidgets, summarizeTranscript } from '../../apps/desktop/src/components/inspector/session-summary'
import type { MessagePart, TranscriptMessage } from '../../apps/desktop/src/types/api'

const message = (id: string, parts: MessagePart[]): TranscriptMessage => ({ id, role: 'assistant', parts })
const fullSummary = (messages: TranscriptMessage[]) => ({ ...summarizeTranscript(messages), ...extractPiSessionWidgets(messages) })

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
