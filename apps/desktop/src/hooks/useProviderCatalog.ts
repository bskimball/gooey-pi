import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { HarnessId, ApexModelCatalog, ApexModelDescriptor, ApexThinkingLevel, ApexApi, RuntimeInfo, SessionRecord } from '@/types/api'

/** Stable fallback identities so consumers can memoize on prop equality. */
const DEFAULT_REASONING_LEVELS: ApexThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

function isUsable(candidate: ApexModelDescriptor): boolean {
  return candidate.enabled !== false && candidate.available
}

/** True only when a warning-free catalog lists the model or its provider as disabled/unavailable. */
function runtimeModelKnownUnavailable(catalog: ApexModelCatalog, provider: string, id: string): boolean {
  if (catalog.warning) return false
  const listed = catalog.models.find((candidate) => candidate.provider === provider && candidate.id === id)
  if (listed) return !isUsable(listed)
  const listedProvider = catalog.providers.find((candidate) => candidate.id === provider)
  return Boolean(listedProvider && (!listedProvider.enabled || !listedProvider.configured))
}

/** Resolve a session's persisted model against the catalog, matching either the model id or the full key. */
function findSessionModel(catalog: ApexModelCatalog, session: Pick<SessionRecord, 'model' | 'provider'> | undefined): ApexModelDescriptor | undefined {
  if (!session?.provider || !session.model) return undefined
  return catalog.models.find((candidate) => candidate.provider === session.provider && (candidate.id === session.model || candidate.key === session.model) && isUsable(candidate))
    ?? catalog.models.find((candidate) => candidate.id === session.model && isUsable(candidate))
}

interface PendingSelection { model: string; effort: ApexThinkingLevel; fast: boolean }

function preferredModel(catalog: ApexModelCatalog | null | undefined, remembered: string) {
  return catalog?.models.find((candidate) => candidate.key === remembered && isUsable(candidate)) ?? catalog?.models.find(isUsable)
}

function sessionSelection(catalog: ApexModelCatalog | null, session: SessionRecord | undefined, remembered: string, runtime: RuntimeInfo | null, pending?: PendingSelection): PendingSelection {
  const pendingModel = pending && catalog?.models.find((candidate) => candidate.key === pending.model && isUsable(candidate))
  const live = runtime?.model
  const liveModel = live && catalog?.models.find((candidate) => candidate.provider === live.provider && candidate.id === live.id && isUsable(candidate))
  const saved = catalog ? findSessionModel(catalog, session) : undefined
  const model = pendingModel ?? liveModel ?? saved ?? preferredModel(catalog, remembered)
  const levels = model?.availableThinkingLevels ?? DEFAULT_REASONING_LEVELS
  const requested = pendingModel ? pending?.effort : (liveModel && runtime?.thinkingLevel) ?? (saved && session?.thinkingLevel)
  const effort = levels.find((level) => level === requested) ?? (levels.includes('medium') ? 'medium' : levels[0] ?? 'off')
  return { model: model?.key ?? '', effort, fast: pendingModel ? Boolean(pendingModel.fastModeSupported && pending?.fast) : runtime?.serviceTier === 'priority' }
}

export function groupModelsByProvider(models: readonly ApexModelDescriptor[] | undefined): Map<string, ApexModelDescriptor[]> {
  const grouped = new Map<string, ApexModelDescriptor[]>()
  for (const model of models ?? []) {
    if (model.enabled === false) continue
    const bucket = grouped.get(model.provider)
    if (bucket) bucket.push(model)
    else grouped.set(model.provider, [model])
  }
  return grouped
}

interface UseProviderCatalogOptions {
  bridge: ApexApi | null
  /** Prevent startup work before the persisted harness selection is loaded. */
  ready?: boolean
  /** Harness whose model catalog is shown; catalogs are cached per harness. */
  harness?: HarnessId
  runtime: RuntimeInfo | null
  /** Owns provisional choices until a newly created workspace receives its session ID. */
  workspaceGeneration?: number
  /** Active session metadata if available. */
  activeSession?: SessionRecord
  /** Updates session records when the active session's model or thinking level changes. */
  setSessions?: React.Dispatch<React.SetStateAction<SessionRecord[]>>
  /** Persisted per-harness model preference. */
  lastSelectedModel?: string
  rememberModel?(modelKey: string): void
  syncRuntime(runtimeId: string): Promise<void>
  reportError(error: unknown): void
}

export function useProviderCatalog({ bridge, ready = true, harness = 'pi', runtime, activeSession, workspaceGeneration, setSessions, lastSelectedModel = '', rememberModel, syncRuntime, reportError }: UseProviderCatalogOptions) {
  // Per-harness cache: switching back to a harness shows its last catalog
  // immediately while the background refresh updates it.
  const [catalogs, setCatalogs] = useState<Partial<Record<HarnessId, ApexModelCatalog>>>({})
  const catalog = catalogs[harness] ?? null
  const setCatalogFor = useCallback((target: HarnessId, next: ApexModelCatalog) => {
    setCatalogs((current) => ({ ...current, [target]: next }))
  }, [])
  const draftKey = workspaceGeneration === undefined ? '' : `draft:${workspaceGeneration}`
  const sessionKey = activeSession?.id ?? draftKey
  // A send may outlive navigation. Its flush keeps the same choice slot even when a draft gets a session ID.
  const draftSlot = useMemo<{ pending?: PendingSelection }>(() => ({}), [workspaceGeneration])
  const parked = useRef(new Map<string, typeof draftSlot>())
  const sessionId = activeSession?.id
  const slot = useMemo(() => sessionId ? parked.current.get(sessionId) ?? (workspaceGeneration === undefined ? {} : draftSlot) : draftSlot, [draftSlot, sessionId, workspaceGeneration])
  const activeSlot = useRef(slot)
  useLayoutEffect(() => {
    activeSlot.current = slot
    if (sessionId && slot.pending) parked.current.set(sessionId, slot)
  }, [sessionId, slot])
  const parkSelection = useCallback((selection: PendingSelection) => {
    slot.pending = selection
    if (sessionId) parked.current.set(sessionId, slot)
  }, [sessionId, slot])
  const pendingMutations = useRef(new Map<string, { revision: number; selection: PendingSelection }>())
  const [owner, setOwner] = useState(sessionKey)
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState<ApexThinkingLevel>('medium')
  const [fast, setFast] = useState(false)
  if (owner !== sessionKey) {
    // Reset before children render: a newly mounted composer also snapshots its props into its draft.
    const pending = (runtime && pendingMutations.current.get(runtime.runtimeId)?.selection) ?? slot.pending
    const next = sessionSelection(catalog, activeSession, lastSelectedModel, runtime, pending)
    setOwner(sessionKey)
    setModel(next.model)
    setEffort(next.effort)
    setFast(next.fast)
  }
  const modelRef = useRef(model)
  const effortRef = useRef(effort)
  const fastRef = useRef(fast)
  const mutationRevisionRef = useRef(0)
  useLayoutEffect(() => {
    modelRef.current = model
    effortRef.current = effort
    fastRef.current = fast
  }, [sessionKey, model, effort, fast])
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve())
  const runtimeIdRef = useRef(runtime?.runtimeId)
  useLayoutEffect(() => { runtimeIdRef.current = runtime?.runtimeId })

  const updateModel = useCallback((value: string) => { modelRef.current = value; setModel(value) }, [])
  const updateEffort = useCallback((value: ApexThinkingLevel) => { effortRef.current = value; setEffort(value) }, [])
  const updateFast = useCallback((value: boolean) => { fastRef.current = value; setFast(value) }, [])

  const queueRuntimeMutation = useCallback((
    runtimeId: string,
    command: () => Promise<void>,
    rollback: () => void,
    selection: PendingSelection = { model: modelRef.current, effort: effortRef.current, fast: fastRef.current },
  ) => {
    const revision = ++mutationRevisionRef.current
    pendingMutations.current.set(runtimeId, { revision, selection })
    const isCurrent = () => pendingMutations.current.get(runtimeId)?.revision === revision && runtimeIdRef.current === runtimeId
    const operation = mutationQueueRef.current.then(async () => {
      try {
        try {
          await command()
        } catch (error) {
          if (isCurrent()) {
            rollback()
            try { await syncRuntime(runtimeId) } catch (syncError) { reportError(syncError) }
          }
          reportError(error)
          throw error
        }
        if (isCurrent()) {
          try { await syncRuntime(runtimeId) } catch (error) { reportError(error) }
        }
      } finally {
        if (pendingMutations.current.get(runtimeId)?.revision === revision) {
          pendingMutations.current.delete(runtimeId)
        }
      }
    })
    mutationQueueRef.current = operation.catch(() => undefined)
    return operation
  }, [reportError, syncRuntime])

  useEffect(() => () => {
    pendingMutations.current.clear()
    runtimeIdRef.current = undefined
  }, [])

  const refresh = useCallback(async (force = false) => {
    if (!bridge || !ready) return
    const target = harness
    setCatalogFor(target, await bridge.providers.catalog(force, target))
  }, [bridge, harness, ready, setCatalogFor])

  const rememberSelection = useCallback((value: string) => {
    if (value && value !== lastSelectedModel) rememberModel?.(value)
  }, [lastSelectedModel, rememberModel])
  const rememberSelectionRef = useRef(rememberSelection)
  useLayoutEffect(() => { rememberSelectionRef.current = rememberSelection })

  const activeSessionRef = useRef(activeSession)
  useLayoutEffect(() => { activeSessionRef.current = activeSession })
  const fallbackModel = useCallback((nextCatalog: ApexModelCatalog | null | undefined) => nextCatalog && (
    findSessionModel(nextCatalog, activeSessionRef.current) ?? preferredModel(nextCatalog, lastSelectedModel)
  ), [lastSelectedModel])

  const selectedModel = useMemo<ApexModelDescriptor | undefined>(() => {
    return catalog?.models.find((candidate) => candidate.key === model && candidate.enabled !== false && candidate.available)
  }, [catalog, model])
  const reasoningLevels = selectedModel?.availableThinkingLevels ?? runtime?.availableThinkingLevels ?? DEFAULT_REASONING_LEVELS
  // Group once per catalog identity so the composer's <option> tree can memoize.
  const modelsByProvider = useMemo(() => groupModelsByProvider(catalog?.models), [catalog?.models])

  useEffect(() => {
    if (reasoningLevels.includes(effort)) return
    updateEffort(reasoningLevels.includes('medium') ? 'medium' : reasoningLevels[0] ?? 'off')
  }, [effort, reasoningLevels, updateEffort])

  useEffect(() => {
    if (!bridge || !ready) return
    let cancelled = false
    const target = harness
    const load = () => {
      void bridge.providers.catalog(false, target).then((next) => { if (!cancelled) setCatalogFor(target, next) }).catch(reportError)
    }
    load()
    const onFocus = () => load()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') load()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [bridge, harness, ready, reportError, setCatalogFor])

  // The composer's selection belongs to one harness's catalog. Clear the old
  // harness before resolving the new harness's remembered or first model.
  const previousHarnessRef = useRef(harness)
  useEffect(() => {
    if (previousHarnessRef.current === harness) return
    previousHarnessRef.current = harness
    updateModel('')
    updateFast(false)
  }, [harness, updateFast, updateModel])

  useEffect(() => {
    if (!catalog) return
    const current = catalog.models.find((candidate) => candidate.key === modelRef.current && candidate.enabled !== false && candidate.available)
    if (current) return
    const fallback = fallbackModel(catalog)
    updateModel(fallback?.key ?? '')
    if (fallback) rememberSelection(fallback.key)
    if (!fallback?.fastModeSupported) updateFast(false)
  }, [catalog, fallbackModel, harness, rememberSelection, updateFast, updateModel])

  const sessionKeyRef = useRef(sessionKey)
  useLayoutEffect(() => { sessionKeyRef.current = sessionKey }, [sessionKey])
  const syncActiveSessionChoice = useCallback((providerId: string | undefined, modelId: string | undefined, thinkingLevel?: ApexThinkingLevel) => {
    const sessionId = activeSessionRef.current?.id
    if (!sessionId || !setSessions) return
    setSessions((items) => items.map((item) => {
      if (item.id !== sessionId) return item
      const nextProvider = providerId ?? item.provider
      const nextModel = modelId ?? item.model
      const nextThinking = thinkingLevel ?? item.thinkingLevel
      if (item.provider === nextProvider && item.model === nextModel && item.thinkingLevel === nextThinking) return item
      return { ...item, provider: nextProvider, model: nextModel, thinkingLevel: nextThinking }
    }))
  }, [setSessions])
  const applyPendingSelectionToRuntime = useCallback((targetRuntime: RuntimeInfo, foreground: boolean) => {
    const pending = slot.pending
    if (!pending || !bridge || !catalog) return
    delete slot.pending
    if (sessionId && parked.current.get(sessionId) === slot) parked.current.delete(sessionId)
    const runtimeModel = targetRuntime.model?.provider && targetRuntime.model.id
      ? catalog.models.find((candidate) => candidate.provider === targetRuntime.model?.provider && candidate.id === targetRuntime.model?.id && isUsable(candidate))
      : undefined
    const pendingModel = catalog.models.find((candidate) => candidate.key === pending.model && isUsable(candidate))
    if (!pendingModel) return
    const nextEffort = pendingModel.availableThinkingLevels.includes(pending.effort)
      ? pending.effort
      : pendingModel.availableThinkingLevels.includes('medium') ? 'medium' : pendingModel.availableThinkingLevels[0] ?? 'off'
    const modelChanged = runtimeModel?.key !== pendingModel.key
    const effortChanged = targetRuntime.thinkingLevel !== nextEffort
    const nextFast = pendingModel.fastModeSupported && pending.fast
    const previousFast = targetRuntime.serviceTier === 'priority'
    const fastChanged = previousFast !== nextFast
    if (foreground) {
      updateModel(pendingModel.key)
      updateEffort(nextEffort)
      updateFast(nextFast)
      syncActiveSessionChoice(pendingModel.provider, pendingModel.id, nextEffort)
    }
    if (!modelChanged && !effortChanged && !fastChanged) return
    const previousModel = runtimeModel?.key ?? pending.model
    const previousEffort = runtimeModel?.availableThinkingLevels.find((level) => level === targetRuntime.thinkingLevel) ?? nextEffort
    return queueRuntimeMutation(
      targetRuntime.runtimeId,
      async () => {
        if (modelChanged) {
          await bridge.agent.command(targetRuntime.runtimeId, { type: 'set_model', provider: pendingModel.provider, modelId: pendingModel.id })
        }
        if (modelChanged || effortChanged) {
          await bridge.agent.command(targetRuntime.runtimeId, { type: 'set_thinking_level', level: nextEffort })
        }
        if (fastChanged || (modelChanged && nextFast)) {
          await bridge.agent.command(targetRuntime.runtimeId, { type: 'set_service_tier', serviceTier: nextFast ? 'priority' : 'default' })
        }
        if (runtimeIdRef.current === targetRuntime.runtimeId) rememberSelectionRef.current(pendingModel.key)
      },
      () => { updateModel(previousModel); updateEffort(previousEffort); updateFast(previousFast) },
      { model: pendingModel.key, effort: nextEffort, fast: nextFast },
    )
  }, [bridge, catalog, queueRuntimeMutation, sessionId, slot, syncActiveSessionChoice, updateEffort, updateFast, updateModel])
  const flushPendingMutations = useCallback((targetRuntime?: RuntimeInfo, visible = true) => {
    if (targetRuntime) {
      const foreground = visible && activeSlot.current === slot
      if (foreground) runtimeIdRef.current = targetRuntime.runtimeId
      const operation = applyPendingSelectionToRuntime(targetRuntime, foreground)
      if (operation) return operation
    }
    return mutationQueueRef.current
  }, [applyPendingSelectionToRuntime, slot])
  // Starts undefined so the first render with a catalog counts as a switch and
  // restores the initial session's effort as well as its model.
  const activeSessionIdRef = useRef<string | undefined>(undefined)
  // One automatic reconciliation per runtime/model/target, so a runtime that keeps reporting
  // its old model cannot drive a set_model loop.
  const reconcileAttemptRef = useRef<string | null>(null)
  useEffect(() => {
    if (!catalog) return
    const sessionChanged = activeSessionIdRef.current !== sessionKey
    activeSessionIdRef.current = sessionKey

    // Precedence: live runtime (when usable), then the tab's unsent selection,
    // then the session's persisted metadata. The latter two apply when the tab
    // changes so a catalog refresh cannot revert what the user picked.
    const inFlight = runtime && pendingMutations.current.get(runtime.runtimeId)
    if (inFlight) {
      updateModel(inFlight.selection.model)
      updateEffort(inFlight.selection.effort)
      updateFast(inFlight.selection.fast)
      return
    }
    if (runtime && applyPendingSelectionToRuntime(runtime, true)) return
    const runtimeModel = runtime?.model?.provider && runtime.model.id
      ? catalog.models.find((candidate) => candidate.provider === runtime.model?.provider && candidate.id === runtime.model?.id && isUsable(candidate))
      : undefined
    // A model missing from the catalog is not proof it is unavailable (project extensions, partial or
    // stale catalogs), so the live runtime stays authoritative unless the catalog positively disables it.
    if (runtime?.model?.provider && runtime.model.id && !runtimeModel && !runtimeModelKnownUnavailable(catalog, runtime.model.provider, runtime.model.id)) return
    if (runtimeModel) {
      if (modelRef.current !== runtimeModel.key) updateModel(runtimeModel.key)
      rememberSelectionRef.current(runtimeModel.key)
      const nextRuntimeEffort = runtime?.thinkingLevel && runtimeModel.availableThinkingLevels.includes(runtime.thinkingLevel as ApexThinkingLevel)
        ? runtime.thinkingLevel as ApexThinkingLevel
        : effortRef.current
      if (effortRef.current !== nextRuntimeEffort) updateEffort(nextRuntimeEffort)
      syncActiveSessionChoice(runtimeModel.provider, runtimeModel.id, nextRuntimeEffort)
      return
    }
    if (sessionChanged) {
      const pending = slot.pending
      const next = sessionSelection(catalog, activeSession, lastSelectedModel, null, pending)
      updateModel(next.model)
      updateEffort(next.effort)
      updateFast(runtime ? runtime.serviceTier === 'priority' : next.fast)
      if (!runtime && !pending && activeSession && !findSessionModel(catalog, activeSession)) {
        const inherited = fallbackModel(catalog)
        if (inherited) syncActiveSessionChoice(inherited.provider, inherited.id, next.effort)
      }
    }
    // Never retarget a streaming runtime; the effect re-runs when the runtime settles.
    if (runtime && !runtime.isStreaming) {
      const targetModelKey = modelRef.current || fallbackModel(catalog)?.key || ''
      const targetModel = catalog.models.find((candidate) => candidate.key === targetModelKey && isUsable(candidate))
      const attempt = `${runtime.runtimeId}:${runtime.model?.provider}/${runtime.model?.id}->${targetModel?.key}`
      if (targetModel && (runtime.model?.provider !== targetModel.provider || runtime.model?.id !== targetModel.id) && reconcileAttemptRef.current !== attempt) {
        reconcileAttemptRef.current = attempt
        const previousModel = modelRef.current
        const previousEffort = effortRef.current
        if (modelRef.current !== targetModel.key) updateModel(targetModel.key)
        const targetEffort = targetModel.availableThinkingLevels.includes(effortRef.current)
          ? effortRef.current
          : targetModel.availableThinkingLevels.includes('medium') ? 'medium' : targetModel.availableThinkingLevels[0] ?? 'off'
        if (effortRef.current !== targetEffort) updateEffort(targetEffort)
        const runtimeModelKey = runtime.model?.provider && runtime.model.id ? `${runtime.model.provider}/${runtime.model.id}` : previousModel
        const runtimeEffort = (runtime.thinkingLevel as ApexThinkingLevel | undefined) ?? previousEffort
        const originSessionKey = sessionKeyRef.current
        queueRuntimeMutation(
          runtime.runtimeId,
          async () => {
            if (!bridge) return
            await bridge.agent.command(runtime.runtimeId, { type: 'set_model', provider: targetModel.provider, modelId: targetModel.id })
            await bridge.agent.command(runtime.runtimeId, { type: 'set_thinking_level', level: targetEffort })
            if (runtimeIdRef.current === runtime.runtimeId) rememberSelectionRef.current(targetModel.key)
            // A tab switch while the commands ran must not write this session's fallback onto the new tab.
            if (sessionKeyRef.current === originSessionKey) syncActiveSessionChoice(targetModel.provider, targetModel.id, targetEffort)
          },
          () => { updateModel(runtimeModelKey); updateEffort(runtimeEffort) },
        )
      }
    }
  }, [activeSession, applyPendingSelectionToRuntime, bridge, catalog, fallbackModel, lastSelectedModel, queueRuntimeMutation, runtime, sessionKey, slot, syncActiveSessionChoice, updateEffort, updateFast, updateModel])

  // Scoped to the runtime's reported tier so a catalog refresh cannot revert
  // an optimistic fast-mode toggle that the runtime has not confirmed yet.
  useEffect(() => {
    if (!runtime || pendingMutations.current.has(runtime.runtimeId)) return
    updateFast(runtime.serviceTier === 'priority')
  }, [runtime?.runtimeId, runtime?.serviceTier, updateFast])

  const changeModel = useCallback((nextModelKey: string) => {
    const previous = { model: modelRef.current, effort: effortRef.current, fast: fastRef.current }
    const nextModel = catalog?.models.find((candidate) => candidate.key === nextModelKey)
    const nextEffort = nextModel && !nextModel.availableThinkingLevels.includes(effortRef.current)
      ? nextModel.availableThinkingLevels.includes('medium') ? 'medium' : nextModel.availableThinkingLevels[0] ?? 'off'
      : effortRef.current
    const nextFast = Boolean(nextModel?.fastModeSupported && fastRef.current)
    updateModel(nextModelKey)
    updateEffort(nextEffort)
    if (!nextModel?.fastModeSupported) updateFast(false)
    if (nextModel) syncActiveSessionChoice(nextModel.provider, nextModel.id, nextEffort)
    if (!bridge || !runtime || !nextModel) {
      if (nextModel) {
        parkSelection({ model: nextModelKey, effort: nextEffort, fast: nextFast })
        rememberSelection(nextModelKey)
      }
      return
    }
    queueRuntimeMutation(
      runtime.runtimeId,
      async () => {
        await bridge.agent.command(runtime.runtimeId, { type: 'set_model', provider: nextModel.provider, modelId: nextModel.id })
        await bridge.agent.command(runtime.runtimeId, { type: 'set_thinking_level', level: nextEffort })
        if (runtimeIdRef.current === runtime.runtimeId) rememberSelectionRef.current(nextModelKey)
      },
      () => { updateModel(previous.model); updateEffort(previous.effort); updateFast(previous.fast) },
    )
  }, [bridge, catalog?.models, parkSelection, queueRuntimeMutation, rememberSelection, runtime, syncActiveSessionChoice, updateEffort, updateFast, updateModel])

  const changeEffort = useCallback((nextEffort: ApexThinkingLevel) => {
    const previous = effortRef.current
    updateEffort(nextEffort)
    syncActiveSessionChoice(undefined, undefined, nextEffort)
    if (!bridge || !runtime) {
      parkSelection({ model: modelRef.current, effort: nextEffort, fast: fastRef.current })
      return
    }
    queueRuntimeMutation(
      runtime.runtimeId,
      async () => { await bridge.agent.command(runtime.runtimeId, { type: 'set_thinking_level', level: nextEffort }) },
      () => updateEffort(previous),
    )
  }, [bridge, parkSelection, queueRuntimeMutation, runtime, syncActiveSessionChoice, updateEffort])

  const changeFast = useCallback((enabled: boolean) => {
    const previous = fastRef.current
    updateFast(enabled)
    if (!bridge || !runtime) {
      parkSelection({ model: modelRef.current, effort: effortRef.current, fast: enabled })
      return
    }
    queueRuntimeMutation(
      runtime.runtimeId,
      async () => { await bridge.agent.command(runtime.runtimeId, { type: 'set_service_tier', serviceTier: enabled ? 'priority' : 'default' }) },
      () => updateFast(previous),
    )
  }, [bridge, parkSelection, queueRuntimeMutation, runtime, updateFast])

  const setEnabled = useCallback(async (providerId: string, enabled: boolean) => {
    if (!bridge) throw new Error('Providers can only be configured in the desktop app.')
    const next = await bridge.providers.setEnabled(providerId, enabled, harness)
    setCatalogFor(harness, next)
    const disabledProviders = next.providers.filter((provider) => !provider.enabled).map((provider) => provider.id)
    const selectedProvider = catalog?.models.find((candidate) => candidate.key === modelRef.current)?.provider
    if (selectedProvider && disabledProviders.includes(selectedProvider)) {
      const fallback = fallbackModel(next)
      updateModel(fallback?.key ?? '')
      if (fallback) rememberSelection(fallback.key)
      updateFast(false)
    }
  }, [bridge, catalog?.models, fallbackModel, harness, rememberSelection, setCatalogFor, updateFast, updateModel])

  const setAllEnabled = useCallback(async () => {
    if (!bridge) throw new Error('Providers can only be configured in the desktop app.')
    setCatalogFor(harness, await bridge.providers.setDisabled([], harness))
  }, [bridge, harness, setCatalogFor])

  const setAllDisabled = useCallback(async () => {
    if (!bridge) throw new Error('Providers can only be configured in the desktop app.')
    const providerIds = catalog?.providers.map((provider) => provider.id).sort() ?? []
    if (!providerIds.length) throw new Error('Provider catalogue is not loaded.')
    setCatalogFor(harness, await bridge.providers.setDisabled(providerIds, harness))
    const selectedProvider = catalog?.models.find((candidate) => candidate.key === modelRef.current)?.provider
    if (selectedProvider && providerIds.includes(selectedProvider)) {
      updateModel('')
      updateFast(false)
    }
  }, [bridge, catalog?.models, catalog?.providers, harness, setCatalogFor, updateFast, updateModel])

  const setModelEnabled = useCallback(async (modelKey: string, enabled: boolean) => {
    if (!bridge) throw new Error('Models can only be configured in the desktop app.')
    const next = await bridge.providers.setModelEnabled(modelKey, enabled, harness)
    setCatalogFor(harness, next)
    if (!enabled && modelRef.current === modelKey) {
      const fallback = fallbackModel(next)
      updateModel(fallback?.key ?? '')
      if (fallback) rememberSelection(fallback.key)
      updateFast(false)
    }
  }, [bridge, fallbackModel, harness, rememberSelection, setCatalogFor, updateFast, updateModel])

  return {
    model, effort, fast, catalog, selectedModel, reasoningLevels, modelsByProvider,
    refresh, changeModel, changeEffort, changeFast, flushPendingMutations,
    setEnabled, setAllEnabled, setAllDisabled, setModelEnabled,
  }
}
