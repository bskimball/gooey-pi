import type { TranscriptMessage } from '@/types/api'

export interface ObservedFile { path: string; line?: number; tool: string }

export function observedPath(path: string, cwd?: string): string | undefined {
  let value = path.replace(/\\/g, '/')
  if (value.startsWith('file:')) {
    try {
      const url = new URL(value)
      value = decodeURIComponent(url.pathname)
      if (url.hostname && url.hostname !== 'localhost') value = `//${url.hostname}${value}`
      else if (/^\/[a-z]:\//i.test(value)) value = value.slice(1)
    } catch { return undefined }
  }
  if (/^(?:[a-z]:\/|\/)/i.test(value)) return value
  return cwd ? `${cwd.replace(/\\/g, '/').replace(/\/$/, '')}/${value}` : undefined
}

/** File references are tool-call evidence, not proof of successful writes or ownership. */
export function specialistEvidence(messages: TranscriptMessage[], cwd?: string): { files: ObservedFile[]; issue?: string } {
  const files = new Map<string, ObservedFile>()
  let issue: string | undefined
  for (const message of messages) {
    if (message.errorMessage) issue = message.errorMessage
    for (const part of message.parts) {
      if (part.type !== 'toolCall' || !part.args || typeof part.args !== 'object') continue
      const tool = part.name.split('.').at(-1)?.toLowerCase() ?? ''
      if (!['read', 'edit', 'write', 'editor_read', 'editor_open', 'lsp'].includes(tool)) continue
      const args = part.args as Record<string, unknown>
      const raw = typeof args.path === 'string' ? args.path : typeof args.uri === 'string' ? args.uri : undefined
      if (!raw) continue
      const path = observedPath(raw, cwd)
      if (!path) continue
      const position = typeof args.line === 'number' ? args.line : tool === 'read' ? args.offset : undefined
      const line = typeof position === 'number' && Number.isSafeInteger(position) && position > 0 && position <= 2_147_483_647 ? position : undefined
      files.set(path, { path, line, tool })
      if (files.size > 100) files.delete(files.keys().next().value!)
    }
  }
  return { files: [...files.values()], issue }
}
