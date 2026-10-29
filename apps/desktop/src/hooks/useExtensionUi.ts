import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ExtensionUiResponse } from '@/components/ExtensionUiModal'
import { ASK_USER_TIMEOUT_MS, blockingExtensionUiRequestId, parseExtensionUiRequest, type ExtensionUiRequest } from '@/lib/extension-ui'
import { PI_FUSION_PAIR_STATUS_KEY, type PiBehaviorMode, type PiFusionPair, parsePiFusionPairStatus, piModeFromStatusText, publishActivePiBehaviorMode, publishActivePiFusionPair, readDefaultPiBehaviorMode, savePiBehaviorMode } from '@/lib/harness'
import type { PrimeWorkApi, RuntimeInfo, SessionRecord } from '@/types/api'

interface UseExtensionUiOptions {
  bridge: PrimeWorkApi | null
  activeRuntimeId?: string
  activeSessionMode?: string
  runtimeSessionsRef: React.RefObject<Map<string, string>>
  setSessions: React.Dispatch<React.SetStateAction<SessionRecord[]>>
  setRuntime: React.Dispatch<React.SetStateAction<RuntimeInfo | null>>
  reportError(error: unknown): void
}

type QuestionnaireSelectRequest = Extract<ExtensionUiRequest, { method: 'select' }>

export interface PendingExtensionUi {
  runtimeId: string
  request: ExtensionUiRequest
  requests?: QuestionnaireSelectRequest[]
  receivedAt?: number
  deadline?: number
}

export function pendingExtensionUiForRuntime(
  pending: ReadonlyMap<string, PendingExtensionUi>,
  runtimeId?: string,
): PendingExtensionUi | null {
  return runtimeId ? pending.get(runtimeId) ?? null : null
}

function requestIds(pending: PendingExtensionUi): string[] {
  return pending.request.method === 'questionnaire'
    ? (pending.requests ?? []).map((request) => request.id)
    : [pending.request.id]
}

export function useExtensionUi({
  bridge,
  activeRuntimeId,
  activeSessionMode,
  runtimeSessionsRef,
  setSessions,
  setRuntime,
  reportError,
}: UseExtensionUiOptions) {
  const [extensionUi, setExtensionUi] = useState<PendingExtensionUi | null>(null)
  const [pendingByRuntime, setPendingByRuntime] = useState<ReadonlyMap<string, PendingExtensionUi>>(() => new Map())
  const extensionUiRef = useRef<PendingExtensionUi | null>(null)
  const pendingByRuntimeRef = useRef<Map<string, PendingExtensionUi>>(new Map())
  const modeByRuntimeRef = useRef<Map<string, PiBehaviorMode>>(new Map())
  // Reported by the runtime only; never cached across runtimes or restarts.
  const fusionPairByRuntimeRef = useRef<Map<string, PiFusionPair>>(new Map())
  const timerByRuntimeRef = useRef<Map<string, number>>(new Map())
  const timedOutQuestionnairesRef = useRef<Set<string>>(new Set())
  const activeRuntimeIdRef = useRef(activeRuntimeId)
  const activeSessionModeRef = useRef(activeSessionMode)
  useLayoutEffect(() => {
    activeRuntimeIdRef.current = activeRuntimeId
    activeSessionModeRef.current = activeSessionMode
  })

  const showPendingForActiveRuntime = useCallback(() => {
    const currentRuntimeId = activeRuntimeIdRef.current
    const visible = pendingExtensionUiForRuntime(pendingByRuntimeRef.current, currentRuntimeId)
    extensionUiRef.current = visible
    setExtensionUi(visible)
    const runtimeMode = currentRuntimeId ? modeByRuntimeRef.current.get(currentRuntimeId) : undefined
    const sessionMode = piModeFromStatusText(activeSessionModeRef.current)
    publishActivePiBehaviorMode(runtimeMode ?? sessionMode ?? readDefaultPiBehaviorMode())
    publishActivePiFusionPair(currentRuntimeId ? fusionPairByRuntimeRef.current.get(currentRuntimeId) ?? null : null)
  }, [])

  const setFusionPair = useCallback((runtimeId: string, pair: PiFusionPair | undefined) => {
    if (pair) fusionPairByRuntimeRef.current.set(runtimeId, pair)
    else fusionPairByRuntimeRef.current.delete(runtimeId)
    if (activeRuntimeIdRef.current === runtimeId) publishActivePiFusionPair(pair ?? null)
  }, [])

  const clearExtensionUi = useCallback((runtimeId?: string, clearMode = false) => {
    const targetRuntimeId = runtimeId ?? extensionUiRef.current?.runtimeId
    if (clearMode && runtimeId) modeByRuntimeRef.current.delete(runtimeId)
    if (!targetRuntimeId) return
    const timer = timerByRuntimeRef.current.get(targetRuntimeId)
    if (timer !== undefined) window.clearTimeout(timer)
    timerByRuntimeRef.current.delete(targetRuntimeId)
    const deleted = pendingByRuntimeRef.current.delete(targetRuntimeId)
    if (deleted) setPendingByRuntime(new Map(pendingByRuntimeRef.current))
    if (extensionUiRef.current?.runtimeId === targetRuntimeId) {
      extensionUiRef.current = null
      setExtensionUi(null)
    }
  }, [])

  const cancelPending = useCallback((pending: PendingExtensionUi) => {
    if (!bridge) return
    for (const id of requestIds(pending)) {
      void bridge.agent.command(pending.runtimeId, {
        type: 'extension_ui_response',
        id,
        cancelled: true,
      }).catch(() => undefined)
    }
  }, [bridge])

  const respondToExtensionUi = useCallback(async (response: ExtensionUiResponse, runtimeId?: string) => {
    const targetRuntimeId = runtimeId ?? extensionUiRef.current?.runtimeId
    const pending = targetRuntimeId ? pendingByRuntimeRef.current.get(targetRuntimeId) : null
    if (!pending) return
    const shouldReportError = runtimeId !== undefined
      || activeRuntimeIdRef.current === pending.runtimeId
      || extensionUiRef.current?.runtimeId === pending.runtimeId
    const pendingSession = runtimeSessionsRef.current.get(pending.runtimeId)
    clearExtensionUi(pending.runtimeId)
    if ('cancelled' in response && response.cancelled) {
      if (!bridge) return
      if (pending.request.method !== 'questionnaire') {
        if (pendingSession) {
          setSessions((items) => items.map((session) => session.filePath === pendingSession && session.status === 'waiting'
            ? { ...session, status: 'running', unread: false }
            : session))
        }
        cancelPending(pending)
        return
      }
      try {
        await bridge.agent.stop(pending.runtimeId)
        setRuntime((current) => current?.runtimeId === pending.runtimeId ? { ...current, isStreaming: false } : current)
      } catch (error) {
        // If stopping the runtime fails, still resolve the extension request so
        // it cannot remain blocked behind a dialog that is no longer visible.
        cancelPending(pending)
        setRuntime((current) => current?.runtimeId === pending.runtimeId ? { ...current, isStreaming: false } : current)
        if (shouldReportError) reportError(error)
      }
      return
    }
    if (pending.request.method === 'questionnaire') {
      setRuntime((current) => current?.runtimeId === pending.runtimeId ? { ...current, isStreaming: true } : current)
      if (pendingSession) {
        setSessions((items) => items.map((session) => session.filePath === pendingSession
          ? { ...session, status: 'running', unread: false }
          : session))
      }
    } else if (pendingSession) {
      setSessions((items) => items.map((session) => session.filePath === pendingSession && session.status === 'waiting'
        ? { ...session, status: 'running', unread: false }
        : session))
    }
    if (!bridge) return
    try {
      if (pending.request.method === 'questionnaire') {
        if ('values' in response) {
          for (const request of pending.requests ?? []) {
            await bridge.agent.command(pending.runtimeId, {
              type: 'extension_ui_response',
              id: request.id,
              value: response.values[request.id] ?? '',
            })
          }
        } else {
          for (const id of requestIds(pending)) {
            await bridge.agent.command(pending.runtimeId, {
              type: 'extension_ui_response',
              id,
              cancelled: true,
            })
          }
        }
        return
      }
      await bridge.agent.command(pending.runtimeId, {
        type: 'extension_ui_response',
        id: pending.request.id,
        ...response,
      })
    } catch (error) {
      setRuntime((current) => current?.runtimeId === pending.runtimeId ? { ...current, isStreaming: false } : current)
      if (shouldReportError) reportError(error)
    }
  }, [bridge, cancelPending, clearExtensionUi, reportError, runtimeSessionsRef, setRuntime, setSessions])

  const respondForRuntime = useCallback(
    (runtimeId: string, response: ExtensionUiResponse) => respondToExtensionUi(response, runtimeId),
    [respondToExtensionUi],
  )

  const openForRuntime = useCallback((runtimeId: string) => {
    const pending = pendingByRuntimeRef.current.get(runtimeId)
    if (!pending) return
    extensionUiRef.current = pending
    setExtensionUi(pending)
  }, [])

  const scheduleTimeout = useCallback((pending: PendingExtensionUi) => {
    const timeout = 'timeout' in pending.request ? pending.request.timeout : undefined
    if (timeout === undefined || timerByRuntimeRef.current.has(pending.runtimeId)) return
    timerByRuntimeRef.current.set(pending.runtimeId, window.setTimeout(() => {
      const current = pendingByRuntimeRef.current.get(pending.runtimeId)
      if (!current || current.request.id !== pending.request.id) return
      if (current.request.method === 'questionnaire') timedOutQuestionnairesRef.current.add(`${pending.runtimeId}:${pending.request.id}`)
      cancelPending(current)
      clearExtensionUi(pending.runtimeId)
    }, timeout))
  }, [cancelPending, clearExtensionUi])

  const showExtensionUi = useCallback((runtimeId: string, rawEvent: Record<string, unknown>) => {
    if (rawEvent.type === 'runtime_exit') {
      modeByRuntimeRef.current.delete(runtimeId)
      setFusionPair(runtimeId, undefined)
      return
    }
    if (rawEvent.type === 'extension_ui_request' && rawEvent.method === 'setStatus' && rawEvent.statusKey === PI_FUSION_PAIR_STATUS_KEY) {
      setFusionPair(runtimeId, parsePiFusionPairStatus(rawEvent.statusText))
      return
    }
    if (rawEvent.type === 'extension_ui_request' && rawEvent.method === 'setStatus' && rawEvent.statusKey === 'mode') {
      const mode = piModeFromStatusText(rawEvent.statusText)
      if (mode) {
        modeByRuntimeRef.current.set(runtimeId, mode)
        const sessionFile = runtimeSessionsRef.current.get(runtimeId)
        if (sessionFile) {
          setSessions((items) => items.map((session) => session.filePath === sessionFile && session.behaviorMode !== mode
            ? { ...session, behaviorMode: mode }
            : session))
        }
        if (mode !== 'fusion') setFusionPair(runtimeId, undefined)
        if (activeRuntimeIdRef.current === runtimeId) {
          savePiBehaviorMode(mode)
        } else if (mode !== 'apex-orchestrate') {
          try {
            if (typeof window !== 'undefined') window.localStorage?.setItem('gooeypi:pi-behavior-mode', mode)
          } catch { /* ignore storage errors */ }
        }
      }
      return
    }
    if (rawEvent.type === 'extension_ui_request' && rawEvent.method === 'notify' && typeof rawEvent.message === 'string') {
      if ((rawEvent.notifyType === 'error' || rawEvent.notifyType === 'warning') && activeRuntimeIdRef.current === runtimeId) {
        reportError(rawEvent.message)
      }
      return
    }
    if (!bridge) return
    const request = parseExtensionUiRequest(rawEvent)
    if (!request) {
      const id = blockingExtensionUiRequestId(rawEvent)
      if (id) void bridge.agent.command(runtimeId, { type: 'extension_ui_response', id, cancelled: true }).catch(() => undefined)
      return
    }

    if (request.method === 'select' && request.questionnaire) {
      const questionnaireKey = `${runtimeId}:${request.questionnaire.groupId}`
      if (timedOutQuestionnairesRef.current.has(questionnaireKey)) {
        void bridge.agent.command(runtimeId, {
          type: 'extension_ui_response',
          id: request.id,
          cancelled: true,
        }).catch(() => undefined)
        return
      }
      const previous = pendingByRuntimeRef.current.get(runtimeId)
      const sameQuestionnaire = previous?.request.method === 'questionnaire' && previous.request.id === request.questionnaire.groupId
      if (previous && !sameQuestionnaire) {
        cancelPending(previous)
        clearExtensionUi(runtimeId)
      }

      const existing = sameQuestionnaire ? previous?.requests ?? [] : []
      const requests = existing.some((item) => item.id === request.id)
        ? existing
        : [...existing, request]
      const questions = requests
        .map((item) => ({
          id: item.id,
          title: item.title,
          options: item.options,
          index: item.questionnaire?.index ?? 0,
        }))
        .sort((a, b) => a.index - b.index)
      const total = request.questionnaire.total
      const now = Date.now()
      const timeout = previous?.request.method === 'questionnaire'
        ? previous.request.timeout
        : request.timeout ?? ASK_USER_TIMEOUT_MS
      const receivedAt = sameQuestionnaire && previous?.receivedAt !== undefined ? previous.receivedAt : now
      const deadline = sameQuestionnaire && previous?.deadline !== undefined
        ? previous.deadline
        : timeout !== undefined ? receivedAt + timeout : undefined
      const pending: PendingExtensionUi = {
        runtimeId,
        request: {
          method: 'questionnaire',
          id: request.questionnaire.groupId,
          title: `Answer ${total} question${total === 1 ? '' : 's'}`,
          questions,
          total,
          complete: questions.length >= total,
          timeout,
        },
        requests,
        receivedAt,
        ...(deadline !== undefined ? { deadline } : {}),
      }
      pendingByRuntimeRef.current.set(runtimeId, pending)
      setPendingByRuntime(new Map(pendingByRuntimeRef.current))
      if (activeRuntimeIdRef.current === runtimeId || extensionUiRef.current?.runtimeId === runtimeId) {
        extensionUiRef.current = pending
        setExtensionUi(pending)
      }
      scheduleTimeout(pending)
      return
    }

    const previous = pendingByRuntimeRef.current.get(runtimeId)
    if (previous) {
      cancelPending(previous)
      clearExtensionUi(runtimeId)
    }
    const receivedAt = Date.now()
    const timeout = 'timeout' in request ? request.timeout : undefined
    const deadline = timeout !== undefined ? receivedAt + timeout : undefined
    const pending: PendingExtensionUi = {
      runtimeId,
      request,
      receivedAt,
      ...(deadline !== undefined ? { deadline } : {}),
    }
    pendingByRuntimeRef.current.set(runtimeId, pending)
    setPendingByRuntime(new Map(pendingByRuntimeRef.current))
    if (activeRuntimeIdRef.current === runtimeId || extensionUiRef.current?.runtimeId === runtimeId) {
      extensionUiRef.current = pending
      setExtensionUi(pending)
    }
    scheduleTimeout(pending)
  }, [bridge, cancelPending, clearExtensionUi, scheduleTimeout, setFusionPair])

  const hasOpenRequestForSession = useCallback((filePath: string): boolean => {
    for (const runtimeId of pendingByRuntimeRef.current.keys()) {
      if (runtimeSessionsRef.current.get(runtimeId) === filePath) return true
    }
    return false
  }, [runtimeSessionsRef])

  useEffect(() => { showPendingForActiveRuntime() }, [activeRuntimeId, activeSessionMode, showPendingForActiveRuntime])

  useEffect(() => () => {
    for (const timer of timerByRuntimeRef.current.values()) window.clearTimeout(timer)
    for (const pending of pendingByRuntimeRef.current.values()) cancelPending(pending)
    timerByRuntimeRef.current.clear()
    pendingByRuntimeRef.current.clear()
    timedOutQuestionnairesRef.current.clear()
    fusionPairByRuntimeRef.current.clear()
    publishActivePiFusionPair(null)
  }, [cancelPending])

  return {
    extensionUi,
    pendingByRuntime,
    clearExtensionUi,
    respondToExtensionUi,
    respondForRuntime,
    openForRuntime,
    showExtensionUi,
    hasOpenRequestForSession,
  }
}
