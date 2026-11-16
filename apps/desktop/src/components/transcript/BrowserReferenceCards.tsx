import * as stylex from '@stylexjs/stylex'
import { styles as contextStyles } from 'apex-ui/styles/browser-references-context.stylex'
import { styles as browserReferencesStyles } from 'apex-ui/styles/browser-references.stylex'
import { createContext, useContext } from 'react'
import type { BrowserReference } from '@/lib/browser-annotations'
import type { MessagePart } from '@/types/api'
import { Crosshair } from '../icons'
import { ImageParts } from './TranscriptImage'

export const BrowserReferenceContext = createContext<((reference: BrowserReference) => void) | undefined>(undefined)

export function BrowserReferenceCards({ references, images }: { references: BrowserReference[]; images: Extract<MessagePart, { type: 'image' }>[] }) {
  const reveal = useContext(BrowserReferenceContext)
  return (
    <div className={`user-browser-references ${stylex.props(browserReferencesStyles.userBrowserReferences).className ?? ""}`}>
      {references.map((reference, index) => {
        const image = reference.imageIndex === undefined ? undefined : images[reference.imageIndex]
        return (
          <article className={`user-browser-reference ${stylex.props(browserReferencesStyles.userBrowserReference).className ?? ""}`} key={index}>
            <button type="button" className={`browser-selection-card__target ${stylex.props(reveal ? contextStyles.targetEnabled : contextStyles.targetDisabled).className ?? ""}`} onClick={() => reveal?.(reference)} disabled={!reveal} title="Reveal in browser">
              <Crosshair {...stylex.props(contextStyles.targetIcon)} size={13} />
              <span {...stylex.props(contextStyles.targetLabel)}>{reference.label || reference.selector}</span>
            </button>
            {image ? <ImageParts images={[image]} alt={`Selected ${reference.label || 'element'}`} xstyle={contextStyles.imagePreviewFocus} /> : null}
            <small {...stylex.props(contextStyles.referenceSmall)} title={reference.pageUrl}>{reference.pageTitle || reference.pageUrl}</small>
            {reference.comment ? <p {...stylex.props(contextStyles.referenceParagraph)}>{reference.comment}</p> : null}
          </article>
        )
      })}
    </div>
  )
}
