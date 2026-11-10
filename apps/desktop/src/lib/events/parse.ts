import type { MessagePart } from 'apex-core/types/api'

/** Record and field coercion for raw Prime events. */

export type UnknownRecord = Record<string, unknown>

export function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' ? value as UnknownRecord : undefined
}

export function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function resultText(value: unknown): string {
  if (typeof value === 'string') return value
  const result = record(value)
  if (!result) return ''
  if (typeof result.output === 'string') return result.output
  if (typeof result.text === 'string') return result.text
  if (Array.isArray(result.content)) return result.content.map((item) => { const block = record(item); return block?.type === 'text' && typeof block.text === 'string' ? block.text : '' }).filter(Boolean).join('\n')
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

export function resultDetails(value: unknown): UnknownRecord | undefined {
  return record(record(value)?.details)
}

const MAX_PARTS_PER_RECORD = 200
const MAX_PART_IMAGE_CHARS = 2 * 1024 * 1024
const TRUNCATION_MARKER = '\n… [truncated] …\n'

function boundedString(value: string, max: number): string {
  if (max <= 0) return ''
  if (value.length <= max) return value
  if (max <= TRUNCATION_MARKER.length) return value.slice(-max)
  const available = max - TRUNCATION_MARKER.length
  const head = Math.floor(available / 3)
  return `${value.slice(0, head)}${TRUNCATION_MARKER}${value.slice(-(available - head))}`
}

export function resultImages(value: unknown): Extract<MessagePart, { type: 'image' }>[] {
  const content = Array.isArray(value) ? value : record(value)?.content
  if (!Array.isArray(content)) return []
  const selected = content.length <= MAX_PARTS_PER_RECORD
    ? content
    : [...content.slice(0, 20), ...content.slice(-(MAX_PARTS_PER_RECORD - 20))]
  const rawImages: Extract<MessagePart, { type: 'image' }>[] = []
  for (const item of selected) {
    const block = record(item)
    if (block?.type !== 'image') continue
    const rawMime = string(block.mimeType)
    const rawData = string(block.data)
    rawImages.push({
      type: 'image',
      mimeType: rawMime !== undefined ? boundedString(rawMime, 128) : undefined,
      data: rawData !== undefined ? boundedString(rawData, MAX_PART_IMAGE_CHARS) : undefined,
      dataTruncated: block.dataTruncated === true || (rawData !== undefined && rawData.length > MAX_PART_IMAGE_CHARS) || undefined,
    })
  }
  let imageBudget = MAX_PART_IMAGE_CHARS
  return rawImages
    .reverse()
    .map((part) => {
      let data: string | undefined
      if (part.data && imageBudget > 0) {
        data = boundedString(part.data, imageBudget)
        imageBudget -= Math.min(part.data.length, imageBudget)
      }
      return {
        ...part,
        data,
        dataTruncated: part.dataTruncated || Boolean(part.data && data !== part.data) || undefined,
      }
    })
    .reverse()
}

export function agentMessagePart(raw: Record<string, unknown>): Extract<MessagePart, { type: 'agentMessage' }> | undefined {
  if (raw.customType !== 'agent_message') return undefined
  const details = record(raw.details)
  const from = record(details?.from)
  const text = string(details?.message) ?? string(raw.content) ?? ''
  return { type: 'agentMessage', text, agentName: string(from?.sessionName) }
}
