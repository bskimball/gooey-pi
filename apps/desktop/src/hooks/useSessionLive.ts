import { useEffect, useRef, useState } from 'react'
import {
  reduceSessionLive,
  seedSessionLiveFromRuntimes,
  syncSessionLivePendingQuestions,
  type SessionLiveMap,
} from '@/app/session-live'
import type { WorkspaceSnapshot } from '@/app/workspace'
import type { PendingExtensionUi } from './useExtensionUi'
import type { HarnessId, PrimeWorkApi, RuntimeInfo } from '@/types/api'

const MAX_BUFFERED_EVENTS_PER_RUNTIME = 64

export async function resolveRuntimeIdForSession(
  bridge: PrimeWorkApi,
  runtimeSessions: ReadonlyMap<string, string>,
  activeRuntime: RuntimeInfo | null,
  sessionFile?: string,
  requestedRuntimeId?: string,
): Promise<string | undefined> {
  if (typeof requestedRuntimeId === 'string' && requestedRuntimeId) return requestedRuntimeId
  if (!sessionFile) return activeRuntime?.runtimeId
  if (activeRuntime?.sessionFile === sessionFile) return activeRuntime.runtimeId
  for (const [runtimeId, trackedFile] of runtimeSessions) {
    if (trackedFile === sessionFile) return runtimeId
  }
  return (await bridge.agent.list()).find((candidate) => candidate.sessionFile === sessionFile)?.runtimeId
}

export interface UseSessionLiveOptions {
  bridge: PrimeWorkApi | null
  harness?: HarnessId
  runtimeSessionsRef: React.RefObject<Map<string, string>>
  runtimeIdRef?: React.RefObject<string | null>
  workspaceRef?: React.RefObject<WorkspaceSnapshot>
  activeRuntime?: RuntimeInfo | null
  pendingByRuntime?: ReadonlyMap<string, PendingExtensionUi>
}

export function useSessionLive({
  bridge,
  harness = 'pi',
  runtimeSessionsRef,
  runtimeIdRef,
  workspaceRef,
  activeRuntime,
  pendingByRuntime,
}: UseSessionLiveOptions): SessionLiveMap {
  const [liveBySession, setLiveBySession] = useState<SessionLiveMap>({})
  const bufferedEventsRef = useRef<Map<string, Array<{ event: Record<string, unknown>; now: number }>>>(new Map())
  const discoveringRuntimesRef = useRef<Set<string>>(new Set())
  const pendingByRuntimeRef = useRef(pendingByRuntime)
  pendingByRuntimeRef.current = pendingByRuntime

  useEffect(() => {
    if (!bridge) {
      setLiveBySession({})
      bufferedEventsRef.current.clear()
      discoveringRuntimesRef.current.clear()
      return
    }
    let cancelled = false

    const applyRuntimeSnapshot = (runtimes: readonly RuntimeInfo[]) => {
      const relevant = runtimes.filter((item) => item.harness === harness)
      for (const runtime of relevant) {
        if (runtime.sessionFile) runtimeSessionsRef.current.set(runtime.runtimeId, runtime.sessionFile)
      }
      setLiveBySession((current) => {
        let next = seedSessionLiveFromRuntimes(current, relevant)
        for (const runtime of relevant) {
          if (!runtime.sessionFile) continue
          const buffered = bufferedEventsRef.current.get(runtime.runtimeId)
          if (!buffered?.length) continue
          bufferedEventsRef.current.delete(runtime.runtimeId)
          for (const item of buffered) {
            next = reduceSessionLive(next, {
              runtimeId: runtime.runtimeId,
              sessionFile: runtime.sessionFile,
              event: item.event,
              now: item.now,
            })
          }
        }
        if (pendingByRuntimeRef.current) {
          next = syncSessionLivePendingQuestions(next, pendingByRuntimeRef.current, runtimeSessionsRef.current)
        }
        return next
      })
    }

    void bridge.agent.list()
      .then((runtimes) => {
        if (!cancelled) applyRuntimeSnapshot(runtimes)
      })
      .catch(() => undefined)

    const discoverRuntimeSession = (runtimeId: string) => {
      if (discoveringRuntimesRef.current.has(runtimeId)) return
      discoveringRuntimesRef.current.add(runtimeId)
      void bridge.agent.list()
        .then((runtimes) => {
          if (!cancelled) applyRuntimeSnapshot(runtimes)
        })
        .catch(() => undefined)
        .finally(() => {
          discoveringRuntimesRef.current.delete(runtimeId)
        })
    }

    const unsubscribe = bridge.agent.onEvent(({ runtimeId, event }) => {
      const now = Date.now()
      const type = typeof event.type === 'string' ? event.type : ''
      if (type === 'session_persisted' && typeof event.sessionFile === 'string') {
        const sessionFile = event.sessionFile
        runtimeSessionsRef.current.set(runtimeId, sessionFile)
        const buffered = bufferedEventsRef.current.get(runtimeId)
        bufferedEventsRef.current.delete(runtimeId)
        setLiveBySession((current) => {
          let next = current
          if (buffered?.length) {
            for (const item of buffered) {
              next = reduceSessionLive(next, { runtimeId, sessionFile, event: item.event, now: item.now })
            }
          }
          if (pendingByRuntimeRef.current) {
            next = syncSessionLivePendingQuestions(next, pendingByRuntimeRef.current, runtimeSessionsRef.current, now)
          }
          return next
        })
        return
      }

      if (type === 'runtime_exit') {
        const sessionFile = runtimeSessionsRef.current.get(runtimeId)
        bufferedEventsRef.current.delete(runtimeId)
        discoveringRuntimesRef.current.delete(runtimeId)
        setLiveBySession((current) => reduceSessionLive(current, { runtimeId, sessionFile, event, now }))
        return
      }

      const sessionFile = runtimeSessionsRef.current.get(runtimeId)
        ?? (runtimeIdRef?.current === runtimeId ? workspaceRef?.current.sessionFile : undefined)

      if (!sessionFile) {
        const queue = bufferedEventsRef.current.get(runtimeId) ?? []
        if (queue.length < MAX_BUFFERED_EVENTS_PER_RUNTIME) {
          queue.push({ event, now })
          bufferedEventsRef.current.set(runtimeId, queue)
        }
        discoverRuntimeSession(runtimeId)
        return
      }

      runtimeSessionsRef.current.set(runtimeId, sessionFile)
      setLiveBySession((current) => reduceSessionLive(current, { runtimeId, sessionFile, event, now }))
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [bridge, harness, runtimeIdRef, runtimeSessionsRef, workspaceRef])

  useEffect(() => {
    if (!activeRuntime?.sessionFile) return
    runtimeSessionsRef.current.set(activeRuntime.runtimeId, activeRuntime.sessionFile)
    setLiveBySession((current) => seedSessionLiveFromRuntimes(current, [activeRuntime]))
  }, [activeRuntime, runtimeSessionsRef])

  useEffect(() => {
    if (!pendingByRuntime) return
    setLiveBySession((current) => syncSessionLivePendingQuestions(current, pendingByRuntime, runtimeSessionsRef.current))
  }, [pendingByRuntime, runtimeSessionsRef])

  return liveBySession
}
