import { useCallback, useEffect, useState } from 'react'
import type { SessionRecord, SpecialistRosterEntry } from '@/types/api'
import { isSessionRunning, isSessionWaiting } from '@/app/session-attention'
import type { SessionLiveMap } from '@/app/session-live'
import { isLiveSpecialist } from '@/lib/specialist-status'

export type SpecialistRosters = Readonly<Record<string, readonly SpecialistRosterEntry[]>>

/** The sidebar lists sub-agents for the open session and for sessions with live work. */
export const MAX_SIDEBAR_ROSTERS = 16

export function sidebarRosterTargets(sessions: readonly SessionRecord[], activeSessionId: string | undefined, liveBySession: SessionLiveMap): string[] {
  const active = sessions.find((session) => session.id === activeSessionId && !session.archived)
  const live = sessions.filter((session) => !session.archived && session.id !== activeSessionId
    && (isSessionRunning(session, liveBySession[session.filePath]) || isSessionWaiting(session)))
  return [...new Set([...(active ? [active] : []), ...live].map((session) => session.filePath))].slice(0, MAX_SIDEBAR_ROSTERS)
}

const EMPTY: SpecialistRosters = {}

/**
 * Sub-agent rosters the main process keeps for the given sessions. The main process reads each
 * session's task_* receipts and pushes a new roster whenever that session file changes.
 */
export function useSpecialistRosters(sessions: readonly SessionRecord[], activeSessionId: string | undefined, liveBySession: SessionLiveMap): SpecialistRosters {
  const targets = sidebarRosterTargets(sessions, activeSessionId, liveBySession)
  const targetKey = targets.join('\n')
  const [rosters, setRosters] = useState<SpecialistRosters>(EMPTY)

  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.apex?.specialists
    if (!api?.onChanged) return
    return api.onChanged((change) => {
      setRosters((current) => change.filePath in current ? { ...current, [change.filePath]: change.specialists } : current)
    })
  }, [])

  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.apex?.specialists
    if (!api?.track) return
    let cancelled = false
    const paths = targetKey ? targetKey.split('\n') : []
    // Keep what we already know while the main process reads; drop sessions no longer tracked.
    setRosters((current) => Object.fromEntries(paths.map((path) => [path, current[path] ?? []])))
    void api.track(paths).then((next) => {
      if (cancelled) return
      setRosters((current) => Object.fromEntries(paths.map((path) => [path, next[path] ?? current[path] ?? []])))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [targetKey])

  useEffect(() => () => {
    void (typeof window === 'undefined' ? undefined : window.apex?.specialists)?.track([]).catch(() => undefined)
  }, [])

  return rosters
}

/**
 * Opens a sub-agent in the right panel, switching to its session first when needed so the
 * lead's conversation stays beside it.
 */
export function useOpenSessionSpecialist({ activeSessionId, loadingSession, isSessionView, selectSession, openSpecialist }: {
  activeSessionId: string | undefined
  loadingSession: boolean
  isSessionView: boolean
  selectSession(session: SessionRecord): Promise<unknown> | void
  openSpecialist(id: string): void
}): (session: SessionRecord, specialistId: string) => void {
  const [pending, setPending] = useState<{ sessionId: string; specialistId: string } | null>(null)
  useEffect(() => {
    if (!pending || loadingSession || !isSessionView || activeSessionId !== pending.sessionId) return
    setPending(null)
    openSpecialist(pending.specialistId)
  }, [pending, loadingSession, isSessionView, activeSessionId, openSpecialist])
  return useCallback((session: SessionRecord, specialistId: string) => {
    if (session.id === activeSessionId && isSessionView) {
      openSpecialist(specialistId)
      return
    }
    setPending({ sessionId: session.id, specialistId })
    void selectSession(session)
  }, [activeSessionId, isSessionView, openSpecialist, selectSession])
}

/**
 * The live agent after the one the Agents panel shows, wrapping around.
 */
export function nextLiveSpecialistId(roster: readonly SpecialistRosterEntry[], currentId: string | null | undefined): string | undefined {
  const live = roster.filter((specialist) => isLiveSpecialist(specialist.status))
  if (!live.length) return undefined
  const index = live.findIndex((specialist) => specialist.id === currentId)
  // A finished agent selected: start at the first live one. Nothing selected: the panel shows the first.
  if (index < 0) return currentId ? live[0]!.id : live[1 % live.length]!.id
  return live[(index + 1) % live.length]!.id
}
