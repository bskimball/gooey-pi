import { memo, useId, useState } from 'react'
import { CaretRight, Check, CircleNotch, Robot, WarningCircle } from '../icons'
import type { MessagePart } from '@/types/api'
import { boundText } from '@/lib/render-bounds'
import { MarkdownText } from '../MarkdownText'

type ToolCall = Extract<MessagePart, { type: 'toolCall' }>
type ToolResult = Extract<MessagePart, { type: 'toolResult' }>

const SUBAGENT_TOOLS = new Set(['task', 'task_start', 'task_wait', 'task_send', 'task_chain'])
export const isSubagentTool = (name: string) => SUBAGENT_TOOLS.has(name)

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined
const oneLine = (value: string | undefined) => value ? boundText(value.replace(/\s+/g, ' '), 160, '…') : undefined

/** Settled task output carries the report after a `--- result ---` marker; everything above it is lifecycle metadata. */
function settledReport(output: string): string | undefined {
  const body = /^---\s*result(?:\s*\([^)]*\))?\s*---\r?\n([\s\S]*)$/m.exec(output)?.[1]?.trim()
  return body && body !== '(empty)' ? body : undefined
}

const VERBS: Record<string, string> = { task: 'Delegated', task_start: 'Started', task_wait: 'Waiting on', task_send: 'Steered', task_chain: 'Chain' }

/**
 * Subagent orchestration calls read as lanes: who was asked, what for, where it stands,
 * and the report itself, so a delegated run can be followed without leaving the transcript.
 */
export const SubagentLane = memo(function SubagentLane({ part, result }: { part: ToolCall; result?: ToolResult }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const args = record(part.args) ?? {}
  const details = record(result?.details)
  const output = result?.text ?? ''
  const steps = Array.isArray(args.steps) ? args.steps.map(record).filter((step) => text(step?.agent)) : []
  const roles = part.name === 'task_chain' ? steps.map((step) => text(step?.agent)!) : text(args.agent) ? [text(args.agent)!] : []
  const taskId = text(args.id) ?? text(details?.instanceId) ?? /\b(task_\d+)\b/.exec(output)?.[1]
  const mission = oneLine(text(args.prompt) ?? text(args.message) ?? text(steps[0]?.prompt))
  const lifecycle = /\blifecycle[:=]\s*([a-z_]+)\b/i.exec(output)?.[1]?.toLowerCase()
  const state = !result || result.streaming ? 'running'
    : result.isError || lifecycle === 'failed' || lifecycle === 'aborted' ? 'error'
    : part.name === 'task_start' || part.name === 'task_send' ? 'sent' : 'done'
  const stateLabel = state === 'running' ? (part.name === 'task_wait' ? 'waiting' : 'running')
    : state === 'error' ? 'failed'
    : part.name === 'task_start' ? 'started' : part.name === 'task_send' ? `sent${text(args.mode) ? ` · ${text(args.mode)}` : ''}` : 'settled'
  const report = text(details?.finalReport) ?? settledReport(output) ?? (state === 'running' ? undefined : text(output))

  return <div className={`subagent-lane is-${state}`}>
    <button type="button" className="subagent-lane__summary" disabled={!report} aria-expanded={report ? open : undefined} aria-controls={report && open ? bodyId : undefined} onClick={() => setOpen((value) => !value)}>
      <span className="activity-line__icon"><Robot size={14} /></span>
      <span className="subagent-lane__verb">{VERBS[part.name] ?? part.name}</span>
      {roles.length
        ? roles.map((role, index) => <span key={`${role}-${index}`} className="subagent-lane__role">{role}</span>)
        : null}
      {taskId ? <code className="subagent-lane__id">{taskId}</code> : null}
      {mission ? <span className="subagent-lane__mission" title={mission}>{mission}</span> : <span className="subagent-lane__mission" />}
      <span className="subagent-lane__state">
        {state === 'running' ? <CircleNotch className="spin" size={11} /> : state === 'error' ? <WarningCircle size={11} /> : <Check size={11} />}
        {stateLabel}
      </span>
      {report ? <CaretRight className="disclosure-caret" size={13} /> : null}
    </button>
    {open && report ? <div className="subagent-lane__body" id={bodyId}>
      <MarkdownText text={boundText(report, 40_000, '\n… [Subagent report truncated in the desktop view.]')} />
    </div> : null}
  </div>
})

type TodoStatus = 'completed' | 'in_progress' | 'pending' | 'cancelled'
interface TodoItem { content: string; status: TodoStatus }

function todoItems(args: unknown): TodoItem[] {
  const todos = record(args)?.todos
  if (!Array.isArray(todos)) return []
  return todos.flatMap((item) => {
    const todo = record(item)
    const content = text(todo?.content)
    if (!content) return []
    const status = todo?.status
    return [{ content, status: status === 'completed' || status === 'in_progress' || status === 'cancelled' ? status : 'pending' }]
  })
}

/** A plan update reads as the step header for the work that follows it. */
export const TodoStep = memo(function TodoStep({ part }: { part: ToolCall }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const todos = todoItems(part.args)
  const done = todos.filter((todo) => todo.status === 'completed').length
  const active = todos.find((todo) => todo.status === 'in_progress')
  const finished = todos.length > 0 && done === todos.length
  return <div className={`todo-step ${finished ? 'is-finished' : ''}`}>
    <button type="button" className="todo-step__summary" disabled={!todos.length} aria-expanded={todos.length ? open : undefined} aria-controls={todos.length && open ? listId : undefined} onClick={() => setOpen((value) => !value)}>
      <span className="todo-step__count">{done}/{todos.length} done</span>
      <span className="todo-step__label">{active?.content ?? (finished ? 'All steps complete' : 'Plan updated')}</span>
      {todos.length ? <CaretRight className="disclosure-caret" size={13} /> : null}
    </button>
    {open ? <ol className="todo-step__list" id={listId}>
      {todos.map((todo, index) => <li key={`${index}-${todo.content}`} className={`is-${todo.status}`}>
        <span className="todo-step__mark" aria-hidden="true">{todo.status === 'completed' ? <Check size={10} /> : null}</span>
        <span>{todo.content}</span>
        <span className="sr-only">{todo.status.replace('_', ' ')}</span>
      </li>)}
    </ol> : null}
  </div>
})
