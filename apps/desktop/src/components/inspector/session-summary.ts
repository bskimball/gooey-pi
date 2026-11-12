import type { MessagePart, TranscriptMessage } from '@/types/api'
import { parseSpecialistRecords, type PiSpecialistSummary } from '@/lib/specialist-records'

export type { PiSpecialistSummary } from '@/lib/specialist-records'

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

export function extractPiSessionWidgets(messages: TranscriptMessage[]): {
  todos: PiTodoItemSummary[]
  specialists: PiSpecialistSummary[]
} {
  return extractWidgetsFromParts(messages.flatMap((message) => Array.isArray(message.parts) ? message.parts : []))
}

function extractWidgetsFromParts(flatParts: MessagePart[]): SessionWidgets {
  let todos: PiTodoItemSummary[] = []
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
    }
  }
  const specialists = parseSpecialistRecords(flatParts).map(({ id, agent, mission, status, activity }): PiSpecialistSummary => activity ? { id, agent, mission, status, activity } : { id, agent, mission, status })
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
