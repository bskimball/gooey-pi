import { useEffect, useMemo, useRef, useState } from 'react'
import { buildActivitySections, type ActivityRowItem, type SessionLiveMap } from '@/app/session-live'
import { CircleNotch, Warning } from '@/components/icons'
import type { SessionRecord } from '@/types/api'

export interface ActivityStatusPillProps {
  sessions: readonly SessionRecord[]
  liveBySession?: SessionLiveMap
  clearedActivity?: Readonly<Record<string, string>>
  active?: boolean
  onOpen?(): void
}

const EMPTY_SESSIONS: readonly SessionRecord[] = []
const EMPTY_LIVE: SessionLiveMap = {}
const EMPTY_CLEARED: Readonly<Record<string, string>> = {}

function summarizeTitles(label: string, items: readonly ActivityRowItem[]): string | null {
  if (items.length === 0) return null
  const shown = items.slice(0, 3).map((item) => item.session.title)
  const overflow = items.length - shown.length
  return `${label}: ${shown.join(', ')}${overflow > 0 ? ` (+${overflow} more)` : ''}`
}

export function buildActivityPillAriaLabel(runningCount: number, needsYouCount: number): string {
  const parts: string[] = []
  if (runningCount > 0) {
    parts.push(`${runningCount} ${runningCount === 1 ? 'session' : 'sessions'} running`)
  }
  if (needsYouCount > 0) {
    parts.push(
      runningCount > 0
        ? `${needsYouCount} ${needsYouCount === 1 ? 'needs' : 'need'} your attention`
        : `${needsYouCount} ${needsYouCount === 1 ? 'session needs' : 'sessions need'} your attention`,
    )
  }
  return `${parts.join(', ')}. Open Activity`
}

export function ActivityStatusPill({
  sessions = EMPTY_SESSIONS,
  liveBySession = EMPTY_LIVE,
  clearedActivity = EMPTY_CLEARED,
  active = false,
  onOpen,
}: ActivityStatusPillProps) {
  const sections = useMemo(
    () => buildActivitySections(sessions, liveBySession, clearedActivity),
    [clearedActivity, liveBySession, sessions],
  )

  const runningCount = sections.running.length
  const needsYouCount = sections.needsYou.length
  const prevNeedsYouRef = useRef(needsYouCount)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    const prev = prevNeedsYouRef.current
    prevNeedsYouRef.current = needsYouCount
    if (needsYouCount > prev) {
      setAnnouncement(
        `${needsYouCount} ${needsYouCount === 1 ? 'session needs' : 'sessions need'} your attention`,
      )
    } else if (needsYouCount === 0 && announcement) {
      setAnnouncement('')
    }
  }, [announcement, needsYouCount])

  const tooltip = useMemo(() => {
    const lines = [
      summarizeTitles('Running', sections.running),
      summarizeTitles('Needs you', sections.needsYou),
    ].filter((line): line is string => Boolean(line))
    return lines.length > 0 ? lines.join('\n') : undefined
  }, [sections.needsYou, sections.running])

  const visible = runningCount > 0 || needsYouCount > 0

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {visible ? (
        <button
          type="button"
          className={`activity-status-pill no-drag ${needsYouCount > 0 ? 'has-needs-you' : ''} ${runningCount > 0 ? 'has-running' : ''} ${active ? 'is-active' : ''}`}
          aria-label={buildActivityPillAriaLabel(runningCount, needsYouCount)}
          aria-current={active ? 'page' : undefined}
          title={tooltip}
          onClick={() => {
            if (!active) onOpen?.()
          }}
        >
          {runningCount > 0 ? (
            <span className="activity-status-pill__segment activity-status-pill__segment--running">
              <CircleNotch className="spin" size={13} />
              <span className="activity-status-pill__count tabular">{runningCount}</span>
              <span className="activity-status-pill__label">running</span>
            </span>
          ) : null}
          {runningCount > 0 && needsYouCount > 0 ? (
            <span className="activity-status-pill__sep" aria-hidden="true">·</span>
          ) : null}
          {needsYouCount > 0 ? (
            <span className="activity-status-pill__segment activity-status-pill__segment--needs-you">
              <Warning size={13} weight="fill" />
              <span className="activity-status-pill__count tabular">{needsYouCount}</span>
              <span className="activity-status-pill__label">needs you</span>
            </span>
          ) : null}
        </button>
      ) : null}
    </>
  )
}
