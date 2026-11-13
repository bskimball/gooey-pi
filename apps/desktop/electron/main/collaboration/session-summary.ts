import type { TranscriptMessage } from '../../../src/types/api'

export interface CollaborationOperations {
  summaries: Array<{ kind: 'tool' | 'todo'; name: string; status: 'error' | 'success' | 'running' | 'unknown'; text: string }>
  truncated: boolean
  character_limit: number
}

const CHARACTER_LIMIT = 6000
const ITEM_LIMIT = 10
const NAME_LIMIT = 80
const TEXT_LIMIT = 1000

type Summary = CollaborationOperations['summaries'][number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function recentOperations(transcript: TranscriptMessage[], characterLimit = CHARACTER_LIMIT): CollaborationOperations {
  const summaries: Summary[] = []
  let truncated = false
  let remaining = characterLimit

  for (let m = transcript.length - 1; m >= 0; m -= 1) {
    const message = transcript[m]
    for (let p = message.parts.length - 1; p >= 0; p -= 1) {
      const part = message.parts[p]
      if (part.type !== 'toolCall' && part.type !== 'toolResult') continue
      if (summaries.length === ITEM_LIMIT || remaining < 8) {
        truncated = true
        return { summaries: summaries.reverse(), truncated, character_limit: characterLimit }
      }

      const isTodo = part.type === 'toolCall' && part.name === 'todo_write'
      let text = ''
      let status: Summary['status'] = 'unknown'
      if (part.type === 'toolResult') {
        text = part.text
        status = 'success'
        if (part.streaming) status = 'running'
        if (part.isError) status = 'error'
      } else if (isTodo) {
        const todos = isRecord(part.args) ? part.args.todos : undefined
        if (Array.isArray(todos)) {
          for (const item of todos) {
            if (!isRecord(item) || typeof item.content !== 'string') continue
            const state = typeof item.status === 'string' ? item.status : 'unknown'
            const line = `${state.slice(0, 80)}: ${item.content.slice(0, TEXT_LIMIT + 1)}`
            if (state.length > 80 || item.content.length > TEXT_LIMIT) truncated = true
            text += `${text ? '\n' : ''}${line}`
            if (text.length > TEXT_LIMIT) { truncated = true; break }
          }
        }
        status = message.streaming ? 'running' : 'unknown'
      } else {
        const args = isRecord(part.args) ? part.args : undefined
        for (const key of ['question', 'command', 'query', 'pattern', 'url', 'path', 'operation', 'id', 'action', 'code', 'cwd']) {
          const value = args?.[key]
          if (typeof value === 'string' && value.trim()) { text = value; break }
        }
        status = message.streaming ? 'running' : 'unknown'
      }

      const originalName = part.name || 'Tool'
      const name = originalName.slice(0, Math.min(NAME_LIMIT, remaining - status.length))
      remaining -= name.length + status.length
      const boundedText = text.slice(0, Math.min(TEXT_LIMIT, remaining))
      remaining -= boundedText.length
      if (name.length < originalName.length || boundedText.length < text.length) truncated = true
      summaries.push({ kind: isTodo ? 'todo' : 'tool', name, status, text: boundedText })
    }
  }
  return { summaries: summaries.reverse(), truncated, character_limit: characterLimit }
}
