import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Composer, ExtensionUiModal, Transcript, detectRendererPlatform, parseExtensionUiRequest, type ComposerCommand, type ExtensionTabControls } from 'apex-ui'
import type { AgentBrowserState, AgentBrowserExtensionStatus, GitStatus, PrimeModelDescriptor, PrimeThinkingLevel, QueuedPrompt, SessionRecord, TranscriptMessage } from 'apex-core/types/api'
import type { EditorFileContext, HostState } from '../src/protocol'
import { browser, onHostMessage, postToHost, sessions } from './host'
import { SessionPicker } from './SessionPicker'
import { applyOps } from './transcript'
import { PI_FUSION_PAIR_STATUS_KEY, PI_HYDRA_STATUS_KEY, parsePiFusionPairStatus, parsePiHydraStatus, piModeFromStatusText, piModeWithHydra, publishActivePiBehaviorMode, publishActivePiFusionPair, publishActivePiHydraTier, readDefaultPiHydraTier } from '@/lib/harness'

const NO_GIT: GitStatus = { isRepo: false, files: [] }
const openChanges = () => postToHost({ type: 'openChanges' })
const NO_SKILLS: never[] = []

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

function selectionLabel(selection: NonNullable<EditorFileContext['selection']>): string {
  if (selection.count > 1) return `${selection.count} selections`
  if (selection.startLine === selection.endLine) return `Line ${selection.startLine}`
  return `Lines ${selection.startLine}–${selection.endLine}`
}

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
  const [editorFile, setEditorFile] = useState<EditorFileContext | null>(null)
  const [attachEditor, setAttachEditor] = useState(true)
  const [git, setGit] = useState<GitStatus>(NO_GIT)
  const [insertDraft, setInsertDraft] = useState<{ id: number; text: string }>()
  const draftSeqRef = useRef(0)
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
      else if (message.type === 'editorContext') setEditorFile(message.file)
      else if (message.type === 'git') setGit(message.git)
      else if (message.type === 'insertDraft') setInsertDraft({ id: ++draftSeqRef.current, text: message.text })
      else if (message.type === 'reset') setMessages(applyOps([], message.ops))
      else if (message.type === 'ops') setMessages((current) => applyOps(current, message.ops))
      else if (message.type === 'state') setState(message.state)
      else if (message.type === 'extensionUi') setUiRequest(message.request)
    })
    postToHost({ type: 'ready' })
    return stop
  }, [])

  useEffect(() => {
    if (!state) return
    const tier = parsePiHydraStatus(state.statuses[PI_HYDRA_STATUS_KEY])
    const mode = piModeWithHydra(piModeFromStatusText(state.statuses.mode), tier)
    publishActivePiHydraTier(tier ?? (mode === 'utopia' ? 'off' : readDefaultPiHydraTier()))
    publishActivePiBehaviorMode(mode)
    publishActivePiFusionPair(mode === 'fusion' ? parsePiFusionPairStatus(state.statuses[PI_FUSION_PAIR_STATUS_KEY]) ?? null : null)
  }, [state?.statuses])

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
  // `/resume` offers this workspace's other free saved sessions; they are not @-referenceable because VS Code has no session tools.
  const [resumeSessions, setResumeSessions] = useState<SessionRecord[]>([])
  useEffect(() => {
    const refresh = () => void sessions.list().then(({ sessions: saved, currentPath }) => setResumeSessions(saved.filter((session) => session.path !== currentPath && !session.owner).map((session) => ({
      id: session.id,
      harness: 'pi',
      filePath: session.path,
      projectPath: state?.cwd ?? '',
      title: session.title,
      createdAt: session.updatedAt,
      updatedAt: session.updatedAt,
      status: 'idle',
      depth: 0,
      preview: session.preview,
    }))), () => undefined)
    refresh()
    return sessions.onCurrent(refresh)
  }, [state?.cwd])

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
        {state?.cwd ? <span className="apex-toolbar__workspace" title={state.cwd}>{folderName(state.cwd)}</span> : null}
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
                git={git}
                harness="pi"
                loading={!state}
                active={busy}
                onOpenChanges={openChanges}
                onSuggestion={(prompt) => postToHost({ type: 'send', text: prompt, images: [], intent: 'queue', attachEditor })}
                suggestionsDisabled={!ready}
                showPinnedChanges={false}
                queuedMessageCount={queuedMessages.length}
              />
              <div className="conversation-bottom-dock">
                <div className="apex-editor-context" data-included={attachEditor ? 'true' : 'false'} role="status" aria-live="polite" aria-atomic="true" title={editorFile ? `${editorFile.path}\nEditor context is captured when you send a message.` : 'Open a text file to include its editor context.'}>
                  <span className="apex-editor-context__label">Editor</span>
                  <span className="apex-editor-context__file">{editorFile?.name ?? 'No active text file'}</span>
                  {editorFile?.dirty ? <span className="apex-editor-context__detail">Unsaved</span> : null}
                  {editorFile?.selection ? <span className="apex-editor-context__detail">
                    {selectionLabel(editorFile.selection)}
                  </span> : null}
                  <button type="button" className="apex-editor-context__toggle" aria-pressed={attachEditor} aria-label="Include editor context" title={attachEditor ? 'Editor context will be sent' : 'Editor context will not be sent'} onClick={() => setAttachEditor(current => !current)}>
                    {attachEditor ? 'On' : 'Off'}
                  </button>
                </div>
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
                  resumeSessions={resumeSessions}
                  runtimeCommands={runtimeCommands}
                  insertDraft={insertDraft}
                  onCommand={(action) => postToHost({ type: 'command', action })}
                  queuedMessages={queuedMessages}
                  onSendQueuedMessage={(message) => postToHost({ type: 'sendQueued', id: message.id })}
                  onDeleteQueuedMessage={(message) => postToHost({ type: 'removeQueued', id: message.id })}
                  onEditQueuedMessage={(message) => postToHost({ type: 'removeQueued', id: message.id })}
                  onModelChange={(key) => postToHost({ type: 'setModel', key })}
                  onEffortChange={(level) => postToHost({ type: 'setThinking', level })}
                  onFastChange={() => undefined}
                  onSend={(text, images, intent) => postToHost({ type: 'send', text, images, intent, attachEditor })}
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
