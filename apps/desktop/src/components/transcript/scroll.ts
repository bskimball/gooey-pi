import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { TranscriptMessage } from '@/types/api'
import { newestWindow } from '@/lib/render-bounds'

function pinScrollerToBottom(scroller: HTMLDivElement, lastScrollTopRef: { current: number }): void {
  const targetTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  scroller.scrollTop = targetTop
  if (typeof scroller.scrollTo === 'function') {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' })
  }
  lastScrollTopRef.current = scroller.scrollTop
}

export function useTranscriptScroll(messages: TranscriptMessage[], active = false, externalScrollRef?: RefObject<HTMLDivElement | null>) {
  const localScrollRef = useRef<HTMLDivElement>(null)
  const scrollRef = externalScrollRef ?? localScrollRef
  const previousCountRef = useRef(0)
  const previousStreamingRef = useRef(false)
  const pinnedToBottomRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const [isPinned, setIsPinned] = useState(true)
  const [visibleLimit, setVisibleLimit] = useState(250)
  const [announcement, setAnnouncement] = useState('')
  const streaming = messages.some((message) => message.streaming)
  const live = streaming || active
  const visibleMessages = useMemo(() => newestWindow(messages, visibleLimit), [messages, visibleLimit])
  const hiddenCount = messages.length - visibleMessages.length

  useLayoutEffect(() => {
    const firstLoadedTranscript = previousCountRef.current === 0 && messages.length > 0
    const appendedMessage = messages.length > previousCountRef.current
    const scroller = scrollRef.current
    if (firstLoadedTranscript) {
      pinnedToBottomRef.current = true
      setIsPinned(true)
      if (scroller) pinScrollerToBottom(scroller, lastScrollTopRef)
    } else if (scroller && pinnedToBottomRef.current && (live || previousStreamingRef.current || appendedMessage)) {
      pinScrollerToBottom(scroller, lastScrollTopRef)
    }
    if (previousStreamingRef.current && !streaming) setAnnouncement('Pi response complete.')
    else if (!previousStreamingRef.current && streaming) setAnnouncement('Pi is working.')
    previousStreamingRef.current = streaming
    previousCountRef.current = messages.length
  }, [live, messages, scrollRef, streaming])

  useEffect(() => {
    if (!live || typeof ResizeObserver === 'undefined') return
    const scroller = scrollRef.current
    const inner = scroller?.querySelector<HTMLElement>('.transcript__inner')
    if (!scroller || !inner) return
    const observer = new ResizeObserver(() => {
      if (pinnedToBottomRef.current) {
        pinScrollerToBottom(scroller, lastScrollTopRef)
      }
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [live, scrollRef])

  const updatePinnedState = () => {
    const scroller = scrollRef.current
    if (!scroller) return
    const currentTop = scroller.scrollTop
    const distanceFromBottom = scroller.scrollHeight - currentTop - scroller.clientHeight
    let nextPinned = pinnedToBottomRef.current
    if (currentTop < lastScrollTopRef.current - 1) {
      nextPinned = distanceFromBottom < 120
    } else if (distanceFromBottom < 120) {
      nextPinned = true
    }
    pinnedToBottomRef.current = nextPinned
    setIsPinned((prev) => (prev === nextPinned ? prev : nextPinned))
    lastScrollTopRef.current = currentTop
  }

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const scroller = scrollRef.current
    pinnedToBottomRef.current = true
    setIsPinned(true)
    if (!scroller) return
    const targetTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior })
    } else {
      scroller.scrollTop = targetTop
    }
    lastScrollTopRef.current = targetTop
  }, [scrollRef])

  const showEarlier = () => setVisibleLimit((limit) => Math.min(messages.length, limit + 250))

  return { announcement, hiddenCount, isPinned, scrollRef, scrollToBottom, showEarlier, updatePinnedState, visibleMessages }
}
