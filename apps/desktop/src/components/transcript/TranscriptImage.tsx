import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from '../icons'
import { useAppShellOverlay, useFocusTrap } from '../ui'
import type { MessagePart } from '@/types/api'

export function ImageParts({ images, alt = 'Chat image' }: { images?: Extract<MessagePart, { type: 'image' }>[]; alt?: string }) {
  return images?.map((image, index) => {
    if (image.dataTruncated || !image.data || !/^image\/(png|jpeg|gif|webp)$/i.test(image.mimeType ?? '') || !/^[a-z\d+/=\s]+$/i.test(image.data)) return <div key={image.partId ?? index} className="image-part--unavailable">Image attachment unavailable</div>
    return <TranscriptImage key={image.partId ?? index} source={`data:${image.mimeType};base64,${image.data.replace(/\s/g, '')}`} alt={alt} />
  })
}

interface TranscriptImageProps {
  source: string
  alt: string
}

export function TranscriptImage({ source, alt }: TranscriptImageProps) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const lightboxRef = useFocusTrap<HTMLElement>(open, () => setOpen(false))
  useAppShellOverlay(open)

  return <>
    <button type="button" className="image-part__preview" aria-label="Expand image" onClick={() => setOpen(true)}>
      <img className="image-part" src={source} alt={alt} />
    </button>
    {open ? createPortal(
      <div className="image-lightbox" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}>
        <section ref={lightboxRef} className="image-lightbox__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false)
        }}>
          <h2 id={titleId} className="sr-only">Expanded image</h2>
          <button type="button" className="image-lightbox__close" aria-label="Close expanded image" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
          <img className="image-lightbox__image" src={source} alt={alt} />
        </section>
      </div>,
      document.body,
    ) : null}
  </>
}
