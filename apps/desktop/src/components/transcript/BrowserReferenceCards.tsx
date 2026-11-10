import { createContext, useContext } from 'react'
import type { BrowserReference } from '@/lib/browser-annotations'
import type { MessagePart } from '@/types/api'
import { Crosshair } from '../icons'
import { ImageParts } from './TranscriptImage'

export const BrowserReferenceContext = createContext<((reference: BrowserReference) => void) | undefined>(undefined)

export function BrowserReferenceCards({ references, images }: { references: BrowserReference[]; images: Extract<MessagePart, { type: 'image' }>[] }) {
  const reveal = useContext(BrowserReferenceContext)
  return (
    <div className="user-browser-references">
      {references.map((reference, index) => {
        const image = reference.imageIndex === undefined ? undefined : images[reference.imageIndex]
        return (
          <article className="user-browser-reference" key={index}>
            <button type="button" className="browser-selection-card__target" onClick={() => reveal?.(reference)} disabled={!reveal} title="Reveal in browser">
              <Crosshair size={13} />
              <span>{reference.label || reference.selector}</span>
            </button>
            {image ? <ImageParts images={[image]} alt={`Selected ${reference.label || 'element'}`} /> : null}
            <small title={reference.pageUrl}>{reference.pageTitle || reference.pageUrl}</small>
            {reference.comment ? <p>{reference.comment}</p> : null}
          </article>
        )
      })}
    </div>
  )
}
