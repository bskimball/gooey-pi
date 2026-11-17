export const PROJECT_PREVIEW_PARTITION_PREFIX = 'apex-project-preview-'

export interface ProjectPreview {
  title: string
  url: string
}

export function projectPreviewUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null
    return url
  } catch { return null }
}

export function parseProjectPreview(source: string): ProjectPreview | null {
  if (source.length > 4096) return null
  try {
    const value: unknown = JSON.parse(source)
    if (!value || typeof value !== 'object' || !('url' in value) || typeof value.url !== 'string'
      || !('title' in value) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160) return null
    const url = projectPreviewUrl(value.url)
    return url ? { title: value.title.trim(), url: url.href } : null
  } catch { return null }
}

export function isProjectPreviewPartition(partition: string): boolean {
  return /^apex-project-preview-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(partition)
}

export function isProjectPreviewRequest(raw: string, origin: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol === 'ws:') url.protocol = 'http:'
    else if (url.protocol === 'wss:') url.protocol = 'https:'
    return !url.username && !url.password && url.origin === origin
  } catch { return false }
}

export const INTERACTIVE_PREVIEW_SCHEME = 'apex-preview'
export const INTERACTIVE_PREVIEW_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'; sandbox allow-scripts"

export function interactivePreviewUrl(source: string): string {
  return `${INTERACTIVE_PREVIEW_SCHEME}://document/render?html=${encodeURIComponent(source)}`
}

export function interactivePreviewDocument(source: string): string {
  return `<!doctype html><html><head></head><body>${source}</body></html>`
}
