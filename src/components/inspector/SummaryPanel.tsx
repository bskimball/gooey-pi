import { memo, useMemo } from 'react'
import { CalendarDots, CaretRight, Check, CircleNotch, GitBranch, Heartbeat, Record as RecordIcon } from '../icons'
import type { AutomationScheduleRecord, GitStatus, NativeHeartbeatRecord, ProjectRecord, RuntimeInfo, TranscriptMessage } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { formatSessionCost, formatSessionTokens } from '@/lib/format-cost'
import { MarkdownText } from '../MarkdownText'

interface SummaryPanelProps {
  /** Active harness agent name ("Prime Agent" / "OMP"). */
  agentName?: string
  /** Short harness name for working copy ("Prime" / "OMP"). */
  shortName?: string
  project?: ProjectRecord
  runtime?: RuntimeInfo | null
  messages: TranscriptMessage[]
  git: GitStatus
  automations: AutomationScheduleRecord[]
  heartbeats: NativeHeartbeatRecord[]
  onOpenAutomation(id: string): void
  onOpenSpecialist?(id: string): void
}

export interface TranscriptSummary {
  toolCount: number
  lastText?: string
}

export interface PiTodoItemSummary {
  id: string
  content: string
  status: string
  note?: string
}

export interface PiSpecialistSummary {
  id: string
  agent: string
  mission: string
  status: 'running' | 'done' | 'error'
  activity?: string
}

export function extractPiSessionWidgets(messages: TranscriptMessage[]): {
  todos: PiTodoItemSummary[]
  specialists: PiSpecialistSummary[]
} {
  let todos: PiTodoItemSummary[] = []
  const specialists: PiSpecialistSummary[] = []
  const workerById = new Map<string, PiSpecialistSummary>()
  const flatParts = messages.flatMap((message) => message.parts)

  const findNextToolResult = (
    startIndex: number,
    toolName: string,
    includeStreaming = false,
  ): Extract<TranscriptMessage['parts'][number], { type: 'toolResult' }> | undefined => {
    for (let cursor = startIndex + 1; cursor < flatParts.length; cursor += 1) {
      const candidate = flatParts[cursor]
      if (candidate.type === 'toolCall' && candidate.name === toolName) return undefined
      if (candidate.type === 'toolResult' && (candidate.name === undefined || candidate.name === toolName)) {
        if (candidate.streaming && !includeStreaming) return undefined
        return candidate
      }
    }
    return undefined
  }
  const findNextFinalToolResult = (startIndex: number, toolName: string) =>
    findNextToolResult(startIndex, toolName, false)

  for (let index = 0; index < flatParts.length; index += 1) {
    const part = flatParts[index]
    if (part.type !== 'toolCall') continue
    const args = part.args && typeof part.args === 'object' ? (part.args as Record<string, unknown>) : undefined
    if (part.name === 'todo_write' && Array.isArray(args?.todos)) {
      const parsed: PiTodoItemSummary[] = []
      for (let i = 0; i < args.todos.length; i += 1) {
        const item = args.todos[i]
        if (!item || typeof item !== 'object') continue
        const rec = item as Record<string, unknown>
        if (typeof rec.content !== 'string' || !rec.content.trim()) continue
        parsed.push({
          id: typeof rec.id === 'string' && rec.id ? rec.id : `todo-${i + 1}`,
          content: rec.content.trim(),
          status: typeof rec.status === 'string' ? rec.status : 'pending',
          note: typeof rec.note === 'string' && rec.note.trim() ? rec.note.trim() : undefined,
        })
      }
      if (parsed.length) todos = parsed
    } else if (part.name === 'task' && typeof args?.agent === 'string') {
      const result = findNextToolResult(index, 'task', true)
      const finalResult = result && !result.streaming ? result : undefined
      const status: PiSpecialistSummary['status'] = finalResult
        ? (finalResult.isError ? 'error' : 'done')
        : 'running'
      const rawPrompt = typeof args.prompt === 'string' ? args.prompt.replace(/\s+/g, ' ').trim() : ''
      let activity: string | undefined
      if (status === 'running' && result?.details && typeof result.details === 'object') {
        const rawActivities = (result.details as Record<string, unknown>).activities
        if (Array.isArray(rawActivities)) {
          for (let i = rawActivities.length - 1; i >= 0; i -= 1) {
            const act = rawActivities[i] as Record<string, unknown> | undefined
            if (act && act.status === 'running' && typeof act.tool === 'string') {
              const summary = typeof act.summary === 'string' ? act.summary : typeof act.args === 'string' ? act.args : ''
              activity = (summary ? `${act.tool}: ${summary}` : act.tool).slice(0, 80)
              break
            }
          }
        }
      }
      specialists.push({
        id: part.id ?? `task-${specialists.length + 1}`,
        agent: args.agent,
        mission: rawPrompt.slice(0, 120),
        status,
        ...(activity ? { activity } : {}),
      })
    } else if (part.name === 'task_chain' && Array.isArray(args?.steps)) {
      const result = findNextFinalToolResult(index, 'task_chain')
      const baseId = part.id ?? `chain-${specialists.length + 1}`
      const anyStepFailed = typeof result?.text === 'string' && /^step\s+\d+\s+(?:failed|aborted|timeout)\b/m.test(result.text)
      let failedEarlier = false
      for (let stepIndex = 0; stepIndex < args.steps.length; stepIndex += 1) {
        const rawStep = args.steps[stepIndex]
        if (!rawStep || typeof rawStep !== 'object') continue
        const step = rawStep as Record<string, unknown>
        if (typeof step.agent !== 'string' || !step.agent.trim()) continue
        const rawPrompt = typeof step.prompt === 'string' ? step.prompt.replace(/\s+/g, ' ').trim() : ''
        let status: PiSpecialistSummary['status'] = 'running'
        if (result) {
          const stepNumber = stepIndex + 1
          const stepOk = new RegExp(`^step\\s+${stepNumber}\\s+ok\\b`, 'm').test(result.text)
          const stepBad = new RegExp(`^step\\s+${stepNumber}\\s+(?:failed|aborted|timeout)\\b`, 'm').test(result.text)
          if (stepOk) {
            status = 'done'
          } else if (stepBad || failedEarlier || anyStepFailed) {
            status = 'error'
            failedEarlier = true
          } else {
            status = result.isError ? 'error' : 'done'
          }
        }
        specialists.push({
          id: `${baseId}-step-${stepIndex + 1}`,
          agent: step.agent.trim(),
          mission: rawPrompt.slice(0, 120),
          status,
        })
      }
    } else if (part.name === 'task_start' && typeof args?.agent === 'string') {
      const result = findNextFinalToolResult(index, 'task_start')
      const rawPrompt = typeof args.prompt === 'string' ? args.prompt.replace(/\s+/g, ' ').trim() : ''
      const match = typeof result?.text === 'string' ? /\b(?:started|reused)\s+(task_\d+)\b/.exec(result.text) : null
      const workerId = match?.[1]
      const existing = workerId ? workerById.get(workerId) : undefined
      if (existing) {
        existing.agent = args.agent
        if (rawPrompt) existing.mission = rawPrompt.slice(0, 120)
        existing.status = result?.isError ? 'error' : 'running'
        delete existing.activity
      } else {
        const entry: PiSpecialistSummary = {
          id: workerId ?? part.id ?? `task-${specialists.length + 1}`,
          agent: args.agent,
          mission: rawPrompt.slice(0, 120),
          status: result?.isError ? 'error' : 'running',
        }
        specialists.push(entry)
        if (workerId) workerById.set(workerId, entry)
      }
    } else if (part.name === 'task_send' && typeof args?.id === 'string') {
      const target = workerById.get(args.id)
      if (!target) continue
      const result = findNextFinalToolResult(index, 'task_send')
      if (result?.isError) continue
      const rawMessage = typeof args.message === 'string' ? args.message.replace(/\s+/g, ' ').trim() : ''
      if (rawMessage && (args.mode === 'prompt' || !target.mission)) {
        target.mission = rawMessage.slice(0, 120)
      }
      if (result && /\blifecycle[:=]\s*(?:failed|aborted)\b/i.test(result.text)) {
        target.status = 'error'
        delete target.activity
      } else if (result && /\blifecycle[:=]\s*(?:settled|closed)\b/i.test(result.text)) {
        target.status = 'done'
        delete target.activity
      } else if (args.mode === 'prompt' || (result && /\blifecycle[:=]\s*(?:running|starting|retrying)\b/i.test(result.text))) {
        target.status = 'running'
        if (args.mode === 'prompt') delete target.activity
      }
    } else if ((part.name === 'task_wait' || part.name === 'task_status' || part.name === 'task_close' || part.name === 'task_abort') && typeof args?.id === 'string') {
      const target = workerById.get(args.id)
      if (!target) continue
      const result = findNextToolResult(index, part.name, part.name === 'task_wait' || part.name === 'task_status')
      if (!result) continue
      const lifecycle = /\blifecycle[:=]\s*([a-z_]+)\b/i.exec(result.text)?.[1]?.toLowerCase()
      if (!result.streaming && (result.isError || part.name === 'task_abort' || lifecycle === 'failed' || lifecycle === 'aborted')) {
        target.status = 'error'
        delete target.activity
      } else if (
        !result.streaming &&
        (part.name === 'task_close' ||
          lifecycle === 'settled' ||
          lifecycle === 'closed' ||
          (!lifecycle && /^task_\d+\s+(?:already\s+)?settled\b/im.test(result.text)))
      ) {
        target.status = 'done'
        delete target.activity
      } else {
        if (lifecycle === 'running' || lifecycle === 'starting' || lifecycle === 'retrying') {
          target.status = 'running'
        }
        if (target.status === 'running') {
          const rawActivity = /^(?:activity|running):[ \t]*(.+)$/m.exec(result.text)?.[1]?.trim().replace(/^running\s+/i, '')
          if (rawActivity && rawActivity !== '(none)') {
            target.activity = rawActivity.slice(0, 80)
          } else {
            delete target.activity
          }
        }
      }
    }
  }
  return { todos, specialists: specialists.slice(-8) }
}

/** One pass for the tool count; one reverse walk that stops at the first text part. */
export function summarizeTranscript(messages: TranscriptMessage[]): TranscriptSummary {
  let toolCount = 0
  for (const message of messages) {
    for (const part of message.parts) if (part.type === 'toolCall') toolCount += 1
  }
  let lastText: string | undefined
  for (let index = messages.length - 1; index >= 0 && lastText === undefined; index -= 1) {
    const parts = messages[index].parts
    for (let cursor = parts.length - 1; cursor >= 0; cursor -= 1) {
      const part = parts[cursor]
      if (part.type === 'text') {
        lastText = part.text
        break
      }
    }
  }
  return { toolCount, lastText }
}

export const SummaryPanel = memo(function SummaryPanel({ agentName = 'Prime Agent', shortName = 'Prime', project, runtime, messages, git, automations, heartbeats, onOpenAutomation, onOpenSpecialist }: SummaryPanelProps) {
  const { toolCount, lastText } = useMemo(() => summarizeTranscript(messages), [messages])
  const { todos, specialists } = useMemo(() => extractPiSessionWidgets(messages), [messages])
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
