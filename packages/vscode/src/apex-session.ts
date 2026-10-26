import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { canonicalSessionPath } from 'apex-core/session-paths'
import { createPiSessionMetadataReader } from 'apex-core/sessions/pi'
import * as vscode from 'vscode'
import { BrowserHost } from './browser/host'
import type { ScreenshotResizer } from './browser/service'
import { editorPromptContext } from './editor'
import { PiRpc, resolvePi } from './pi-rpc'
import type { HostMessage, HostState, ModelDescriptor, PromptImage, ProviderDescriptor, QueuedPrompt, RuntimeCommand, ThinkingLevel, TranscriptOp, WebviewMessage } from './protocol'
import { listSessions, sessionBucket, sessionTranscriptOps } from './session-catalog'

type Json = Record<string, unknown>

// Event types pi-desktop's transcript reducer (src/lib/events/reduce.ts) consumes; everything else stays host-side.
const TRANSCRIPT_EVENTS = new Set([
  'agent_start',
  'agent_end',
  'turn_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'compaction_start',
  'compaction_end',
  'auto_retry_start',
  'auto_retry_end',
  'retry_fallback_applied',
  'model_change',
  'custom_message',
  'extension_error',
  'error',
])
const DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor'])
// Events that keep streaming into the same assistant row; anything else may finalize it.
const SAME_SEGMENT_EVENTS = new Set(['message_update', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'turn_start', 'apex_noop'])
const REASONING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high']

const asRecord = (value: unknown): Json | undefined => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined)
const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

function describeModel(raw: Json): ModelDescriptor {
  const provider = String(raw.provider)
  const id = String(raw.id)
  const reasoning = raw.reasoning === true
  return {
    key: `${provider}/${id}`,
    provider,
    id,
    name: asString(raw.name) ?? id,
    reasoning,
    input: Array.isArray(raw.input) ? raw.input.filter((kind): kind is 'text' | 'image' => kind === 'text' || kind === 'image') : ['text'],
    contextWindow: Number(raw.contextWindow) || 0,
    maxTokens: Number(raw.maxTokens) || 0,
    availableThinkingLevels: reasoning ? REASONING_LEVELS : ['off'],
    fastModeSupported: false,
    available: true,
  }
}

function describeProviders(models: ModelDescriptor[]): ProviderDescriptor[] {
  const counts = new Map<string, number>()
  for (const model of models) counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1)
  return [...counts].map(([id, count]) => ({ id, name: id, authMethod: 'external', configured: true, modelCount: count, availableModelCount: count, enabled: true }))
}

/** One pi RPC process plus the transcript log the webview replays. */
export class ApexSession implements vscode.Disposable {
  private rpc: PiRpc | undefined
  private ops: TranscriptOp[] = []
  private pendingOps: TranscriptOp[] = []
  private flushTimer: NodeJS.Timeout | undefined
  private latestToolUpdate = new Map<string, number>()
  private uiQueue: Json[] = []
  private statuses = new Map<string, string>()
  private statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
  private queuePaused = false
  /** Set when pi reports agent_start after our latest prompt, so a late "handled" response can't end a real run. */
  private runStarted = false
  /** Bumped per idle prompt and on transcript reset; only the current prompt's response may end its optimistic run. */
  private promptToken = 0
  private seq = 0
  private currentPath: string | null = null
  private switching = false
  private state: HostState = {
    status: 'starting',
    isStreaming: false,
    thinkingLevel: 'off',
    thinkingLevels: ['off'],
    models: [],
    providers: [],
    commands: [],
    queued: [],
    messageEnterAction: 'queue',
  }

  readonly browser: BrowserHost
  private readonly browserSessionKey = canonicalSessionPath(this.cwd)
  private browserToken: string | undefined
  private launchGeneration = 0
  private browserPortNotice = false

  constructor(
    private readonly post: (message: HostMessage) => void,
    private readonly distDirectory: string,
    resizeScreenshot?: ScreenshotResizer,
  ) {
    this.statusItem.name = 'Apex'
    this.browser = new BrowserHost(distDirectory, resizeScreenshot)
    this.browser.service.onExtensionStatusChanged(() => this.postBrowser())
  }

  private postBrowser() {
    this.post({ type: 'browserState', state: this.browser.service.state(), status: this.browser.service.getExtensionStatus() })
  }

  get cwd(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir()
  }

  async start() {
    const generation = ++this.launchGeneration
    this.browser.capability.revoke(this.browserToken)
    this.browserToken = undefined
    const previous = this.rpc
    this.rpc = undefined
    previous?.dispose()
    const config = vscode.workspace.getConfiguration('apex')
    this.resetTranscript()
    this.setCurrentPath(null)
    this.uiQueue = []
    this.post({ type: 'extensionUi', request: null })
    this.update({
      status: 'starting',
      error: undefined,
      isStreaming: false,
      queued: [],
      contextUsage: undefined,
      sessionUsage: undefined,
      cwd: this.cwd,
      messageEnterAction: config.get('messageEnterAction', 'queue'),
    })
    let rpc: PiRpc
    let launchToken: string | undefined
    try {
      await this.browser.start()
      if (generation !== this.launchGeneration) return
      await this.browser.service.setActiveSession(this.browserSessionKey)
      if (generation !== this.launchGeneration) return
      if (this.browser.bridge.port !== 29301 && !this.browserPortNotice) {
        this.browserPortNotice = true
        const notice = `Browser extension is paired with another app (port 29301 is in use); Apex bridge is on ${this.browser.bridge.port}.`
        vscode.window.setStatusBarMessage(`Apex: ${notice}`, 15000)
        this.notice(notice)
      }
      const environment = this.browser.capability.environmentFor({ cwd: this.cwd, sessionPath: this.browserSessionKey })
      launchToken = environment.PRIME_WORK_BROWSER_TOKEN
      this.browserToken = launchToken
      rpc = new PiRpc(
        resolvePi(config.get('piPath', '')),
        ['--mode', 'rpc', '--extension', this.browser.extensionPath, '--extension', join(this.distDirectory, 'extensions', 'editor-extension.ts')],
        this.cwd,
        (record) => {
          if (this.rpc === rpc) this.onRecord(record)
        },
        (code, stderr) => {
          this.browser.capability.revoke(launchToken)
          if (this.browserToken === launchToken) this.browserToken = undefined
          if (this.rpc !== rpc) return
          this.rpc = undefined
          this.addOp({ kind: 'event', event: { type: 'runtime_exit', code } })
          this.uiQueue = []
          this.post({ type: 'extensionUi', request: null })
          this.update({ status: 'exited', isStreaming: false, error: `Pi stopped${code === null ? '' : ` (exit code ${code})`}.${stderr ? `\n${stderr.split('\n').slice(-6).join('\n')}` : ''}` })
        },
        environment,
      )
    } catch (error) {
      this.browser.capability.revoke(launchToken)
      if (this.browserToken === launchToken) this.browserToken = undefined
      this.update({ status: 'exited', error: error instanceof Error ? error.message : String(error) })
      return
    }
    this.rpc = rpc
    void this.refreshAll().then(
      () => {
        if (this.rpc === rpc) this.update({ status: 'ready' })
      },
      (error) => this.notice(`Could not read Pi's state: ${error instanceof Error ? error.message : String(error)}`),
    )
  }

  dispose() {
    ++this.launchGeneration
    void this.browser.stop()
    this.rpc?.dispose()
    this.rpc = undefined
    this.statusItem.dispose()
    clearTimeout(this.flushTimer)
  }

  /** Sent when a webview (re)loads so it can rebuild the transcript from scratch. */
  replay() {
    this.flushOps()
    this.post({ type: 'reset', ops: this.ops })
    this.post({ type: 'state', state: this.state })
    this.post({ type: 'extensionUi', request: this.uiQueue[0] ?? null })
    this.postBrowser()
    this.post({ type: 'sessions:current', path: this.currentPath })
  }

  async handle(message: WebviewMessage) {
    switch (message.type) {
      case 'sessions:list': {
        try {
          this.post({ type: 'sessions:list', requestId: message.requestId, sessions: await listSessions(this.cwd), currentPath: this.currentPath })
        } catch (error) {
          this.post({ type: 'sessions:list', requestId: message.requestId, sessions: [], currentPath: this.currentPath, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      case 'sessions:switch': {
        try {
          await this.switchSession(message.path)
          this.post({ type: 'sessions:switch', requestId: message.requestId })
        } catch (error) {
          this.post({ type: 'sessions:switch', requestId: message.requestId, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      case 'browserRequest': {
        try {
          const service = this.browser.service
          let result: unknown
          switch (message.method) {
            case 'state':
              result = service.state()
              break
            case 'getExtensionStatus':
              result = service.getExtensionStatus()
              break
            case 'setActiveSession':
              result = await service.setActiveSession(this.browserSessionKey)
              break
            case 'setTabPaused':
              result = await service.setTabPaused(this.browserSessionKey, message.tabId ?? '', message.paused)
              break
            case 'focusExtensionTab':
            case 'popOutTab':
              result = await service.focusExtensionTab(this.browserSessionKey, message.tabId ?? '')
              break
          }
          this.post({ type: 'browserResponse', requestId: message.requestId, result })
        } catch (error) {
          this.post({ type: 'browserResponse', requestId: message.requestId, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      case 'ready':
        return this.replay()
      case 'send':
        return this.send(message.text, message.images, message.intent)
      case 'stop':
        return this.stop()
      case 'sendQueued': {
        if (this.switching || !this.rpc) return this.notice('Cannot send a queued message while switching sessions or Pi is not running.')
        const queued = this.state.queued.find((item) => item.id === message.id)
        if (!queued) return
        this.update({ queued: this.state.queued.filter((item) => item.id !== message.id) })
        return this.send(queued.text, queued.images ?? [], 'steer', queued.editorContext)
      }
      case 'removeQueued':
        return this.update({ queued: this.state.queued.filter((item) => item.id !== message.id) })
      case 'setModel':
        return this.setModel(message.key)
      case 'setThinking':
        return this.guard(async () => {
          await this.rpc?.command('set_thinking_level', { level: message.level })
          this.update({ thinkingLevel: message.level })
        })
      case 'extensionUiResponse':
        return this.respondToUi(message.id, message.response)
      case 'command':
        return this.runCommand(message.action)
      case 'listFiles':
        return this.listFiles(message.requestId)
      case 'openExternal':
        if (/^(https?:|mailto:)/i.test(message.url)) void vscode.env.openExternal(vscode.Uri.parse(message.url))
        return
    }
  }

  async switchSession(path: string) {
    if (!this.rpc || this.state.status !== 'ready' || this.state.isStreaming || this.switching) throw new Error('Cannot switch sessions while Pi is starting, busy, or not running.')
    const rpc = this.rpc
    this.switching = true
    const wasPaused = this.queuePaused
    this.queuePaused = true
    try {
      const target = canonicalSessionPath(path)
      if (!target.endsWith('.jsonl') || dirname(target) !== canonicalSessionPath(sessionBucket(this.cwd))) throw new Error('Session is not in the current workspace catalog.')
      const metadata = await createPiSessionMetadataReader()(target)
      if (!metadata.projectPath || canonicalSessionPath(metadata.projectPath) !== canonicalSessionPath(this.cwd)) throw new Error('Session belongs to a different workspace.')
      const ops = await sessionTranscriptOps(target)
      if (this.rpc !== rpc || this.state.isStreaming || this.state.status !== 'ready') throw new Error('Cannot switch sessions while Pi is starting, busy, or not running.')
      const runtimeState = await rpc.command<Json>('get_state')
      if (runtimeState.isStreaming === true || runtimeState.isCompacting === true) throw new Error('Cannot switch sessions while Pi is busy.')
      const result = await rpc.command<Json>('switch_session', { sessionPath: target })
      if (this.rpc !== rpc) throw new Error('Pi restarted while switching sessions.')
      if (result.cancelled === true) throw new Error('An extension kept the current session open.')
      this.resetTranscript()
      for (const op of ops) {
        if (op.kind === 'event') this.appendEvent(op.event)
        else this.addOp(op)
      }
      this.flushOps()
      this.setCurrentPath(target)
      this.uiQueue = []
      this.post({ type: 'extensionUi', request: null })
      this.update({ queued: [], isStreaming: false, sessionName: undefined, contextUsage: undefined, sessionUsage: undefined })
      await this.refreshAll()
    } finally {
      this.switching = false
      this.queuePaused = wasPaused
    }
  }

  private setCurrentPath(path: string | null) {
    if (path === this.currentPath) return
    this.currentPath = path
    this.post({ type: 'sessions:current', path })
  }

  async newSession() {
    if (this.switching) {
      this.notice('Cannot create a session while switching sessions.')
      return
    }
    if (!this.rpc) return this.start()
    // Hold the local queue first: pi settles before abort responds, which would otherwise send the next queued prompt into the outgoing session.
    this.queuePaused = true
    await this.guard(async () => {
      if (this.state.isStreaming) await this.abortRun()
      const result = await this.rpc?.command<Json>('new_session')
      if (result?.cancelled === true) {
        this.notice('An extension kept the current session open.')
        return
      }
      this.resetTranscript()
      this.queuePaused = false
      this.update({ queued: [], isStreaming: false, sessionName: undefined, contextUsage: undefined, sessionUsage: undefined })
      await this.refreshAll()
    })
  }

  async stop() {
    if (!this.rpc || !this.state.isStreaming) return
    // Queued messages stay visible but wait for the user's next run instead of firing right after an abort.
    this.queuePaused = this.state.queued.length > 0
    await this.guard(() => this.abortRun())
  }

  /** abort alone would go on to deliver steers/follow-ups pi already holds, so clear them first and say what was dropped. */
  private async abortRun() {
    const rpc = this.rpc
    if (!rpc) return
    const cleared = await rpc.command<Json>('clear_queue').catch(() => undefined)
    await rpc.command('abort')
    const dropped = [...(Array.isArray(cleared?.steering) ? cleared.steering : []), ...(Array.isArray(cleared?.followUp) ? cleared.followUp : [])].filter(
      (text): text is string => typeof text === 'string',
    )
    if (dropped.length) this.notice(`Stopped before delivering:\n${dropped.map((text) => `• ${text}`).join('\n')}`)
  }

  private async send(text: string, images: PromptImage[], intent: 'queue' | 'steer', editorContext = editorPromptContext()) {
    if (this.switching) {
      this.notice('Cannot send a prompt while switching sessions.')
      return
    }
    const rpc = this.rpc
    if (!rpc) {
      this.notice('Pi is not running. Use Restart Pi to start it again.')
      return
    }
    const imagePayload = images.length ? { images } : {}
    if (this.state.isStreaming) {
      if (this.isExtensionCommand(text)) {
        await this.guard(() => rpc.command('prompt', { message: text }))
        return
      }
      // The Composer's queue actions resend text only, so prompts with images go to pi's own follow-up queue.
      if (intent === 'queue' && !images.length) {
        const queued: QueuedPrompt = { id: `queued-${++this.seq}`, text, intent, timestamp: Date.now(), editorContext }
        this.update({ queued: [...this.state.queued, queued] })
        return
      }
      this.addOp({ kind: 'user', id: `user-${++this.seq}`, text, ...imagePayload, timestamp: Date.now(), startAssistant: false })
      await this.guard(() => rpc.command('prompt', { message: text + editorContext, streamingBehavior: intent === 'steer' ? 'steer' : 'followUp', ...imagePayload }))
      return
    }
    this.queuePaused = false
    this.runStarted = false
    const token = ++this.promptToken
    this.addOp({ kind: 'user', id: `user-${++this.seq}`, text, ...imagePayload, timestamp: Date.now(), startAssistant: true })
    this.update({ isStreaming: true })
    try {
      const response = await rpc.command<Json>('prompt', { message: this.isExtensionCommand(text) ? text : text + editorContext, ...imagePayload })
      if (response?.disposition === 'handled' && token === this.promptToken) this.endOptimisticRun()
    } catch (error) {
      if (token !== this.promptToken) return
      this.endOptimisticRun()
      this.notice(error instanceof Error ? error.message : String(error))
    }
  }

  /** A prompt that started no run (handled command or rejection) leaves an empty placeholder to drop. */
  private endOptimisticRun() {
    if (this.runStarted) return
    this.addOp({ kind: 'event', event: { type: 'apex_drop_empty_assistant' } })
    this.update({ isStreaming: false })
    this.flushQueue()
  }

  private isExtensionCommand(text: string) {
    if (!text.startsWith('/')) return false
    const name = text.slice(1).split(/\s/, 1)[0]
    return this.state.commands.some((command) => command.source === 'extension' && command.name === name)
  }

  private async setModel(key: string) {
    const model = this.state.models.find((candidate) => candidate.key === key)
    if (!model) return
    await this.guard(async () => {
      await this.rpc?.command('set_model', { provider: model.provider, modelId: model.id })
      this.update({ model: key })
      await this.refreshThinking()
    })
  }

  private async runCommand(action: { type: string; [key: string]: unknown }) {
    switch (action.type) {
      case 'new':
        return this.newSession()
      case 'restart':
        return this.start()
      case 'name': {
        const title = asString(action.title)?.trim()
        if (title)
          await this.guard(async () => {
            await this.rpc?.command('set_session_name', { name: title })
            this.update({ sessionName: title })
          })
        return
      }
      case 'copy':
        return this.guard(async () => {
          const data = await this.rpc?.command<Json>('get_last_assistant_text')
          const text = asString(data?.text)
          if (text) {
            await vscode.env.clipboard.writeText(text)
            void vscode.window.setStatusBarMessage('Apex: copied the last response', 2500)
          }
        })
      case 'session':
        return this.guard(async () => {
          const stats = await this.rpc?.command<Json>('get_session_stats')
          void vscode.window.showInformationMessage(`Apex session ${asString(stats?.sessionId) ?? ''}`, { modal: false, detail: asString(stats?.sessionFile) })
        })
      case 'settings':
        return void vscode.commands.executeCommand('workbench.action.openSettings', 'apex')
      case 'resume':
        return this.notice('Resuming other sessions is not available in Apex for VS Code yet. Open the session in the Apex desktop app.')
    }
  }

  private async listFiles(requestId: number) {
    const uris = await vscode.workspace.findFiles('**/*', undefined, 5000)
    const root = this.cwd
    const files = new Set<string>()
    const dirs = new Set<string>()
    for (const uri of uris) {
      const relative = vscode.workspace.asRelativePath(uri, false).replaceAll('\\', '/')
      if (relative.startsWith('/') || /^[a-z]:/i.test(relative) || !uri.fsPath.startsWith(root)) continue
      files.add(relative)
      const segments = relative.split('/')
      for (let depth = 1; depth < segments.length; depth += 1) dirs.add(segments.slice(0, depth).join('/'))
    }
    this.post({
      type: 'files',
      requestId,
      entries: [...[...dirs].sort().map((path) => ({ path, type: 'directory' as const })), ...[...files].sort().map((path) => ({ path, type: 'file' as const }))],
    })
  }

  private respondToUi(id: string, response: Json) {
    this.rpc?.respondToUi(id, response)
    this.uiQueue = this.uiQueue.filter((request) => request.id !== id)
    this.post({ type: 'extensionUi', request: this.uiQueue[0] ?? null })
  }

  private onRecord(record: Json) {
    const type = asString(record.type)
    if (type === 'extension_ui_request') return this.onExtensionUi(record)
    if (type === 'agent_start') {
      this.runStarted = true
      this.update({ isStreaming: true })
    }
    if (type === 'agent_settled') {
      this.update({ isStreaming: false })
      void this.refreshStats()
      void this.guard(() => this.refreshState())
      this.flushQueue()
    }
    if (type === 'model_change') void this.guard(() => this.refreshState())
    if (type && TRANSCRIPT_EVENTS.has(type)) this.appendEvent(record)
  }

  private onExtensionUi(record: Json) {
    const method = asString(record.method)
    if (method && DIALOG_METHODS.has(method)) {
      this.uiQueue.push(record)
      if (this.uiQueue.length === 1) this.post({ type: 'extensionUi', request: record })
      return
    }
    if (method === 'notify') {
      const text = asString(record.message) ?? ''
      const kind = asString(record.notifyType)
      if (kind === 'error') void vscode.window.showErrorMessage(text)
      else if (kind === 'warning') void vscode.window.showWarningMessage(text)
      else vscode.window.setStatusBarMessage(`Apex: ${text}`, 6000)
    } else if (method === 'setStatus') {
      const key = asString(record.statusKey) ?? 'default'
      const text = asString(record.statusText)
      if (text) this.statuses.set(key, text)
      else this.statuses.delete(key)
      this.statusItem.text = [...this.statuses.values()].join('  ')
      if (this.statuses.size) this.statusItem.show()
      else this.statusItem.hide()
    }
  }

  /** Strip each delta to the fields the reducer reads and coalesce runs so the replay log stays small. */
  private appendEvent(record: Json) {
    if (record.type === 'message_update') {
      const delta = asRecord(record.assistantMessageEvent)
      const deltaType = asString(delta?.type)
      if (deltaType === 'text_delta' || deltaType === 'thinking_delta') {
        const text = asString(delta?.delta) ?? ''
        const last = this.pendingOps.at(-1)
        const lastDelta = last?.kind === 'event' && last.event.type === 'message_update' ? asRecord(last.event.assistantMessageEvent) : undefined
        if (lastDelta?.type === deltaType) {
          lastDelta.delta = String(lastDelta.delta) + text
          this.scheduleFlush()
          return
        }
        return this.addOp({ kind: 'event', event: { type: 'message_update', assistantMessageEvent: { type: deltaType, delta: text } } })
      }
      if (deltaType === 'toolcall_end') return this.addOp({ kind: 'event', event: { type: 'message_update', assistantMessageEvent: { type: deltaType, toolCall: delta?.toolCall } } })
      return
    }
    if (record.type === 'tool_execution_update') {
      // Each update carries the whole partial result, so only the latest per call matters.
      const id = asString(record.toolCallId)
      const index = id ? this.latestToolUpdate.get(id) : undefined
      const superseded: TranscriptOp = { kind: 'event', event: { type: 'apex_noop' } }
      if (index !== undefined && index < this.ops.length) this.ops[index] = superseded
      else if (index !== undefined) this.pendingOps[index - this.ops.length] = superseded
      if (id) this.latestToolUpdate.set(id, this.ops.length + this.pendingOps.length)
      return this.addOp({ kind: 'event', event: record })
    }
    this.addOp({ kind: 'event', event: record })
  }

  private addOp(op: TranscriptOp) {
    // Superseding is only safe while the tool's assistant row is still the live one.
    if (op.kind !== 'event' || !SAME_SEGMENT_EVENTS.has(String(op.event.type))) this.latestToolUpdate.clear()
    this.pendingOps.push(op)
    this.scheduleFlush()
  }

  private scheduleFlush() {
    this.flushTimer ??= setTimeout(() => this.flushOps(), 16)
  }

  private flushOps() {
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    if (!this.pendingOps.length) return
    const ops = this.pendingOps
    this.pendingOps = []
    this.ops.push(...ops)
    this.post({ type: 'ops', ops })
  }

  private resetTranscript() {
    this.promptToken += 1
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    this.ops = []
    this.pendingOps = []
    this.latestToolUpdate.clear()
    this.post({ type: 'reset', ops: [] })
  }

  private notice(text: string) {
    this.addOp({ kind: 'notice', id: `notice-${++this.seq}`, text, timestamp: Date.now() })
  }

  private flushQueue() {
    if (this.queuePaused || !this.state.queued.length) return
    const [next, ...rest] = this.state.queued
    this.update({ queued: rest })
    void this.send(next.text, next.images ?? [], 'queue', next.editorContext)
  }

  private async guard(action: () => Promise<unknown>) {
    try {
      await action()
    } catch (error) {
      this.notice(error instanceof Error ? error.message : String(error))
    }
  }

  private async refreshAll() {
    const rpc = this.rpc
    if (!rpc) return
    const [models, commands] = await Promise.all([rpc.command<Json>('get_available_models'), rpc.command<Json>('get_commands').catch(() => ({ commands: [] }))])
    const descriptors = (Array.isArray(models?.models) ? models.models : []).map((model) => describeModel(model as Json))
    const runtimeCommands: RuntimeCommand[] = (Array.isArray(commands?.commands) ? commands.commands : []).flatMap((value) => {
      const command = value as Json
      const name = asString(command.name)
      const source = command.source
      return name && (source === 'extension' || source === 'prompt' || source === 'skill') ? [{ name, description: asString(command.description), source }] : []
    })
    this.update({ models: descriptors, providers: describeProviders(descriptors), commands: runtimeCommands })
    await Promise.all([this.refreshState(), this.refreshThinking(), this.refreshStats()])
  }

  private async refreshState() {
    const state = await this.rpc?.command<Json>('get_state')
    const model = asRecord(state?.model)
    this.setCurrentPath(asString(state?.sessionFile) ? canonicalSessionPath(String(state?.sessionFile)) : null)
    this.update({
      model: model ? `${String(model.provider)}/${String(model.id)}` : undefined,
      thinkingLevel: (asString(state?.thinkingLevel) as ThinkingLevel | undefined) ?? 'off',
      sessionName: asString(state?.sessionName),
    })
  }

  private async refreshThinking() {
    const data = await this.rpc?.command<Json>('get_available_thinking_levels')
    const levels = Array.isArray(data?.levels) ? (data.levels as ThinkingLevel[]) : ['off' as const]
    const models = this.state.models.map((model) => (model.key === this.state.model ? { ...model, availableThinkingLevels: levels } : model))
    this.update({ thinkingLevels: levels, models })
  }

  private async refreshStats() {
    const stats = await this.rpc?.command<Json>('get_session_stats').catch(() => undefined)
    if (!stats) return
    const usage = asRecord(stats.contextUsage)
    const tokens = asRecord(stats.tokens)
    this.update({
      contextUsage: usage
        ? { tokens: typeof usage.tokens === 'number' ? usage.tokens : null, contextWindow: Number(usage.contextWindow) || 0, percent: typeof usage.percent === 'number' ? usage.percent : null }
        : undefined,
      sessionUsage: {
        cost: typeof stats.cost === 'number' ? stats.cost : null,
        ...(tokens
          ? {
              tokens: {
                input: Number(tokens.input) || 0,
                output: Number(tokens.output) || 0,
                cacheRead: Number(tokens.cacheRead) || 0,
                cacheWrite: Number(tokens.cacheWrite) || 0,
                total: Number(tokens.total) || 0,
              },
            }
          : {}),
      },
    })
  }

  private update(patch: Partial<HostState>) {
    this.state = { ...this.state, ...patch }
    this.post({ type: 'state', state: this.state })
  }
}
