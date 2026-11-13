import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExtensionUiResponse } from '@/components/ExtensionUiModal'
import type { PendingExtensionUi } from './useExtensionUi'
import { parseExtensionUiRequest } from '@/lib/extension-ui'
import { replayApexEvents } from '@/lib/events/reduce'
import type { ApexApi, ApexEventEnvelope, CoordinatorAttachment, PromptDeliveryIntent, TranscriptMessage } from '@/types/api'

type CoordinatorState =
  | { phase: 'closed' }
  | { phase: 'opening'; projectId: string }
  | { phase: 'error'; projectId: string; error: string }
  | { phase: 'ready'; projectId: string; attachment: CoordinatorAttachment; messages: TranscriptMessage[]; dialogs: Record<string, unknown>[]; disconnected: boolean }

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useCoordinatorRuntime(bridge: ApexApi | null, projectId: string | undefined) {
  const [state, setState] = useState<CoordinatorState>({ phase: 'closed' })
  const [revision, setRevision] = useState(0)
  const [sending, setSending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const generationRef = useRef(0)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const generation = ++generationRef.current
    setActionError(null)
    setSending(false)
    if (!bridge || !projectId) {
      setState({ phase: 'closed' })
      return
    }
    let disposed = false
    let attachment: CoordinatorAttachment | undefined
    setState({ phase: 'opening', projectId })
    const buffered: ApexEventEnvelope[] = []
    let overflow = false
    const receive = (envelope: ApexEventEnvelope) => {
      if (disposed) return
      if (!attachment) {
        if (buffered.length < 2_000) buffered.push(envelope)
        else overflow = true
        return
      }
      const { runtimeId, event, sequence } = envelope
      if (runtimeId !== attachment.runtime.runtimeId || (sequence !== undefined && sequence <= attachment.eventSequence)) return
      setState((current) => {
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
        setActionError(typeof error === 'string' ? error : 'The coordinator reported an error.')
      }
    }
    const unsubscribe = bridge.agent.onEvent(receive)
    void bridge.coordinator.open(projectId).then((opened) => {
      if (disposed) {
        void bridge.coordinator.close(opened.attachmentId).catch(() => undefined)
        return
      }
      if (overflow) {
        void bridge.coordinator.close(opened.attachmentId).catch(() => undefined)
        throw new Error('Session activity changed too quickly while opening. Reconnect to get a fresh snapshot.')
      }
      attachment = opened
      setState({ phase: 'ready', projectId, attachment: opened, messages: opened.messages, dialogs: opened.pendingDialogs, disconnected: false })
      for (const envelope of buffered.splice(0)) receive(envelope)
    }).catch((error: unknown) => {
      if (!disposed) setState({ phase: 'error', projectId, error: errorText(error) })
    })
    return () => {
      disposed = true
      if (generationRef.current === generation) generationRef.current += 1
      unsubscribe()
      if (attachment) void bridge.coordinator.close(attachment.attachmentId).catch(() => undefined)
    }
  }, [bridge, projectId, revision])

  const send = useCallback(async (message: string, intent: PromptDeliveryIntent = 'queue') => {
    const current = stateRef.current
    if (!bridge || current.phase !== 'ready' || current.projectId !== projectId || current.disconnected || sending) return false
    const generation = generationRef.current
    setSending(true)
    setActionError(null)
    try {
      const accepted = await bridge.sessions.followUp(current.attachment.session.filePath, message, intent)
      if (!accepted) throw new Error('The coordinator did not accept the message.')
      return true
    } catch (error) {
      if (generationRef.current === generation) setActionError(errorText(error))
      return false
    } finally {
      if (generationRef.current === generation) setSending(false)
    }
  }, [bridge, projectId, sending])

  const stop = useCallback(async () => {
    const current = stateRef.current
    if (!bridge || current.phase !== 'ready' || current.projectId !== projectId) return
    try {
      await bridge.agent.command(current.attachment.runtime.runtimeId, { type: 'abort' })
    } catch (error) { setActionError(errorText(error)) }
  }, [bridge, projectId])

  const pending = state.phase === 'ready' ? state.dialogs.flatMap((dialog): PendingExtensionUi[] => {
    const request = parseExtensionUiRequest(dialog)
    if (!request) return []
    const deadline = typeof dialog.deadline === 'number' ? dialog.deadline
      : typeof dialog.receivedAt === 'number' && 'timeout' in request && request.timeout
        ? dialog.receivedAt + request.timeout : undefined
    return [{ runtimeId: state.attachment.runtime.runtimeId, request, ...(deadline !== undefined ? { deadline } : {}) }]
  })[0] : undefined

  const respond = useCallback(async (_runtimeId: string, response: ExtensionUiResponse) => {
    const current = stateRef.current
    if (!bridge || current.phase !== 'ready' || current.projectId !== projectId || !pending) return
    try {
      await bridge.agent.command(pending.runtimeId, { type: 'extension_ui_response', id: pending.request.id, ...response })
      setState((value) => value.phase === 'ready' && value.attachment.attachmentId === current.attachment.attachmentId
        ? { ...value, dialogs: value.dialogs.filter((dialog) => dialog.id !== pending.request.id) } : value)
    } catch (error) { setActionError(errorText(error)) }
  }, [bridge, pending, projectId])

  return { state, sending, error: actionError, pending, send, stop, respond, reconnect: () => setRevision((value) => value + 1) }
}
