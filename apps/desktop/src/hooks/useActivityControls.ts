import { useCallback, useMemo } from 'react'
import type { ExtensionUiResponse } from '@/components/ExtensionUiModal'
import type { PendingExtensionUi } from './useExtensionUi'
import type { useWorkspaceRuntime } from './useWorkspaceRuntime'
import type {
  ApexApi,
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
  bridge: ApexApi | null
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

  const canFollowUpSession = useCallback((_session: SessionRecord): boolean => {
    return Boolean(bridge)
  }, [bridge])

  const onSendReply = useCallback(async (
    session: SessionRecord,
    text: string,
    mode: 'steer' | 'follow-up',
    _runtimeId?: string,
  ): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (isActiveWorkspaceSession(session)) {
      await sendPrompt(trimmed, [], mode === 'steer' ? 'steer' : 'queue')
      return
    }
    if (!bridge) {
      const error = new Error('Agent commands require the desktop bridge.')
      reportError(error)
      throw error
    }
    try {
      const accepted = await bridge.sessions.followUp(session.filePath, trimmed, mode === 'steer' ? 'steer' : 'queue')
      if (!accepted) throw new Error('The session did not accept the message.')
      const sentAtIso = new Date().toISOString()
      setSessions((items) => items.map((item) => item.filePath === session.filePath
        ? { ...item, lastUserMessageAt: sentAtIso }
        : item))
    } catch (error) {
      reportError(error)
      throw error
    }
  }, [bridge, isActiveWorkspaceSession, reportError, sendPrompt, setSessions])

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
