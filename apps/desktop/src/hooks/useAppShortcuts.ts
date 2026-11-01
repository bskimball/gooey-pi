import { useEffect, useRef } from 'react'
import { type AppShortcutAction, createAppKeydownHandler } from '@/lib/app-shortcuts'
import type { SessionRecord } from '@/types/api'
import { useStableCallback } from './useStableCallback'

/** Routes the app-owned keyboard shortcuts to the latest render's actions. */
export function useAppShortcuts(actions: Record<AppShortcutAction, () => void>, settingsOpen: boolean): void {
  const onKeyDown = useStableCallback(createAppKeydownHandler(actions, document, settingsOpen))
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])
}

/** The session that was active before the current one; a new draft keeps the last real session. */
export function usePreviousSessionId(activeSessionId: string | undefined): string | undefined {
  const history = useRef<{ current?: string; previous?: string }>({ current: activeSessionId })
  if (history.current.current !== activeSessionId) {
    history.current = { current: activeSessionId, previous: history.current.current ?? history.current.previous }
  }
  return history.current.previous
}

/** Returns an action that reopens the previously active session, or reports that there is none. */
export function usePreviousSession(activeSessionId: string | undefined, sessions: readonly SessionRecord[], select: (session: SessionRecord) => void, onMissing: () => void): () => void {
  const previousId = usePreviousSessionId(activeSessionId)
  return () => {
    const session = sessions.find((candidate) => candidate.id === previousId && !candidate.archived)
    if (session) select(session)
    else onMissing()
  }
}
