import { useActorRef, useSelector } from '@xstate/react'
import { useCallback, useEffect, useRef } from 'react'
import type { DragEvent } from 'react'
import {
  composerImagesMachine,
  type ComposerImage,
  type ComposerImagesEvent,
  type ComposerUnsupportedFile,
} from './composerImagesMachine'

export type { ComposerImage, ComposerUnsupportedFile }

const supportedImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
export const MAX_COMPOSER_FILE_COUNT = 8
export const MAX_COMPOSER_IMAGE_SOURCE_BYTES = 1_350_000

interface UseComposerImagesOptions {
  shortName: string
  /** Absolute path of an on-disk file, or empty when the file has none (clipboard data, browser demo). */
  resolveFilePath?(file: File): string
  /** Receives on-disk non-image files, which the prompt references by path instead of attaching. */
  onFileReferences?(paths: string[]): void
}

function filePath(file: File, resolve: UseComposerImagesOptions['resolveFilePath']): string {
  try { return resolve?.(file) ?? '' } catch { return '' }
}

function base64FromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return window.btoa(binary)
}

function isFileDrag(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

export function useComposerImages({ shortName, resolveFilePath, onFileReferences }: UseComposerImagesOptions) {
  const actorRef = useActorRef(composerImagesMachine)
  const images = useSelector(actorRef, (snapshot) => snapshot.context.images)
  const unsupportedFiles = useSelector(actorRef, (snapshot) => snapshot.context.unsupportedFiles)
  const error = useSelector(actorRef, (snapshot) => snapshot.context.error)
  const processing = useSelector(actorRef, (snapshot) => snapshot.matches({ ingestion: 'processing' }))
  const dragging = useSelector(actorRef, (snapshot) => snapshot.matches({ drag: 'over' }))

  const imagesRef = useRef<ComposerImage[]>(images)
  const unsupportedFilesRef = useRef<ComposerUnsupportedFile[]>(unsupportedFiles)
  imagesRef.current = images
  unsupportedFilesRef.current = unsupportedFiles

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const send = useCallback((event: ComposerImagesEvent) => {
    actorRef.send(event)
    const next = actorRef.getSnapshot().context
    imagesRef.current = next.images
    unsupportedFilesRef.current = next.unsupportedFiles
  }, [actorRef])

  const updateError = useCallback((message: string) => {
    send({ type: 'SET_ERROR', message })
  }, [send])

  const ingest = useCallback(async (incoming: readonly File[]) => {
    if (incoming.length === 0) return
    const startingErrorRevision = actorRef.getSnapshot().context.errorRevision
    const referenced: string[] = []
    const files = incoming.filter((file) => {
      if (supportedImageTypes.has(file.type.toLowerCase())) return true
      const path = filePath(file, resolveFilePath)
      if (path) referenced.push(path)
      return !path
    })
    if (referenced.length > 0) {
      onFileReferences?.(referenced)
      send({ type: 'CLEAR_ERROR' })
    }
    if (files.length === 0) return
    const current = actorRef.getSnapshot().context
    if (current.images.length + current.unsupportedFiles.length + current.reservedCount + files.length > MAX_COMPOSER_FILE_COUNT) {
      updateError(`You can attach up to ${MAX_COMPOSER_FILE_COUNT} files.`)
      return
    }

    const imageFiles = files.filter((file) => supportedImageTypes.has(file.type.toLowerCase()))
    const otherFiles = files.filter((file) => !supportedImageTypes.has(file.type.toLowerCase()))
    if (otherFiles.length > 0) {
      const added = otherFiles.map((file, index): ComposerUnsupportedFile => ({
        id: crypto.randomUUID(),
        name: file.name || `Attached file ${index + 1}`,
        size: file.size,
        mimeType: file.type.toLowerCase() || 'application/octet-stream',
      }))
      send({ type: 'ADD_UNSUPPORTED', files: added })
    }
    if (imageFiles.length === 0) return

    const latest = actorRef.getSnapshot().context
    const sourceBytes = imageFiles.reduce((sum, file) => sum + file.size, 0)
    const currentBytes = latest.images.reduce((sum, image) => sum + image.size, 0)
    if (currentBytes + latest.reservedBytes + sourceBytes > MAX_COMPOSER_IMAGE_SOURCE_BYTES) {
      updateError('These images are too large to send. Attach smaller images (about 1.3 MB total).')
      return
    }

    send({ type: 'BATCH_START', count: imageFiles.length, bytes: sourceBytes })
    try {
      const added = await Promise.all(imageFiles.map(async (file, index): Promise<ComposerImage> => ({
        id: crypto.randomUUID(),
        name: file.name || `Attached image ${index + 1}`,
        size: file.size,
        type: 'image',
        mimeType: file.type.toLowerCase(),
        data: base64FromBuffer(await file.arrayBuffer()),
      })))
      if (!mountedRef.current) return
      send({ type: 'BATCH_SUCCEED', images: added, count: imageFiles.length, bytes: sourceBytes, startingErrorRevision })
    } catch {
      if (mountedRef.current) {
        send({ type: 'BATCH_FAIL', message: `${shortName} could not read the image.`, count: imageFiles.length, bytes: sourceBytes })
      }
    }
  }, [actorRef, onFileReferences, resolveFilePath, send, shortName, updateError])

  const clear = useCallback(() => {
    send({ type: 'CLEAR' })
  }, [send])

  const remove = useCallback((id: string) => {
    send({ type: 'REMOVE', id })
  }, [send])

  const restoreWithinLimits = useCallback((restored: ComposerImage[]) => {
    const currentContext = actorRef.getSnapshot().context
    const current = currentContext.images
    const currentIds = new Set(current.map((image) => image.id))
    let count = current.length + currentContext.unsupportedFiles.length + currentContext.reservedCount
    let bytes = current.reduce((sum, image) => sum + image.size, 0) + currentContext.reservedBytes
    const accepted: ComposerImage[] = []
    let omitted = 0
    for (const image of restored) {
      if (currentIds.has(image.id)) continue
      if (count >= MAX_COMPOSER_FILE_COUNT || bytes + image.size > MAX_COMPOSER_IMAGE_SOURCE_BYTES) {
        omitted += 1
        continue
      }
      accepted.push(image)
      currentIds.add(image.id)
      count += 1
      bytes += image.size
    }
    if (accepted.length > 0) {
      send({ type: 'RESTORE', images: accepted })
    }
    return { restored: accepted.length, omitted }
  }, [actorRef, send])

  const hasPending = useCallback(() => actorRef.getSnapshot().context.pendingBatches > 0, [actorRef])

  const onDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    send({ type: 'DRAG_ENTER' })
  }, [send])

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!actorRef.getSnapshot().matches({ drag: 'over' })) return
    event.preventDefault()
    send({ type: 'DRAG_LEAVE' })
  }, [actorRef, send])

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    send({ type: 'DROP' })
    void ingest(Array.from(event.dataTransfer.files))
  }, [ingest, send])

  return {
    images,
    imagesRef,
    unsupportedFiles,
    unsupportedFilesRef,
    error,
    setError: updateError,
    processing,
    hasPending,
    dragging,
    ingest,
    clear,
    remove,
    restoreWithinLimits,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
