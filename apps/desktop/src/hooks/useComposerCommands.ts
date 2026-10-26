import { useEffect, useState } from 'react'
import { useStableCallback } from '@/hooks/useStableCallback'
import { writeClipboardText } from '@/lib/clipboard'
import { type ComposerCommand, type ComposerCommandAction, parseRuntimeCommands } from '@/lib/composer-commands'
import type { SettingsSection } from '@/pages/settings/contracts'
import type { InspectorTab, PrimeWorkApi, SessionRecord, TranscriptMessage } from '@/types/api'

/** Last `get_commands` listing per project, so a new session lists extension commands before its runtime starts. */
const commandsByProject = new Map<string, ComposerCommand[]>()

interface ComposerCommandsDeps {
  bridge: PrimeWorkApi | null
  runtimeId: string | undefined
  projectId: string | undefined
  activeSession: SessionRecord | undefined
  sessions: readonly SessionRecord[]
  messages: readonly TranscriptMessage[]
  newSession(): void
  selectSession(session: SessionRecord): Promise<void> | void
  renameSession(session: SessionRecord, title: string): Promise<void> | void
  openSettings(section: SettingsSection): void
  openInspectorTab(tab: InspectorTab): void
  setToast(message: string): void
}

function lastAgentText(messages: readonly TranscriptMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const text = message.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n\n').trim()
    if (text) return text
  }
  return ''
}

/** The runtime's slash commands and the app actions behind local commands such as `/new` and `/name`. */
export function useComposerCommands(deps: ComposerCommandsDeps) {
  const { bridge, runtimeId, projectId } = deps
  const [runtimeCommands, setRuntimeCommands] = useState(() => (projectId ? commandsByProject.get(projectId) : undefined))

  useEffect(() => {
    setRuntimeCommands(projectId ? commandsByProject.get(projectId) : undefined)
    if (!bridge || !runtimeId || !projectId) return
    let current = true
    bridge.agent.command(runtimeId, { type: 'get_commands' }).then((response) => {
      const commands = parseRuntimeCommands(response)
      commandsByProject.set(projectId, commands)
      if (current) setRuntimeCommands(commands)
    }).catch(() => undefined)
    return () => { current = false }
  }, [bridge, projectId, runtimeId])

  const runCommand = useStableCallback((action: ComposerCommandAction) => {
    switch (action.type) {
      case 'new': deps.newSession(); return
      case 'session': deps.openInspectorTab('summary'); return
      case 'settings': deps.openSettings(action.section); return
      case 'resume': {
        const session = deps.sessions.find((candidate) => candidate.id === action.sessionId)
        if (session) void deps.selectSession(session)
        return
      }
      case 'name':
        if (deps.activeSession) void deps.renameSession(deps.activeSession, action.title)
        else deps.setToast('Send a message first, then name the session.')
        return
      case 'copy': {
        const text = lastAgentText(deps.messages)
        if (!text) { deps.setToast('There is no agent message to copy yet.'); return }
        void writeClipboardText(text).then(
          () => deps.setToast('Copied the last agent message.'),
          () => deps.setToast('The clipboard is unavailable.'),
        )
      }
    }
  })

  return { runtimeCommands, runCommand }
}
