import { describe, expect, it, vi } from 'vitest'
import { createSessionSummarySelector, extractPiSessionWidgets, summarizeTranscript } from '../../apps/desktop/src/components/inspector/session-summary'
import { createReadinessSelector, extractReadiness } from '../../apps/desktop/src/components/inspector/readiness'
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

describe('readiness extraction', () => {
  const run = (id: string, command: string, text: string, extra: { isError?: boolean; details?: unknown } = {}): TranscriptMessage[] => [
    message(`${id}-call`, [{ type: 'toolCall', id, name: 'bash', args: { command } }]),
    message(`${id}-result`, [{ type: 'toolResult', name: 'bash', text, ...extra }]),
  ]
  const edit = (id: string) => message(id, [{ type: 'toolCall', id, name: 'edit', args: { path: 'a.ts' } }])
  const task = (id: string, agent: string, text: string) => message(id, [
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
    for (const command of ['npm test || true', 'npm test | tail -n 1', 'npm test; echo done', 'npm test || :', 'npm test | tee out.log', 'npm test && echo done || true', 'npm test && echo done; echo done', 'npm test && echo done', 'npm test && npx eslint a.ts > a.ts', 'npm test && npx eslint "--fix" a.ts', 'npm test & npm run lint & wait']) {
      expect(outcomes(run('t', command, 'ok'))[0]).toEqual(['test', 'unknown'])
    }
    expect(outcomes(run('t', 'npm test && npx eslint --fix a.ts', 'ok'))).toEqual([['test', 'unknown'], ['lint', 'passed']])
    const failedThenUnknown = extractReadiness([...run('t1', 'npm test', 'exited with code 1'), ...run('t2', 'npm test || true', 'ok')])
    expect(failedThenUnknown.checks[0].outcome).toBe('failed')
    const failedThenPassed = extractReadiness([...run('t1', 'npm test', 'exited with code 1'), ...run('t2', 'npm test', 'ok')])
    expect(failedThenPassed.checks[0].outcome).toBe('passed')
    expect(extractReadiness([...run('t1', 'npm test', 'ok'), ...run('t2', 'npm test || true', 'ok')]).checks[0].outcome).toBe('unknown')
  })

  it('counts a compound command for every kind and reports running without a result', () => {
    expect(outcomes(run('c1', 'npm run typecheck && npm run lint', 'ok'))).toEqual([['lint', 'passed'], ['typecheck', 'passed']])
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
})
