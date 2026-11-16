import * as stylex from '@stylexjs/stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from '../icons'
import { useAppShellOverlay, useFocusTrap } from '../ui'
import type { MessagePart } from '@/types/api'

export function ImageParts({ images, alt = 'Chat image', xstyle, imageXstyle }: { images?: Extract<MessagePart, { type: 'image' }>[]; alt?: string; xstyle?: stylex.StyleXStyles; imageXstyle?: stylex.StyleXStyles }) {
  return images?.map((image, index) => {
    if (image.dataTruncated || !image.data || !/^image\/(png|jpeg|gif|webp)$/i.test(image.mimeType ?? '') || !/^[a-z\d+/=\s]+$/i.test(image.data)) return <div key={image.partId ?? index} className={`image-part--unavailable ${stylex.props(transcriptStyles.imagePartUnavailable).className ?? ""}`}>Image attachment unavailable</div>
    return <TranscriptImage key={image.partId ?? index} source={`data:${image.mimeType};base64,${image.data.replace(/\s/g, '')}`} alt={alt} xstyle={xstyle} imageXstyle={imageXstyle} />
  })
}

interface TranscriptImageProps {
  source: string
  alt: string
  xstyle?: stylex.StyleXStyles
  imageXstyle?: stylex.StyleXStyles
}

export function TranscriptImage({ source, alt, xstyle, imageXstyle }: TranscriptImageProps) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const lightboxRef = useFocusTrap<HTMLElement>(open, () => setOpen(false))
  useAppShellOverlay(open)

  return <>
    <button type="button" className={`image-part__preview ${stylex.props(transcriptStyles.imagePartPreview, xstyle).className ?? ""}`} aria-label="Expand image" onClick={() => setOpen(true)}>
      <img className={`image-part ${stylex.props(transcriptStyles.imagePart, imageXstyle).className ?? ""}`} src={source} alt={alt} />
    </button>
    {open ? createPortal(
      <div className={`image-lightbox ${stylex.props(transcriptStyles.imageLightbox).className ?? ""}`} role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}>
        <section ref={lightboxRef} className={`image-lightbox__panel ${stylex.props(transcriptStyles.imageLightboxPanel).className ?? ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false)
        }}>
          <h2 id={titleId} className={`sr-only ${stylex.props(baseStyles.srOnly).className ?? ""}`}>Expanded image</h2>
          <button type="button" className={`image-lightbox__close ${stylex.props(transcriptStyles.imageLightboxClose).className ?? ""}`} aria-label="Close expanded image" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
          <img className={`image-lightbox__image ${stylex.props(transcriptStyles.imageLightboxImage).className ?? ""}`} src={source} alt={alt} />
        </section>
      </div>,
      document.body,
    ) : null}
  </>
}
