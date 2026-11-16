import type { MessagePart, TranscriptMessage } from '../types/api'
import { specialistOutcome, specialistStepStatus, uiRequestsEvent, workerDetails, type SpecialistStatus } from './status'
import { applySpecialistEvents, isLiveSpecialist } from './machine'
import { extractStaticToolCalls, pairToolCalls, type ToolResultPart } from './tool-calls'

export { extractStaticToolCalls, pairToolCalls, type ToolResultPart } from './tool-calls'

export interface PiSpecialistSummary {
  id: string
  agent: string
  mission: string
  status: SpecialistStatus
  activity?: string
}

export interface PiSpecialistSession extends PiSpecialistSummary {
  prompt: string
  cwd?: string
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
    const summaryText = typeof item.summary === 'string' ? item.summary : typeof item.args === 'string' ? item.args : ''
    const status = typeof item.status === 'string' ? item.status : 'completed'
    const duration = typeof item.duration === 'number' && Number.isFinite(item.duration) ? item.duration : undefined
    if (status === 'running') {
      runningLabel = summaryText ? `${tool}: ${summaryText}`.slice(0, 80) : tool
    }
    parts.push({
      type: 'toolCall',
      id,
      name: tool,
      args: asRecord(item.args) ?? parseActivityArgs(summaryText),
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

const CODEMODE_TASK_TOOLS = new Set(['task_close', 'task_abort', 'task_wait'])

export function extractPiSpecialistSessions(messages: TranscriptMessage[]): PiSpecialistSession[] {
  return parseSpecialistRecords(messages.flatMap((message) => message.parts))
}

/** The one replay of task_* receipts; every specialist view reads its status from here. */
export function parseSpecialistRecords(flatParts: MessagePart[]): PiSpecialistSession[] {
  const specialists: PiSpecialistSession[] = []
  const turnsBySpecId = new Map<string, SpecialistTurnDraft[]>()
  const workerById = new Map<string, PiSpecialistSession>()
  const pairedResults = pairToolCalls(flatParts)

  const getPairedResult = (index: number, includeStreaming: boolean): ToolResultPart | undefined => {
    const result = pairedResults.get(index)
    if (!result) return undefined
    if (result.streaming && !includeStreaming) return undefined
    return result
  }

  const applyWorkerDetails = (target: PiSpecialistSession, details: Record<string, unknown> | undefined) => {
    const worker = asRecord(details?.worker) ?? details
    const closeInfo = asRecord(details?.close)
    if (typeof closeInfo?.sessionFile === 'string' && closeInfo.sessionFile) {
      target.sessionFile = closeInfo.sessionFile
    }
    if (!worker) return
    if (typeof worker.cwd === 'string') target.cwd = worker.cwd
    target.status = applySpecialistEvents(target.status, uiRequestsEvent(worker))
    if (typeof worker.instanceId === 'string' && worker.instanceId) target.instanceId = worker.instanceId
    if (typeof worker.sessionFile === 'string' && worker.sessionFile) target.sessionFile = worker.sessionFile
    if (typeof worker.model === 'string' && worker.model) target.model = worker.model
    if (typeof worker.thinking === 'string' && worker.thinking) target.thinking = worker.thinking
    if (typeof worker.turns === 'number') target.turns = worker.turns
    if (typeof worker.maxTurns === 'number' && worker.maxTurns <= 100_000) target.maxTurns = worker.maxTurns
    if (typeof worker.generation === 'number') target.generation = worker.generation
    if (typeof worker.killReason === 'string' && worker.killReason) target.killReason = worker.killReason
  }

  const syncTurnState = (target: PiSpecialistSession) => {
    if (!isLiveSpecialist(target.status)) delete target.activity
    const turns = turnsBySpecId.get(target.id)
    const currentTurn = turns?.at(-1)
    if (currentTurn) {
      currentTurn.streaming = isLiveSpecialist(target.status)
      currentTurn.isError = target.status === 'error'
      target.messages = buildMessagesFromTurns(turns!)
    }
  }

  const applyControlResult = (target: PiSpecialistSession, toolName: string, result: ToolResultPart) => {
    const details = asRecord(result.details)
    const workerView = asRecord(details?.worker)
    applyWorkerDetails(target, details)
    const sessionFileMatch = /^session_file:\s*(.+)$/m.exec(result.text)?.[1]?.trim()
    if (sessionFileMatch) target.sessionFile = sessionFileMatch
    const killReason = /^kill_reason:[ \t]*(.+)$/m.exec(result.text)?.[1]?.trim()
    if (killReason) target.killReason = killReason

    target.status = specialistOutcome({ previous: target.status, tool: toolName, result })
    const rawActivity = isLiveSpecialist(target.status)
      ? /^(?:activity|running):[ \t]*(.+)$/m
          .exec(result.text)?.[1]
          ?.trim()
          .replace(/^running\s+/i, '')
      : undefined
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
        const activityTool = colon > 0 ? target.activity.slice(0, colon).trim() : 'tool'
        const toolSummary = colon > 0 ? target.activity.slice(colon + 1).trim() : target.activity
        currentTurn.activities = [
          { type: 'toolCall', id: `${target.id}-live-tool`, name: activityTool, args: { command: toolSummary } },
          { type: 'toolResult', name: activityTool, text: toolSummary, streaming: true },
        ]
      }
      if (isLiveSpecialist(target.status) && runningLabel && !target.activity) {
        target.activity = runningLabel
      }
      const settledBody = typeof details?.finalReport === 'string' ? details.finalReport.trim() : extractSettledResultBody(result.text)
      if (target.status === 'done' && settledBody && (toolName === 'task_wait' || !target.finalReport)) target.finalReport = settledBody
      const latestText = typeof workerView?.latestText === 'string' && workerView.latestText.trim() ? workerView.latestText.trim() : undefined
      if (target.finalReport) currentTurn.responseText = target.finalReport
      else if (settledBody) currentTurn.responseText = settledBody
      else if (latestText) currentTurn.responseText = latestText
      currentTurn.streaming = isLiveSpecialist(target.status)
      currentTurn.isError = target.status === 'error'
      target.messages = buildMessagesFromTurns(turns!)
    }
  }

  const applyAsyncSettlementLines = (text: string) => {
    const pattern = /^(task_\d+):\s*(settled|failed|aborted)\b(.*)$/gm
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const target = workerById.get(match[1]!)
      if (!target) continue
      const word = match[2]!
      const eventType = word === 'settled' ? 'SETTLED' : word === 'failed' ? 'FAILED' : 'ABORTED'
      target.status = applySpecialistEvents(target.status, [{ type: eventType }])
      syncTurnState(target)
    }
  }

  for (let index = 0; index < flatParts.length; index += 1) {
    const part = flatParts[index]!
    if (part.type === 'toolResult' && (part.name === 'Async Task Settled' || part.name === 'async-task-settled')) {
      applyAsyncSettlementLines(part.text)
      continue
    }
    if (part.type === 'text' && /^Async RPC worker settled:/m.test(part.text)) {
      applyAsyncSettlementLines(part.text)
      continue
    }
    if (part.type !== 'toolCall') continue
    const args = asRecord(part.args)
    if (part.name === 'task' && typeof args?.agent === 'string') {
      const result = getPairedResult(index, true)
      const finalResult = result && !result.streaming ? result : undefined
      const details = asRecord(result?.details)
      const { parts: activityParts, runningLabel } = activityPartsFromDetails(details?.activities)
      const status: PiSpecialistSession['status'] = finalResult ? (finalResult.isError ? 'error' : 'done') : 'running'
      const fullPrompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
      const rawPrompt = fullPrompt.replace(/\s+/g, ' ')
      const responseText = typeof details?.finalReport === 'string' && details.finalReport.trim() ? details.finalReport.trim() : finalResult?.text?.trim() || undefined
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
        cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
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
      const result = getPairedResult(index, true)
      const finalResult = result && !result.streaming ? result : undefined
      const details = asRecord(result?.details)
      const detailSteps = Array.isArray(details?.steps) ? details.steps : []
      const baseId = part.id ?? `chain-${specialists.length + 1}`
      const anyStepFailed = typeof finalResult?.text === 'string' && /^step\s+\d+\s+(?:failed|aborted|timeout)\b/m.test(finalResult.text)
      const finalBody = typeof finalResult?.text === 'string' ? (extractSettledResultBody(finalResult.text) ?? finalResult.text) : undefined
      let failedEarlier = false
      for (let stepIndex = 0; stepIndex < args.steps.length; stepIndex += 1) {
        const step = asRecord(args.steps[stepIndex])
        if (!step || typeof step.agent !== 'string' || !step.agent.trim()) continue
        const stepDetail = asRecord(detailSteps[stepIndex])
        const { parts: stepActivities, runningLabel } = activityPartsFromDetails(stepDetail?.activities)
        const fullPrompt = typeof step.prompt === 'string' ? step.prompt.trim() : ''
        const rawPrompt = fullPrompt.replace(/\s+/g, ' ')
        let status: PiSpecialistSession['status'] = 'running'
        const stepStatus = specialistStepStatus(workerDetails(stepDetail)?.status)
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
        const stepReport = typeof stepDetail?.report === 'string' && stepDetail.report.trim() ? stepDetail.report.trim() : finalResult && isLastStep ? finalBody : undefined
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
      const result = getPairedResult(index, false)
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
        if (typeof args.cwd === 'string') existing.cwd = args.cwd
        if (rawPrompt) existing.mission = rawPrompt.slice(0, 120)
        if (fullPrompt) existing.prompt = fullPrompt
        existing.status = applySpecialistEvents(existing.status, [{ type: result?.isError ? 'FAILED' : 'RUNNING' }])
        delete existing.killReason
        delete existing.finalReport
        delete existing.activity
        applyWorkerDetails(existing, details)
        const turns = turnsBySpecId.get(existing.id) ?? []
        turns.push({
          id: `${existing.id}-gen-${turns.length + 1}`,
          prompt: fullPrompt,
          activities: activityParts,
          streaming: isLiveSpecialist(existing.status),
          isError: existing.status === 'error',
        })
        turnsBySpecId.set(existing.id, turns)
        existing.messages = buildMessagesFromTurns(turns)
      } else {
        const id = workerId ?? part.id ?? `task-${specialists.length + 1}`
        const turns: SpecialistTurnDraft[] = [
          {
            id: `${id}-gen-1`,
            prompt: fullPrompt,
            activities: activityParts,
            streaming: !result?.isError,
            isError: Boolean(result?.isError),
          },
        ]
        turnsBySpecId.set(id, turns)
        const entry: PiSpecialistSession = {
          id,
          agent: args.agent,
          mission: rawPrompt.slice(0, 120),
          prompt: fullPrompt,
          cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
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
      const result = getPairedResult(index, false)
      if (result?.isError) continue
      const details = asRecord(result?.details)
      applyWorkerDetails(target, details)
      const fullMessage = typeof args.message === 'string' ? args.message.trim() : ''
      const rawMessage = fullMessage.replace(/\s+/g, ' ')
      // task_send requires mode; only a new prompt starts a generation.
      const mode = typeof args.mode === 'string' ? args.mode : undefined
      if (rawMessage && (mode === 'prompt' || !target.mission)) {
        target.mission = rawMessage.slice(0, 120)
        target.prompt = fullMessage
      }
      target.status = specialistOutcome({ previous: target.status, tool: part.name, result, startsGeneration: mode === 'prompt' })
      if (!isLiveSpecialist(target.status) || mode === 'prompt') delete target.activity
      if (isLiveSpecialist(target.status) && mode === 'prompt') {
        delete target.killReason
        delete target.finalReport
      }
      if (fullMessage) {
        const turns = turnsBySpecId.get(target.id) ?? []
        turns.push({
          id: `${target.id}-send-${turns.length + 1}`,
          prompt: fullMessage,
          label: mode === 'prompt' ? undefined : mode,
          activities: [],
          streaming: isLiveSpecialist(target.status),
        })
        turnsBySpecId.set(target.id, turns)
        target.messages = buildMessagesFromTurns(turns)
      }
    } else if ((part.name === 'task_wait' || part.name === 'task_status' || part.name === 'task_close' || part.name === 'task_abort') && typeof args?.id === 'string') {
      const target = workerById.get(args.id)
      if (!target) continue
      const result = getPairedResult(index, part.name === 'task_wait' || part.name === 'task_status')
      if (!result) continue
      applyControlResult(target, part.name, result)
    } else if (part.name === 'task_wait' && Array.isArray(args?.ids)) {
      const result = getPairedResult(index, true)
      if (!result) continue
      const details = asRecord(result.details)
      const workerView = asRecord(details?.worker)
      const primaryId = (typeof workerView?.id === 'string' && workerView.id) || /^(task_\d+)\s+(?:already\s+)?settled\b/im.exec(result.text)?.[1] || /^(task_\d+)\b/m.exec(result.text)?.[1]
      if (primaryId) {
        const target = workerById.get(primaryId)
        if (target) applyControlResult(target, 'task_wait', result)
      }
      const othersLine = /^others:[ \t]*(.+)$/im.exec(result.text)?.[1]
      if (othersLine) {
        const otherPattern = /\b(task_\d+)\s+(settled|running|starting|retrying|failed|aborted|closed)\b/gi
        let m: RegExpExecArray | null
        while ((m = otherPattern.exec(othersLine)) !== null) {
          const otherId = m[1]!
          if (otherId === primaryId) continue
          const other = workerById.get(otherId)
          if (!other) continue
          other.status = specialistOutcome({
            previous: other.status,
            tool: 'task_wait',
            result: { type: 'toolResult', name: 'task_wait', text: `lifecycle: ${m[2]!.toLowerCase()}` },
          })
          syncTurnState(other)
        }
      }
    } else if (part.name === 'task_list') {
      const result = getPairedResult(index, false)
      if (!result || result.isError) continue
      const details = asRecord(result.details)
      const listObj = asRecord(details?.list)
      const rawWorkers = Array.isArray(listObj?.workers) ? listObj.workers : Array.isArray(details?.workers) ? details.workers : []
      for (const item of rawWorkers) {
        const w = asRecord(item)
        if (!w || typeof w.id !== 'string' || typeof w.lifecycle !== 'string') continue
        const target = workerById.get(w.id)
        if (!target) continue
        target.status = specialistOutcome({
          previous: target.status,
          tool: 'task_list',
          result: { type: 'toolResult', name: 'task_list', text: `lifecycle: ${w.lifecycle}`, details: { worker: w } },
        })
        syncTurnState(target)
      }
      const rowPattern = /^(task_\d+)\s+lifecycle=([a-z_]+)/gim
      let rowMatch: RegExpExecArray | null
      while ((rowMatch = rowPattern.exec(result.text)) !== null) {
        const target = workerById.get(rowMatch[1]!)
        if (!target) continue
        target.status = specialistOutcome({
          previous: target.status,
          tool: 'task_list',
          result: { type: 'toolResult', name: 'task_list', text: `lifecycle: ${rowMatch[2]!}` },
        })
        syncTurnState(target)
      }
    } else if (part.name === 'codemode' && typeof args?.code === 'string') {
      const result = getPairedResult(index, false)
      if (result?.isError) continue
      const staticCalls = extractStaticToolCalls(args.code, CODEMODE_TASK_TOOLS)
      for (const call of staticCalls) {
        const id = typeof call.args.id === 'string' ? call.args.id : undefined
        if (!id) continue
        const target = workerById.get(id)
        if (!target) continue
        if (call.name === 'task_close' || call.name === 'task_abort') {
          applyControlResult(target, call.name, {
            type: 'toolResult',
            name: call.name,
            text: call.name === 'task_close' ? 'lifecycle: closed' : 'lifecycle: aborted',
          })
        } else if (call.name === 'task_wait' && result?.text && (/\blifecycle[:=]\s*[a-z_]+/i.test(result.text) || /^task_\d+\s+(?:already\s+)?settled\b/im.test(result.text))) {
          applyControlResult(target, 'task_wait', {
            type: 'toolResult',
            name: 'task_wait',
            text: result.text,
          })
        }
      }
    }
  }

  return specialists
}
