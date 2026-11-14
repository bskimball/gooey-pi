import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useMachine } from '@xstate/react'
import { extensionUiMachine } from './extensionUiMachine'
import type { AgentTurnHandle } from '@/app/agentTurnMachine'
import { applySessionStatusEvent } from '@/app/session-attention'
import type { ExtensionUiResponse } from '@/components/ExtensionUiModal'
import { ASK_USER_TIMEOUT_MS, blockingExtensionUiRequestId, parseExtensionUiRequest, type ExtensionUiRequest } from '@/lib/extension-ui'
import { PI_FUSION_PAIR_STATUS_KEY, PI_HYDRA_STATUS_KEY, type ActivePiHydraTier, type PiBehaviorMode, type PiFusionPair, parsePiFusionPairStatus, parsePiHydraStatus, piModeFromStatusText, piModeWithHydra, piSessionMode, publishActivePiBehaviorMode, publishActivePiFusionPair, publishActivePiHydraTier, readDefaultPiBehaviorMode, readDefaultPiHydraTier, savePiBehaviorMode, savePiHydraTier } from '@/lib/harness'
import type { ApexApi, RuntimeInfo, SessionRecord } from '@/types/api'

interface UseExtensionUiOptions {
  bridge: ApexApi | null
  activeRuntimeId?: string
  activeSessionMode?: string
  runtimeSessionsRef: React.RefObject<Map<string, string>>
  setSessions: React.Dispatch<React.SetStateAction<SessionRecord[]>>
  setRuntime: React.Dispatch<React.SetStateAction<RuntimeInfo | null>>
  agentTurn: AgentTurnHandle
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
  agentTurn,
  reportError,
}: UseExtensionUiOptions) {
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
  const [snapshot, send, actor] = useMachine(extensionUiMachine.provide({
    actions: { cancelRequest: (_, { pending }) => cancelPending(pending) },
  }))
  const extensionUi = snapshot.context.visible
  const pendingByRuntime = snapshot.context.pendingByRuntime
  const modeByRuntimeRef = useRef<Map<string, PiBehaviorMode>>(new Map())
  const hydraByRuntimeRef = useRef<Map<string, ActivePiHydraTier>>(new Map())
  // Reported by the runtime only; never cached across runtimes or restarts.
  const fusionPairByRuntimeRef = useRef<Map<string, PiFusionPair>>(new Map())
  const activeRuntimeIdRef = useRef(activeRuntimeId)
  const activeSessionModeRef = useRef(activeSessionMode)
  useLayoutEffect(() => {
    activeRuntimeIdRef.current = activeRuntimeId
    activeSessionModeRef.current = activeSessionMode
  })

  const showPendingForActiveRuntime = useCallback(() => {
    const currentRuntimeId = activeRuntimeIdRef.current
    send({ type: 'SELECT', runtimeId: currentRuntimeId })
    const runtimeHydra = currentRuntimeId ? hydraByRuntimeRef.current.get(currentRuntimeId) : undefined
    const sessionHydra = parsePiHydraStatus(activeSessionModeRef.current)
    const runtimeMode = currentRuntimeId ? modeByRuntimeRef.current.get(currentRuntimeId) : undefined
    const sessionMode = piModeFromStatusText(activeSessionModeRef.current)
    const mode = piModeWithHydra(runtimeMode ?? sessionMode ?? readDefaultPiBehaviorMode(), runtimeHydra ?? sessionHydra)
    publishActivePiHydraTier(runtimeHydra ?? sessionHydra ?? (mode === 'utopia' ? 'off' : readDefaultPiHydraTier()))
    publishActivePiBehaviorMode(mode)
    publishActivePiFusionPair(currentRuntimeId ? fusionPairByRuntimeRef.current.get(currentRuntimeId) ?? null : null)
  }, [send])

  const setFusionPair = useCallback((runtimeId: string, pair: PiFusionPair | undefined) => {
    if (pair) fusionPairByRuntimeRef.current.set(runtimeId, pair)
    else fusionPairByRuntimeRef.current.delete(runtimeId)
    if (activeRuntimeIdRef.current === runtimeId) publishActivePiFusionPair(pair ?? null)
  }, [])

  const clearExtensionUi = useCallback((runtimeId?: string, clearMode = false) => {
    const targetRuntimeId = runtimeId ?? actor.getSnapshot().context.visible?.runtimeId
    if (clearMode && runtimeId) {
      modeByRuntimeRef.current.delete(runtimeId)
      hydraByRuntimeRef.current.delete(runtimeId)
    }
    if (!targetRuntimeId) return
    send({ type: 'CLEAR', runtimeId: targetRuntimeId })
  }, [actor, send])

  const respondToExtensionUi = useCallback(async (response: ExtensionUiResponse, runtimeId?: string) => {
    const current = actor.getSnapshot().context
    const targetRuntimeId = runtimeId ?? current.visible?.runtimeId
    const pending = targetRuntimeId ? current.pendingByRuntime.get(targetRuntimeId) : null
    if (!pending) return
    const shouldReportError = runtimeId !== undefined
      || activeRuntimeIdRef.current === pending.runtimeId
      || current.visible?.runtimeId === pending.runtimeId
    const pendingSession = runtimeSessionsRef.current.get(pending.runtimeId)
    send({ type: 'CLEAR', runtimeId: pending.runtimeId, outcome: 'cancelled' in response && response.cancelled ? 'CANCEL' : 'ANSWER' })
    if ('cancelled' in response && response.cancelled) {
      if (!bridge) return
      if (pending.request.method !== 'questionnaire') {
        if (pendingSession) {
          setSessions((items) => items.map((session) => session.filePath === pendingSession
            ? applySessionStatusEvent(session, { type: 'QUESTION_RESOLVED' })
            : session))
        }
        cancelPending(pending)
        return
      }
      try {
        if (activeRuntimeIdRef.current === pending.runtimeId) agentTurn.send({ type: 'STOP' })
        await bridge.agent.stop(pending.runtimeId)
        if (activeRuntimeIdRef.current === pending.runtimeId) agentTurn.send({ type: 'STOP_SETTLED' })
        setRuntime((current) => current?.runtimeId === pending.runtimeId ? { ...current, isStreaming: false } : current)
      } catch (error) {
        // If stopping the runtime fails, still resolve the extension request so
        // it cannot remain blocked behind a dialog that is no longer visible.
        cancelPending(pending)
        if (activeRuntimeIdRef.current === pending.runtimeId) agentTurn.send({ type: 'STOP_SETTLED' })
        setRuntime((current) => current?.runtimeId === pending.runtimeId ? { ...current, isStreaming: false } : current)
        if (shouldReportError) reportError(error)
      }
      return
    }
    if (pending.request.method === 'questionnaire') {
      if (activeRuntimeIdRef.current === pending.runtimeId) agentTurn.send({ type: 'RUNTIME_STREAMING' })
      setRuntime((current) => current?.runtimeId === pending.runtimeId ? { ...current, isStreaming: true } : current)
    }
    if (pendingSession) {
      setSessions((items) => items.map((session) => session.filePath === pendingSession
        ? applySessionStatusEvent(session, { type: 'QUESTION_RESOLVED' })
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
      if (activeRuntimeIdRef.current === pending.runtimeId) agentTurn.send({ type: 'RUNTIME_IDLE' })
      setRuntime((current) => current?.runtimeId === pending.runtimeId ? { ...current, isStreaming: false } : current)
      if (shouldReportError) reportError(error)
    }
  }, [actor, agentTurn, bridge, cancelPending, reportError, runtimeSessionsRef, send, setRuntime, setSessions])

  const respondForRuntime = useCallback(
    (runtimeId: string, response: ExtensionUiResponse) => respondToExtensionUi(response, runtimeId),
    [respondToExtensionUi],
  )

  const openForRuntime = useCallback((runtimeId: string) => {
    if (!actor.getSnapshot().context.pendingByRuntime.has(runtimeId)) return
    send({ type: 'SELECT', runtimeId })
  }, [actor, send])

  const showExtensionUi = useCallback((runtimeId: string, rawEvent: Record<string, unknown>) => {
    if (rawEvent.type === 'extension_ui_resolved' && typeof rawEvent.id === 'string') {
      const pending = actor.getSnapshot().context.pendingByRuntime.get(runtimeId)
      if (!pending || !requestIds(pending).includes(rawEvent.id)) return
      const remaining = pending.requests?.filter((request) => request.id !== rawEvent.id)
      if (pending.request.method !== 'questionnaire' || !remaining?.length) clearExtensionUi(runtimeId)
      else {
        const next: PendingExtensionUi = { ...pending, requests: remaining, request: { ...pending.request, questions: pending.request.questions.filter((question) => question.id !== rawEvent.id), total: remaining.length, complete: true } }
        send({ type: 'UPSERT', pending: next, show: actor.getSnapshot().context.visible?.runtimeId === runtimeId })
      }
      return
    }
    if (rawEvent.type === 'runtime_exit') {
      modeByRuntimeRef.current.delete(runtimeId)
      hydraByRuntimeRef.current.delete(runtimeId)
      setFusionPair(runtimeId, undefined)
      return
    }
    if (rawEvent.type === 'extension_ui_request' && rawEvent.method === 'setStatus' && rawEvent.statusKey === PI_FUSION_PAIR_STATUS_KEY) {
      setFusionPair(runtimeId, parsePiFusionPairStatus(rawEvent.statusText))
      return
    }
    if (rawEvent.type === 'extension_ui_request' && rawEvent.method === 'setStatus' && rawEvent.statusKey === PI_HYDRA_STATUS_KEY) {
      const tier = parsePiHydraStatus(rawEvent.statusText)
      if (tier) hydraByRuntimeRef.current.set(runtimeId, tier)
      else hydraByRuntimeRef.current.delete(runtimeId)
      const baseMode = modeByRuntimeRef.current.get(runtimeId)
      const effectiveMode = piModeWithHydra(baseMode, tier)
      const sessionMode = piSessionMode(effectiveMode, tier)
      const sessionFile = runtimeSessionsRef.current.get(runtimeId)
      if (sessionFile) {
        setSessions((items) => items.map((session) => session.filePath === sessionFile && session.behaviorMode !== sessionMode
          ? { ...session, behaviorMode: sessionMode }
          : session))
      }
      if (activeRuntimeIdRef.current === runtimeId) {
        savePiHydraTier(tier ?? 'off')
        savePiBehaviorMode(effectiveMode)
      } else if (effectiveMode !== 'apex-orchestrate') {
        try {
          if (typeof window !== 'undefined') {
            if (tier) window.localStorage?.setItem('gooeypi:pi-hydra-tier', tier)
            window.localStorage?.setItem('gooeypi:pi-behavior-mode', effectiveMode)
          }
        } catch { /* ignore storage errors */ }
      }
      if (tier && bridge) {
        void bridge.agent.command(runtimeId, { type: 'get_state' })
          .then((response) => {
            if (!response || typeof response !== 'object') return
            const data = typeof response.data === 'object' && response.data !== null ? response.data as Record<string, unknown> : undefined
            const rawModel = data && typeof data.model === 'object' && data.model !== null ? data.model as Record<string, unknown> : undefined
            const provider = typeof rawModel?.provider === 'string' ? rawModel.provider : undefined
            const id = typeof rawModel?.id === 'string' ? rawModel.id : undefined
            const name = typeof rawModel?.name === 'string' ? rawModel.name : undefined
            const thinkingLevel = typeof data?.thinkingLevel === 'string' ? data.thinkingLevel : undefined
            if (!provider || !id) return
            setRuntime((current) => current?.runtimeId === runtimeId
              ? { ...current, model: { provider, id, ...(name ? { name } : {}) }, ...(thinkingLevel ? { thinkingLevel } : {}) }
              : current)
          })
          .catch(() => undefined)
      }
      return
    }
    if (rawEvent.type === 'extension_ui_request' && rawEvent.method === 'setStatus' && rawEvent.statusKey === 'mode') {
      const mode = piModeFromStatusText(rawEvent.statusText)
      if (mode) {
        modeByRuntimeRef.current.set(runtimeId, mode)
        const activeHydra = hydraByRuntimeRef.current.get(runtimeId)
        const effectiveMode = piModeWithHydra(mode, activeHydra)
        const sessionMode = piSessionMode(effectiveMode, activeHydra)
        const sessionFile = runtimeSessionsRef.current.get(runtimeId)
        if (sessionFile) {
          setSessions((items) => items.map((session) => session.filePath === sessionFile && session.behaviorMode !== sessionMode
            ? { ...session, behaviorMode: sessionMode }
            : session))
        }
        if (mode !== 'fusion') setFusionPair(runtimeId, undefined)
        if (activeRuntimeIdRef.current === runtimeId) {
          if (mode === 'utopia') publishActivePiHydraTier(activeHydra ?? 'off')
          savePiBehaviorMode(effectiveMode)
        } else if (effectiveMode !== 'apex-orchestrate') {
          try {
            if (typeof window !== 'undefined') window.localStorage?.setItem('gooeypi:pi-behavior-mode', effectiveMode)
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
      if (actor.getSnapshot().context.timedOutQuestionnaires.has(questionnaireKey)) {
        void bridge.agent.command(runtimeId, {
          type: 'extension_ui_response',
          id: request.id,
          cancelled: true,
        }).catch(() => undefined)
        return
      }
      const previous = actor.getSnapshot().context.pendingByRuntime.get(runtimeId)
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
      const originalTimeout = request.timeout ?? ASK_USER_TIMEOUT_MS
      const recoveredAt = typeof rawEvent.receivedAt === 'number' && Number.isFinite(rawEvent.receivedAt)
        ? Math.min(now, rawEvent.receivedAt) : now
      const recoveredDeadline = typeof rawEvent.deadline === 'number' && Number.isFinite(rawEvent.deadline)
        ? rawEvent.deadline : recoveredAt + originalTimeout
      const receivedAt = sameQuestionnaire && previous?.receivedAt !== undefined ? previous.receivedAt : recoveredAt
      const deadline = sameQuestionnaire && previous?.deadline !== undefined
        ? Math.min(previous.deadline, recoveredDeadline) : recoveredDeadline
      // The actor starts or reschedules against the earliest known absolute deadline.
      const timeout = Math.max(0, deadline - now)
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
      send({ type: 'UPSERT', pending, show: activeRuntimeIdRef.current === runtimeId || actor.getSnapshot().context.visible?.runtimeId === runtimeId })
      return
    }

    const previous = actor.getSnapshot().context.pendingByRuntime.get(runtimeId)
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
    send({ type: 'UPSERT', pending, show: activeRuntimeIdRef.current === runtimeId || actor.getSnapshot().context.visible?.runtimeId === runtimeId })
  }, [actor, bridge, cancelPending, clearExtensionUi, send, setFusionPair])

  const hasOpenRequestForSession = useCallback((filePath: string): boolean => {
    for (const runtimeId of actor.getSnapshot().context.pendingByRuntime.keys()) {
      if (runtimeSessionsRef.current.get(runtimeId) === filePath) return true
    }
    return false
  }, [actor, runtimeSessionsRef])

  useEffect(() => { showPendingForActiveRuntime() }, [activeRuntimeId, activeSessionMode, showPendingForActiveRuntime])

  useLayoutEffect(() => () => {
    send({ type: 'RESET' })
    fusionPairByRuntimeRef.current.clear()
    publishActivePiFusionPair(null)
  }, [cancelPending, send])

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
