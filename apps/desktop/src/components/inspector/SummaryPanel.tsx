import * as stylex from '@stylexjs/stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useId, useState } from 'react'
import { CalendarDots } from '../icons'
import { StatusMark, type StatusMarkState } from '../activity/StatusMark'
import { collapseMotionProps, useInstantMotion } from '../transcript/subagent-lane'
import type { AutomationScheduleRecord, GitStatus, RuntimeInfo } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { RunConfigSection } from "./RunConfigSection"
import type { Check as ReadinessCheck, Readiness, Review } from './readiness'
import type { SessionSummary } from './session-summary'
import { SummaryAgentsSection } from './SummaryAgentsSection'

export { extractPiSessionWidgets, summarizeTranscript } from './session-summary'
export type { PiSpecialistSummary, PiTodoItemSummary, TranscriptSummary } from './session-summary'

const planStyles = stylex.create({
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  heading: { marginBottom: 0 },
  toggle: { width: 'auto', flexShrink: 0, minHeight: 24, marginLeft: 0, marginRight: 0, paddingLeft: 4, paddingRight: 4, fontSize: 11 },
  list: { maxHeight: 240, overflowY: 'auto', overflowX: 'hidden', marginTop: 6 },
  text: { minWidth: 0, overflowWrap: 'anywhere' },
})

function SummaryPlan({ todos }: { todos: SessionSummary['todos'] }) {
  const [expanded, setExpanded] = useState(false)
  const [keyboardToggle, setKeyboardToggle] = useState(false)
  const instant = useInstantMotion() || keyboardToggle
  const listId = useId()
  const current = [...todos.filter((todo) => todo.status === 'in_progress'), ...todos.filter((todo) => todo.status === 'blocked')]
  const compact = current.length ? current.slice(0, 3) : todos.filter((todo) => todo.status === 'pending').slice(0, 1)
  const visible = expanded ? todos : compact
  const done = todos.filter((todo) => todo.status === 'completed').length
  const total = todos.filter((todo) => todo.status !== 'cancelled').length
  return <section className={`summary-section summary-plan ${stylex.props(inspectorStyles.summarySection).className ?? ''}`}>
    <div {...stylex.props(planStyles.header)}>
      <h3 {...stylex.props(planStyles.heading)}>Plan ({done}/{total})</h3>
      {expanded || todos.length > compact.length ? <button type="button" {...stylex.props(inspectorStyles.runConfigToggle, planStyles.toggle)} aria-expanded={expanded} aria-controls={listId} onClick={(event) => { setKeyboardToggle(event.detail === 0); setExpanded((value) => !value) }}>
        {expanded ? 'Show current' : `Show all ${todos.length} tasks`}
      </button> : null}
    </div>
    <div id={listId} role="list" aria-label="Plan tasks" tabIndex={expanded ? 0 : undefined} className={`progress-list ${stylex.props(inspectorStyles.progressList, planStyles.list).className ?? ''}`}>
      <AnimatePresence initial={false}>
        {visible.map((todo) => <motion.div key={todo.id} {...collapseMotionProps(instant)} role="listitem" className={todo.status === 'in_progress' ? 'is-current' : todo.status === 'cancelled' ? 'is-stale' : ''} title={todo.status === 'blocked' || todo.status === 'cancelled' ? todo.status : undefined}>
          <StatusMark state={todoMark(todo.status)} size={14} />
          <span {...stylex.props(planStyles.text)}>{todo.content}{todo.note ? ` — ${todo.note}` : ''}</span>
        </motion.div>)}
      </AnimatePresence>
    </div>
  </section>
}

const CHECK_LABELS: Record<ReadinessCheck['kind'], string> = { test: 'Tests', lint: 'Lint', typecheck: 'Typecheck', build: 'Build', format: 'Format' }
const REVIEW_LABELS: Record<Review['agent'], string> = { oracle: 'Oracle review', inspector: 'Inspector review' }
const staleSuffix = (changes: number) => changes > 0 ? ` · may be stale (${changes} later ${changes === 1 ? 'change' : 'changes'})` : ''

function checkState({ outcome, changesSince }: ReadinessCheck): string {
  if (outcome === 'unknown') return 'Result unverified'
  if (outcome === 'failed') return 'Failed'
  if (outcome === 'running') return 'Running'
  return `Passed${staleSuffix(changesSince)}`
}

function reviewState({ verdict, changesSince }: Review): string {
  return `Verdict ${verdict}${staleSuffix(changesSince)}`
}

const checkMark = (outcome: ReadinessCheck['outcome']): StatusMarkState => outcome === 'passed' ? 'done' : outcome === 'failed' ? 'failed' : outcome === 'running' ? 'running' : 'stale'
const todoMark = (status: string): StatusMarkState => status === 'completed' ? 'done' : status === 'in_progress' ? 'running' : status === 'blocked' || status === 'cancelled' ? 'stale' : 'pending'

function deliveryLine(git: GitStatus): string {
  if (!git.isRepo) return 'Git repository not detected'
  if (git.error) return 'Git status unavailable'
  const changed = new Set(git.files.map((file) => file.path)).size
  if (git.truncated) return `More than ${changed} changed files`
  if (changed) return `${changed} uncommitted ${changed === 1 ? 'file' : 'files'}`
  if (!git.upstream) return 'No uncommitted changes · No upstream configured'
  if (git.ahead === undefined || git.behind === undefined) return 'No uncommitted changes · Upstream sync unknown'
  if (git.ahead > 0 && git.behind > 0) return `${git.ahead} ahead, ${git.behind} behind`
  if (git.ahead > 0) return `${git.ahead} ${git.ahead === 1 ? 'commit' : 'commits'} not pushed`
  if (git.behind > 0) return `${git.behind} ${git.behind === 1 ? 'commit' : 'commits'} behind upstream`
  return 'Clean and up to date with upstream'
}

interface SummaryPanelProps {
  summary: SessionSummary
  readiness: Readiness
  runtime?: RuntimeInfo | null
  behaviorMode?: string
  cwd?: string
  sessionKey?: string
  git: GitStatus
  automations: AutomationScheduleRecord[]
  onOpenAutomation(id: string): void
  onOpenSpecialist(id: string): void
}

/** Overview sections that the chat, Composer, and toolbar do not already show: plan, agents, progress, automations. */
export const SummaryPanel = memo(function SummaryPanel({ summary, readiness, runtime, behaviorMode, cwd, sessionKey, git, automations, onOpenAutomation, onOpenSpecialist }: SummaryPanelProps) {
  const { toolCount, todos } = summary
  return (
    <div className={`summary-panel ${stylex.props(inspectorStyles.summaryPanel).className ?? ""}`}>
      <RunConfigSection runtime={runtime} behaviorMode={behaviorMode} cwd={cwd} sessionKey={sessionKey} />
      {todos.length > 0 ? <SummaryPlan key={sessionKey} todos={todos} /> : null}
      <SummaryAgentsSection specialists={summary.specialists} onOpenSpecialist={onOpenSpecialist} />
      <section className={`summary-section ${stylex.props(inspectorStyles.summarySection).className ?? ""}`}><h3>Readiness</h3><div className={`progress-list readiness-list ${stylex.props(inspectorStyles.progressList).className ?? ""}`}>
        {readiness.checks.length || readiness.reviews.length ? null : <div><StatusMark state="pending" size={14} /><span>No checks detected in this session</span></div>}
        {readiness.checks.map((check) => <div key={check.kind} className={`${check.outcome === 'failed' ? 'is-failed' : check.outcome === 'running' ? 'is-current' : ''}${check.changesSince > 0 || check.outcome === 'unknown' ? ' is-stale' : ''}`}><StatusMark state={checkMark(check.outcome)} size={14} /><span>{CHECK_LABELS[check.kind]} · {checkState(check)}</span></div>)}
        {readiness.reviews.map((review) => <div key={review.agent} className={`${review.verdict === 'PASS' || review.verdict === 'ADVISORY' ? '' : 'is-failed'}${review.changesSince > 0 ? ' is-stale' : ''}`}><StatusMark state={review.verdict === 'PASS' || review.verdict === 'ADVISORY' ? 'done' : 'failed'} size={14} /><span>{REVIEW_LABELS[review.agent]} · {reviewState(review)}</span></div>)}
        <div className={git.files.length ? 'is-current' : ''}><span className={`status-mark-spacer ${stylex.props(inspectorStyles.statusMarkSpacer).className ?? ""}`} aria-hidden="true" /><span>{deliveryLine(git)}</span></div>
        <div><span className={`status-mark-spacer ${stylex.props(inspectorStyles.statusMarkSpacer).className ?? ""}`} aria-hidden="true" /><span>{toolCount} tool {toolCount === 1 ? 'call' : 'calls'} recorded</span></div>
      </div></section>
      {automations.length ? <section className={`summary-section ${stylex.props(inspectorStyles.summarySection).className ?? ""}`}><h3>Automations</h3><div className={`summary-automation-list ${stylex.props(inspectorStyles.summaryAutomationList).className ?? ""}`}>
        {automations.slice(0, 2).map((task) => <button type="button" key={task.id} onClick={() => onOpenAutomation(task.id)}>
          <span className={`summary-automation-icon ${stylex.props(inspectorStyles.summaryAutomationIcon).className ?? ""}`}><CalendarDots size={14}/></span><span><strong>{task.title}</strong><small>{task.status}{task.nextRunAt ? ` · Next ${formatRelative(task.nextRunAt)}` : ''}</small></span>
        </button>)}
        {automations.length > 2 ? <button type="button" className="summary-automation-more" onClick={() => onOpenAutomation(automations[0].id)}>View all {automations.length} automations</button> : null}
      </div></section> : null}
    </div>
  )
})
