export const INTERACTIVE_PREVIEW_SCHEME = 'apex-preview'
export const INTERACTIVE_PREVIEW_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'; sandbox allow-scripts"

export function interactivePreviewUrl(source: string): string {
  return `${INTERACTIVE_PREVIEW_SCHEME}://document/render?html=${encodeURIComponent(source)}`
}

export function interactivePreviewDocument(source: string): string {
  return `<!doctype html><html><head></head><body>${source}</body></html>`
}
