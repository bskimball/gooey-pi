import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { specialistOutcome, specialistStepStatus, specialistStatusLabel } from '@/lib/specialist-status'
import { CaretDown, CaretRight, Check, Record as RecordIcon, WarningCircle } from '../icons'
import type { MessagePart, TranscriptMessage } from '@/types/api'
import { coalesceAssistantTurns } from '../transcript/grouping'
import { MarkdownText } from '../MarkdownText'
import { renderNarrativeWithActivity } from '../transcript/messages'
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
  finalReport?: string
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
        finalReport: finalResult ? responseText : undefined,
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
        const stepStatus = specialistStepStatus(stepDetail?.status)
        if (stepStatus) {
          status = stepStatus
          if (status === 'error' || status === 'stopped') failedEarlier = true
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
          finalReport: status === 'done' ? stepReport : undefined,
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
      const match = typeof result?.text === 'string' ? /\b(?:started|reused)\s+(task_\d+)\b/i.exec(result.text) : null
      const workerId = (typeof workerView?.id === 'string' ? workerView.id : undefined) ?? match?.[1]
      const { parts: activityParts, runningLabel } = activityPartsFromDetails(workerView?.activities)
      const existing = workerId ? workerById.get(workerId) : undefined
      if (existing && workerId) {
        existing.agent = args.agent
        if (rawPrompt) existing.mission = rawPrompt.slice(0, 120)
        if (fullPrompt) existing.prompt = fullPrompt
        existing.status = result?.isError ? 'error' : 'running'
        delete existing.killReason
        delete existing.finalReport
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
      target.status = specialistOutcome({ previous: target.status, tool: part.name, result, startsGeneration: mode === 'prompt' })
      if (target.status !== 'running' || mode === 'prompt') delete target.activity
      if (target.status === 'running' && mode === 'prompt') { delete target.killReason; delete target.finalReport }
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
      const killReason = /^kill_reason:[ \t]*(.+)$/m.exec(result.text)?.[1]?.trim()
      if (killReason) target.killReason = killReason

      target.status = specialistOutcome({ previous: target.status, tool: part.name, result })
      const rawActivity = target.status === 'running' ? /^(?:activity|running):[ \t]*(.+)$/m.exec(result.text)?.[1]?.trim().replace(/^running\s+/i, '') : undefined
      if (rawActivity && rawActivity !== '(none)') target.activity = rawActivity.slice(0, 80)
      else delete target.activity

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
        const settledBody = typeof details?.finalReport === 'string' ? details.finalReport.trim() : extractSettledResultBody(result.text)
        if (target.status === 'done' && settledBody && (part.name === 'task_wait' || !target.finalReport)) target.finalReport = settledBody
        const latestText = typeof workerView?.latestText === 'string' && workerView.latestText.trim() ? workerView.latestText.trim() : undefined
        if (target.finalReport) currentTurn.responseText = target.finalReport
        else if (settledBody) currentTurn.responseText = settledBody
        else if (latestText) currentTurn.responseText = latestText
        currentTurn.streaming = target.status === 'running'
        currentTurn.isError = target.status === 'error'
        target.messages = buildMessagesFromTurns(turns!)
      }
    }
  }

  return specialists
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
    status: PiSpecialistSession['status']
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
    const targetStatus = active.status
    setDiskTranscript((current) =>
      current && current.sessionKey === targetSessionKey && current.specId === targetId && current.path === targetPath
        ? current
        : null,
    )
    const load = () => {
      void window.prime.sessions.read(targetPath).then((loaded) => {
        if (cancelled) return
        if (Array.isArray(loaded) && loaded.length > 0) {
          setDiskTranscript({ sessionKey: targetSessionKey, specId: targetId, path: targetPath, status: targetStatus, messages: loaded })
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
  const resultRef = useRef<HTMLElement>(null)
  const pinnedToBottomRef = useRef(true)
  const awaitingReportRef = useRef(false)
  const positionedScrollTopRef = useRef<number | null>(null)
  const [following, setFollowing] = useState(true)
  const previousTargetRef = useRef<{ key: string; status: PiSpecialistSession['status'] } | null>(null)
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
  const scrollTargetKey = active ? `${sessionKey ?? ''}:${active.id}` : null
  const finalReport = active?.status === 'done' ? active.finalReport : undefined
  const report = useMemo(() => {
    if (!finalReport) return null
    for (let index = renderedMessages.length - 1; index >= 0; index--) {
      const message = renderedMessages[index]
      if (message.role !== 'assistant') continue
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = message.parts[partIndex]
        if (part.type === 'text' && part.text.trim() === finalReport.trim()) return { messageId: message.id, partIndex }
      }
    }
    return null
  }, [finalReport, renderedMessages])

  useEffect(() => {
    if (!scrollTargetKey || !active) { previousTargetRef.current = null; return }
    const previous = previousTargetRef.current
    const switched = previous?.key !== scrollTargetKey
    const finished = previous?.status === 'running' && active.status !== 'running'
    previousTargetRef.current = { key: scrollTargetKey, status: active.status }
    if (switched) {
      pinnedToBottomRef.current = active.status === 'running'
      awaitingReportRef.current = active.status === 'done'
      setFollowing(pinnedToBottomRef.current)
    }
    if (!switched && !awaitingReportRef.current && !(pinnedToBottomRef.current && (active.status === 'running' || finished))) return
    const position = () => {
      const scroller = scrollRef.current
      if (!scroller) return
      if (active.status === 'done' && resultRef.current) {
        if (!awaitingReportRef.current && !pinnedToBottomRef.current) return
        scroller.scrollTop += resultRef.current.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        awaitingReportRef.current = Boolean(candidateSessionPath && (!matchedDiskTranscript || diskTranscript?.status !== active.status))
        pinnedToBottomRef.current = false
        setFollowing(false)
      } else if (active.status === 'running') {
        if (!pinnedToBottomRef.current) return
        scroller.scrollTop = scroller.scrollHeight
      } else scroller.scrollTop = 0
      positionedScrollTopRef.current = scroller.scrollTop
    }
    position()
    const frame = requestAnimationFrame(position)
    return () => cancelAnimationFrame(frame)
  }, [scrollTargetKey, renderedMessages, active?.activity, active?.status, finalReport, candidateSessionPath, matchedDiskTranscript, diskTranscript?.status])

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

  const failure = active.status === 'error' ? active.killReason ?? [...rawTranscript].reverse().find((message) => message.errorMessage)?.errorMessage : active.killReason
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
              title={`${spec.mission} · ${specialistStatusLabel[spec.status]}`}
              tabIndex={isSelected ? 0 : -1}
              onKeyDown={(event) => {
                const index = specialists.indexOf(spec)
                const destinations: Record<string, number> = { ArrowRight: (index + 1) % specialists.length, ArrowLeft: (index - 1 + specialists.length) % specialists.length, Home: 0, End: specialists.length - 1 }
                const next = destinations[event.key]
                if (next === undefined) return
                event.preventDefault()
                onSelect(specialists[next].id)
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
              }}
              key={spec.id}
              className={`specialist-tabstrip__item ${isSelected ? 'is-active' : ''} is-${spec.status}`}
              onClick={() => onSelect(spec.id)}
            >
              {spec.status === 'done' ? <Check size={12} /> : spec.status === 'error' ? <WarningCircle size={12} /> : <RecordIcon size={12} />}
              <strong>{spec.agent}</strong>
              {/^task_\d+$/.test(spec.id) ? <span>({spec.id})</span> : null}
            </button>
          )
        })}
      </div>
      <header className="specialist-header" key={active.id}>
        <div className="specialist-header__top">
          <div className="specialist-header__title"><strong>{active.agent}</strong><span className="mono">{active.id}</span></div>
          <span className={`run-state is-${active.status}`}>{specialistStatusLabel[active.status]}</span>
        </div>
        <p className="specialist-header__mission" title={active.mission}>{active.mission}</p>
        {failure ? <div className="specialist-header__error"><WarningCircle size={12} /><span>{failure}</span></div> : null}
        {active.status === 'running' && active.activity ? <div className="specialist-header__activity" title="Activity from the parent's last recorded update"><span>Last observed</span><code>{active.activity}</code></div> : null}
        <details className="specialist-header__details">
          <summary>Details <span>{matchedDiskTranscript ? 'Session transcript' : 'Parent summary'}</span></summary>
          <div className="specialist-header__meta">{metaBadges.map((badge) => <span key={badge}>{badge}</span>)}</div>
          {!matchedDiskTranscript ? <small className="specialist-header__source">Showing the parent session's recorded activity, not a live worker status.</small> : null}
          <strong className="specialist-turn__label">Work order</strong><MarkdownText text={active.prompt} />
        </details>
      </header>
      <div
        ref={scrollRef}
        className="inspector-scroll scroll-area specialists-panel__body"
        onScroll={() => {
          const scroller = scrollRef.current
          if (scroller) {
            const positioned = positionedScrollTopRef.current
            positionedScrollTopRef.current = null
            if (positioned !== null && Math.abs(scroller.scrollTop - positioned) < 1) return
            pinnedToBottomRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40
            awaitingReportRef.current = false
            setFollowing(pinnedToBottomRef.current)
          }
        }}
      >
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
            if (message.parts.every((part) => part.type === 'text' && !part.text.trim()) && !message.streaming && !message.errorMessage) return null
            const reportIndex = report?.messageId === message.id ? report.partIndex : -1
            const reportPart = message.parts[reportIndex]
            return (
              <article key={message.id} className="specialist-turn specialist-turn--assistant">
                <div className="specialist-turn__label">{active.agent}</div>
                {message.errorMessage ? <div className="specialist-header__error" role="alert">{message.errorMessage}</div> : null}
                <div className="specialist-turn__content">
                  {renderNarrativeWithActivity(reportIndex < 0 ? message.parts : message.parts.slice(0, reportIndex), message.id, true, true, Boolean(matchedDiskTranscript && message.streaming))}
                  {reportPart?.type === 'text' ? <section className="specialist-result" ref={resultRef}><h3>Result</h3><MarkdownText text={reportPart.text} />{renderNarrativeWithActivity(message.parts.slice(reportIndex + 1), `${message.id}-after`, true, true)}</section> : null}
                </div>
                {message.streaming && !message.parts.length ? (
                  <div className="specialist-turn__working">
                    <RecordIcon size={13} />
                    <span>Awaiting a recorded update…</span>
                  </div>
                ) : null}
              </article>
            )
          })}
          {finalReport && !report ? <section className="specialist-result" ref={resultRef}><h3>Result</h3><MarkdownText text={finalReport} /></section> : null}
        </div>
      </div>
      {active.status === 'running' && !following ? <button type="button" className="specialist-jump" onClick={() => { pinnedToBottomRef.current = true; setFollowing(true); if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }}>Jump to latest</button> : null}
    </div>
  )
})
