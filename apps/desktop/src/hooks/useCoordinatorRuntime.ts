import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ExtensionUiResponse } from '@/components/ExtensionUiModal'
import type { PendingExtensionUi } from './useExtensionUi'
import { parseExtensionUiRequest } from '@/lib/extension-ui'
import { replayApexEvents } from '@/lib/events/reduce'
import type { ApexApi, ApexEventEnvelope, CoordinatorAttachment, PromptDeliveryIntent, PromptImage, TranscriptMessage } from '@/types/api'

type CoordinatorState =
  | { phase: 'closed' }
  | { phase: 'opening'; projectId: string }
  | { phase: 'error'; projectId: string; error: string }
  | { phase: 'ready'; projectId: string; attachment: CoordinatorAttachment; messages: TranscriptMessage[]; dialogs: Record<string, unknown>[]; disconnected: boolean }

interface Snapshot { state: CoordinatorState; actionError: string | null }

/**
 * One coordinator attachment, kept open while Activity is unmounted so switching back is instant.
 * Its event subscription keeps the transcript current in the background; it closes after
 * WARM_MS without a mounted user, or at once when it failed or its runtime exited.
 */
interface Connection {
  readonly bridge: ApexApi
  readonly projectId: string
  snapshot: Snapshot
  readonly listeners: Set<() => void>
  users: number
  idleTimer?: ReturnType<typeof setTimeout>
  recoverQuestion?: (runtimeId: string, event: Record<string, unknown>) => void
  closed: boolean
  close(): void
}

const WARM_MS = 10 * 60_000
const CLOSED: Snapshot = { state: { phase: 'closed' }, actionError: null }
const connections = new Map<string, Connection>()

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function publish(connection: Connection, next: Snapshot) {
  if (next === connection.snapshot) return
  connection.snapshot = next
  for (const listener of connection.listeners) listener()
}

function setState(connection: Connection, update: (state: CoordinatorState) => CoordinatorState) {
  const state = update(connection.snapshot.state)
  if (state !== connection.snapshot.state) publish(connection, { ...connection.snapshot, state })
}

function setActionError(connection: Connection, actionError: string | null) {
  if (actionError !== connection.snapshot.actionError) publish(connection, { ...connection.snapshot, actionError })
}

function open(bridge: ApexApi, projectId: string, spaceId: string | undefined): Connection {
  let attachment: CoordinatorAttachment | undefined
  const buffered: ApexEventEnvelope[] = []
  let overflow = false
  const connection: Connection = {
    bridge,
    projectId,
    snapshot: { state: { phase: 'opening', projectId }, actionError: null },
    listeners: new Set(),
    users: 0,
    closed: false,
    close() {
      if (connection.closed) return
      connection.closed = true
      clearTimeout(connection.idleTimer)
      unsubscribe()
      if (connections.get(projectId) === connection) connections.delete(projectId)
      if (attachment) void bridge.coordinator.close(attachment.attachmentId).catch(() => undefined)
    },
  }
  const receive = (envelope: ApexEventEnvelope) => {
    if (connection.closed) return
    if (!attachment) {
      if (buffered.length < 2_000) buffered.push(envelope)
      else overflow = true
      return
    }
    const { runtimeId, event, sequence } = envelope
    if (runtimeId !== attachment.runtime.runtimeId || (sequence !== undefined && sequence <= attachment.eventSequence)) return
    const parsed = parseExtensionUiRequest(event)
    if (parsed?.method === 'select' && parsed.questionnaire) connection.recoverQuestion?.(runtimeId, event)
    setState(connection, (current) => {
      if (current.phase !== 'ready' || current.attachment.attachmentId !== attachment?.attachmentId) return current
      const runtime = { ...current.attachment.runtime }
      const type = event.type
      if (type === 'agent_start' || type === 'auto_retry_start') runtime.isStreaming = true
      if (type === 'agent_end' || type === 'error' || type === 'transport_error' || type === 'runtime_exit') {
        runtime.isStreaming = false
        runtime.isCompacting = false
      }
      if (type === 'compaction_start') runtime.isCompacting = true
      if (type === 'compaction_end') runtime.isCompacting = false
      let dialogs = current.dialogs
      if (parseExtensionUiRequest(event)) {
        dialogs = [...dialogs.filter((dialog) => dialog.id !== event.id), { ...event, receivedAt: typeof event.receivedAt === 'number' ? event.receivedAt : Date.now() }]
      } else if (type === 'extension_ui_resolved') {
        dialogs = dialogs.filter((dialog) => dialog.id !== event.id)
      } else if (type === 'runtime_exit') dialogs = []
      return {
        ...current,
        attachment: { ...current.attachment, runtime },
        messages: replayApexEvents(current.messages, [event]),
        dialogs,
        disconnected: current.disconnected || type === 'runtime_exit',
      }
    })
    if (event.type === 'error' || event.type === 'transport_error' || event.type === 'extension_error') {
      const error = event.error ?? event.message
      setActionError(connection, typeof error === 'string' ? error : 'The coordinator reported an error.')
    }
  }
  const unsubscribe = bridge.agent.onEvent(receive)
  void bridge.coordinator.open(spaceId).then((opened) => {
    if (connection.closed) {
      void bridge.coordinator.close(opened.attachmentId).catch(() => undefined)
      return
    }
    if (overflow) {
      void bridge.coordinator.close(opened.attachmentId).catch(() => undefined)
      throw new Error('Session activity changed too quickly while opening. Reconnect to get a fresh snapshot.')
    }
    attachment = opened
    for (const dialog of opened.pendingDialogs) {
      const request = parseExtensionUiRequest(dialog)
      if (request?.method === 'select' && request.questionnaire) connection.recoverQuestion?.(opened.runtime.runtimeId, dialog)
    }
    setState(connection, () => ({ phase: 'ready', projectId, attachment: opened, messages: opened.messages, dialogs: opened.pendingDialogs, disconnected: false }))
    for (const envelope of buffered.splice(0)) receive(envelope)
  }).catch((error: unknown) => {
    if (!connection.closed) setState(connection, () => ({ phase: 'error', projectId, error: errorText(error) }))
  })
  return connection
}

function acquire(bridge: ApexApi, projectId: string, spaceId: string | undefined): Connection {
  let connection = connections.get(projectId)
  if (connection && connection.bridge !== bridge) connection.close()
  if (!connection || connection.closed) {
    connection = open(bridge, projectId, spaceId)
    connections.set(projectId, connection)
  }
  clearTimeout(connection.idleTimer)
  connection.users += 1
  return connection
}

function release(connection: Connection) {
  connection.users -= 1
  if (connection.users > 0 || connection.closed) return
  const { state } = connection.snapshot
  if (state.phase === 'error' || (state.phase === 'ready' && state.disconnected)) connection.close()
  else connection.idleTimer = setTimeout(() => connection.close(), WARM_MS)
}

export function useCoordinatorRuntime(bridge: ApexApi | null, onRecoverQuestion?: (runtimeId: string, event: Record<string, unknown>) => void, spaceId?: string) {
  const projectId = spaceId ?? 'global-chief'
  const [connection, setConnection] = useState<Connection | null>(null)
  const [revision, setRevision] = useState(0)
  const [sending, setSending] = useState(false)
  const generationRef = useRef(0)
  const connectionRef = useRef(connection)
  const recoverQuestionRef = useRef(onRecoverQuestion)
  connectionRef.current = connection
  recoverQuestionRef.current = onRecoverQuestion

  // A layout effect swaps in a warm connection before paint, so a return to Activity never flashes the opening state.
  useLayoutEffect(() => {
    generationRef.current += 1
    setSending(false)
    if (!bridge) {
      setConnection(null)
      return
    }
    const acquired = acquire(bridge, projectId, spaceId)
    acquired.recoverQuestion = (runtimeId, event) => recoverQuestionRef.current?.(runtimeId, event)
    setActionError(acquired, null)
    setConnection(acquired)
    return () => release(acquired)
  }, [bridge, projectId, revision, spaceId])

  const subscribe = useCallback((listener: () => void) => {
    if (!connection) return () => {}
    connection.listeners.add(listener)
    return () => { connection.listeners.delete(listener) }
  }, [connection])
  const snapshot = useSyncExternalStore(subscribe, () => connection?.snapshot ?? CLOSED)
  const current = connection && connection.projectId === projectId && connection.bridge === bridge ? snapshot : undefined
  const state: CoordinatorState = !bridge ? CLOSED.state : current?.state ?? { phase: 'opening', projectId }
  const actionError = current?.actionError ?? null
  const stateRef = useRef(state)
  stateRef.current = state

  const send = useCallback(async (message: string, images: PromptImage[], intent: PromptDeliveryIntent = 'queue') => {
    const current = stateRef.current
    const target = connectionRef.current
    if (!bridge || !target || current.phase !== 'ready' || current.projectId !== projectId || current.disconnected || sending) throw new Error('Chief of Staff is not ready to receive messages.')
    const generation = generationRef.current
    setSending(true)
    setActionError(target, null)
    try {
      let scopedMessage = message
      if (spaceId) {
        const spaces = await bridge.spaces.list()
        const latest = stateRef.current
        if (generationRef.current !== generation || latest.phase !== 'ready' || latest.attachment.attachmentId !== current.attachment.attachmentId) throw new Error('The Space changed before the message could be sent.')
        const space = spaces.find((item) => item.id === spaceId)
        if (!space) throw new Error('This Space is no longer available. Refresh and try again.')
        scopedMessage = '[Current Space context]\n' + JSON.stringify({ name: space.name, objective: space.objective }) + '\n[End Space context]\n\n' + message
      }
      const response = await bridge.agent.command(current.attachment.runtime.runtimeId, {
        type: 'attached_prompt', intent, message: scopedMessage,
        ...(images.length ? { images } : {}),
      })
      if (response.success === false) throw new Error(typeof response.error === 'string' && response.error ? response.error : 'Chief of Staff rejected the message.')
    } catch (error) {
      if (generationRef.current === generation) setActionError(target, errorText(error))
      throw error
    } finally {
      if (generationRef.current === generation) setSending(false)
    }
  }, [bridge, projectId, sending, spaceId])

  const syncRuntime = useCallback(async (runtimeId: string) => {
    const target = connectionRef.current
    if (!bridge || !target) return
    const runtime = (await bridge.agent.list()).find((item) => item.runtimeId === runtimeId)
    if (!runtime) return
    setState(target, (current) => current.phase === 'ready' && current.attachment.runtime.runtimeId === runtimeId
      ? { ...current, attachment: { ...current.attachment, runtime } } : current)
  }, [bridge])

  const stop = useCallback(async () => {
    const current = stateRef.current
    const target = connectionRef.current
    if (!bridge || !target || current.phase !== 'ready' || current.projectId !== projectId) return
    try {
      setActionError(target, null)
      const response = await bridge.agent.command(current.attachment.runtime.runtimeId, { type: 'abort' })
      if (response.success === false) throw new Error(typeof response.error === 'string' && response.error ? response.error : 'Chief of Staff could not stop the run.')
    } catch (error) { setActionError(target, errorText(error)) }
  }, [bridge, projectId])

  const pending = state.phase === 'ready' ? state.dialogs.flatMap((dialog): PendingExtensionUi[] => {
    const request = parseExtensionUiRequest(dialog)
    if (!request || (recoverQuestionRef.current && request.method === 'select' && request.questionnaire)) return []
    const deadline = typeof dialog.deadline === 'number' ? dialog.deadline
      : typeof dialog.receivedAt === 'number' && 'timeout' in request && request.timeout
        ? dialog.receivedAt + request.timeout : undefined
    return [{ runtimeId: state.attachment.runtime.runtimeId, request, ...(deadline !== undefined ? { deadline } : {}) }]
  })[0] : undefined

  const respond = useCallback(async (_runtimeId: string, response: ExtensionUiResponse) => {
    const current = stateRef.current
    const target = connectionRef.current
    if (!bridge || !target || current.phase !== 'ready' || current.projectId !== projectId || !pending) return
    try {
      await bridge.agent.command(pending.runtimeId, { type: 'extension_ui_response', id: pending.request.id, ...response })
      setState(target, (value) => value.phase === 'ready' && value.attachment.attachmentId === current.attachment.attachmentId
        ? { ...value, dialogs: value.dialogs.filter((dialog) => dialog.id !== pending.request.id) } : value)
    } catch (error) { setActionError(target, errorText(error)) }
  }, [bridge, pending, projectId])

  const reconnect = useCallback(() => {
    connectionRef.current?.close()
    setRevision((value) => value + 1)
  }, [])

  // Archives the saved conversation in the main process, then reopens on a fresh session.
  const [clearing, setClearing] = useState(false)
  const clear = useCallback(async () => {
    const target = connectionRef.current
    if (!bridge || clearing) return
    setClearing(true)
    try {
      if (target) setActionError(target, null)
      await bridge.coordinator.reset(spaceId)
      connectionRef.current?.close()
      setRevision((value) => value + 1)
    } catch (error) {
      if (target && !target.closed) setActionError(target, errorText(error))
    } finally {
      setClearing(false)
    }
  }, [bridge, clearing, spaceId])

  const ready = state.phase === 'ready'
  return { state, sending: ready && sending, error: ready ? actionError : null, pending: ready ? pending : undefined, send, stop, respond, syncRuntime, reconnect, clear, clearing }
}
