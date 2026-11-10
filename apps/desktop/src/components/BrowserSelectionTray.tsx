import type { BrowserAnnotation } from '@/types/api'
import { annotationElementLabel, type BrowserReference } from '@/lib/browser-annotations'
import { ImageParts } from './transcript/TranscriptImage'
import { Crosshair, X } from './icons'

export function annotationReference(annotation: BrowserAnnotation): BrowserReference {
  return {
    pageUrl: annotation.pageUrl,
    pageTitle: annotation.pageTitle,
    label: annotation.element.component || annotationElementLabel(annotation.element),
    selector: annotation.element.selector,
    tabId: annotation.tabId,
    comment: annotation.comment,
  }
}

export function BrowserSelectionTray({
  annotations,
  processing,
  error,
  onRemove,
  onClear,
  onReveal,
}: {
  annotations: BrowserAnnotation[]
  processing?: boolean
  error?: string
  onRemove(id: string): void
  onClear(): void
  onReveal?(reference: BrowserReference): void
}) {
  if (!annotations.length && !processing && !error) return null
  return (
    <section className="browser-selection-tray" aria-label="Selected browser elements">
      {annotations.length ? (
        <header className="browser-selection-tray__heading">
          <span>
            {annotations.length} selected element{annotations.length === 1 ? '' : 's'}
          </span>
          <button type="button" aria-label="Remove page annotations" onClick={onClear}>
            Clear
          </button>
        </header>
      ) : null}
      {processing ? <p role="status">Preparing element preview…</p> : null}
      {error ? <p role="status">{error}</p> : null}
      <div className="browser-selection-tray__items">
        {annotations.map((annotation, index) => {
          const reference = annotationReference(annotation)
          return (
            <article className="browser-selection-card" key={annotation.id}>
              <header>
                <button type="button" className="browser-selection-card__target" title={`Reveal ${reference.label} in browser`} onClick={() => onReveal?.(reference)} disabled={!onReveal}>
                  <Crosshair size={12} />
                  <span>{reference.label}</span>
                </button>
                <button type="button" aria-label={`Remove annotation ${index + 1}`} onClick={() => onRemove(annotation.id)}>
                  <X size={13} />
                </button>
              </header>
              {annotation.preview ? (
                <ImageParts images={[annotation.preview]} alt={`Selected ${reference.label}`} />
              ) : (
                <div className="browser-selection-card__missing">Element details attached · no image</div>
              )}
              <small title={annotation.pageUrl}>{annotation.pageTitle || annotation.pageUrl}</small>
              {annotation.stale ? <small>Page changed since capture</small> : null}
              <details>
                <summary>Element details</summary>
                <code>{reference.selector}</code>
                {annotation.comment ? <p>{annotation.comment}</p> : null}
                {annotation.source?.kind === 'resolved' ? (
                  <small>
                    {annotation.source.path}
                    {annotation.source.line ? `:${annotation.source.line}` : ''}
                  </small>
                ) : null}
              </details>
            </article>
          )
        })}
      </div>
    </section>
  )
}
