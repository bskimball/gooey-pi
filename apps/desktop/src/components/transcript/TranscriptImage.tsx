import * as stylex from '@stylexjs/stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { motion } from 'motion/react'
import { useContext, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { MessagePart } from '@/types/api'
import { ImageCarousel, ImageLightbox, ImageSlideContext } from './ImageCarousel'
import { useInstantMotion } from '../ContentMotion'

type ImagePart = Extract<MessagePart, { type: 'image' }>
interface PreviewStyles { xstyle?: stylex.StyleXStyles; imageXstyle?: stylex.StyleXStyles }

/** Render an adjacent run once, at the position of its first attachment. */
export function imageRunAt(parts: MessagePart[], start: number, key: string) {
  if (parts[start - 1]?.type === 'image') return null
  const images: ImagePart[] = []
  for (let i = start; i < parts.length; i++) {
    const part = parts[i]
    if (part.type !== 'image') break
    images.push(part)
  }
  return <ImageParts key={key} images={images} />
}

export function ImageParts({ images, alt = 'Chat image', ...styles }: PreviewStyles & { images?: ImagePart[]; alt?: string }) {
  if (!images?.length) return null
  const slides = images.map((image, index) => <PartPreview key={image.partId ?? index} image={image} alt={alt} {...styles} />)
  return slides.length === 1 ? slides[0] : <ImageCarousel>{slides}</ImageCarousel>
}

function PartPreview({ image, alt, ...styles }: PreviewStyles & { image: ImagePart; alt: string }) {
  const source = useMemo(() => {
    if (image.dataTruncated || !image.data || !/^image\/(png|jpeg|gif|webp)$/i.test(image.mimeType ?? '') || !/^[a-z\d+/=\s]+$/i.test(image.data)) return undefined
    return `data:${image.mimeType};base64,${image.data.replace(/\s/g, '')}`
  }, [image])
  return <TranscriptImage source={source} alt={alt} {...styles} />
}

function ExpandedImage({ source, alt }: { source: string; alt: string }) {
  const instant = useInstantMotion()
  return <motion.img className={`image-lightbox__image ${stylex.props(transcriptStyles.imageLightboxImage).className}`} src={source} alt={alt}
    initial={instant ? false : { opacity: .65 }} animate={{ opacity: 1 }} transition={{ duration: .12 }} />
}

export function TranscriptImage({ source, alt, placeholder, xstyle, imageXstyle }: PreviewStyles & { source?: string; alt: string; placeholder?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [failedSource, setFailedSource] = useState<string>()
  const slide = useContext(ImageSlideContext)
  const fallback = placeholder ?? <span className={`image-part--unavailable ${stylex.props(transcriptStyles.imagePartUnavailable).className}`}>Image attachment unavailable</span>
  const available = source && source !== failedSource
  const expandedImage = available ? <ExpandedImage source={source} alt={alt} /> : fallback

  return <>
    {available ? <button type="button" className={`image-part__preview ${stylex.props(transcriptStyles.imagePartPreview, xstyle).className}`} aria-label="Expand image" onClick={slide?.expand ?? (() => setOpen(true))}>
      <img className={`image-part ${stylex.props(transcriptStyles.imagePart, imageXstyle).className}`} src={source} alt={alt} loading={slide ? 'lazy' : undefined} onError={() => setFailedSource(source)} />
    </button> : fallback}
    {slide?.expandedTarget && createPortal(expandedImage, slide.expandedTarget)}
    {open && <ImageLightbox onClose={() => setOpen(false)}>{expandedImage}</ImageLightbox>}
  </>
}
