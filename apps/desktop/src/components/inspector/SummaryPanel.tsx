import { memo } from 'react'
import { CalendarDots, Check, CircleNotch, Record as RecordIcon } from '../icons'
import type { AutomationScheduleRecord, GitStatus } from '@/types/api'
import { formatRelative } from '@/lib/data'
import type { SessionSummary } from './session-summary'

export { extractPiSessionWidgets, summarizeTranscript } from './session-summary'
export type { PiSpecialistSummary, PiTodoItemSummary, TranscriptSummary } from './session-summary'

interface SummaryPanelProps {
  summary: SessionSummary
  git: GitStatus
  automations: AutomationScheduleRecord[]
  onOpenAutomation(id: string): void
}

/** Overview sections that the chat, Composer, and toolbar do not already show: plan, progress, automations. */
export const SummaryPanel = memo(function SummaryPanel({ summary, git, automations, onOpenAutomation }: SummaryPanelProps) {
  const { toolCount, todos } = summary
  return (
    <div className="summary-panel">
      {todos.length > 0 ? (
        <section className="summary-section">
          <h3>Plan ({todos.filter((t) => t.status === 'completed').length}/{todos.length})</h3>
          <div className="progress-list">
            {todos.map((todo) => (
              <div key={todo.id} className={todo.status === 'in_progress' ? 'is-current' : ''}>
                {todo.status === 'completed' ? <Check size={13} /> : todo.status === 'in_progress' ? <CircleNotch className="spin" size={13} /> : <RecordIcon size={13} />}
                <span>{todo.content}{todo.note ? ` — ${todo.note}` : ''}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section className="summary-section"><h3>Progress</h3><div className="progress-list"><div><Check size={13} /><span>{toolCount} tool {toolCount === 1 ? 'call' : 'calls'} recorded</span></div><div className={git.files.length ? 'is-current' : ''}><RecordIcon size={13} /><span>{git.files.length ? `${git.files.length} files ready to review` : git.isRepo ? 'No uncommitted changes' : 'Git repository not detected'}</span></div></div></section>
      {automations.length ? <section className="summary-section"><h3>Automations</h3><div className="summary-automation-list">
        {automations.slice(0, 2).map((task) => <button type="button" key={task.id} onClick={() => onOpenAutomation(task.id)}>
          <span className="summary-automation-icon"><CalendarDots size={14}/></span><span><strong>{task.title}</strong><small>{task.status}{task.nextRunAt ? ` · Next ${formatRelative(task.nextRunAt)}` : ''}</small></span>
        </button>)}
        {automations.length > 2 ? <button type="button" className="summary-automation-more" onClick={() => onOpenAutomation(automations[0].id)}>View all {automations.length} automations</button> : null}
      </div></section> : null}
    </div>
  )
})
