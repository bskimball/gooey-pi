import type { TranscriptMessage } from '@/types/api'

interface AssistantGroup {
  segments: TranscriptMessage[]
  message: TranscriptMessage
}

/** Cache only the current transcript's groups, retaining settled row identities across tail updates. */
export function createAssistantTurnCoalescer() {
  let previous = new Map<TranscriptMessage, AssistantGroup>()
  return (messages: TranscriptMessage[]): TranscriptMessage[] => {
    const next = new Map<TranscriptMessage, AssistantGroup>()
    const grouped: TranscriptMessage[] = []
    for (let index = 0; index < messages.length;) {
      const first = messages[index++]
      if (first.role !== 'assistant' || messages[index]?.role !== 'assistant') {
        grouped.push(first)
        continue
      }
      const segments = [first]
      while (messages[index]?.role === 'assistant') segments.push(messages[index++])
      const cached = previous.get(first)
      if (cached && cached.segments.length === segments.length && segments.every((message, i) => message === cached.segments[i])) {
        grouped.push(cached.message)
        next.set(first, cached)
        continue
      }
      const streaming = segments.some((message) => message.streaming)
      let completedAt = first.completedAt
      for (const segment of segments) completedAt = segment.completedAt ?? completedAt
      const message: TranscriptMessage = {
        ...first,
        completedAt: streaming ? undefined : completedAt,
        streaming,
        // Flatten once, rather than copying the accumulated parts for each continuation.
        parts: segments.flatMap((segment) => segment.parts),
      }
      grouped.push(message)
      next.set(first, { segments, message })
    }
    previous = next
    return next.size ? grouped : messages
  }
}

export function coalesceAssistantTurns(messages: TranscriptMessage[]): TranscriptMessage[] {
  return createAssistantTurnCoalescer()(messages)
}
