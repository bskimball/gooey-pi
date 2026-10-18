import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { CaretRight } from '../icons'

export const TIMELINE_PAGE_SIZE = 50
export const RECENT_TIMELINE_PAGES = 2

/** Older activity mounts on demand. Interacting with a page keeps it mounted
 * when it ages out, so streaming cannot discard focused or expanded tool rows.
 */
export function TimelinePage({ recent, start, count, children }: { recent: boolean; start: number; count: number; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  // Keep an outgoing recent page for one layout pass to check whether the user
  // is reading it. Folding offscreen pages lets native scroll anchoring work.
  const [retained, setRetained] = useState(recent)
  const bodyRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const open = recent || retained || expanded

  useLayoutEffect(() => {
    if (recent) {
      setRetained(true)
      return
    }
    if (!retained) return
    const body = bodyRef.current
    const scroller = body?.closest('.scroll-area')
    if (body && scroller) {
      const bodyRect = body.getBoundingClientRect()
      const viewport = scroller.getBoundingClientRect()
      const readingHistory = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight >= 120
      if (readingHistory && bodyRect.bottom > viewport.top && bodyRect.top < viewport.bottom) setExpanded(true)
    }
    setRetained(false)
  }, [recent, retained])

  return <div className="timeline-page">
    {!recent ? <button
      type="button"
      className="timeline-page__toggle"
      aria-expanded={open}
      aria-controls={id}
      onClick={() => setExpanded(!open)}
    ><CaretRight className="disclosure-caret" size={13} />{open ? 'Hide' : 'Show'} earlier activity (steps {start}-{start + count - 1})</button> : null}
    <div
      id={id}
      ref={bodyRef}
      className="timeline-page__body"
      hidden={!open}
      onFocusCapture={() => setExpanded(true)}
      onClickCapture={() => setExpanded(true)}
    >{open ? children : null}</div>
  </div>
}
