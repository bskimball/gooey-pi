import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

export function useTranscriptScroll(messages: TranscriptMessage[], active = false) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const previousCountRef = useRef(0)
  const previousStreamingRef = useRef(false)
  const pinnedToBottomRef = useRef(true)
  const lastScrollTopRef = useRef(0)
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
      if (scroller) pinScrollerToBottom(scroller, lastScrollTopRef)
    } else if (scroller && pinnedToBottomRef.current && (live || previousStreamingRef.current || appendedMessage)) {
      pinScrollerToBottom(scroller, lastScrollTopRef)
    }
    if (previousStreamingRef.current && !streaming) setAnnouncement('Pi response complete.')
    else if (!previousStreamingRef.current && streaming) setAnnouncement('Pi is working.')
    previousStreamingRef.current = streaming
    previousCountRef.current = messages.length
  }, [live, messages, streaming])

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
  }, [live])

  const updatePinnedState = () => {
    const scroller = scrollRef.current
    if (!scroller) return
    const currentTop = scroller.scrollTop
    const distanceFromBottom = scroller.scrollHeight - currentTop - scroller.clientHeight
    if (currentTop < lastScrollTopRef.current - 1) {
      pinnedToBottomRef.current = distanceFromBottom < 120
    } else if (distanceFromBottom < 120) {
      pinnedToBottomRef.current = true
    }
    lastScrollTopRef.current = currentTop
  }

  const showEarlier = () => setVisibleLimit((limit) => Math.min(messages.length, limit + 250))

  return { announcement, hiddenCount, scrollRef, showEarlier, updatePinnedState, visibleMessages }
}
