import { memo } from 'react'
import { CalendarDots, CaretRight } from '../icons'
import { StatusMark, type StatusMarkState } from '../activity/StatusMark'
import type { AutomationScheduleRecord, GitStatus, RuntimeInfo } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { RunConfigSection } from "./RunConfigSection"
import type { Check as ReadinessCheck, Readiness, Review } from './readiness'
import type { SessionSummary } from './session-summary'
import { specialistStatusLabel } from '@/lib/specialist-status'

export { extractPiSessionWidgets, summarizeTranscript } from './session-summary'
export type { PiSpecialistSummary, PiTodoItemSummary, TranscriptSummary } from './session-summary'

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
const todoMark = (status: string): StatusMarkState => status === 'completed' ? 'done' : status === 'in_progress' ? 'running' : 'pending'
const specialistMark = (status: string): StatusMarkState => status === 'running' ? 'running' : status === 'done' ? 'done' : status === 'error' ? 'failed' : 'pending'

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
  const specialists = summary.specialists.slice(-8)
  return (
    <div className="summary-panel">
      <RunConfigSection runtime={runtime} behaviorMode={behaviorMode} cwd={cwd} sessionKey={sessionKey} />
      {todos.length > 0 ? (
        <section className="summary-section">
          <h3>Plan ({todos.filter((t) => t.status === 'completed').length}/{todos.length})</h3>
          <div className="progress-list">
            {todos.map((todo) => (
              <div key={todo.id} className={todo.status === 'in_progress' ? 'is-current' : ''}>
                <StatusMark state={todoMark(todo.status)} size={14} />
                <span>{todo.content}{todo.note ? ` — ${todo.note}` : ''}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {specialists.length > 0 ? (
        <section className="summary-section">
          <h3>Agents ({specialists.filter((s) => s.status === 'running').length} reported running)</h3>
          <div className="summary-agent-list">
            {specialists.map((specialist) => (
              <button type="button" key={specialist.id} className={`is-${specialist.status}`} title={specialistStatusLabel[specialist.status]} onClick={() => onOpenSpecialist(specialist.id)}>
                <StatusMark state={specialistMark(specialist.status)} size={14} />
                <strong>{specialist.agent}</strong>
                <span>{specialist.activity || specialist.mission}</span>
                <CaretRight size={11} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section className="summary-section"><h3>Readiness</h3><div className="progress-list readiness-list">
        {readiness.checks.length || readiness.reviews.length ? null : <div><StatusMark state="pending" size={14} /><span>No checks detected in this session</span></div>}
        {readiness.checks.map((check) => <div key={check.kind} className={`${check.outcome === 'failed' ? 'is-failed' : check.outcome === 'running' ? 'is-current' : ''}${check.changesSince > 0 || check.outcome === 'unknown' ? ' is-stale' : ''}`}><StatusMark state={checkMark(check.outcome)} size={14} /><span>{CHECK_LABELS[check.kind]} · {checkState(check)}</span></div>)}
        {readiness.reviews.map((review) => <div key={review.agent} className={`${review.verdict === 'PASS' || review.verdict === 'ADVISORY' ? '' : 'is-failed'}${review.changesSince > 0 ? ' is-stale' : ''}`}><StatusMark state={review.verdict === 'PASS' || review.verdict === 'ADVISORY' ? 'done' : 'failed'} size={14} /><span>{REVIEW_LABELS[review.agent]} · {reviewState(review)}</span></div>)}
        <div className={git.files.length ? 'is-current' : ''}><span className="status-mark-spacer" aria-hidden="true" /><span>{deliveryLine(git)}</span></div>
        <div><span className="status-mark-spacer" aria-hidden="true" /><span>{toolCount} tool {toolCount === 1 ? 'call' : 'calls'} recorded</span></div>
      </div></section>
      {automations.length ? <section className="summary-section"><h3>Automations</h3><div className="summary-automation-list">
        {automations.slice(0, 2).map((task) => <button type="button" key={task.id} onClick={() => onOpenAutomation(task.id)}>
          <span className="summary-automation-icon"><CalendarDots size={14}/></span><span><strong>{task.title}</strong><small>{task.status}{task.nextRunAt ? ` · Next ${formatRelative(task.nextRunAt)}` : ''}</small></span>
        </button>)}
        {automations.length > 2 ? <button type="button" className="summary-automation-more" onClick={() => onOpenAutomation(automations[0].id)}>View all {automations.length} automations</button> : null}
      </div></section> : null}
    </div>
  )
})
