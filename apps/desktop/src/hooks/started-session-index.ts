import type { Dispatch, SetStateAction } from 'react'
import { mergeSessionCatalog } from '@/hooks/useBootstrap'
import type { ApexApi, ProjectRecord, SessionRecord } from '@/types/api'

interface StartedSessionIndexInput {
  bridge: ApexApi
  harness: ProjectRecord['harness']
  sessionFile: string | undefined
  setSessions: Dispatch<SetStateAction<SessionRecord[]>>
  isCurrent?(): boolean
  activeFile?(): string | undefined
}

export async function indexStartedSession({ bridge, harness, sessionFile, setSessions, isCurrent, activeFile }: StartedSessionIndexInput): Promise<SessionRecord | undefined> {
  if (!sessionFile) return
  // Publish only this session, so a delayed scan cannot replace newer catalog
  // entries belonging to other submissions.
  const catalog = await bridge.sessions.list(undefined, true, harness, true)
  const indexedSession = catalog.find((session) => session.filePath === sessionFile)
  if (isCurrent && !isCurrent()) return indexedSession
  if (indexedSession) {
    setSessions((current) => {
      const previous = current.find((session) => session.filePath === sessionFile)
      if (!previous) return [...current, indexedSession]
      if (Date.parse(previous.updatedAt) > Date.parse(indexedSession.updatedAt)) return current
      const [merged] = mergeSessionCatalog([previous], [indexedSession], activeFile?.(), new Map(), 0)
      return current.map((session) => session.filePath === sessionFile ? merged : session)
    })
  }
  return indexedSession
}
