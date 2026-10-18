import { memo } from 'react'
import { CalendarDots, CaretRight, Check, CircleNotch, GitBranch, Heartbeat, Record as RecordIcon } from '../icons'
import type { AutomationScheduleRecord, GitStatus, NativeHeartbeatRecord, ProjectRecord, RuntimeInfo } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { formatSessionCost, formatSessionTokens } from '@/lib/format-cost'
import { MarkdownText } from '../MarkdownText'
import type { SessionSummary } from './session-summary'

export { extractPiSessionWidgets, summarizeTranscript } from './session-summary'
export type { PiSpecialistSummary, PiTodoItemSummary, TranscriptSummary } from './session-summary'

interface SummaryPanelProps {
  /** Active harness agent name ("Prime Agent" / "OMP"). */
  agentName?: string
  /** Short harness name for working copy ("Prime" / "OMP"). */
  shortName?: string
  project?: ProjectRecord
  runtime?: RuntimeInfo | null
  summary: SessionSummary
  git: GitStatus
  automations: AutomationScheduleRecord[]
  heartbeats: NativeHeartbeatRecord[]
  onOpenAutomation(id: string): void
  onOpenSpecialist?(id: string): void
}

export const SummaryPanel = memo(function SummaryPanel({ agentName = 'Prime Agent', shortName = 'Prime', project, runtime, summary, git, automations, heartbeats, onOpenAutomation, onOpenSpecialist }: SummaryPanelProps) {
  const { toolCount, lastText, todos, specialists } = summary
  const active = Boolean(runtime?.isStreaming || runtime?.isCompacting)
  const sessionCost = formatSessionCost(runtime?.sessionUsage)
  const sessionTokens = formatSessionTokens(runtime?.sessionUsage)
  return (
    <div className="inspector-scroll scroll-area summary-panel">
      <section className="summary-hero">
        <span className={`run-state ${active ? 'is-running' : ''}`}>{active ? <CircleNotch className="spin" size={13} /> : <Check size={13} />}{runtime?.isCompacting ? 'Compacting context' : active ? `${shortName} is working` : 'Ready'}</span>
        <h2>{runtime?.isCompacting ? 'Compacting the session context' : active ? 'Working through the request' : 'Session overview'}</h2>
        <MarkdownText text={lastText !== undefined ? lastText.slice(0, 220) : 'Start a conversation to see a compact summary of the work here.'} />
      </section>
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
      {specialists.length > 0 ? (
        <section className="summary-section">
          <h3>Specialists ({specialists.length})</h3>
          <div className="progress-list">
            {specialists.map((spec) => (
              <button
                type="button"
                key={spec.id}
                className={`summary-specialist-button ${spec.status === 'running' ? 'is-current' : ''}`}
                title={spec.activity ? `${spec.mission} — ${spec.activity}` : spec.mission}
                onClick={() => onOpenSpecialist?.(spec.id)}
              >
                {spec.status === 'running' ? <CircleNotch className="spin" size={13} /> : spec.status === 'done' ? <Check size={13} /> : <RecordIcon size={13} />}
                <span>
                  <strong>{spec.agent}</strong>
                  {/^task_\d+$/.test(spec.id) ? ` (${spec.id})` : ''}
                  {spec.mission ? ` · ${spec.mission}` : ''}
                  {spec.status === 'running' && spec.activity ? ` — ${spec.activity}` : ''}
                </span>
                <CaretRight className="summary-specialist-button__chevron" size={13} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section className="summary-section"><h3>Workspace</h3><dl className="detail-list"><div><dt>Project</dt><dd>{project?.name ?? 'No project'}</dd></div><div><dt>Branch</dt><dd><GitBranch size={12} />{git.branch ?? project?.gitBranch ?? '—'}</dd></div><div><dt>Environment</dt><dd>Local</dd></div><div><dt>Working directory</dt><dd title={project?.primaryFolder} className="mono truncate">{project?.primaryFolder ?? '—'}</dd></div></dl></section>
      <section className="summary-section"><h3>Progress</h3><div className="progress-list"><div><Check size={13} /><span>Loaded project context</span></div><div><Check size={13} /><span>{toolCount} tool {toolCount === 1 ? 'call' : 'calls'} recorded</span></div><div className={git.files.length ? 'is-current' : ''}><RecordIcon size={13} /><span>{git.files.length ? `${git.files.length} files ready to review` : git.isRepo ? 'No uncommitted changes' : 'Git repository not detected'}</span></div></div></section>
      {automations.length || heartbeats.length ? <section className="summary-section"><h3>Automations</h3><div className="summary-automation-list">
        {automations.slice(0, 2).map((task) => <button type="button" key={task.id} onClick={() => onOpenAutomation(task.id)}>
          <span className="summary-automation-icon"><CalendarDots size={14}/></span><span><strong>{task.title}</strong><small>{task.status}{task.nextRunAt ? ` · Next ${formatRelative(task.nextRunAt)}` : ''}</small></span>
        </button>)}
        {heartbeats.slice(0, Math.max(0, 2 - automations.length)).map((heartbeat) => <button type="button" key={heartbeat.id} onClick={() => onOpenAutomation(heartbeat.id)}>
          <span className="summary-automation-icon is-heartbeat"><Heartbeat size={14}/></span><span><strong>{heartbeat.label ?? (heartbeat.source === 'heartbeat' ? 'Thread heartbeat' : 'Agent heartbeat')}</strong><small>{heartbeat.status}{heartbeat.nextRunAt ? ` · Next ${formatRelative(heartbeat.nextRunAt)}` : ''}</small></span>
        </button>)}
        {automations.length + heartbeats.length > 2 ? <button type="button" className="summary-automation-more" onClick={() => onOpenAutomation(automations[0]?.id ?? heartbeats[0]!.id)}>View all {automations.length + heartbeats.length} automations</button> : null}
      </div></section> : null}
      <section className="summary-section"><h3>Context</h3><div className="context-meter"><div><span>Session context</span><span>Managed</span></div><small>{agentName} monitors and compacts context when needed.</small></div>
        {sessionCost !== null ? <dl className="detail-list summary-cost"><div><dt>Cost</dt><dd title={sessionTokens ?? undefined}>{sessionCost}</dd></div>{sessionTokens ? <div><dt>Tokens</dt><dd className="mono truncate" title={sessionTokens}>{sessionTokens}</dd></div> : null}</dl> : null}</section>
    </div>
  )
})
