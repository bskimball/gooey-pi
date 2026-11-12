import { randomUUID } from 'node:crypto'
import type { TranscriptMessage } from 'apex-core/types/api'
import { isRecord } from 'apex-core/validation'
import { replayApexEvents } from '../../src/lib/events/reduce'
import { blockingExtensionUiRequestId } from '../../src/lib/extension-ui'

/** Updated synchronously before subscribers see a frame. Never rereads a live file. */
export class DesktopSessionProjection {
  messages: TranscriptMessage[]
  readonly dialogs = new Map<string, { event: Record<string, unknown>; expiresAt: number }>()
  readonly statuses: Record<string, string> = Object.create(null)
  readonly answering = new Set<string>()

  constructor(messages: TranscriptMessage[]) { this.messages = messages }

  apply(event: Record<string, unknown>): Record<string, unknown> | undefined {
    const id = blockingExtensionUiRequestId(event)
    if (id) this.dialogs.set(id, { event, expiresAt: typeof event.timeout === 'number' && event.timeout > 0 ? Date.now() + event.timeout : Infinity })
    if (event.type === 'extension_ui_resolved' && typeof event.id === 'string') this.dialogs.delete(event.id)
    if (event.type === 'extension_ui_request' && event.method === 'setStatus' && typeof event.statusKey === 'string') {
      if (typeof event.statusText === 'string') this.statuses[event.statusKey] = event.statusText
      else delete this.statuses[event.statusKey]
    }
    if (event.type === 'message_end' && isRecord(event.message) && event.message.role === 'user') {
      const raw = event.message
      const parts: TranscriptMessage['parts'] = []
      if (typeof raw.content === 'string') parts.push({ type: 'text', text: raw.content })
      else if (Array.isArray(raw.content)) for (const part of raw.content) {
        if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') parts.push({ type: 'text', text: part.text })
        else if (isRecord(part) && part.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string') parts.push({ type: 'image', data: part.data, mimeType: part.mimeType })
      }
      const message: TranscriptMessage = { id: `desktop-user-${randomUUID()}`, role: 'user', timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(), parts }
      const tail = this.messages.at(-1)
      const previous = tail?.role === 'assistant' && tail.streaming && !tail.parts.length ? this.messages.slice(0, -1) : this.messages
      this.messages = [...previous.map((row) => row.streaming ? { ...row, streaming: false } : row), message]
      return { type: 'desktop_user_message', message, messages: this.messages }
    }
    this.messages = replayApexEvents(this.messages, [event])
    return undefined
  }

  pendingDialogs(): Record<string, unknown>[] {
    const now = Date.now()
    for (const [id, dialog] of this.dialogs) if (dialog.expiresAt <= now) this.dialogs.delete(id)
    return [...this.dialogs.values()].map(({ event }) => event)
  }

  beginAnswer(id: string): void {
    this.pendingDialogs()
    if (!this.dialogs.has(id) || this.answering.has(id)) throw new Error('Dialog response is stale or already submitted')
    this.answering.add(id)
  }
}
