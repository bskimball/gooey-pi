import { homedir } from 'node:os'
import * as vscode from 'vscode'
import { connectDesktopSession, type DesktopSessionClient } from 'apex-core/sessions/desktop-link'
import { isRecord } from 'apex-core/validation'
import type { HostMessage, HostState, ModelDescriptor, WebviewMessage } from './protocol'
import { editorPromptContext, scopedEditorRequest } from './editor'

type Json = Record<string, unknown>
const levels: HostState['thinkingLevels'] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** A view of Desktop authority. Closing this view never aborts or takes ownership. */
export class AttachedSession {
  private client: DesktopSessionClient | undefined
  private dialogs: Json[] = []
  private ops: Extract<HostMessage, { type: 'reset' }>['ops'] = []
  private disposed = false
  private pendingOps: Extract<HostMessage, { type: 'ops' }>['ops'] = []
  private flushTimer: NodeJS.Timeout | undefined
  private refreshPending: Promise<void> | undefined
  private state: HostState

  constructor(readonly path: string, private readonly cwd: string, private readonly post: (message: HostMessage) => void) {
    this.state = { status: 'starting', connection: 'desktop', homeDir: homedir(), cwd, isStreaming: false, thinkingLevel: 'off', thinkingLevels: ['off'], models: [], providers: [], commands: [], statuses: {}, queued: [], messageEnterAction: vscode.workspace.getConfiguration('apex').get('messageEnterAction', 'queue') }
  }

  async connect(): Promise<boolean> {
    const client = await connectDesktopSession({
      sessionPath: this.path, cwd: this.cwd,
      onEvent: (event) => this.onEvent(event),
      onDisconnect: (reason) => {
        if (this.disposed) return
        this.dialogs = []
        this.post({ type: 'extensionUi', request: null })
        this.update({ status: 'exited', isStreaming: false, error: `${reason} Reconnect to read the current state. Sent commands are not retried.` })
      },
      editorRequest: (method, params) => scopedEditorRequest(this.cwd, method, params),
    })
    if (!client) return false
    if (this.disposed) { await client.close(); return false }
    this.client = client
    const { runtime, messages, dialogs, statuses } = client.snapshot
    this.ops = messages.map((message) => ({ kind: 'saved', message }))
    this.dialogs = dialogs
    this.state = { ...this.state, status: 'ready', isStreaming: Boolean(runtime.isStreaming || runtime.isCompacting), statuses, pendingCount: runtime.sessionActions?.queuedCount ?? 0, contextUsage: runtime.contextUsage, sessionUsage: runtime.sessionUsage }
    this.replay()
    void this.refresh().catch((error: unknown) => this.notice(error))
    return true
  }

  get isConnected(): boolean { return this.state.status === 'ready' && !this.disposed }

  replay() {
    this.flush()
    this.post({ type: 'state', state: this.state })
    this.post({ type: 'reset', ops: this.ops })
    this.post({ type: 'sessions:current', path: this.path })
    this.post({ type: 'extensionUi', request: this.dialogs[0] ?? null })
  }

  async dispose() { this.disposed = true; clearTimeout(this.flushTimer); this.pendingOps = []; await this.client?.close() }

  private async command(command: Json): Promise<Json> {
    if (!this.client || this.state.status !== 'ready') throw new Error('Desktop is disconnected. Reconnect before sending commands.')
    const response = await this.client.command(command)
    return isRecord(response.data) ? response.data : {}
  }

  async handle(message: WebviewMessage): Promise<boolean> {
    try {
      switch (message.type) {
        case 'ready': this.replay(); return true
        case 'send': {
          const compact = /^\/compact(?:\s+([\s\S]*))?$/.exec(message.text.trim())
          if (compact) {
            if (message.images.length) throw new Error('/compact does not accept attachments.')
            if (this.state.isStreaming) throw new Error('Wait for the current run to finish before compacting.')
            await this.command({ type: 'compact', ...(compact[1] ? { customInstructions: compact[1] } : {}) })
          } else {
            const extensionCommand = message.text.startsWith('/') && this.state.commands.some((item) => item.source === 'extension' && item.name === message.text.slice(1).split(/\s/, 1)[0])
            const context = message.attachEditor === false || extensionCommand ? '' : editorPromptContext()
            await this.command({ type: 'attached_prompt', message: message.text + context, intent: message.intent, ...(message.images.length ? { images: message.images } : {}) })
            void this.refresh().catch((error: unknown) => this.notice(error))
          }
          return true
        }
        case 'stop': {
          const cleared = await this.command({ type: 'clear_queue' })
          await this.command({ type: 'abort' })
          const dropped = [...(Array.isArray(cleared.steering) ? cleared.steering : []), ...(Array.isArray(cleared.followUp) ? cleared.followUp : [])]
          if (dropped.length) this.notice(`Stopped; discarded ${dropped.length} pending prompt(s).`)
          return true
        }
        case 'setModel': {
          const model = this.state.models.find((item) => item.key === message.key)
          if (!model) throw new Error('That model is not available in Desktop.')
          await this.command({ type: 'set_model', provider: model.provider, modelId: model.id })
          await this.refresh()
          return true
        }
        case 'setThinking':
          await this.command({ type: 'set_thinking_level', level: message.level }); await this.refresh(); return true
        case 'extensionUiResponse':
          await this.command({ ...message.response, type: 'extension_ui_response', id: message.id }); return true
        case 'sendQueued': case 'removeQueued':
          throw new Error('Attached prompts are queued by Desktop, not this editor.')
        case 'command': {
          const action = message.action
          if (action.type === 'name' && typeof action.title === 'string') { await this.command({ type: 'set_session_name', name: action.title }); await this.refresh(); return true }
          if (action.type === 'copy') {
            const data = await this.command({ type: 'get_last_assistant_text' })
            if (typeof data.text === 'string') await vscode.env.clipboard.writeText(data.text)
            return true
          }
          if (action.type === 'session') { void vscode.window.showInformationMessage(`Apex Desktop owns this session: ${this.path}`); return true }
          return false
        }
        default: return false
      }
    } catch (error) { this.notice(error); return true }
  }

  private onEvent(event: Json) {
    if (this.disposed) return
    if (event.type === 'desktop_user_message' && isRecord(event.message) && typeof event.message.id === 'string' && Array.isArray(event.message.parts)) {
      const message = event.message as unknown as import('apex-core/types/api').TranscriptMessage
      this.addOps([{ kind: 'saved', message }])
      return
    }
    if (event.type === 'session_action_update' && isRecord(event.actions) && typeof event.actions.queuedCount === 'number') this.update({ pendingCount: event.actions.queuedCount })
    if (event.type === 'extension_ui_resolved') {
      this.dialogs = this.dialogs.filter((dialog) => dialog.id !== event.id)
      this.post({ type: 'extensionUi', request: this.dialogs[0] ?? null })
      return
    }
    if (event.type === 'extension_ui_request') {
      if (['select', 'confirm', 'input', 'editor'].includes(String(event.method))) {
        this.dialogs.push(event)
        this.post({ type: 'extensionUi', request: this.dialogs[0] ?? null })
      } else if (event.method === 'setStatus' && typeof event.statusKey === 'string') {
        const statuses = { ...this.state.statuses }
        if (typeof event.statusText === 'string') statuses[event.statusKey] = event.statusText
        else delete statuses[event.statusKey]
        this.update({ statuses })
      } else if (event.method === 'notify' && typeof event.message === 'string') this.notice(event.message)
      return
    }
    if (event.type === 'agent_start' || event.type === 'compaction_start' || event.type === 'auto_retry_start') this.update({ isStreaming: true })
    if (event.type === 'agent_settled' || event.type === 'agent_end') {
      this.update({ isStreaming: false })
      void this.refresh().catch((error: unknown) => this.notice(error))
    }
    if (event.type === 'compaction_end') this.update({ isStreaming: event.willRetry === true })
    if (event.type === 'model_change') void this.refresh().catch((error: unknown) => this.notice(error))
    if (event.type === 'message_update') {
      const delta = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : undefined
      if (delta?.type === 'text_delta' || delta?.type === 'thinking_delta') {
        const last = this.pendingOps.at(-1)
        const previous = last?.kind === 'event' && isRecord(last.event.assistantMessageEvent) ? last.event.assistantMessageEvent : undefined
        if (previous?.type === delta.type && typeof previous.delta === 'string' && typeof delta.delta === 'string') { previous.delta += delta.delta; return }
        this.addOps([{ kind: 'event', event: { type: 'message_update', assistantMessageEvent: { type: delta.type, delta: delta.delta } } }])
      } else if (delta?.type === 'toolcall_end') this.addOps([{ kind: 'event', event: { type: 'message_update', assistantMessageEvent: { type: delta.type, toolCall: delta.toolCall } } }])
      return
    }
    this.addOps([{ kind: 'event', event }])
  }

  private addOps(ops: Extract<HostMessage, { type: 'ops' }>['ops']) {
    this.pendingOps.push(...ops)
    this.flushTimer ??= setTimeout(() => this.flush(), 16)
  }
  private flush() {
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    if (!this.pendingOps.length || this.disposed) return
    const ops = this.pendingOps
    this.pendingOps = []
    this.ops.push(...ops)
    this.post({ type: 'ops', ops })
  }

  private refresh(): Promise<void> {
    this.refreshPending ??= this.refreshState().finally(() => { this.refreshPending = undefined })
    return this.refreshPending
  }

  private async refreshState() {
    const [state, available, commands, thinkingLevels, stats] = await Promise.all([
      this.command({ type: 'get_state' }), this.command({ type: 'get_available_models' }), this.command({ type: 'get_commands' }),
      this.command({ type: 'get_available_thinking_levels' }), this.command({ type: 'get_session_stats' }),
    ])
    if (this.disposed || this.state.status !== 'ready') return
    const models: ModelDescriptor[] = (Array.isArray(available.models) ? available.models : []).filter(isRecord).flatMap((model) => {
      if (typeof model.provider !== 'string' || typeof model.id !== 'string') return []
      return [{ key: `${model.provider}/${model.id}`, provider: model.provider, id: model.id, name: typeof model.name === 'string' ? model.name : model.id, reasoning: model.reasoning === true, input: Array.isArray(model.input) && model.input.includes('image') ? ['text', 'image'] : ['text'], contextWindow: Number(model.contextWindow) || 0, maxTokens: Number(model.maxTokens) || 0, availableThinkingLevels: model.reasoning === true ? levels : ['off'], fastModeSupported: false, available: true }]
    })
    const providerIds = [...new Set(models.map((model) => model.provider))]
    const model = isRecord(state.model) ? state.model : undefined
    const key = model ? `${String(model.provider)}/${String(model.id)}` : undefined
    const thinking = levels.find((level) => level === state.thinkingLevel) ?? 'off'
    const availableLevels = levels.filter((level) => Array.isArray(thinkingLevels.levels) && thinkingLevels.levels.includes(level))
    const usage = isRecord(stats.contextUsage) ? stats.contextUsage : undefined
    this.update({
      pendingCount: isRecord(state.sessionActions) && typeof state.sessionActions.queuedCount === 'number' ? state.sessionActions.queuedCount : this.state.pendingCount,
      models, model: key, thinkingLevel: thinking, thinkingLevels: availableLevels.length ? availableLevels : ['off'],
      ...(usage ? { contextUsage: { tokens: typeof usage.tokens === 'number' ? usage.tokens : null, contextWindow: Number(usage.contextWindow) || 0, percent: typeof usage.percent === 'number' ? usage.percent : null } } : {}),
      sessionUsage: { cost: typeof stats.cost === 'number' ? stats.cost : null },
      sessionName: typeof state.sessionName === 'string' ? state.sessionName : undefined,
      providers: providerIds.map((id) => ({ id, name: id, authMethod: 'external', configured: true, modelCount: models.filter((item) => item.provider === id).length, availableModelCount: models.filter((item) => item.provider === id).length, enabled: true })),
      commands: (Array.isArray(commands.commands) ? commands.commands : []).filter(isRecord).flatMap((command) => typeof command.name === 'string' && (command.source === 'extension' || command.source === 'prompt' || command.source === 'skill') ? [{ name: command.name, source: command.source, description: typeof command.description === 'string' ? command.description : undefined }] : []),
    })
  }

  private notice(error: unknown) {
    if (!this.disposed) this.addOps([{ kind: 'notice', id: `desktop-notice-${Date.now()}`, timestamp: Date.now(), text: error instanceof Error ? error.message : String(error) }])
  }
  private update(patch: Partial<HostState>) { this.state = { ...this.state, ...patch }; this.post({ type: 'state', state: this.state }) }
}
