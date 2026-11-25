import * as stylex from '@stylexjs/stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { createContext, useContext, useEffect, useState, type ComponentProps } from 'react'
import { TranscriptImage } from './transcript/TranscriptImage'

export const WorkspaceImageContext = createContext<string | undefined>(undefined)

const INLINE_RASTER_DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z\d+/=\s]+)$/i

function parseInlineDataUrl(src: string): string | null {
  const match = INLINE_RASTER_DATA_URL.exec(src.trim())
  if (!match) return null
  const [, mimeType, data] = match
  const normalizedData = data.replace(/\s/g, '')
  if (!normalizedData) return null
  return `data:${mimeType.toLowerCase()};base64,${normalizedData}`
}

function isRemoteOrUnsupportedScheme(src: string): boolean {
  const trimmed = src.trim()
  if (!trimmed || trimmed.startsWith('//')) return true
  if (/^file:/i.test(trimmed)) return false
  if (/^[a-z]:[\\/]/i.test(trimmed)) return false
  return /^[a-z][a-z\d+.-]*:/i.test(trimmed)
}

export function WorkspaceImage({ src, alt }: ComponentProps<'img'>) {
  const cwd = useContext(WorkspaceImageContext)
  const label = alt || 'attachment'
  const rawSrc = typeof src === 'string' ? src.trim() : ''
  const inlineDataUrl = rawSrc ? parseInlineDataUrl(rawSrc) : null
  const canReadWorkspace = Boolean(rawSrc && !inlineDataUrl && !isRemoteOrUnsupportedScheme(rawSrc) && cwd && typeof window !== 'undefined' && window.apex?.app?.readWorkspaceImage)

  const [resolved, setResolved] = useState<{
    key: string
    status: 'loading' | 'ready' | 'error'
    dataUrl?: string
  } | null>(null)

  const requestKey = canReadWorkspace ? `${cwd}\0${rawSrc}` : ''

  useEffect(() => {
    if (!canReadWorkspace || !cwd) return
    let cancelled = false
    setResolved({ key: requestKey, status: 'loading' })
    void window.apex.app
      .readWorkspaceImage(cwd, rawSrc)
      .then((image) => {
        if (cancelled) return
        if (!image || image.type !== 'image' || !/^image\/(png|jpeg|gif|webp)$/i.test(image.mimeType) || !image.data || !/^[a-z\d+/=\s]+$/i.test(image.data)) {
          setResolved({ key: requestKey, status: 'error' })
          return
        }
        setResolved({
          key: requestKey,
          status: 'ready',
          dataUrl: `data:${image.mimeType.toLowerCase()};base64,${image.data.replace(/\s/g, '')}`,
        })
      })
      .catch(() => {
        if (!cancelled) setResolved({ key: requestKey, status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [canReadWorkspace, cwd, rawSrc, requestKey])

  if (inlineDataUrl) {
    return <TranscriptImage source={inlineDataUrl} alt={label} />
  }

  const current = canReadWorkspace && resolved?.key === requestKey ? resolved : null
  if (current?.dataUrl) return <TranscriptImage source={current.dataUrl} alt={label} />
  const status = !canReadWorkspace ? 'Image' : current?.status === 'error' ? 'Image unavailable' : 'Loading image'
  return <TranscriptImage alt={label} placeholder={
    <span className={`markdown-image-placeholder ${stylex.props(transcriptStyles.markdownImagePlaceholder).className ?? ""}`}>[{status}: {label}]</span>
  } />
}
