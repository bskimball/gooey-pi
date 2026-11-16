import * as stylex from '@stylexjs/stylex'
import { styles as contextStyles } from 'apex-ui/styles/browser-references-context.stylex'
import { styles as browserReferencesStyles } from 'apex-ui/styles/browser-references.stylex'
import type { BrowserAnnotation } from '@/types/api'
import { annotationElementLabel, type BrowserReference } from '@/lib/browser-annotations'
import { ImageParts } from './transcript/TranscriptImage'
import { Crosshair, X } from './icons'
import { ApexButton, IconButton } from './ui'

const trayStyles = stylex.create({
  imageOutline: {
    outline: '1px solid light-dark(oklch(0 0 0 / 0.1), oklch(1 0 0 / 0.1))',
    outlineOffset: -1,
  },
})

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
    <section className={`browser-selection-tray ${stylex.props(browserReferencesStyles.browserSelectionTray).className ?? ""}`} aria-label="Selected browser elements">
      {annotations.length ? (
        <header className={`browser-selection-tray__heading ${stylex.props(browserReferencesStyles.browserSelectionTrayHeading).className ?? ""}`}>
          <span>
            {annotations.length} selected element{annotations.length === 1 ? '' : 's'}
          </span>
          <ApexButton compact variant="quiet" xstyle={contextStyles.trayHeadingButton} aria-label="Remove page annotations" onClick={onClear}>
            Clear
          </ApexButton>
        </header>
      ) : null}
      {processing ? <p {...stylex.props(contextStyles.trayParagraph)} role="status">Preparing element preview…</p> : null}
      {error ? <p {...stylex.props(contextStyles.trayParagraph)} role="status">{error}</p> : null}
      <div className={`browser-selection-tray__items ${stylex.props(browserReferencesStyles.browserSelectionTrayItems).className ?? ""}`}>
        {annotations.map((annotation, index) => {
          const reference = annotationReference(annotation)
          return (
            <article className={`browser-selection-card ${stylex.props(browserReferencesStyles.browserSelectionCard).className ?? ""}`} key={annotation.id}>
              <header {...stylex.props(contextStyles.cardHeader)}>
                <button type="button" className={`browser-selection-card__target ${stylex.props(onReveal ? contextStyles.targetEnabled : contextStyles.targetDisabled, contextStyles.headerTarget).className ?? ""}`} title={`Reveal ${reference.label} in browser`} onClick={() => onReveal?.(reference)} disabled={!onReveal}>
                  <Crosshair {...stylex.props(contextStyles.targetIcon)} size={12} />
                  <span {...stylex.props(contextStyles.targetLabel)}>{reference.label}</span>
                </button>
                <IconButton size="small" xstyle={contextStyles.headerLastButton} label={`Remove annotation ${index + 1}`} onClick={() => onRemove(annotation.id)}>
                  <X size={13} />
                </IconButton>
              </header>
              {annotation.preview ? (
                <ImageParts images={[annotation.preview]} alt={`Selected ${reference.label}`} xstyle={[contextStyles.trayPreview, contextStyles.imagePreviewFocus]} imageXstyle={[contextStyles.trayImage, trayStyles.imageOutline]} />
              ) : (
                <div className={`browser-selection-card__missing ${stylex.props(browserReferencesStyles.browserSelectionCardMissing).className ?? ""}`}>Element details attached · no image</div>
              )}
              <small {...stylex.props(contextStyles.referenceSmall)} title={annotation.pageUrl}>{annotation.pageTitle || annotation.pageUrl}</small>
              {annotation.stale ? <small {...stylex.props(contextStyles.referenceSmall)}>Page changed since capture</small> : null}
              <details {...stylex.props(contextStyles.cardDetails)}>
                <summary {...stylex.props(contextStyles.cardSummary)}>Element details</summary>
                <code {...stylex.props(contextStyles.cardDetailText)}>{reference.selector}</code>
                {annotation.comment ? <p {...stylex.props(contextStyles.cardDetailText)}>{annotation.comment}</p> : null}
                {annotation.source?.kind === 'resolved' ? (
                  <small {...stylex.props(contextStyles.cardDetailText)}>
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
