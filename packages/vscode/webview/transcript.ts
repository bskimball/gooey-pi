import { replayPrimeEvents } from 'apex-ui'
import type { MessagePart, TranscriptMessage } from 'apex-core/types/api'
import type { TranscriptOp } from '../src/protocol'

function finalizeStreaming(messages: TranscriptMessage[]): TranscriptMessage[] {
  if (!messages.some((message) => message.streaming)) return messages
  const now = Date.now()
  return messages.map((message) => message.streaming ? { ...message, streaming: false, completedAt: now } : message)
}

function dropEmptyAssistant(messages: TranscriptMessage[]): TranscriptMessage[] {
  const tail = messages.at(-1)
  if (tail?.role !== 'assistant' || tail.parts.length) return finalizeStreaming(messages)
  return finalizeStreaming(messages.slice(0, -1))
}

/** Apply host ops in order; consecutive raw pi events go through pi-desktop's reducer as one batch. */
export function applyOps(messages: TranscriptMessage[], ops: TranscriptOp[]): TranscriptMessage[] {
  let next = messages
  let batch: Record<string, unknown>[] = []
  const flush = () => {
    if (!batch.length) return
    next = replayPrimeEvents(next, batch)
    batch = []
  }
  for (const op of ops) {
    if (op.kind === 'event') {
      if (op.event.type !== 'apex_drop_empty_assistant') { batch.push(op.event); continue }
      flush()
      next = dropEmptyAssistant(next)
      continue
    }
    flush()
    if (op.kind === 'saved') {
      next = [...finalizeStreaming(next), op.message]
      continue
    }
    if (op.kind === 'notice') {
      next = [...finalizeStreaming(next), { id: op.id, role: 'system', timestamp: op.timestamp, parts: [{ type: 'text', text: op.text }] }]
      continue
    }
    // A steer freezes the visible output so later deltas open a new assistant row below it.
    const parts: MessagePart[] = [{ type: 'text', text: op.text }, ...(op.images ?? []).map((image) => ({ type: 'image' as const, mimeType: image.mimeType, data: image.data }))]
    next = [...finalizeStreaming(next), { id: op.id, role: 'user', timestamp: op.timestamp, parts }]
    if (op.startAssistant) next.push({ id: `assistant-${op.id}`, role: 'assistant', timestamp: op.timestamp, startedAt: op.timestamp, streaming: true, parts: [] })
  }
  flush()
  return next
}
