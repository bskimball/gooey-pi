import { useCallback, useMemo } from 'react'
import type { ExtensionUiResponse } from '@/components/ExtensionUiModal'
import { resolveRuntimeIdForSession } from './useSessionLive'
import type { PendingExtensionUi } from './useExtensionUi'
import type { useWorkspaceRuntime } from './useWorkspaceRuntime'
import type {
  PrimeWorkApi,
  PromptDeliveryIntent,
  PromptImage,
  SessionRecord,
  TranscriptMessage,
} from '@/types/api'

export interface ActivityControls {
  compactLayout?: boolean
  pendingByRuntime?: ReadonlyMap<string, PendingExtensionUi>
  readTranscript?(filePath: string): Promise<TranscriptMessage[]>
  canFollowUpSession?(session: SessionRecord): boolean
  onRespondQuestion?(runtimeId: string, response: ExtensionUiResponse): Promise<void> | void
  onOpenQuestionModal?(runtimeId: string): void
  onSendReply?(session: SessionRecord, text: string, mode: 'steer' | 'follow-up', runtimeId?: string): Promise<void>
  reportError?(error: unknown): void
}

export interface UseActivityControlsOptions {
  bridge: PrimeWorkApi | null
  compactLayout: boolean
  workspace: ReturnType<typeof useWorkspaceRuntime>
  pendingByRuntime: ReadonlyMap<string, PendingExtensionUi>
  respondForRuntime(runtimeId: string, response: ExtensionUiResponse): Promise<void>
  openForRuntime(runtimeId: string): void
  sendPrompt(prompt: string, images?: PromptImage[], intent?: PromptDeliveryIntent): Promise<void>
  setSessions: React.Dispatch<React.SetStateAction<SessionRecord[]>>
  reportError(error: unknown): void
}

export function useActivityControls({
  bridge,
  compactLayout,
  workspace,
  pendingByRuntime,
  respondForRuntime,
  openForRuntime,
  sendPrompt,
  setSessions,
  reportError,
}: UseActivityControlsOptions): ActivityControls {
  const isActiveWorkspaceSession = useCallback((session: SessionRecord): boolean => {
    return workspace.activeSessionId === session.id
      || workspace.workspaceRef.current.sessionFile === session.filePath
  }, [workspace.activeSessionId, workspace.workspaceRef])

  const readTranscript = useCallback(async (filePath: string): Promise<TranscriptMessage[]> => {
    if (!bridge) return []
    return bridge.sessions.read(filePath)
  }, [bridge])

  const canFollowUpSession = useCallback((session: SessionRecord): boolean => {
    return isActiveWorkspaceSession(session)
  }, [isActiveWorkspaceSession])

  const onSendReply = useCallback(async (
    session: SessionRecord,
    text: string,
    mode: 'steer' | 'follow-up',
    runtimeId?: string,
  ): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (isActiveWorkspaceSession(session)) {
      await sendPrompt(trimmed, [], mode === 'steer' ? 'steer' : 'queue')
      return
    }
    if (mode !== 'steer') {
      const error = new Error('Open session to continue.')
      reportError(error)
      throw error
    }
    if (!bridge) {
      const error = new Error('Agent commands require the desktop bridge.')
      reportError(error)
      throw error
    }
    try {
      const resolvedId = await resolveRuntimeIdForSession(
        bridge,
        workspace.runtimeSessionsRef.current,
        workspace.runtime,
        session.filePath,
        runtimeId,
      )
      if (!resolvedId) {
        throw new Error('No active runtime found for this session. Open the session to continue.')
      }
      const sentAtIso = new Date().toISOString()
      setSessions((items) => items.map((item) => item.filePath === session.filePath
        ? { ...item, lastUserMessageAt: sentAtIso }
        : item))
      await bridge.agent.command(resolvedId, { type: 'steer', message: trimmed })
    } catch (error) {
      reportError(error)
      throw error
    }
  }, [bridge, isActiveWorkspaceSession, reportError, sendPrompt, setSessions, workspace.runtime, workspace.runtimeSessionsRef])

  return useMemo<ActivityControls>(() => ({
    compactLayout,
    pendingByRuntime,
    readTranscript,
    canFollowUpSession,
    onRespondQuestion: respondForRuntime,
    onOpenQuestionModal: openForRuntime,
    onSendReply,
    reportError,
  }), [
    canFollowUpSession,
    compactLayout,
    onSendReply,
    openForRuntime,
    pendingByRuntime,
    readTranscript,
    reportError,
    respondForRuntime,
  ])
}
