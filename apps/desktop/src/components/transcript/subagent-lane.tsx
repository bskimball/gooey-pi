import { createContext, memo, useContext, useId, useState } from 'react'
import type { PiSpecialistSummary } from '../inspector/session-summary'
import { specialistOutcome, specialistStatusLabel, workerDetails, type SpecialistStatus } from '@/lib/specialist-status'
import { CaretRight, Check, CircleNotch, Robot, WarningCircle } from '../icons'
import type { MessagePart } from '@/types/api'
import { boundText } from '@/lib/render-bounds'
import { MarkdownText } from '../MarkdownText'

type ToolCall = Extract<MessagePart, { type: 'toolCall' }>
type ToolResult = Extract<MessagePart, { type: 'toolResult' }>

export const SubagentContext = createContext<{ specialists: PiSpecialistSummary[]; onOpen?(id: string): void }>({ specialists: [] })

const SUBAGENT_TOOLS = new Set(['task', 'task_start', 'task_wait', 'task_chain'])
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

const VERBS: Record<string, string> = { task_wait: 'Waiting on', task_chain: 'Chain' }

export interface SubagentFollowUp { call: ToolCall; result?: ToolResult }
export interface SubagentPairs { followUps: Map<ToolCall, SubagentFollowUp[]>; absorbed: Set<MessagePart> }

function startedTaskId(result?: ToolResult): string | undefined {
  return text(workerDetails(result?.details)?.id) ?? /\b(task_\d+)\b/.exec(result?.text ?? '')?.[1]
}

/**
 * Wait reports fold into the originating lane. Control receipts remain inspectable in the timeline,
 * including operation errors that do not change the worker's outcome.
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
    if (!['task_wait', 'task_send', 'task_status', 'task_close', 'task_abort'].includes(part.name)) return
    const start = starts.get(text(record(part.args)?.id) ?? '')
    if (!start) return
    followUps.set(start, [...followUps.get(start) ?? [], { call: part, result }])
    if (part.name === 'task_wait' && !result?.isError) {
      absorbed.add(part)
      if (result) absorbed.add(result)
    }
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
  const { specialists, onOpen } = useContext(SubagentContext)
  const args = record(part.args) ?? {}
  const steps = Array.isArray(args.steps) ? args.steps.map(record).filter((step) => text(step?.agent)) : []
  const roles = part.name === 'task_chain' ? steps.map((step) => text(step?.agent)!) : text(args.agent) ? [text(args.agent)!] : []
  const taskId = text(args.id) ?? (part.name === 'task_start' ? startedTaskId(result) : undefined) ?? part.id
  const specialist = specialists.find((candidate) => candidate.id === taskId)
  const targets = specialists.filter((candidate) => part.name === 'task_chain' ? candidate.id.startsWith(`${taskId}-step-`) : candidate.id === taskId)
  const mission = oneLine(text(args.prompt) ?? text(args.message) ?? text(steps[0]?.prompt))
  // Failed operations stay in the timeline; keep the last received report in the lane.
  const latest = [...followUps].reverse().find((followUp) => followUp.call.name === 'task_wait' && !followUp.result?.isError) ?? { call: part, result }
  const latestOutput = latest.result?.text ?? ''
  const pending = !latest.result || latest.result.streaming || followUps.some((followUp) => !followUp.result || followUp.result.streaming)
  const background = !pending && latest.call.name === 'task_start'
  let outcome: SpecialistStatus = pending || background ? 'running' : latest.result?.isError ? 'error' : 'done'
  for (const followUp of followUps) outcome = specialistOutcome({ previous: outcome, tool: followUp.call.name, result: followUp.result, startsGeneration: record(followUp.call.args)?.mode === 'prompt' })
  const state = specialist?.status ?? outcome
  const stateLabel = specialistStatusLabel[state]
  const report = text(record(latest.result?.details)?.finalReport) ?? settledReport(latestOutput) ?? (pending || background ? undefined : text(latestOutput))
  const highlights = report ? reportHighlights(report) : []
  const rail = highlights.length ? highlights : state === 'running' ? [specialist?.activity ? `Last observed: ${specialist.activity}` : 'Awaiting a recorded update…'] : []
  const verb = VERBS[part.name]

  return <div className={`subagent-lane is-${state}`}>
    <div className="subagent-lane__summary">
      <span className="subagent-lane__status" aria-hidden="true">{state === 'running' ? <CircleNotch size={13} /> : state === 'error' ? <WarningCircle size={13} /> : state === 'done' ? <Check size={13} /> : <Robot size={13} />}</span>
      {verb ? <span className="subagent-lane__verb">{verb}</span> : null}
      {roles.length
        ? roles.map((role, index) => <span key={`${role}-${index}`} className="subagent-lane__role">{role}</span>)
        : <span className="subagent-lane__role">agent</span>}
      {taskId ? <code className="subagent-lane__id">{taskId}</code> : null}
      {mission ? <span className="subagent-lane__mission" title={mission}>{mission}</span> : <span className="subagent-lane__mission" />}
      <span className="subagent-lane__state">{stateLabel}</span>
    </div>
    {onOpen && targets.length > 0 ? <div className="subagent-lane__links">{targets.map((target) => <button type="button" key={target.id} onClick={() => onOpen(target.id)}>{part.name === 'task_chain' ? `Open ${target.agent} transcript` : 'Open agent transcript'}</button>)}</div> : null}
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
