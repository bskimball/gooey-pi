import * as stylex from '@stylexjs/stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { AnimatePresence, motion } from 'motion/react'
import { arrivalMotionProps, collapseMotionProps, MorphInline, prefersInstantMotion, useInstantMotion } from '../ContentMotion'
import { createContext, memo, useContext, useId, useState } from 'react'
import type { PiSpecialistSummary } from '../inspector/session-summary'
import { isLiveSpecialist, shortModelName, specialistOutcome, workerDetails, type SpecialistStatus } from '@/lib/specialist-status'
import { ArrowUpRight, CaretRight } from '../icons'
import { PlanStatusMark } from '../PlanStatusMark'
import type { MessagePart } from '@/types/api'
import { boundText } from '@/lib/render-bounds'
import { MarkdownText } from '../MarkdownText'

const DISCLOSURE_SPRING = { type: 'spring', stiffness: 380, damping: 27, mass: 0.8 } as const
const DISCLOSURE_TRANSITION = { height: DISCLOSURE_SPRING, y: DISCLOSURE_SPRING, opacity: { duration: 0.14 } } as const
const laneStyles = stylex.create({
  body: { animationName: 'none' },
  instantCaret: { transitionProperty: 'none' },
  summary: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, columnGap: 0, alignItems: 'stretch' },
  primary: { flexGrow: 1, minWidth: 0, borderWidth: 0, margin: 0, fontFamily: 'inherit', textAlign: 'left', outlineOffset: -2 },
  toggle: {
    display: 'grid', placeItems: 'center', flexShrink: 0, alignSelf: 'center',
    width: 28, height: 28, marginRight: 6, padding: 0, borderWidth: 0,
    borderLeftWidth: 1, borderLeftStyle: 'solid', borderLeftColor: 'var(--border-subtle)',
    backgroundColor: { default: 'transparent', ':hover': 'var(--surface-hover)' },
    color: 'var(--text-tertiary)', cursor: 'pointer',
    outlineWidth: { default: null, ':focus-visible': 2 },
    outlineStyle: { default: null, ':focus-visible': 'solid' },
    outlineColor: { default: null, ':focus-visible': 'var(--focus)' },
    outlineOffset: -2,
  },
})

type ToolCall = Extract<MessagePart, { type: 'toolCall' }>
type ToolResult = Extract<MessagePart, { type: 'toolResult' }>

export const SubagentContext = createContext<{ specialists: PiSpecialistSummary[]; onOpen?(id: string): void }>({ specialists: [] })

const SUBAGENT_TOOLS = new Set(['task', 'task_start', 'task_wait', 'task_chain'])
export const isSubagentTool = (name: string) => SUBAGENT_TOOLS.has(name)

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined

const LANE_STATUS_LABEL: Record<SpecialistStatus, string> = {
  running: 'running',
  waiting: 'waiting',
  done: 'done',
  error: 'failed',
  stopped: 'stopped',
  closed: 'closed',
}

function stripMarkdown(line: string): string {
  return line
    .replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const PREAMBLE_LINE = /^(?:repo\s*:|read\s+agents\.md\b|worktree\b)/i
const HEADING_GOAL = /^(?:#{1,6}\s*)?(?:goal|outcome)\s*:?\s*(.*)$/i

export function cleanGoal(rawPrompt: string | undefined): string | undefined {
  if (!rawPrompt?.trim()) return undefined
  const lines = rawPrompt.split(/\r?\n/).map((line) => line.trim())
  let inFence = false
  let afterGoalHeading = false
  let fallback: string | undefined
  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence || /^-{3,}$/.test(line)) continue
    const goalMatch = HEADING_GOAL.exec(line)
    if (goalMatch) {
      const inline = stripMarkdown(goalMatch[1])
      if (inline && !PREAMBLE_LINE.test(inline)) return boundText(inline, 120, '…')
      afterGoalHeading = true
      continue
    }
    if (PREAMBLE_LINE.test(line)) continue
    const cleaned = stripMarkdown(line)
    if (!cleaned) continue
    if (afterGoalHeading) return boundText(cleaned, 120, '…')
    if (!fallback && !/^#{1,6}\s+/.test(line)) fallback = cleaned
  }
  if (fallback) return boundText(fallback, 120, '…')
  const firstNonPreamble = lines.find((line) => line && !line.startsWith('```') && !/^-{3,}$/.test(line) && !PREAMBLE_LINE.test(line))
  const cleaned = firstNonPreamble ? stripMarkdown(firstNonPreamble) : undefined
  return cleaned ? boundText(cleaned, 120, '…') : undefined
}

export function cleanOutcome(report: string | undefined): string | undefined {
  if (!report?.trim()) return undefined
  const handoffMatch = /(?:^|\n)\s*outcome:\s*(.+)/i.exec(report) ?? /"outcome":\s*"([^"]+)"/.exec(report)
  if (handoffMatch?.[1]) {
    const cleaned = stripMarkdown(handoffMatch[1].replace(/["',]+$/, ''))
    if (cleaned) return boundText(cleaned, 120, '…')
  }
  const lines = report.split(/\r?\n/).map((line) => line.trim())
  let inFence = false
  for (const line of lines) {
    if (!line || line.startsWith('```')) {
      if (line.startsWith('```')) inFence = !inFence
      continue
    }
    if (inFence || /^-{3,}$/.test(line) || /^#{1,6}\s+/.test(line)) continue
    const cleaned = stripMarkdown(line)
    if (cleaned) return boundText(cleaned, 120, '…')
  }
  return undefined
}

/** Settled task output carries the report after a `--- result ---` marker; everything above it is lifecycle metadata. */
function settledReport(output: string): string | undefined {
  const body = /^---\s*result(?:\s*\([^)]*\))?\s*---\r?\n([\s\S]*)$/m.exec(output)?.[1]?.trim()
  return body && body !== '(empty)' ? body : undefined
}

export interface SubagentFollowUp { call: ToolCall; result?: ToolResult }
export interface SubagentPairs { followUps: Map<ToolCall, SubagentFollowUp[]>; absorbed: Set<MessagePart> }

/** A chain reads as its most urgent step. */
function chainStatus(steps: PiSpecialistSummary[]): SpecialistStatus {
  for (const status of ['error', 'waiting', 'running', 'stopped', 'closed'] as const) if (steps.some((step) => step.status === status)) return status
  return 'done'
}

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
      if (id && !result?.isError) starts.set(id, part)
      return
    }
    if (part.name === 'task_rebind' && result && !result.isError) {
      // A wait after rebind may refer to a different launch. Leave it visible rather than folding it into a stale lane.
      if (/^rebound task_\d+ /m.test(result.text)) starts.clear()
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

/**
 * Subagent orchestration calls render as a single quiet ledger row in the reading column,
 * with settled reports and transcript links tucked behind a clean disclosure.
 */
export const SubagentLane = memo(function SubagentLane({ part, result, followUps = [], animateArrival = false }: { part: ToolCall; result?: ToolResult; followUps?: SubagentFollowUp[]; animateArrival?: boolean }) {
  const [open, setOpen] = useState(false)
  const [instantDisclosure, setInstantDisclosure] = useState(true)
  const bodyId = useId()
  const instant = useInstantMotion()
  const { specialists, onOpen } = useContext(SubagentContext)
  const args = record(part.args) ?? {}
  const steps = Array.isArray(args.steps) ? args.steps.map(record).filter((step) => text(step?.agent)) : []
  const roles = part.name === 'task_chain' ? steps.map((step) => text(step?.agent)!) : text(args.agent) ? [text(args.agent)!] : []
  const roleLabel = roles.length ? roles.join(' → ') : 'agent'
  const taskId = text(args.id) ?? (part.name === 'task_start' ? startedTaskId(result) : undefined) ?? part.id
  const instanceId = text(workerDetails(result?.details)?.instanceId)
  const handleMatches = specialists.filter((candidate) => (candidate.taskId ?? candidate.id) === taskId)
  const specialist = (part.id ? specialists.find((candidate) => candidate.launchCallId === part.id) : undefined)
    ?? (instanceId && !result?.isError ? specialists.find((candidate) => candidate.instanceId === instanceId) : undefined)
    ?? (handleMatches.length === 1 && (!instanceId || !handleMatches[0]?.instanceId) ? handleMatches[0] : undefined)
  const targets = part.name === 'task_chain' ? specialists.filter((candidate) => candidate.id.startsWith(`${taskId}-step-`)) : specialist ? [specialist] : []
  const rawPrompt = text(args.prompt) ?? text(args.message) ?? text(steps[0]?.prompt)
  // Failed operations stay in the timeline; keep the last received report in the lane.
  const latest = [...followUps].reverse().find((followUp) => followUp.call.name === 'task_wait' && !followUp.result?.isError) ?? { call: part, result }
  const latestOutput = latest.result?.text ?? ''
  const pending = !latest.result || latest.result.streaming || followUps.some((followUp) => !followUp.result || followUp.result.streaming)
  const background = !pending && latest.call.name === 'task_start'
  let outcome: SpecialistStatus = pending || background ? 'running' : latest.result?.isError ? 'error' : 'done'
  for (const followUp of followUps) outcome = specialistOutcome({ previous: outcome, tool: followUp.call.name, result: followUp.result, startsGeneration: record(followUp.call.args)?.mode === 'prompt' })
  const state = specialist?.status ?? (part.name === 'task_chain' && targets.length ? chainStatus(targets) : outcome)
  const stateLabel = LANE_STATUS_LABEL[state]
  const report = text(record(latest.result?.details)?.finalReport) ?? settledReport(latestOutput) ?? (pending || background ? undefined : text(latestOutput))
  const summary = isLiveSpecialist(state) && specialist?.activity
    ? boundText(specialist.activity.replace(/\s+/g, ' '), 120, '…')
    : !isLiveSpecialist(state) && report
      ? cleanOutcome(report) ?? cleanGoal(rawPrompt)
      : cleanGoal(rawPrompt)
  const singleTarget = onOpen && part.name !== 'task_chain' && targets.length === 1 ? targets[0] : undefined
  const canExpand = Boolean(report) || (Boolean(onOpen) && targets.length > 0 && !singleTarget)
  const isClickable = canExpand || Boolean(singleTarget)
  const hasBody = Boolean(report) || (Boolean(onOpen) && targets.length > 0)
  const avatarLetter = (roleLabel.trim().charAt(0) || 'A').toUpperCase()
  // Fusion workers all share one role, so the task id is what tells parallel lanes apart.
  const workerName = taskId && /^task_\d+$/.test(taskId) && part.name !== 'task_chain' ? taskId : undefined
  const resultWorker = workerDetails(latest.result?.details ?? result?.details)
  const models = part.name === 'task_chain'
    ? [...new Set(targets.flatMap((target) => target.model ? [target.model] : []))]
    : [specialist?.model ?? text(resultWorker?.model) ?? text(args.model)].filter((model): model is string => Boolean(model))
  const thinking = part.name === 'task_chain' ? undefined : specialist?.thinking ?? text(resultWorker?.thinking) ?? text(args.thinking)
  const modelLabel = models.length ? `${models.map((model) => shortModelName(model) ?? model).join(', ')}${thinking ? ` · ${thinking}` : ''}` : undefined

  const toggleDisclosure = (keyboard: boolean) => {
    setInstantDisclosure(keyboard || prefersInstantMotion())
    setOpen((value) => !value)
  }
  const summaryContent = <>
    <span className={`subagent-lane__avatar is-${state} ${stylex.props(transcriptStyles.subagentLaneAvatar).className ?? ''}`} aria-hidden="true">
      <MorphInline morphKey={avatarLetter} instant={instant}>
        {avatarLetter}
      </MorphInline>
    </span>
    <span className={`subagent-lane__main ${stylex.props(transcriptStyles.subagentLaneMain).className ?? ''}`}>
      <span className={`subagent-lane__identity ${stylex.props(transcriptStyles.subagentLaneIdentity).className ?? ''}`}>
        <span className={`subagent-lane__role ${stylex.props(transcriptStyles.subagentLaneRole).className ?? ''}`} title={taskId || undefined}>{roleLabel}</span>
        {workerName ? <span className={`subagent-lane__name ${stylex.props(transcriptStyles.subagentLaneMeta).className ?? ''}`}>{workerName}</span> : null}
        {modelLabel ? <span className={`subagent-lane__model ${stylex.props(transcriptStyles.subagentLaneMeta, transcriptStyles.subagentLaneModel).className ?? ''}`} title={models.join(', ')}>{modelLabel}</span> : null}
      </span>
      {summary ? <span className={`subagent-lane__mission ${stylex.props(transcriptStyles.subagentLaneMission).className ?? ''}`} title={summary}>{summary}</span> : null}
    </span>
    <span className={`subagent-lane__state ${stylex.props(transcriptStyles.subagentLaneState).className ?? ''}`}>
      <MorphInline morphKey={stateLabel} instant={instant}>{stateLabel}</MorphInline>
      {singleTarget ? <ArrowUpRight size={11} aria-hidden="true" /> : null}
    </span>
  </>

  return <motion.div className={[`subagent-lane is-${state}`, stylex.props(transcriptStyles.subagentLane, state === 'running' && transcriptStyles.subagentLaneIsRunning, state === 'error' && transcriptStyles.subagentLaneIsError, state === 'waiting' && transcriptStyles.subagentLaneIsWaiting).className].filter(Boolean).join(' ')} {...arrivalMotionProps(instant, animateArrival)}>
    <div className={`subagent-lane__summary ${stylex.props(transcriptStyles.subagentLaneSummary, laneStyles.summary).className ?? ''}`}>
      {isClickable ? <button
        type="button"
        className={`subagent-lane__primary ${stylex.props(transcriptStyles.subagentLaneSummaryClickable, laneStyles.primary).className ?? ''}`}
        title={singleTarget ? 'Show agent in sidebar' : 'Show agent details'}
        aria-expanded={!singleTarget && canExpand ? open : undefined}
        aria-controls={!singleTarget && canExpand ? bodyId : undefined}
        onClick={(event) => {
          if (singleTarget) onOpen?.(singleTarget.id)
          else toggleDisclosure(event.detail === 0)
        }}
      >{summaryContent}</button> : <div {...stylex.props(transcriptStyles.subagentLaneSummary, laneStyles.primary)}>{summaryContent}</div>}
      {canExpand ? <button
        type="button"
        className={`subagent-lane__toggle ${stylex.props(laneStyles.toggle).className ?? ''}`}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${roleLabel} details`}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={(event) => toggleDisclosure(event.detail === 0)}
      ><CaretRight className={`disclosure-caret ${stylex.props(transcriptStyles.subagentLaneCaret, transcriptStyles.disclosureCaret, instantDisclosure && laneStyles.instantCaret).className ?? ''}`} size={11} aria-hidden="true" /></button> : null}
    </div>
    <AnimatePresence initial={false} custom={instantDisclosure}>
      {open && hasBody ? <motion.div key="subagent-body"
        initial={instantDisclosure ? false : { height: 0, opacity: 0, y: -4, overflow: 'hidden' }}
        animate={{ height: 'auto', opacity: 1, y: 0, transitionEnd: { overflow: 'visible' } }}
        variants={{ closed: (snap: boolean) => ({ height: 0, opacity: 0, y: snap ? 0 : -4, overflow: 'hidden', transition: snap ? { duration: 0 } : DISCLOSURE_TRANSITION }) }}
        exit="closed"
        transition={instantDisclosure ? { duration: 0 } : DISCLOSURE_TRANSITION}
        style={{ display: 'flow-root' }}
      >
        <div className={`subagent-lane__body ${stylex.props(transcriptStyles.subagentLaneBody, laneStyles.body).className ?? ''}`} id={bodyId}>
          {onOpen && targets.length > 0 ? <div className={`subagent-lane__links ${stylex.props(transcriptStyles.subagentLaneLinks).className ?? ''}`}>{targets.map((target) => <button type="button" key={target.id} onClick={() => onOpen(target.id)}>{part.name === 'task_chain' ? `Open ${target.agent} transcript` : 'Open agent transcript'}</button>)}</div> : null}
          {report ? <MarkdownText variant="muted" text={boundText(report, 40_000, '\n… [Subagent report truncated in the desktop view.]')} /> : null}
        </div>
      </motion.div> : null}
    </AnimatePresence>
  </motion.div>
})

type TodoStatus = 'completed' | 'in_progress' | 'pending' | 'blocked' | 'cancelled'
interface TodoItem { id: string; content: string; status: TodoStatus }

function todoItems(args: unknown): TodoItem[] {
  const todos = record(args)?.todos
  if (!Array.isArray(todos)) return []
  return todos.flatMap((item, index) => {
    const todo = record(item)
    const content = text(todo?.content)
    if (!content) return []
    const status = todo?.status
    return [{ id: text(todo?.id) ?? `todo-${index + 1}`, content, status: status === 'completed' || status === 'in_progress' || status === 'blocked' || status === 'cancelled' ? status : 'pending' }]
  })
}

/** A plan update reads as the step header for the work that follows it. */
export const TodoStep = memo(function TodoStep({ part, animateArrival = false }: { part: ToolCall; animateArrival?: boolean }) {
  const [open, setOpen] = useState(false)
  const [keyboardToggle, setKeyboardToggle] = useState(false)
  const listId = useId()
  const instant = useInstantMotion()
  const todos = todoItems(part.args)
  const done = todos.filter((todo) => todo.status === 'completed').length
  const active = todos.find((todo) => todo.status === 'in_progress')
  const total = todos.filter((todo) => todo.status !== 'cancelled').length
  const finished = total > 0 && done === total
  const countText = `${done}/${total} done`
  const labelText = active?.content ?? (finished ? 'All steps complete' : 'Plan updated')
  return <motion.div className={[`todo-step ${finished ? 'is-finished' : ''}`, stylex.props(transcriptStyles.todoStep).className].filter(Boolean).join(' ')} {...arrivalMotionProps(instant, animateArrival)}>
    <button type="button" className={`todo-step__summary ${stylex.props(transcriptStyles.todoStepSummary).className ?? ""}`} disabled={!todos.length} aria-expanded={todos.length ? open : undefined} aria-controls={todos.length && open ? listId : undefined} onClick={(event) => {
      setKeyboardToggle(event.detail === 0)
      setOpen((value) => !value)
    }}>
      <span className={`todo-step__count ${stylex.props(transcriptStyles.todoStepCount).className ?? ""}`}>
        <MorphInline morphKey={countText} instant={instant}>{countText}</MorphInline>
      </span>
      <span className={`todo-step__label ${stylex.props(transcriptStyles.todoStepLabel).className ?? ""}`}>
        <MorphInline morphKey={labelText} instant={instant}>{labelText}</MorphInline>
      </span>
      {todos.length ? <CaretRight className={`disclosure-caret ${stylex.props(transcriptStyles.disclosureCaret).className ?? ""}`} size={13} /> : null}
    </button>
    <AnimatePresence initial={false}>
      {open ? <motion.ol key="todo-list" className={`todo-step__list ${stylex.props(transcriptStyles.todoStepList).className ?? ""}`} id={listId} {...collapseMotionProps(instant || keyboardToggle)}>
        <AnimatePresence mode="popLayout" initial={false}>{todos.map((todo) => <motion.li key={todo.id} layout={instant ? false : 'position'} className={`is-${todo.status}`}
          initial={instant ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={instant ? undefined : { opacity: 0 }} transition={{ duration: instant ? 0 : 0.16 }}>
          <PlanStatusMark status={todo.status} instant={instant} size={12} />
          <span>{todo.content}</span>
          <span className={`sr-only ${stylex.props(baseStyles.srOnly).className ?? ""}`}>{todo.status.replace('_', ' ')}</span>
        </motion.li>)}</AnimatePresence>
      </motion.ol> : null}
    </AnimatePresence>
  </motion.div>
})
