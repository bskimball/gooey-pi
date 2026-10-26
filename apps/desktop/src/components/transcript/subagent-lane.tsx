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

const VERBS: Record<string, string> = { task_wait: 'Waiting on', task_send: 'Steered', task_chain: 'Chain' }

export interface SubagentFollowUp { call: ToolCall; result?: ToolResult }
export interface SubagentPairs { followUps: Map<ToolCall, SubagentFollowUp[]>; absorbed: Set<MessagePart> }

function startedTaskId(result?: ToolResult): string | undefined {
  return text(record(result?.details)?.instanceId) ?? /\b(task_\d+)\b/.exec(result?.text ?? '')?.[1]
}

/**
 * A `task_wait` or `task_send` naming a task started earlier in the same parts list folds into that start's lane,
 * so one delegated run reads as one row. Absorbed calls and their results are skipped by the timeline.
 */
export function pairSubagentCalls(parts: MessagePart[]): SubagentPairs {
  const followUps = new Map<ToolCall, SubagentFollowUp[]>()
  const absorbed = new Set<MessagePart>()
  const starts = new Map<string, ToolCall>()
  parts.forEach((part, index) => {
    if (part.type !== 'toolCall') return
    const next = parts[index + 1]
    const result = next?.type === 'toolResult' ? next : undefined
    if (part.name === 'task_start') {
      const id = startedTaskId(result)
      if (id) starts.set(id, part)
      return
    }
    if (part.name !== 'task_wait' && part.name !== 'task_send') return
    const start = starts.get(text(record(part.args)?.id) ?? '')
    if (!start) return
    followUps.set(start, [...followUps.get(start) ?? [], { call: part, result }])
    absorbed.add(part)
    if (result) absorbed.add(result)
  })
  return { followUps, absorbed }
}

/** The report's first few headings or bullets, as plain one-liners for the tree rail. */
function reportHighlights(report: string): string[] {
  const lines = report.split('\n').map((line) => line.trim()).filter(Boolean)
  const marked = lines.flatMap((line) => {
    const match = /^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)(.+)$/.exec(line)
    return match ? [match[1]] : []
  })
  return (marked.length ? marked : lines).slice(0, 3).map((line) => oneLine(line.replace(/[*_`]+/g, ''))!)
}

/**
 * Subagent orchestration calls read as lanes: who was asked, what for, where it stands,
 * and a tree rail of the report's highlights, so a delegated run can be followed without leaving the transcript.
 */
export const SubagentLane = memo(function SubagentLane({ part, result, followUps = [] }: { part: ToolCall; result?: ToolResult; followUps?: SubagentFollowUp[] }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const args = record(part.args) ?? {}
  const details = record(result?.details)
  const output = result?.text ?? ''
  const steps = Array.isArray(args.steps) ? args.steps.map(record).filter((step) => text(step?.agent)) : []
  const roles = part.name === 'task_chain' ? steps.map((step) => text(step?.agent)!) : text(args.agent) ? [text(args.agent)!] : []
  const taskId = text(args.id) ?? text(details?.instanceId) ?? /\b(task_\d+)\b/.exec(output)?.[1]
  const mission = oneLine(text(args.prompt) ?? text(args.message) ?? text(steps[0]?.prompt))
  // The newest paired wait carries the run's outcome; steering sends only change the label.
  const latest = [...followUps].reverse().find((followUp) => followUp.call.name === 'task_wait') ?? { call: part, result }
  const latestOutput = latest.result?.text ?? ''
  const lifecycle = /\blifecycle[:=]\s*([a-z_]+)\b/i.exec(latestOutput)?.[1]?.toLowerCase()
  const pending = !latest.result || latest.result.streaming || followUps.some((followUp) => !followUp.result || followUp.result.streaming)
  const background = !pending && latest.call.name === 'task_start'
  const state = pending ? 'running'
    : latest.result?.isError || lifecycle === 'failed' || lifecycle === 'aborted' ? 'error'
    : background || latest.call.name === 'task_send' ? 'sent' : 'done'
  const stateLabel = state === 'running' ? (latest.call.name === 'task_wait' ? 'waiting' : 'running')
    : state === 'error' ? 'failed'
    : background ? 'running' : latest.call.name === 'task_send' ? `sent${text(args.mode) ? ` · ${text(args.mode)}` : ''}` : 'settled'
  const report = text(record(latest.result?.details)?.finalReport) ?? settledReport(latestOutput) ?? (pending || background ? undefined : text(latestOutput))
  const highlights = report ? reportHighlights(report) : []
  const rail = highlights.length ? highlights : state === 'running' || background ? ['Running in background…'] : []
  const verb = VERBS[part.name]

  return <div className={`subagent-lane is-${state}`}>
    <div className="subagent-lane__summary">
      <span className="subagent-lane__status" aria-hidden="true">{state === 'running' ? <CircleNotch className="spin" size={13} /> : state === 'error' ? <WarningCircle size={13} /> : state === 'done' ? <Check size={13} /> : <Robot size={13} />}</span>
      {verb ? <span className="subagent-lane__verb">{verb}</span> : null}
      {roles.length
        ? roles.map((role, index) => <span key={`${role}-${index}`} className="subagent-lane__role">{role}</span>)
        : <span className="subagent-lane__role">agent</span>}
      {taskId ? <code className="subagent-lane__id">{taskId}</code> : null}
      {mission ? <span className="subagent-lane__mission" title={mission}>{mission}</span> : <span className="subagent-lane__mission" />}
      <span className="subagent-lane__state">{stateLabel}</span>
    </div>
    {rail.length || report ? <ul className="subagent-lane__tree">
      {rail.map((line, index) => <li key={`${index}-${line}`} className={highlights.length ? undefined : 'is-pending'}>
        <span className="subagent-lane__branch" aria-hidden="true">{index === rail.length - 1 && !report ? '╰─' : '├─'}</span>
        <span className="subagent-lane__leaf">{line}</span>
      </li>)}
      {report ? <li>
        <span className="subagent-lane__branch" aria-hidden="true">╰─</span>
        <button type="button" className="subagent-lane__report-toggle" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide full report' : 'View full report'}<CaretRight className="disclosure-caret" size={11} />
        </button>
      </li> : null}
    </ul> : null}
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
