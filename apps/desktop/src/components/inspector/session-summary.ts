import type { MessagePart, TranscriptMessage } from '@/types/api'
import { specialistOutcome, specialistStepStatus, workerDetails, type SpecialistStatus } from '@/lib/specialist-status'

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
  status: SpecialistStatus
  activity?: string
}

export function extractPiSessionWidgets(messages: TranscriptMessage[]): {
  todos: PiTodoItemSummary[]
  specialists: PiSpecialistSummary[]
} {
  return extractWidgetsFromParts(messages.flatMap((message) => Array.isArray(message.parts) ? message.parts : []))
}

function extractWidgetsFromParts(flatParts: MessagePart[]): SessionWidgets {
  let todos: PiTodoItemSummary[] = []
  const specialists: PiSpecialistSummary[] = []
  const workerById = new Map<string, PiSpecialistSummary>()

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
      const result = findNextToolResult(index, 'task_chain', true)
      const steps = workerDetails(result?.details)?.steps
      const detailSteps = Array.isArray(steps) ? steps : []
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
        const stepStatus = specialistStepStatus(workerDetails(detailSteps[stepIndex])?.status)
        if (stepStatus) {
          status = stepStatus
          if (status === 'error' || status === 'stopped') failedEarlier = true
        } else if (result && !result.streaming) {
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
      const match = typeof result?.text === 'string' ? /\b(?:started|reused)\s+(task_\d+)\b/i.exec(result.text) : null
      const worker = workerDetails(result?.details)
      const workerId = typeof worker?.id === 'string' ? worker.id : match?.[1]
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
      target.status = specialistOutcome({ previous: target.status, tool: part.name, result, startsGeneration: args.mode === 'prompt' })
      if (target.status !== 'running' || args.mode === 'prompt') delete target.activity
    } else if ((part.name === 'task_wait' || part.name === 'task_status' || part.name === 'task_close' || part.name === 'task_abort') && typeof args?.id === 'string') {
      const target = workerById.get(args.id)
      if (!target) continue
      const result = findNextToolResult(index, part.name, part.name === 'task_wait' || part.name === 'task_status')
      if (!result) continue
      target.status = specialistOutcome({ previous: target.status, tool: part.name, result })
      const rawActivity = target.status === 'running' ? /^(?:activity|running):[ \t]*(.+)$/m.exec(result.text)?.[1]?.trim().replace(/^running\s+/i, '') : undefined
      if (rawActivity && rawActivity !== '(none)') target.activity = rawActivity.slice(0, 80)
      else delete target.activity
    }
  }
  return { todos, specialists }
}

/** One pass for the tool count; one reverse walk that stops at the first text part. */
export function summarizeTranscript(messages: TranscriptMessage[]): TranscriptSummary {
  let toolCount = 0
  for (const message of messages) {
    for (const part of Array.isArray(message.parts) ? message.parts : []) if (part.type === 'toolCall') toolCount += 1
  }
  let lastText: string | undefined
  for (let index = messages.length - 1; index >= 0 && lastText === undefined; index -= 1) {
    const parts = Array.isArray(messages[index].parts) ? messages[index].parts : []
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

export type SessionWidgets = ReturnType<typeof extractPiSessionWidgets>
export type SessionSummary = TranscriptSummary & SessionWidgets

interface MessageSummary extends TranscriptSummary {
  message: TranscriptMessage
  widgetParts: MessagePart[]
}

const WIDGET_TOOLS = new Set(['todo_write', 'task', 'task_chain', 'task_start', 'task_send', 'task_wait', 'task_status', 'task_close', 'task_abort'])
const EMPTY_PARTS: MessagePart[] = []

function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function summarizeMessage(message: TranscriptMessage, previous?: MessageSummary): MessageSummary {
  let toolCount = 0
  let lastText: string | undefined
  let widgetParts: MessagePart[] = []
  for (const part of Array.isArray(message.parts) ? message.parts : EMPTY_PARTS) {
    if (part.type === 'text') lastText = part.text
    if (part.type === 'toolCall') {
      toolCount += 1
      if (WIDGET_TOOLS.has(part.name)) widgetParts.push(part)
    } else if (part.type === 'toolResult' && (part.name === undefined || WIDGET_TOOLS.has(part.name))) {
      // Unnamed results participate in the parser's cross-message pairing too.
      widgetParts.push(part)
    }
  }
  if (!widgetParts.length) widgetParts = EMPTY_PARTS
  else if (previous && sameItems(previous.widgetParts, widgetParts)) widgetParts = previous.widgetParts
  return { message, toolCount, lastText, widgetParts }
}

/** One selector per inspector. Unchanged messages never rescan their parts.
 * Widget parsing runs only when relevant calls/results change, not on text deltas.
 * Replacing, reordering or removing messages still follows the authoritative snapshot.
 */
export function createSessionSummarySelector() {
  let entries = new Map<string, MessageSummary>()
  let widgetChunks: MessagePart[][] = []
  let widgets: SessionWidgets = { todos: [], specialists: [] }
  let summary: SessionSummary = { toolCount: 0, ...widgets }
  return (messages: TranscriptMessage[]): SessionSummary => {
    const nextEntries = new Map<string, MessageSummary>()
    const nextChunks: MessagePart[][] = []
    let toolCount = 0
    let lastText: string | undefined
    for (const message of messages) {
      const previous = entries.get(message.id)
      const entry = previous?.message === message ? previous : summarizeMessage(message, previous)
      nextEntries.set(message.id, entry)
      toolCount += entry.toolCount
      if (entry.lastText !== undefined) lastText = entry.lastText
      if (entry.widgetParts.length) nextChunks.push(entry.widgetParts)
    }
    entries = nextEntries
    if (!sameItems(widgetChunks, nextChunks)) {
      widgets = extractWidgetsFromParts(nextChunks.flat())
      widgetChunks = nextChunks
    }
    if (summary.toolCount !== toolCount || summary.lastText !== lastText || summary.todos !== widgets.todos || summary.specialists !== widgets.specialists) {
      summary = { toolCount, lastText, ...widgets }
    }
    return summary
  }
}
