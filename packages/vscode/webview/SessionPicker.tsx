import { CaretDown, Check, ClockCounterClockwise, formatRelative } from 'apex-ui'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { HostState, SessionSummary } from '../src/protocol'
import { sessions } from './host'

interface SessionPickerProps {
  status?: HostState['status']
  busy: boolean
  sessionName?: string
  onNotice(text: string): void
}

export function SessionPicker({ status, busy, sessionName, onNotice }: SessionPickerProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<SessionSummary[]>([])
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const refreshTokenRef = useRef(0)
  const listId = useId()

  const refresh = useCallback((reportError: boolean) => {
    const token = ++refreshTokenRef.current
    setLoading(true)
    void sessions.list().then(
      ({ sessions: nextSessions, currentPath: nextCurrentPath }) => {
        if (token !== refreshTokenRef.current) return
        setItems(nextSessions)
        setCurrentPath(nextCurrentPath)
        setLoading(false)
      },
      (error: unknown) => {
        if (token !== refreshTokenRef.current) return
        setLoading(false)
        if (reportError) {
          setOpen(false)
          onNotice(error instanceof Error ? error.message : String(error))
        }
      },
    )
  }, [onNotice])

  useEffect(() => {
    const stop = sessions.onCurrent((path) => {
      setCurrentPath(path)
      refresh(false)
    })
    refresh(false)
    return stop
  }, [refresh])

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!open) return
    refresh(true)
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close(true)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [close, open, refresh])

  const activeSession = items.find((item) => item.path === currentPath)
  const activeTitle = sessionName?.trim() || activeSession?.title.trim() || activeSession?.preview.trim() || 'Sessions'

  const handleSelect = (session: SessionSummary) => {
    close(true)
    if (session.path === currentPath && !busy && status === 'ready') return
    void sessions.switch(session.path).catch((error: unknown) => {
      onNotice(error instanceof Error ? error.message : String(error))
    })
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setOpen(true)
      }
      return
    }
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button.session-row') ?? [])
    if (!buttons.length) return
    const currentIndex = buttons.findIndex((button) => button === document.activeElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = currentIndex < 0 ? 0 : (currentIndex + 1) % buttons.length
      buttons[next]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const next = currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1
      buttons[next]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      buttons[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      buttons.at(-1)?.focus()
    }
  }

  return (
    <div className="apex-session-picker" ref={rootRef} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="permissions-chip apex-session-picker__trigger"
        aria-label={`Sessions: ${activeTitle}`}
        title={`Sessions: ${activeTitle}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <ClockCounterClockwise size={14} />
        <span className="apex-session-picker__trigger-label">{activeTitle}</span>
        <CaretDown size={11} className={open ? 'is-open' : ''} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="apex-session-picker__popover"
          onBlur={(event) => {
            const next = event.relatedTarget
            if (next instanceof Node && !rootRef.current?.contains(next)) close()
          }}
        >
          <div className="apex-session-picker__header">
            <span className="sidebar-menu__label">Sessions</span>
            {items.length > 0 ? <span className="apex-session-picker__count">{items.length}</span> : null}
          </div>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Sessions"
            aria-busy={loading}
            className="apex-session-picker__list scroll-area"
          >
            {loading && items.length === 0 ? <p className="sidebar__empty" role="status">Loading sessions…</p> : null}
            {!loading && items.length === 0 ? <p className="sidebar__empty">No saved sessions yet</p> : null}
            {items.map((session) => {
              const isActive = currentPath !== null && session.path === currentPath
              const title = session.title.trim() || session.preview.trim() || 'Untitled session'
              const preview = session.preview.trim()
              const relativeTime = formatRelative(session.updatedAt)
              const subtitle = preview && preview !== title
                ? preview
                : preview || `${session.messageCount} ${session.messageCount === 1 ? 'message' : 'messages'}`
              return (
                <div
                  key={session.id || session.path}
                  className={`session-row-wrap${isActive ? ' is-selected' : ''}`}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    aria-current={isActive ? 'true' : undefined}
                    title={title}
                    className={`session-row${isActive ? ' is-selected' : ''}`}
                    onClick={() => handleSelect(session)}
                  >
                    <span
                      className={`session-status-mark ${isActive ? 'session-status-mark--active' : 'session-status-mark--idle'}`}
                      aria-hidden="true"
                    >
                      {isActive ? <Check size={12} /> : <span />}
                    </span>
                    <span className="session-row__text">
                      <span className="session-row__heading">
                        <span className="session-row__title">{title}</span>
                        {relativeTime ? <span className="session-row__time">{relativeTime}</span> : null}
                      </span>
                      <span className="session-row__meta">{subtitle}</span>
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
