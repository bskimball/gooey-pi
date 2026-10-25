import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Composer } from '@/components/Composer'
import { ExtensionUiModal } from '@/components/ExtensionUiModal'
import { Transcript } from '@/components/Transcript'
import { parseExtensionUiRequest } from '@/lib/extension-ui'
import { detectRendererPlatform } from '@/lib/platform-shortcuts'
import type { ComposerCommand } from '@/lib/composer-commands'
import type { AgentBrowserState, AgentBrowserExtensionStatus, GitStatus, PrimeModelDescriptor, PrimeThinkingLevel, QueuedPrompt, TranscriptMessage } from '@/types/api'
import type { HostState } from '../src/protocol'
import { browser, onHostMessage, postToHost } from './host'
import type { ExtensionTabControls } from '@/hooks/useAgentBrowserTabs'
import { SessionPicker } from './SessionPicker'
import { applyOps } from './transcript'

const NO_GIT: GitStatus = { isRepo: false, files: [] }
const NO_SKILLS: never[] = []

export function App() {
  const [browserState, setBrowserState] = useState<AgentBrowserState>({ tabs: [] })
  const [browserStatus, setBrowserStatus] = useState<AgentBrowserExtensionStatus | null>(null)
  const browserExtension = useMemo<ExtensionTabControls>(() => ({
    status: browserStatus,
    setPaused: (tab, paused) => { void browser.setTabPaused(tab.sessionFile, tab.tabId, paused).catch(console.error) },
    focus: tab => { void browser.focusExtensionTab(tab.sessionFile, tab.tabId).catch(console.error) },
    popOut: tab => { void browser.popOutTab(tab.sessionFile, tab.tabId).catch(console.error) },
  }), [browserStatus])
  const extensionTabs = browserState.tabs.filter(tab => tab.backend === 'extension' && tab.sessionFile === browserStatus?.activeSessionKey)
  const extensionTab = extensionTabs[0]
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [state, setState] = useState<HostState | undefined>()
  const [uiRequest, setUiRequest] = useState<Record<string, unknown> | null>(null)
  const noticeSeqRef = useRef(0)
  const pushNotice = useCallback((text: string) => {
    const id = `local-notice-${++noticeSeqRef.current}`
    setMessages((current) => applyOps(current, [{ kind: 'notice', id, text, timestamp: Date.now() }]))
  }, [])

  useEffect(() => {
    const stop = onHostMessage((message) => {
      if (message.type === 'browserState') { setBrowserState(message.state); setBrowserStatus(message.status) }
      else if (message.type === 'reset') setMessages(applyOps([], message.ops))
      else if (message.type === 'ops') setMessages((current) => applyOps(current, message.ops))
      else if (message.type === 'state') setState(message.state)
      else if (message.type === 'extensionUi') setUiRequest(message.request)
    })
    postToHost({ type: 'ready' })
    return stop
  }, [])

  const modelsByProvider = useMemo(() => {
    const grouped = new Map<string, PrimeModelDescriptor[]>()
    for (const model of state?.models ?? []) {
      const list = grouped.get(model.provider) ?? []
      list.push(model as PrimeModelDescriptor)
      grouped.set(model.provider, list)
    }
    return grouped
  }, [state?.models])
  const runtimeCommands = useMemo<ComposerCommand[] | undefined>(() => state?.commands.map((command) => ({ ...command })), [state?.commands])
  const queuedMessages = useMemo<QueuedPrompt[]>(() => (state?.queued ?? []).map(({ id, text, intent, timestamp }) => ({ id, text, intent, timestamp })), [state?.queued])
  const parsedUiRequest = useMemo(() => uiRequest ? parseExtensionUiRequest(uiRequest) : undefined, [uiRequest])

  // A dialog Apex can't render must still be answered, or the extension waits forever.
  useEffect(() => {
    const id = typeof uiRequest?.id === 'string' ? uiRequest.id : undefined
    if (uiRequest && id && !parsedUiRequest) postToHost({ type: 'extensionUiResponse', id, response: { cancelled: true } })
  }, [uiRequest, parsedUiRequest])

  const ready = state?.status === 'ready'
  const busy = Boolean(state?.isStreaming)
  const selectedModel = state?.models.find((model) => model.key === state.model)
  const platform = detectRendererPlatform()

  return <div className="app-shell apex-shell" data-platform={platform} data-ready={state ? 'true' : 'false'}>
    <div className="workbench">
      <header className="title-toolbar apex-toolbar">
        <SessionPicker
          status={state?.status}
          busy={busy}
          sessionName={state?.sessionName}
          onNotice={pushNotice}
        />
      </header>
      <div className="workbench__content">
        <div className="session-workspace">
          <div className="conversation-column">
            <main className="conversation-pane">
              {state?.status === 'exited' ? <div className="apex-banner" role="alert">
                <pre>{state.error ?? 'Pi stopped.'}</pre>
                <button type="button" onClick={() => postToHost({ type: 'command', action: { type: 'restart' } })}>Restart Pi</button>
              </div> : null}
              <Transcript
                messages={messages}
                git={NO_GIT}
                harness="pi"
                loading={!state}
                active={busy}
                onOpenChanges={() => undefined}
                onSuggestion={(prompt) => postToHost({ type: 'send', text: prompt, images: [], intent: 'queue' })}
                suggestionsDisabled={!ready}
                showPinnedChanges={false}
                queuedMessageCount={queuedMessages.length}
              />
              <div className="conversation-bottom-dock">
                <Composer
                  extensionTab={extensionTab}
                  browserExtension={browserExtension}
                  draftKey={state?.cwd ? `apex-vscode:${state.cwd}` : undefined}
                  busy={busy}
                  loading={!state}
                  submitting={state?.status === 'starting'}
                  disabled={state?.status === 'exited'}
                  messageEnterAction={state?.messageEnterAction ?? 'queue'}
                  model={state?.model ?? ''}
                  effort={(state?.thinkingLevel ?? 'off') as PrimeThinkingLevel}
                  modelsByProvider={modelsByProvider}
                  providers={state?.providers ?? []}
                  reasoningLevels={(state?.thinkingLevels ?? ['off']) as PrimeThinkingLevel[]}
                  fast={false}
                  fastSupported={false}
                  fastAvailable={false}
                  agentName="Pi"
                  shortName="Pi"
                  harness="pi"
                  imageInputSupported={Boolean(selectedModel?.input.includes('image'))}
                  contextUsage={state?.contextUsage}
                  sessionUsage={state?.sessionUsage}
                  skills={NO_SKILLS}
                  fileRoot={state?.cwd}
                  runtimeCommands={runtimeCommands}
                  onCommand={(action) => postToHost({ type: 'command', action })}
                  queuedMessages={queuedMessages}
                  onDeleteQueuedMessage={(message) => postToHost({ type: 'removeQueued', id: message.id })}
                  onEditQueuedMessage={(message) => postToHost({ type: 'removeQueued', id: message.id })}
                  onModelChange={(key) => postToHost({ type: 'setModel', key })}
                  onEffortChange={(level) => postToHost({ type: 'setThinking', level })}
                  onFastChange={() => undefined}
                  onSend={(text, images, intent) => postToHost({ type: 'send', text, images, intent })}
                  onStop={() => postToHost({ type: 'stop' })}
                />
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
    {parsedUiRequest ? <ExtensionUiModal
      key={parsedUiRequest.id}
      request={parsedUiRequest}
      platform={platform}
      onRespond={(response) => postToHost({ type: 'extensionUiResponse', id: parsedUiRequest.id, response })}
    /> : null}
  </div>
}
