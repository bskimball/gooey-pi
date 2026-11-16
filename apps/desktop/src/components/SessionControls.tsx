import * as stylex from '@stylexjs/stylex'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ProjectRecord, SessionRecord } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { findProjectForSession } from '@/lib/workspace'
import { ChatCircleDots, Check, ClockCounterClockwise, NotePencil } from './icons'
import { ApexButton, IconButton } from './ui'

const styles = stylex.create({
  root: {
    position: 'relative',
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  picker: { position: 'relative' },
  popover: {
    position: 'absolute',
    zIndex: 30,
    right: 0,
    top: 'calc(100% + 4px)',
    width: 'min(380px, calc(100vw - 32px))',
    maxHeight: 'min(460px, 60vh)',
    display: 'flex',
    flexDirection: 'column',
    padding: 6,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--surface-raised)',
    boxShadow: 'var(--shadow-popover)',
  },
  heading: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBlock: 7, paddingInline: 10, color: 'var(--text-tertiary)', fontSize: 'var(--fs-meta)', fontWeight: 500 },
  count: { fontVariantNumeric: 'tabular-nums', fontSize: 'var(--fs-micro)' },
  list: { overflowY: 'auto', minHeight: 0, display: 'grid', gap: 2 },
  item: {
    width: '100%',
    height: 'auto',
    minHeight: 64,
    display: 'flex',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    gap: 10,
    paddingBlock: 10,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    backgroundColor: { default: 'transparent', ':hover': 'var(--surface-hover)' },
    boxShadow: 'none',
    textAlign: 'left',
    cursor: 'pointer',
  },
  itemContent: { width: '100%', minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 10 },
  selected: { backgroundColor: 'var(--surface-selected)' },
  mark: { width: 16, paddingTop: 2, flexShrink: 0, color: 'var(--text-tertiary)' },
  activeMark: { color: 'var(--apex)' },
  text: { minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 4 },
  title: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)', fontSize: 'var(--fs-ui)', fontWeight: 550, lineHeight: 1.4 },
  preview: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 'var(--fs-meta)', fontWeight: 400, lineHeight: 1.4 },
  meta: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, color: 'var(--text-tertiary)', fontSize: 'var(--fs-micro)', fontWeight: 400, lineHeight: 1.4 },
  project: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  time: { flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  empty: { paddingBlock: 8, paddingInline: 8, color: 'var(--text-tertiary)', fontSize: 'var(--fs-meta)' },
})

interface SessionControlsProps {
  projects: ProjectRecord[]
  sessions: SessionRecord[]
  activeSessionId?: string
  platform: NodeJS.Platform
  onNewSession(): void
  onSelectSession(session: SessionRecord): void
}

export function SessionControls({ projects, sessions, activeSessionId, platform, onNewSession, onSelectSession }: SessionControlsProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const history = useMemo(
    () =>
      sessions
        .filter((session) => !session.archived && session.role !== 'coordinator' && findProjectForSession(projects, session))
        .sort((left, right) => {
          const difference = Date.parse(right.lastUserMessageAt ?? right.createdAt) - Date.parse(left.lastUserMessageAt ?? left.createdAt)
          return difference || right.createdAt.localeCompare(left.createdAt) || left.filePath.localeCompare(right.filePath)
        }),
    [sessions, projects],
  )

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const list = listRef.current
      const selected = list?.querySelector<HTMLButtonElement>('button[aria-current="true"]')
      ;(selected ?? list?.querySelector<HTMLButtonElement>('button'))?.focus()
    })
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div {...stylex.props(styles.root)}>
      <div ref={rootRef} {...stylex.props(styles.picker)}>
        <IconButton ref={triggerRef} label="Session history" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((value) => !value)}>
          <ClockCounterClockwise size={17} />
        </IconButton>
        {open ? (
          <div id={listId} role="dialog" aria-label="Session history" {...stylex.props(styles.popover)}>
            <div {...stylex.props(styles.heading)}>
              <span>Recent sessions</span>
              <span {...stylex.props(styles.count)}>{history.length}</span>
            </div>
            <div
              ref={listRef}
              {...stylex.props(styles.list)}
              onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
                if (!buttons.length) return
                event.preventDefault()
                const current = buttons.findIndex((button) => button === document.activeElement)
                let next = 0
                if (event.key === 'End') next = buttons.length - 1
                else if (event.key === 'ArrowDown') next = (current + 1) % buttons.length
                else if (event.key === 'ArrowUp') next = current <= 0 ? buttons.length - 1 : current - 1
                buttons[next]?.focus()
              }}
            >
              {history.length === 0 ? (
                <div {...stylex.props(styles.empty)}>No saved sessions yet</div>
              ) : (
                history.map((session) => {
                  const selected = session.id === activeSessionId
                  const project = findProjectForSession(projects, session)
                  return (
                    <ApexButton
                      key={session.filePath}
                      variant="quiet"
                      aria-current={selected ? 'true' : undefined}
                      xstyle={[styles.item, selected && styles.selected]}
                      onClick={() => {
                        setOpen(false)
                        triggerRef.current?.focus()
                        if (!selected) onSelectSession(session)
                      }}
                    >
                      <span {...stylex.props(styles.itemContent)}>
                      <span aria-hidden="true" {...stylex.props(styles.mark, selected && styles.activeMark)}>
                        {selected ? <Check size={15} /> : <ChatCircleDots size={15} />}
                      </span>
                      <span {...stylex.props(styles.text)}>
                        <span {...stylex.props(styles.title)}>{session.title || 'Untitled session'}</span>
                        {session.preview && session.preview !== session.title ? <span {...stylex.props(styles.preview)}>{session.preview}</span> : null}
                        <span {...stylex.props(styles.meta)}>
                          <span {...stylex.props(styles.project)}>
                            {project?.name}
                            {selected ? ' · Current session' : ''}
                          </span>
                          <span {...stylex.props(styles.time)}>{formatRelative(session.updatedAt)}</span>
                        </span>
                      </span>
                      </span>
                    </ApexButton>
                  )
                })
              )}
            </div>
          </div>
        ) : null}
      </div>
      <IconButton label={`New session (${shortcutLabel(platform, ['Primary', 'N'])})`} onClick={() => onNewSession()}>
        <NotePencil size={16} />
      </IconButton>
    </div>
  )
}
