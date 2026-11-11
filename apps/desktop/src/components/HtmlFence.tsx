import { useState } from 'react'

const PREVIEW_LIMIT = 100_000
const PREVIEW_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;">`

export function htmlPreviewDocument(source: string): string {
  return `<!doctype html><html><head>${PREVIEW_POLICY}</head><body>${source}</body></html>`
}

/** Sandboxed visual for a model-authored HTML fence. Scripts and remote loads stay blocked. */
export function HtmlFence({ source }: { source: string }) {
  const [showSource, setShowSource] = useState(false)
  if (source.length > PREVIEW_LIMIT) {
    return <pre className="html-preview__source" dir="ltr"><code>{source}</code></pre>
  }
  return <figure className="html-preview">
    <iframe
      className="html-preview__frame"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={htmlPreviewDocument(source)}
      title="HTML preview"
    />
    <button type="button" className="html-preview__source-toggle" aria-expanded={showSource} onClick={() => setShowSource((open) => !open)}>
      {showSource ? 'Hide source' : 'Source'}
    </button>
    {showSource ? <pre className="html-preview__source" dir="ltr"><code>{source}</code></pre> : null}
  </figure>
}
