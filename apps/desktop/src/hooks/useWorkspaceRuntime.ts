import { useActorRef, useSelector } from '@xstate/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AGENT_EVENT_FLUSH_CHUNK,
  admitAgentEvent,
  authoritativeTranscriptReadIsCurrent,
  eventsForWorkspace,
  isTranscriptTerminalEvent,
  needsTranscriptReconciliation,
  reconcileTranscriptMessages,
  reconciliationMatches,
  type PendingAgentEvent,
  type TranscriptReconciliationMarker,
} from '@/app/agent-events'
import { runTranscriptRead } from '@/app/transcript-load'
import { reconcileTranscripts } from '@/app/transcript-reconcile'
import type { WorkspaceSnapshot } from '@/app/workspace'
import { createApexEventBuffer, createSteerAcceptedEvent, createSteerPickupEvent, replayApexEvents } from '@/lib/events'
import { findRuntimeForWorkspace, workspaceCwd } from '@/lib/workspace'
import type { HarnessId, MessagePart, ApexApi, ProjectRecord, PromptDeliveryIntent, QueuedPrompt, RuntimeInfo, SessionActionSnapshot, SessionRecord, TranscriptMessage } from '@/types/api'
import { workspaceLoadMachine, type TranscriptLoad } from './workspaceLoadMachine'

let queuedPromptSequence = 0

function nextQueuedPromptId(): string {
  queuedPromptSequence += 1
  return `queued-${Date.now()}-${queuedPromptSequence}`
}

function queuedPromptOwner(
  project: ProjectRecord | undefined,
  session: SessionRecord | undefined,
  runtime: RuntimeInfo | undefined,
  generation: number,
): string | undefined {
  if (session?.filePath) return `${session.harness}:session:${session.filePath}`
  if (runtime?.sessionFile) return `${runtime.harness}:session:${runtime.sessionFile}`
  if (runtime) return `${runtime.harness}:runtime:${runtime.runtimeId}`
  if (project) return `${project.harness}:new:${project.id}:${generation}`
  return undefined
}

interface UseWorkspaceRuntimeOptions {
  bridge: ApexApi | null
  /** Active harness; runtime discovery only attaches runtimes it owns. */
  harness?: HarnessId
  initialProject?: ProjectRecord
  initialSession?: SessionRecord
  sessions: SessionRecord[]
  initialMessages: TranscriptMessage[]
  reportError(error: unknown): void
}

export function useWorkspaceRuntime({
  bridge,
  harness = 'pi',
  initialProject,
  initialSession,
  sessions,
  initialMessages,
  reportError,
}: UseWorkspaceRuntimeOptions) {
  const [messages, setMessages] = useState(initialMessages)
  const [pendingQueuedPrompts, setPendingQueuedPrompts] = useState<QueuedPrompt[]>([])
  const pendingQueuedPromptsRef = useRef<QueuedPrompt[]>([])
  const queuedPromptsByOwnerRef = useRef<Map<string, QueuedPrompt[]>>(new Map())
  const observedSteerIdsRef = useRef<Set<string>>(new Set())
  const activeQueuedPromptOwnerRef = useRef<string | undefined>(queuedPromptOwner(initialProject, initialSession, undefined, 0))
  const [activeProjectId, setActiveProjectId] = useState(initialProject?.id)
  const [activeSessionId, setActiveSessionId] = useState(initialSession?.id)
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [workspaceGeneration, setWorkspaceGeneration] = useState(0)
  const loadActor = useActorRef(workspaceLoadMachine)
  const loadingSession = useSelector(loadActor, (snapshot) => snapshot.matches('admitted') || snapshot.matches('reading'))
  const harnessRef = useRef(harness)
  harnessRef.current = harness
  const runtimeIdRef = useRef<string | null>(null)
  const runtimeSessionsRef = useRef<Map<string, string>>(new Map())
  const runtimeOwnerRef = useRef<{ runtimeId: string; generation: number } | null>(null)
  const workspaceRef = useRef<WorkspaceSnapshot>({
    generation: 0,
    project: initialProject,
    session: initialSession,
    cwd: workspaceCwd(initialProject, initialSession),
    sessionFile: initialSession?.filePath,
  })
  const pendingAgentEventsRef = useRef<PendingAgentEvent[]>([])
  const lastTranscriptReadWorkspaceRef = useRef<{ generation: number; sessionFile: string } | null>(null)
  const lastObservedCatalogRef = useRef<{ generation: number; filePath: string; updatedAt: string; syncRevision?: number } | null>(null)
  const agentEventFrameRef = useRef<number | null>(null)
  const chunkedFlushTimerRef = useRef<number | null>(null)
  const reconcileOnVisibleRef = useRef(false)

  const flushAgentEvents = useCallback(() => {
    if (agentEventFrameRef.current !== null) {
      cancelAnimationFrame(agentEventFrameRef.current)
      agentEventFrameRef.current = null
    }
    if (chunkedFlushTimerRef.current !== null) {
      window.clearTimeout(chunkedFlushTimerRef.current)
      chunkedFlushTimerRef.current = null
    }
    const generation = workspaceRef.current.generation
    const pending = pendingAgentEventsRef.current
    pendingAgentEventsRef.current = []
    const admitted = eventsForWorkspace(pending, generation)
    if (admitted.length) {
      setMessages((current) => replayApexEvents(current, admitted))
    }
  }, [])

  const flushAgentEventsChunked = useCallback(() => {
    if (chunkedFlushTimerRef.current !== null) return
    if (agentEventFrameRef.current !== null) {
      cancelAnimationFrame(agentEventFrameRef.current)
      agentEventFrameRef.current = null
    }
    if (pendingAgentEventsRef.current.length <= AGENT_EVENT_FLUSH_CHUNK) {
      flushAgentEvents()
      return
    }
    const flushChunk = () => {
      chunkedFlushTimerRef.current = null
      const generation = workspaceRef.current.generation
      const chunk = pendingAgentEventsRef.current.splice(0, AGENT_EVENT_FLUSH_CHUNK)
      const admitted = eventsForWorkspace(chunk, generation)
      if (admitted.length) setMessages((current) => replayApexEvents(current, admitted))
      if (pendingAgentEventsRef.current.length) chunkedFlushTimerRef.current = window.setTimeout(flushChunk, 0)
    }
    flushChunk()
  }, [flushAgentEvents])

  const attachRuntime = useCallback((nextRuntime: RuntimeInfo | undefined, generation: number) => {
    if (nextRuntime?.sessionFile) runtimeSessionsRef.current.set(nextRuntime.runtimeId, nextRuntime.sessionFile)
    if (workspaceRef.current.generation !== generation) return
    const next = nextRuntime ?? null
    const previousQueueOwner = activeQueuedPromptOwnerRef.current
    const nextQueueOwner = queuedPromptOwner(workspaceRef.current.project, workspaceRef.current.session, nextRuntime, generation)
    if (nextQueueOwner !== previousQueueOwner) {
      const currentQueue = pendingQueuedPromptsRef.current
      const restoredQueue = nextQueueOwner ? queuedPromptsByOwnerRef.current.get(nextQueueOwner) : undefined
      const nextQueue = currentQueue.length ? currentQueue : restoredQueue ?? []
      if (previousQueueOwner?.includes(':new:') || previousQueueOwner?.includes(':runtime:')) {
        queuedPromptsByOwnerRef.current.delete(previousQueueOwner)
      }
      if (nextQueueOwner && nextQueue.length) queuedPromptsByOwnerRef.current.set(nextQueueOwner, nextQueue)
      activeQueuedPromptOwnerRef.current = nextQueueOwner
      pendingQueuedPromptsRef.current = nextQueue
      setPendingQueuedPrompts(nextQueue)
    }
    runtimeIdRef.current = next?.runtimeId ?? null
    runtimeOwnerRef.current = next ? { runtimeId: next.runtimeId, generation } : null
    setRuntime(next)
  }, [])

  const adoptCreatedSession = useCallback((session: SessionRecord, generation: number) => {
    if (workspaceRef.current.generation !== generation) return
    workspaceRef.current = { ...workspaceRef.current, session, sessionFile: session.filePath }
    lastTranscriptReadWorkspaceRef.current = { generation, sessionFile: session.filePath }
    setActiveSessionId(session.id)
    attachRuntime(undefined, generation)
  }, [attachRuntime])

  const promoteStartedSession = useCallback((session: SessionRecord, runtimeId: string) => {
    if (runtimeIdRef.current !== runtimeId || workspaceRef.current.sessionFile) return
    workspaceRef.current = { ...workspaceRef.current, session, sessionFile: session.filePath }
    // The prompt already owns this transcript. Do not start a disk read that
    // could replace its optimistic rows with a partial first turn.
    lastTranscriptReadWorkspaceRef.current = { generation: workspaceRef.current.generation, sessionFile: session.filePath }
    setActiveSessionId(session.id)
  }, [])

  const activateWorkspace = useCallback((project?: ProjectRecord, session?: SessionRecord, nextRuntime?: RuntimeInfo) => {
    pendingAgentEventsRef.current = []
    reconcileOnVisibleRef.current = false
    if (agentEventFrameRef.current !== null) {
      cancelAnimationFrame(agentEventFrameRef.current)
      agentEventFrameRef.current = null
    }
    if (chunkedFlushTimerRef.current !== null) {
      window.clearTimeout(chunkedFlushTimerRef.current)
      chunkedFlushTimerRef.current = null
    }
    const generation = workspaceRef.current.generation + 1
    workspaceRef.current = {
      generation,
      project,
      session,
      cwd: workspaceCwd(project, session),
      sessionFile: session?.filePath,
    }
    loadActor.send({
      type: 'ACTIVATE',
      load: bridge && session?.filePath
        ? { generation, sessionFile: session.filePath, eventBuffer: createApexEventBuffer(), reconciliation: false, admissionRevision: 0 }
        : null,
    })
    const queueOwner = queuedPromptOwner(project, session, nextRuntime, generation)
    const queuedPrompts = queueOwner ? queuedPromptsByOwnerRef.current.get(queueOwner) ?? [] : []
    activeQueuedPromptOwnerRef.current = queueOwner
    pendingQueuedPromptsRef.current = queuedPrompts
    setWorkspaceGeneration(generation)
    setPendingQueuedPrompts(queuedPrompts)
    setActiveProjectId(project?.id)
    setActiveSessionId(session?.id)
    attachRuntime(nextRuntime, generation)
    if (bridge) {
      setMessages([])
    }
    return generation
  }, [attachRuntime, bridge, loadActor])

  const reconcileRuntime = useCallback(async (generation: number) => {
    if (!bridge) return
    const selected = workspaceRef.current
    if (selected.generation !== generation || !selected.sessionFile) return
    try {
      const runtimes = (await bridge.agent.list()).filter((candidate) => candidate.harness === harnessRef.current)
      if (workspaceRef.current.generation !== generation) return
      attachRuntime(findRuntimeForWorkspace(runtimes, selected.cwd, selected.sessionFile), generation)
    } catch (error) {
      if (workspaceRef.current.generation === generation) reportError(error)
    }
  }, [attachRuntime, bridge, reportError])

  const startTranscriptRead = useCallback((
    selected: WorkspaceSnapshot,
    reconciliation: boolean,
    runtimeId?: string,
    admittedLoad?: TranscriptLoad,
  ) => {
    if (!bridge || !selected.sessionFile) return
    const previousLoad = loadActor.getSnapshot().context.load
    const pendingLoad = admittedLoad ?? {
      generation: selected.generation,
      sessionFile: selected.sessionFile,
      eventBuffer: previousLoad?.generation === selected.generation
        && previousLoad.sessionFile === selected.sessionFile
        ? previousLoad.eventBuffer
        : createApexEventBuffer(),
      runtimeId,
      reconciliation,
      admissionRevision: loadActor.getSnapshot().context.promptRevision,
    }
    loadActor.send({ type: 'READ_STARTED', load: pendingLoad })

    void runTranscriptRead({
      read: () => bridge.sessions.read(selected.sessionFile!),
      isCurrent: () => loadActor.getSnapshot().context.load === pendingLoad
        && workspaceRef.current.generation === pendingLoad.generation
        && workspaceRef.current.sessionFile === pendingLoad.sessionFile,
      onValue: (value) => {
        const current = workspaceRef.current
        const readMarker = pendingLoad.runtimeId ? {
          generation: pendingLoad.generation,
          runtimeId: pendingLoad.runtimeId,
          sessionFile: pendingLoad.sessionFile,
          admissionRevision: pendingLoad.admissionRevision,
        } : null
        if (pendingLoad.reconciliation && readMarker
          && !authoritativeTranscriptReadIsCurrent(readMarker, {
            ...current,
            admissionRevision: loadActor.getSnapshot().context.promptRevision,
          }, runtimeIdRef.current)) {
          setMessages((messages) => pendingLoad.eventBuffer.replay(messages))
          return
        }
        // Post-turn reconciliation reads restore disk authority, but unchanged
        // messages keep their identity so memoized rows do not re-render.
        if (pendingLoad.reconciliation) {
          setMessages((messages) => reconcileTranscripts(messages, pendingLoad.eventBuffer.replay(value)))
          return
        }
        // Background reads (initial and external-sync) merge into the live
        // list so an optimistic message sent while the read was in flight is
        // not replaced away by older on-disk state.
        setMessages((messages) => reconcileTranscriptMessages(messages, pendingLoad.eventBuffer.replay(value)))
      },
      onError: (error) => {
        setMessages((messages) => pendingLoad.eventBuffer.replay(messages))
        reportError(error)
      },
      onFinally: () => {
        loadActor.send({ type: 'READ_SETTLED', load: pendingLoad })
        const deferred = loadActor.getSnapshot().context.deferredReconciliation
        if (!deferred || loadActor.getSnapshot().context.load) return
        loadActor.send({ type: 'RECONCILIATION_DEFERRED', marker: null })
        const current = workspaceRef.current
        if (reconciliationMatches(deferred, current.generation, deferred.runtimeId, current.sessionFile)) {
          flushAgentEvents()
          startTranscriptRead(current, true, deferred.runtimeId)
        }
      },
    })
  }, [bridge, flushAgentEvents, loadActor, reportError])

  const runOverflowReconciliation = useCallback(() => {
    reconcileOnVisibleRef.current = false
    pendingAgentEventsRef.current = []
    if (agentEventFrameRef.current !== null) {
      cancelAnimationFrame(agentEventFrameRef.current)
      agentEventFrameRef.current = null
    }
    if (chunkedFlushTimerRef.current !== null) {
      window.clearTimeout(chunkedFlushTimerRef.current)
      chunkedFlushTimerRef.current = null
    }
    const selected = workspaceRef.current
    if (!selected.sessionFile) return
    startTranscriptRead(selected, false)
  }, [startTranscriptRead])

  const queueAgentEvent = useCallback((event: Record<string, unknown>) => {
    const generation = workspaceRef.current.generation
    const owner = admitAgentEvent(generation, event, loadActor.getSnapshot().context.load, pendingAgentEventsRef.current)
    if (owner === 'overflow') {
      // The replay queue is beyond its bound; an authoritative transcript read
      // replaces replay. Defer the read until the document is visible again so a
      // hidden window does not re-read on every dropped event.
      reconcileOnVisibleRef.current = true
      pendingAgentEventsRef.current = []
      if (agentEventFrameRef.current !== null) {
        cancelAnimationFrame(agentEventFrameRef.current)
        agentEventFrameRef.current = null
      }
      if (typeof document === 'undefined' || document.visibilityState === 'visible') runOverflowReconciliation()
      return
    }
    if (owner === 'frame' && agentEventFrameRef.current === null && chunkedFlushTimerRef.current === null) {
      agentEventFrameRef.current = requestAnimationFrame(flushAgentEvents)
    }
  }, [flushAgentEvents, loadActor, runOverflowReconciliation])

  const reconcileTranscriptForEvent = useCallback((runtimeId: string, event: Record<string, unknown>) => {
    const selected = workspaceRef.current
    const type = typeof event.type === 'string' ? event.type : ''
    // auto_retry_start also supersedes any in-flight reconciliation: the
    // agent_end that scheduled it did not actually end the turn, and the disk
    // read would replace the still-streaming transcript with finalized rows.
    if (type === 'agent_start' || type === 'turn_start' || type === 'compaction_start' || type === 'auto_retry_start') {
      const load = loadActor.getSnapshot().context.load
      if (load?.generation === selected.generation) {
        loadActor.send({ type: 'LOAD_CANCELLED' })
        setMessages((current) => load.eventBuffer.replay(current))
      }
    }
    if (loadActor.getSnapshot().context.promptGeneration === selected.generation) {
      // transport_error and runtime_exit mean the admitted prompt will never
      // start; clear the admission so reconciliation stops being suppressed.
      if (type === 'agent_start' || type === 'turn_start' || type === 'transport_error' || type === 'runtime_exit') {
        loadActor.send({ type: 'PROMPT_SETTLED' })
      } else if (needsTranscriptReconciliation(event) || isTranscriptTerminalEvent(event)) return
    }
    if (!selected.sessionFile) return
    const marker: TranscriptReconciliationMarker = {
      generation: selected.generation,
      runtimeId,
      sessionFile: selected.sessionFile,
    }
    if (needsTranscriptReconciliation(event)) {
      loadActor.send({ type: 'RECONCILIATION_NEEDED', marker })
      return
    }
    if (!isTranscriptTerminalEvent(event)) return

    const needed = loadActor.getSnapshot().context.reconciliationNeeded
    if (needed && !reconciliationMatches(needed, selected.generation, runtimeId, selected.sessionFile)) return
    loadActor.send({ type: 'RECONCILIATION_NEEDED', marker: null })
    if (loadActor.getSnapshot().context.load) {
      loadActor.send({ type: 'RECONCILIATION_DEFERRED', marker })
      return
    }
    flushAgentEvents()
    startTranscriptRead(selected, true, runtimeId)
  }, [flushAgentEvents, loadActor, startTranscriptRead])

  const prepareForPrompt = useCallback((generation: number): boolean => {
    if (workspaceRef.current.generation !== generation) return false
    loadActor.send({ type: 'PROMPT_ADMITTED', generation })
    const load = loadActor.getSnapshot().context.load
    // Supersede every pending transcript load, not only reconciliations: a
    // background read resolving after the prompt would otherwise replace the
    // optimistic user message with older on-disk state. The reconciliation
    // read after the turn's terminal event restores disk authority.
    if (load?.generation === generation) {
      loadActor.send({ type: 'LOAD_CANCELLED' })
      setMessages((current) => load.eventBuffer.replay(current))
    }
    return true
  }, [loadActor])

  const queuePrompt = useCallback((text: string, intent: PromptDeliveryIntent, parts?: MessagePart[], timestamp = Date.now()): string => {
    const queued: QueuedPrompt = { id: nextQueuedPromptId(), text, intent, timestamp, ...(parts ? { parts } : {}) }
    const next = [...pendingQueuedPromptsRef.current, queued]
    pendingQueuedPromptsRef.current = next
    const owner = activeQueuedPromptOwnerRef.current
    if (owner) queuedPromptsByOwnerRef.current.set(owner, next)
    setPendingQueuedPrompts(next)
    return queued.id
  }, [])
  const removeQueuedPrompt = useCallback((id: string) => {
    observedSteerIdsRef.current.delete(id)
    const current = pendingQueuedPromptsRef.current
    const next = current.filter((prompt) => prompt.id !== id)
    if (next.length !== current.length) {
      pendingQueuedPromptsRef.current = next
      const owner = activeQueuedPromptOwnerRef.current
      if (owner) {
        if (next.length) queuedPromptsByOwnerRef.current.set(owner, next)
        else queuedPromptsByOwnerRef.current.delete(owner)
      }
      setPendingQueuedPrompts(next)
      return
    }
    for (const [owner, prompts] of queuedPromptsByOwnerRef.current) {
      const remaining = prompts.filter((prompt) => prompt.id !== id)
      if (remaining.length === prompts.length) continue
      if (remaining.length) queuedPromptsByOwnerRef.current.set(owner, remaining)
      else queuedPromptsByOwnerRef.current.delete(owner)
      // Wake the idle-flush effect for the visible thread after a background
      // delivery settles; its previous pass may have observed the global
      // single-flight guard while this prompt was being sent.
      setPendingQueuedPrompts([...pendingQueuedPromptsRef.current])
      return
    }
  }, [])
  const updateQueuedPrompts = useCallback((transform: (prompt: QueuedPrompt) => QueuedPrompt) => {
    const update = (prompts: QueuedPrompt[]) => {
      let changed = false
      const next = prompts.map((prompt) => {
        const updated = transform(prompt)
        if (updated !== prompt) changed = true
        return updated
      })
      return changed ? next : prompts
    }
    const nextActive = update(pendingQueuedPromptsRef.current)
    if (nextActive !== pendingQueuedPromptsRef.current) {
      pendingQueuedPromptsRef.current = nextActive
      setPendingQueuedPrompts(nextActive)
    }
    for (const [owner, prompts] of queuedPromptsByOwnerRef.current) {
      const next = update(prompts)
      if (next !== prompts) queuedPromptsByOwnerRef.current.set(owner, next)
    }
  }, [])
  const markQueuedPromptFlushFailed = useCallback((id: string) => {
    updateQueuedPrompts((prompt) => prompt.id === id && !prompt.flushAttemptFailed
      ? { ...prompt, flushAttemptFailed: true }
      : prompt)
  }, [updateQueuedPrompts])
  const clearQueuedPromptFlushFailures = useCallback(() => {
    updateQueuedPrompts(({ flushAttemptFailed: _failed, ...prompt }) => prompt)
  }, [updateQueuedPrompts])
  const clearQueuedPrompts = useCallback(() => {
    const owner = activeQueuedPromptOwnerRef.current
    if (owner) queuedPromptsByOwnerRef.current.delete(owner)
    for (const prompt of pendingQueuedPromptsRef.current) observedSteerIdsRef.current.delete(prompt.id)
    pendingQueuedPromptsRef.current = []
    setPendingQueuedPrompts([])
  }, [])
  const acceptSteer = useCallback((id: string) => {
    const prompt = pendingQueuedPromptsRef.current.find((candidate) => candidate.id === id && candidate.intent === 'steer')
    if (prompt) queueAgentEvent(createSteerAcceptedEvent(prompt))
  }, [queueAgentEvent])
  const reconcileQueuedPrompts = useCallback((snapshot: SessionActionSnapshot) => {
    const localSteers = pendingQueuedPromptsRef.current.filter((prompt) => prompt.intent === 'steer')
    if (!localSteers.length) return

    // Session action previews are literal for ordinary prompts and may be
    // compacted for very long ones. Match in queue order so duplicate steers
    // are still acknowledged one at a time.
    const unmatchedPreviews = [...snapshot.steering]
    const stillQueued = new Set<string>()
    for (const prompt of localSteers) {
      const previewIndex = unmatchedPreviews.findIndex((preview) => (
        preview === prompt.text || prompt.text.startsWith(preview) || preview.startsWith(prompt.text)
      ))
      if (previewIndex < 0) continue
      unmatchedPreviews.splice(previewIndex, 1)
      stillQueued.add(prompt.id)
      observedSteerIdsRef.current.add(prompt.id)
    }

    const settled = localSteers.filter((prompt) => (
      !stillQueued.has(prompt.id) && observedSteerIdsRef.current.has(prompt.id)
    ))
    if (!settled.length) return

    // A disappearing preview is a pickup only when the scheduler exposes an
    // active turn. Queue clearing/abort removes the pending row too, but must
    // not inject the cancelled message into transcript history.
    const pickedUp = snapshot.active?.kind === 'turn' ? settled : []
    const settledIds = new Set(settled.map((prompt) => prompt.id))
    const next = pendingQueuedPromptsRef.current.filter((prompt) => !settledIds.has(prompt.id))
    pendingQueuedPromptsRef.current = next
    const owner = activeQueuedPromptOwnerRef.current
    if (owner) {
      if (next.length) queuedPromptsByOwnerRef.current.set(owner, next)
      else queuedPromptsByOwnerRef.current.delete(owner)
    }
    for (const prompt of settled) observedSteerIdsRef.current.delete(prompt.id)
    setPendingQueuedPrompts(next)

    // Keep the pickup boundary in the same ordered event buffer as preceding
    // tool output. Directly mutating messages here would let an unflushed tool
    // event jump below the newly inserted user row.
    if (pickedUp.length) queueAgentEvent(createSteerPickupEvent(pickedUp))
  }, [queueAgentEvent])

  const acknowledgeSteer = useCallback((id: string, snapshot: SessionActionSnapshot) => {
    if (!pendingQueuedPromptsRef.current.some((prompt) => prompt.id === id && prompt.intent === 'steer')) return
    // The command response proves admission. Reconcile against the
    // post-admission snapshot returned with it so a steer that was picked up
    // before the renderer received either scheduler edge cannot remain stuck.
    observedSteerIdsRef.current.add(id)
    reconcileQueuedPrompts(snapshot)
  }, [reconcileQueuedPrompts])

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const promptAdmitted = useSelector(loadActor, (snapshot) => snapshot.context.promptRevision > 0)
  const locallyOwnedActiveSession = Boolean(
    activeSession?.filePath && runtime?.sessionFile === activeSession.filePath
    && (runtime.isStreaming || runtime.isCompacting || promptAdmitted),
  )
  const externalSessionUpdatedAt = activeSession?.updatedAt
  const externalSessionSyncRevision = activeSession?.syncRevision

  useEffect(() => {
    if (!bridge || !activeSession?.filePath) {
      if (bridge && !activeSession) {
        loadActor.send({ type: 'LOAD_CANCELLED' })
        lastTranscriptReadWorkspaceRef.current = null
        setMessages([])
      } else if (loadActor.getSnapshot().matches('admitted')) {
        // An admitted load with no readable file would buffer events forever.
        loadActor.send({ type: 'LOAD_CANCELLED' })
      }
      return
    }
    const selected = workspaceRef.current
    if (selected.generation !== workspaceGeneration || selected.sessionFile !== activeSession.filePath) {
      // Recovery: an admitted load for the live workspace snapshot must still be
      // started even when this render's catalog view diverges (for example a
      // renamed session record), or its events buffer forever and the session
      // never finishes loading.
      const admitted = loadActor.getSnapshot().context.load
      if (admitted && !admitted.reconciliation
        && admitted.generation === selected.generation
        && admitted.sessionFile === selected.sessionFile
        && selected.sessionFile
        && lastTranscriptReadWorkspaceRef.current?.generation !== selected.generation) {
        lastTranscriptReadWorkspaceRef.current = { generation: selected.generation, sessionFile: selected.sessionFile }
        startTranscriptRead(selected, false, undefined, admitted)
      }
      return
    }
    const previousReadWorkspace = lastTranscriptReadWorkspaceRef.current
    const workspaceChanged = previousReadWorkspace?.generation !== selected.generation
      || previousReadWorkspace.sessionFile !== activeSession.filePath
    lastTranscriptReadWorkspaceRef.current = { generation: selected.generation, sessionFile: activeSession.filePath }
    const previousCatalog = lastObservedCatalogRef.current
    const catalogChanged = previousCatalog?.generation !== selected.generation
      || previousCatalog.filePath !== activeSession.filePath || previousCatalog.updatedAt !== activeSession.updatedAt
      || previousCatalog.syncRevision !== activeSession.syncRevision
    lastObservedCatalogRef.current = { generation: selected.generation, filePath: activeSession.filePath,
      updatedAt: activeSession.updatedAt, syncRevision: activeSession.syncRevision }
    // A warm attachment or busy/idle transition alone is not a disk change.
    const awaitingRead = loadActor.getSnapshot().matches('admitted')
    // An admitted load has never been read, so the no-change guard must not skip it.
    if (!awaitingRead && !workspaceChanged && (locallyOwnedActiveSession || !catalogChanged)) return
    const admittedLoad = loadActor.getSnapshot().context.load
    if (admittedLoad?.generation === workspaceGeneration && admittedLoad.sessionFile === activeSession.filePath) {
      if (!admittedLoad.reconciliation) startTranscriptRead(selected, false, undefined, admittedLoad)
    } else {
      startTranscriptRead(selected, false)
    }
  }, [activeSession?.filePath, bridge, externalSessionSyncRevision, externalSessionUpdatedAt, locallyOwnedActiveSession, startTranscriptRead, workspaceGeneration])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (reconcileOnVisibleRef.current) {
        runOverflowReconciliation()
        return
      }
      flushAgentEventsChunked()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [flushAgentEventsChunked, runOverflowReconciliation])

  useEffect(() => () => {
    loadActor.send({ type: 'LOAD_CANCELLED' })
    if (agentEventFrameRef.current !== null) cancelAnimationFrame(agentEventFrameRef.current)
    if (chunkedFlushTimerRef.current !== null) window.clearTimeout(chunkedFlushTimerRef.current)
  }, [])

  return {
    messages,
    setMessages,
    pendingQueuedPrompts,
    queuePrompt,
    removeQueuedPrompt,
    markQueuedPromptFlushFailed,
    clearQueuedPromptFlushFailures,
    clearQueuedPrompts,
    acceptSteer,
    reconcileQueuedPrompts,
    acknowledgeSteer,
    activeProjectId,
    activeSessionId,
    promoteStartedSession,
    adoptCreatedSession,
    runtime,
    setRuntime,
    workspaceGeneration,
    loadingSession,
    runtimeIdRef,
    runtimeSessionsRef,
    runtimeOwnerRef,
    workspaceRef,
    activateWorkspace,
    attachRuntime,
    reconcileRuntime,
    prepareForPrompt,
    queueAgentEvent,
    reconcileTranscriptForEvent,
  }
}
