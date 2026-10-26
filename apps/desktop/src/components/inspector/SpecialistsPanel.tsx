import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, CaretRight, Check, CircleNotch, Record as RecordIcon, WarningCircle } from '../icons'
import type { MessagePart, TranscriptMessage } from '@/types/api'
import { coalesceAssistantTurns } from '../Transcript'
import { MarkdownText } from '../MarkdownText'
import { WorkTimeline } from '../transcript/timeline'
import type { PiSpecialistSummary } from './SummaryPanel'

export interface PiSpecialistSession extends PiSpecialistSummary {
  prompt: string
  instanceId?: string
  sessionFile?: string
  model?: string
  thinking?: string
  turns?: number
  maxTurns?: number
  generation?: number
  killReason?: string
  messages: TranscriptMessage[]
}

interface SpecialistTurnDraft {
  id: string
  prompt: string
  label?: string
  activities: MessagePart[]
  responseText?: string
  isError?: boolean
  streaming?: boolean
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function parseActivityArgs(summary: unknown): unknown {
  if (typeof summary !== 'string') return summary
  const trimmed = summary.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return { summary: trimmed }
    }
  }
  return { command: trimmed }
}

function activityPartsFromDetails(rawActivities: unknown): { parts: MessagePart[]; runningLabel?: string } {
  if (!Array.isArray(rawActivities)) return { parts: [] }
  const parts: MessagePart[] = []
  let runningLabel: string | undefined
  for (let i = 0; i < rawActivities.length; i += 1) {
    const item = asRecord(rawActivities[i])
    if (!item || typeof item.tool !== 'string' || !item.tool.trim()) continue
    const tool = item.tool.trim()
    const id = typeof item.id === 'string' && item.id ? item.id : `spec-act-${i + 1}`
    const summaryText = typeof item.summary === 'string'
      ? item.summary
      : typeof item.args === 'string'
        ? item.args
        : ''
    const status = typeof item.status === 'string' ? item.status : 'completed'
    const duration = typeof item.duration === 'number' && Number.isFinite(item.duration) ? item.duration : undefined
    if (status === 'running') {
      runningLabel = summaryText ? `${tool}: ${summaryText}`.slice(0, 80) : tool
    }
    parts.push({
      type: 'toolCall',
      id,
      name: tool,
      args: parseActivityArgs(summaryText),
    })
    parts.push({
      type: 'toolResult',
      name: tool,
      text: duration !== undefined ? `${summaryText}${summaryText ? '\n\n' : ''}Duration: ${duration}ms` : summaryText,
      isError: status === 'error',
      streaming: status === 'running',
    })
  }
  return { parts, runningLabel }
}

function extractSettledResultBody(text: string): string | undefined {
  const marker = /^---\s*result(?:\s*\([^)]*\))?\s*---\r?\n([\s\S]*)$/m.exec(text)
  if (!marker) return undefined
  const body = marker[1]?.trim()
  return body && body !== '(empty)' ? body : undefined
}

function buildMessagesFromTurns(turns: SpecialistTurnDraft[]): TranscriptMessage[] {
  const out: TranscriptMessage[] = []
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i]!
    if (turn.prompt) {
      out.push({
        id: `${turn.id}-user`,
        role: 'user',
        parts: [{ type: 'text', text: turn.label ? `**[${turn.label}]**\n\n${turn.prompt}` : turn.prompt }],
      })
    }
    const assistantParts: MessagePart[] = [...turn.activities]
    if (turn.responseText) {
      assistantParts.push({ type: 'text', text: turn.responseText })
    }
    if (assistantParts.length > 0 || turn.streaming) {
      out.push({
        id: `${turn.id}-assistant`,
        role: 'assistant',
        streaming: turn.streaming,
        parts: assistantParts,
      })
    }
  }
  return out
}

export function extractPiSpecialistSessions(messages: TranscriptMessage[]): PiSpecialistSession[] {
  const specialists: PiSpecialistSession[] = []
  const turnsBySpecId = new Map<string, SpecialistTurnDraft[]>()
  const workerById = new Map<string, PiSpecialistSession>()
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

  const applyWorkerDetails = (target: PiSpecialistSession, details: Record<string, unknown> | undefined) => {
    const worker = asRecord(details?.worker) ?? details
    const closeInfo = asRecord(details?.close)
    if (typeof closeInfo?.sessionFile === 'string' && closeInfo.sessionFile) {
      target.sessionFile = closeInfo.sessionFile
    }
    if (!worker) return
    if (typeof worker.instanceId === 'string' && worker.instanceId) target.instanceId = worker.instanceId
    if (typeof worker.sessionFile === 'string' && worker.sessionFile) target.sessionFile = worker.sessionFile
    if (typeof worker.model === 'string' && worker.model) target.model = worker.model
    if (typeof worker.thinking === 'string' && worker.thinking) target.thinking = worker.thinking
    if (typeof worker.turns === 'number') target.turns = worker.turns
    if (typeof worker.maxTurns === 'number' && worker.maxTurns <= 100_000) target.maxTurns = worker.maxTurns
    if (typeof worker.generation === 'number') target.generation = worker.generation
    if (typeof worker.killReason === 'string' && worker.killReason) target.killReason = worker.killReason
  }

  for (let index = 0; index < flatParts.length; index += 1) {
    const part = flatParts[index]
    if (part.type !== 'toolCall') continue
    const args = asRecord(part.args)
    if (part.name === 'task' && typeof args?.agent === 'string') {
      const result = findNextToolResult(index, 'task', true)
      const finalResult = result && !result.streaming ? result : undefined
      const details = asRecord(result?.details)
      const { parts: activityParts, runningLabel } = activityPartsFromDetails(details?.activities)
      const status: PiSpecialistSession['status'] = finalResult
        ? (finalResult.isError ? 'error' : 'done')
        : 'running'
      const fullPrompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      const rawPrompt = fullPrompt.replace(/\s+/g, ' ')
      const responseText = typeof details?.finalReport === 'string' && details.finalReport.trim()
        ? details.finalReport.trim()
        : finalResult?.text?.trim() || undefined
      const id = part.id ?? `task-${specialists.length + 1}`
      const turn: SpecialistTurnDraft = {
        id,
        prompt: fullPrompt,
        activities: activityParts,
        responseText,
        isError: status === 'error',
        streaming: status === 'running',
      }
      const entry: PiSpecialistSession = {
        id,
        agent: args.agent,
        mission: rawPrompt.slice(0, 120),
        prompt: fullPrompt,
        status,
        ...(status === 'running' && runningLabel ? { activity: runningLabel } : {}),
        ...(typeof details?.instanceId === 'string' && details.instanceId ? { instanceId: details.instanceId } : {}),
        ...(typeof details?.sessionFile === 'string' && details.sessionFile ? { sessionFile: details.sessionFile } : {}),
        ...(typeof details?.model === 'string' ? { model: details.model } : {}),
        ...(typeof details?.thinking === 'string' ? { thinking: details.thinking } : {}),
        ...(typeof details?.turns === 'number' ? { turns: details.turns } : {}),
        ...(typeof details?.maxTurns === 'number' && details.maxTurns <= 100_000 ? { maxTurns: details.maxTurns } : {}),
        ...(typeof details?.killReason === 'string' ? { killReason: details.killReason } : {}),
        messages: buildMessagesFromTurns([turn]),
      }
      specialists.push(entry)
    } else if (part.name === 'task_chain' && Array.isArray(args?.steps)) {
      const result = findNextToolResult(index, 'task_chain', true)
      const finalResult = result && !result.streaming ? result : undefined
      const details = asRecord(result?.details)
      const detailSteps = Array.isArray(details?.steps) ? details.steps : []
      const baseId = part.id ?? `chain-${specialists.length + 1}`
      const anyStepFailed = typeof finalResult?.text === 'string' && /^step\s+\d+\s+(?:failed|aborted|timeout)\b/m.test(finalResult.text)
      const finalBody = typeof finalResult?.text === 'string' ? extractSettledResultBody(finalResult.text) ?? finalResult.text : undefined
      let failedEarlier = false
      for (let stepIndex = 0; stepIndex < args.steps.length; stepIndex += 1) {
        const step = asRecord(args.steps[stepIndex])
        if (!step || typeof step.agent !== 'string' || !step.agent.trim()) continue
        const stepDetail = asRecord(detailSteps[stepIndex])
        const { parts: stepActivities, runningLabel } = activityPartsFromDetails(stepDetail?.activities)
        const fullPrompt = typeof step.prompt === 'string' ? step.prompt.trim() : ''
        const rawPrompt = fullPrompt.replace(/\s+/g, ' ')
        let status: PiSpecialistSession['status'] = 'running'
        if (typeof stepDetail?.status === 'string') {
          if (stepDetail.status === 'completed' || stepDetail.status === 'done' || stepDetail.status === 'ok') status = 'done'
          else if (stepDetail.status === 'failed' || stepDetail.status === 'error' || stepDetail.status === 'aborted' || stepDetail.status === 'timeout') {
            status = 'error'
            failedEarlier = true
          }
        } else if (finalResult) {
          const stepNumber = stepIndex + 1
          const stepOk = new RegExp(`^step\\s+${stepNumber}\\s+ok\\b`, 'm').test(finalResult.text)
          const stepBad = new RegExp(`^step\\s+${stepNumber}\\s+(?:failed|aborted|timeout)\\b`, 'm').test(finalResult.text)
          if (stepOk) status = 'done'
          else if (stepBad || failedEarlier || anyStepFailed) {
            status = 'error'
            failedEarlier = true
          } else {
            status = finalResult.isError ? 'error' : 'done'
          }
        }
        const id = `${baseId}-step-${stepIndex + 1}`
        const isLastStep = stepIndex === args.steps.length - 1 || status === 'error'
        const stepReport = typeof stepDetail?.report === 'string' && stepDetail.report.trim()
          ? stepDetail.report.trim()
          : finalResult && isLastStep
            ? finalBody
            : undefined
        const turn: SpecialistTurnDraft = {
          id,
          prompt: fullPrompt,
          activities: stepActivities,
          responseText: stepReport,
          isError: status === 'error',
          streaming: status === 'running',
        }
        const entry: PiSpecialistSession = {
          id,
          agent: step.agent.trim(),
          mission: rawPrompt.slice(0, 120),
          prompt: fullPrompt,
          status,
          ...(status === 'running' && runningLabel ? { activity: runningLabel } : {}),
          messages: buildMessagesFromTurns([turn]),
        }
        applyWorkerDetails(entry, stepDetail)
        specialists.push(entry)
      }
    } else if (part.name === 'task_start' && typeof args?.agent === 'string') {
      const result = findNextToolResult(index, 'task_start', false)
      const details = asRecord(result?.details)
      const workerView = asRecord(details?.worker)
      const fullPrompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      const rawPrompt = fullPrompt.replace(/\s+/g, ' ')
      const match = typeof result?.text === 'string' ? /\b(?:started|reused)\s+(task_\d+)\b/.exec(result.text) : null
      const workerId = (typeof workerView?.id === 'string' ? workerView.id : undefined) ?? match?.[1]
      const { parts: activityParts, runningLabel } = activityPartsFromDetails(workerView?.activities)
      const existing = workerId ? workerById.get(workerId) : undefined
      if (existing && workerId) {
        existing.agent = args.agent
        if (rawPrompt) existing.mission = rawPrompt.slice(0, 120)
        if (fullPrompt) existing.prompt = fullPrompt
        existing.status = result?.isError ? 'error' : 'running'
        delete existing.activity
        applyWorkerDetails(existing, details)
        const turns = turnsBySpecId.get(existing.id) ?? []
        turns.push({
          id: `${existing.id}-gen-${turns.length + 1}`,
          prompt: fullPrompt,
          activities: activityParts,
          streaming: existing.status === 'running',
          isError: existing.status === 'error',
        })
        turnsBySpecId.set(existing.id, turns)
        existing.messages = buildMessagesFromTurns(turns)
      } else {
        const id = workerId ?? part.id ?? `task-${specialists.length + 1}`
        const turns: SpecialistTurnDraft[] = [{
          id: `${id}-gen-1`,
          prompt: fullPrompt,
          activities: activityParts,
          streaming: !result?.isError,
          isError: Boolean(result?.isError),
        }]
        turnsBySpecId.set(id, turns)
        const entry: PiSpecialistSession = {
          id,
          agent: args.agent,
          mission: rawPrompt.slice(0, 120),
          prompt: fullPrompt,
          status: result?.isError ? 'error' : 'running',
          ...(runningLabel ? { activity: runningLabel } : {}),
          messages: buildMessagesFromTurns(turns),
        }
        applyWorkerDetails(entry, details)
        specialists.push(entry)
        if (workerId) workerById.set(workerId, entry)
      }
    } else if (part.name === 'task_send' && typeof args?.id === 'string') {
      const target = workerById.get(args.id)
      if (!target) continue
      const result = findNextToolResult(index, 'task_send', false)
      if (result?.isError) continue
      const details = asRecord(result?.details)
      applyWorkerDetails(target, details)
      const fullMessage = typeof args.message === 'string' ? args.message.trim() : ''
      const rawMessage = fullMessage.replace(/\s+/g, ' ')
      const mode = typeof args.mode === 'string' ? args.mode : 'prompt'
      if (rawMessage && (mode === 'prompt' || !target.mission)) {
        target.mission = rawMessage.slice(0, 120)
        target.prompt = fullMessage
      }
      if (result && /\blifecycle[:=]\s*(?:failed|aborted)\b/i.test(result.text)) {
        target.status = 'error'
        delete target.activity
      } else if (result && /\blifecycle[:=]\s*(?:settled|closed)\b/i.test(result.text)) {
        target.status = 'done'
        delete target.activity
      } else if (mode === 'prompt' || (result && /\blifecycle[:=]\s*(?:running|starting|retrying)\b/i.test(result.text))) {
        target.status = 'running'
        if (mode === 'prompt') delete target.activity
      }
      if (fullMessage) {
        const turns = turnsBySpecId.get(target.id) ?? []
        turns.push({
          id: `${target.id}-send-${turns.length + 1}`,
          prompt: fullMessage,
          label: mode === 'prompt' ? undefined : mode,
          activities: [],
          streaming: target.status === 'running',
        })
        turnsBySpecId.set(target.id, turns)
        target.messages = buildMessagesFromTurns(turns)
      }
    } else if ((part.name === 'task_wait' || part.name === 'task_status' || part.name === 'task_close' || part.name === 'task_abort') && typeof args?.id === 'string') {
      const target = workerById.get(args.id)
      if (!target) continue
      const result = findNextToolResult(index, part.name, part.name === 'task_wait' || part.name === 'task_status')
      if (!result) continue
      const details = asRecord(result.details)
      const workerView = asRecord(details?.worker)
      applyWorkerDetails(target, details)
      const sessionFileMatch = /^session_file:\s*(.+)$/m.exec(result.text)?.[1]?.trim()
      if (sessionFileMatch) target.sessionFile = sessionFileMatch

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

      const turns = turnsBySpecId.get(target.id)
      const currentTurn = turns?.at(-1)
      if (currentTurn) {
        const { parts: detailActivities, runningLabel } = activityPartsFromDetails(workerView?.activities)
        if (detailActivities.length > 0) {
          currentTurn.activities = detailActivities
        } else if (target.activity) {
          const colon = target.activity.indexOf(':')
          const toolName = colon > 0 ? target.activity.slice(0, colon).trim() : 'tool'
          const toolSummary = colon > 0 ? target.activity.slice(colon + 1).trim() : target.activity
          currentTurn.activities = [
            { type: 'toolCall', id: `${target.id}-live-tool`, name: toolName, args: { command: toolSummary } },
            { type: 'toolResult', name: toolName, text: toolSummary, streaming: true },
          ]
        }
        if (target.status === 'running' && runningLabel && !target.activity) {
          target.activity = runningLabel
        }
        const settledBody = extractSettledResultBody(result.text)
        const latestText = typeof workerView?.latestText === 'string' && workerView.latestText.trim() ? workerView.latestText.trim() : undefined
        if (settledBody) currentTurn.responseText = settledBody
        else if (latestText) currentTurn.responseText = latestText
        currentTurn.streaming = target.status === 'running'
        currentTurn.isError = target.status === 'error'
        target.messages = buildMessagesFromTurns(turns!)
      }
    }
  }

  return specialists.slice(-8)
}

interface SpecialistsPanelProps {
  messages: TranscriptMessage[]
  selectedId: string | null
  onSelect(id: string): void
  homeDir?: string
  sessionKey?: string
}

function WorkOrderTurn({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <article className="specialist-turn specialist-turn--user">
      <button
        type="button"
        className="specialist-turn__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <CaretDown size={12} aria-hidden="true" /> : <CaretRight size={12} aria-hidden="true" />}
        <span className="specialist-turn__label">Work order</span>
      </button>
      {open ? (
        <div className="specialist-turn__content">
          <MarkdownText text={text} />
        </div>
      ) : null}
    </article>
  )
}

export const SpecialistsPanel = memo(function SpecialistsPanel({
  messages,
  selectedId,
  onSelect,
  homeDir,
  sessionKey,
}: SpecialistsPanelProps) {
  const specialists = useMemo(() => extractPiSpecialistSessions(messages), [messages])
  const active = useMemo(
    () => specialists.find((spec) => spec.id === selectedId) ?? specialists.find((spec) => spec.status === 'running') ?? specialists.at(-1),
    [specialists, selectedId],
  )
  const [diskTranscript, setDiskTranscript] = useState<{
    sessionKey: string | undefined
    specId: string
    path: string
    messages: TranscriptMessage[]
  } | null>(null)

  const candidateSessionPath = useMemo(() => {
    if (!active) return undefined
    if (active.sessionFile) return active.sessionFile
    if (active.instanceId && homeDir) {
      return `${homeDir.replace(/\/+$/, '')}/.pi/agent/sessions/rpc-workers/${active.instanceId}/worker.jsonl`
    }
    return undefined
  }, [active, homeDir])

  useEffect(() => {
    if (!active || !candidateSessionPath || typeof window === 'undefined' || !window.prime?.sessions?.read) {
      setDiskTranscript(null)
      return
    }
    let cancelled = false
    const targetId = active.id
    const targetPath = candidateSessionPath
    const targetSessionKey = sessionKey
    setDiskTranscript((current) =>
      current && current.sessionKey === targetSessionKey && current.specId === targetId && current.path === targetPath
        ? current
        : null,
    )
    const load = () => {
      void window.prime.sessions.read(targetPath).then((loaded) => {
        if (cancelled) return
        if (Array.isArray(loaded) && loaded.length > 0) {
          setDiskTranscript({ sessionKey: targetSessionKey, specId: targetId, path: targetPath, messages: loaded })
        } else {
          setDiskTranscript((current) =>
            current?.sessionKey === targetSessionKey && current?.specId === targetId && current?.path === targetPath
              ? null
              : current,
          )
        }
      }).catch(() => {
        if (cancelled) return
        setDiskTranscript((current) =>
          current?.sessionKey === targetSessionKey && current?.specId === targetId && current?.path === targetPath
            ? null
            : current,
        )
      })
    }
    load()
    if (active.status !== 'running') {
      return () => { cancelled = true }
    }
    const timer = window.setInterval(load, 1_200)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [active?.id, active?.status, active?.activity, active?.turns, candidateSessionPath, sessionKey])

  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedToBottomRef = useRef(true)
  const previousTargetRef = useRef<string | null>(null)
  const matchedDiskTranscript =
    active !== undefined &&
    candidateSessionPath !== undefined &&
    diskTranscript !== null &&
    diskTranscript.sessionKey === sessionKey &&
    diskTranscript.specId === active.id &&
    diskTranscript.path === candidateSessionPath &&
    diskTranscript.messages.length > 0
      ? diskTranscript.messages
      : null
  const rawTranscript = active ? (matchedDiskTranscript ?? active.messages) : []
  const renderedMessages = useMemo(() => coalesceAssistantTurns(rawTranscript), [rawTranscript])
  const scrollTargetKey = active ? `${sessionKey ?? ''}:${active.id}:${matchedDiskTranscript ? 'disk' : 'inline'}` : null

  useEffect(() => {
    if (!scrollTargetKey) {
      previousTargetRef.current = null
      return
    }
    const switchedTarget = previousTargetRef.current !== scrollTargetKey
    if (switchedTarget) {
      previousTargetRef.current = scrollTargetKey
      pinnedToBottomRef.current = true
    }
    if (!switchedTarget && !pinnedToBottomRef.current) return
    const scrollToBottom = () => {
      const scroller = scrollRef.current
      if (!scroller) return
      if (typeof scroller.scrollTo === 'function') {
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' })
      }
      scroller.scrollTop = scroller.scrollHeight
    }
    scrollToBottom()
    const frame = requestAnimationFrame(scrollToBottom)
    return () => cancelAnimationFrame(frame)
  }, [scrollTargetKey, renderedMessages, active?.activity, active?.status])

  if (!specialists.length || !active) {
    return (
      <div className="inspector-scroll scroll-area specialists-panel">
        <div className="specialists-empty">
          <p>No sub-agents have run in this session yet.</p>
          <small>When Pi delegates work via task or task_start, each specialist’s live session transcript appears here.</small>
        </div>
      </div>
    )
  }

  const metaBadges = [
    active.model,
    active.thinking ? `think:${active.thinking}` : undefined,
    active.generation !== undefined ? `gen ${active.generation}` : undefined,
    active.turns !== undefined
      ? active.maxTurns !== undefined ? `${active.turns}/${active.maxTurns} turns` : `${active.turns} turns`
      : undefined,
  ].filter((item): item is string => Boolean(item))

  return (
    <div className="specialists-panel">
      <div className="specialist-tabstrip" role="tablist" aria-label="Session specialists">
        {specialists.map((spec) => {
          const isSelected = spec.id === active.id
          return (
            <button
              type="button"
              role="tab"
              aria-selected={isSelected}
              key={spec.id}
              className={`specialist-tabstrip__item ${isSelected ? 'is-active' : ''} is-${spec.status}`}
              onClick={() => onSelect(spec.id)}
            >
              {spec.status === 'running' ? <CircleNotch className="spin" size={12} /> : spec.status === 'done' ? <Check size={12} /> : <RecordIcon size={12} />}
              <strong>{spec.agent}</strong>
              {/^task_\d+$/.test(spec.id) ? <span>({spec.id})</span> : null}
            </button>
          )
        })}
      </div>
      <div
        ref={scrollRef}
        className="inspector-scroll scroll-area specialists-panel__body"
        onScroll={() => {
          const scroller = scrollRef.current
          if (scroller) pinnedToBottomRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120
        }}
      >
        <header className="specialist-header">
          <div className="specialist-header__top">
            <div className="specialist-header__title">
              <strong>{active.agent}</strong>
              {/^task_\d+$/.test(active.id) ? <span className="mono">({active.id})</span> : null}
            </div>
            <span className={`run-state ${active.status === 'running' ? 'is-running' : active.status === 'error' ? 'is-error' : ''}`}>
              {active.status === 'running' ? <CircleNotch className="spin" size={12} /> : active.status === 'done' ? <Check size={12} /> : <WarningCircle size={12} />}
              {active.status === 'running' ? 'Running' : active.status === 'done' ? 'Completed' : 'Failed'}
            </span>
          </div>
          {metaBadges.length > 0 ? (
            <div className="specialist-header__meta">
              {metaBadges.map((badge) => <span key={badge}>{badge}</span>)}
            </div>
          ) : null}
          {active.status === 'running' && active.activity ? (
            <div className="specialist-header__activity">
              <CircleNotch className="spin" size={12} />
              <code className="mono">{active.activity}</code>
            </div>
          ) : null}
          {active.killReason ? (
            <div className="specialist-header__error">
              <WarningCircle size={12} />
              <span>{active.killReason}</span>
            </div>
          ) : null}
          {!matchedDiskTranscript ? (
            <small className="specialist-header__source">
              Showing activity summary recorded in parent session (no standalone session transcript file for this run).
            </small>
          ) : null}
        </header>
        <div className="specialist-transcript" aria-label={`${active.agent} session transcript`}>
          {renderedMessages.map((message) => {
            if (message.role === 'user') {
              const text = message.parts
                .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
                .map((part) => part.text)
                .join('\n')
              if (!text) return null
              return <WorkOrderTurn key={`${active.id}:${message.id}`} text={text} />
            }
            const activityParts = message.parts.filter((part) => part.type !== 'text' && part.type !== 'image')
            const textParts = message.parts.filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text' && Boolean(part.text.trim()))
            if (activityParts.length === 0 && textParts.length === 0 && !message.streaming) return null
            return (
              <article key={message.id} className="specialist-turn specialist-turn--assistant">
                <div className="specialist-turn__label">{active.agent}</div>
                {activityParts.length > 0 ? (
                  <WorkTimeline parts={activityParts} showReasoning showTools streaming={Boolean(message.streaming)} />
                ) : null}
                {textParts.length > 0 ? (
                  <div className="specialist-turn__content">
                    {textParts.map((part, index) => (
                      <MarkdownText key={`${message.id}-text-${index}`} text={part.text} streaming={Boolean(message.streaming)} />
                    ))}
                  </div>
                ) : null}
                {message.streaming && activityParts.length === 0 && textParts.length === 0 ? (
                  <div className="specialist-turn__working">
                    <CircleNotch className="spin" size={13} />
                    <span>{active.agent} is working…</span>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
})
