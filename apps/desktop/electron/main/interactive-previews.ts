import type { Session } from 'electron'
import { INTERACTIVE_PREVIEW_POLICY, INTERACTIVE_PREVIEW_SCHEME, interactivePreviewDocument } from 'apex-core/interactive-preview'

const MAX_SOURCE_LENGTH = 100_000

function previewSource(raw: string): string | null {
  if (raw.length > 900_100) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== `${INTERACTIVE_PREVIEW_SCHEME}:` || url.hostname !== 'document'
      || url.pathname !== '/render' || url.port || url.username || url.password || url.hash
      || [...url.searchParams.keys()].length !== 1 || !url.searchParams.has('html')) return null
    const source = url.searchParams.get('html')
    return source !== null && source.length <= MAX_SOURCE_LENGTH ? source : null
  } catch { return null }
}

export function isInteractivePreviewUrl(raw: string): boolean {
  return previewSource(raw) !== null
}

export function isAllowedRendererFrameUrl(raw: string): boolean {
  return raw === 'about:blank' || raw === 'about:srcdoc' || isInteractivePreviewUrl(raw)
}

export function interactivePreviewResponse(request: Pick<Request, 'url' | 'method'>): Response {
  const source = request.method === 'GET' ? previewSource(request.url) : null
  return new Response(source === null ? 'Preview unavailable' : interactivePreviewDocument(source), {
    status: source === null ? 400 : 200,
    headers: {
      'Content-Type': source === null ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8',
      'Content-Security-Policy': INTERACTIVE_PREVIEW_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

/** The default session hosts the app; browser guests use their separate partition. */
export function installInteractivePreviews(session: Session): void {
  session.protocol.handle(INTERACTIVE_PREVIEW_SCHEME, interactivePreviewResponse)
  session.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === 'subFrame') {
      callback({ cancel: !isAllowedRendererFrameUrl(details.url) })
      return
    }
    const fromPreview = details.frame?.url.startsWith(`${INTERACTIVE_PREVIEW_SCHEME}:`)
      || details.referrer.startsWith(`${INTERACTIVE_PREVIEW_SCHEME}:`)
    callback({ cancel: Boolean(fromPreview) })
  })
}
