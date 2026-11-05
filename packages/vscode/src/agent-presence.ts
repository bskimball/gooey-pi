import { isAbsolute, resolve } from 'node:path'
import * as vscode from 'vscode'
import { isPathWithin, isRecord } from 'apex-core/validation'
import type { MessagePart } from 'apex-core/types/api'
import type { HostMessage } from './protocol'

type Activity = { uri: vscode.Uri; actor: string; tool: string; line?: number; active: boolean; stale: boolean }

/** Advisory evidence from tool calls, not locks, inferred AST ownership, or compiler diagnostics. */
export class AgentPresence implements vscode.Disposable, vscode.CodeLensProvider, vscode.FileDecorationProvider {
  private readonly activities = new Map<string, Activity>()
  private readonly calls = new Map<string, { name: string; args: Record<string, unknown> }>()
  private readonly workers = new Map<string, string>()
  private readonly change = new vscode.EventEmitter<vscode.Uri[]>()
  private readonly lenses = new vscode.EventEmitter<void>()
  readonly onDidChangeFileDecorations = this.change.event
  readonly onDidChangeCodeLenses = this.lenses.event
  private readonly rail = vscode.window.createTextEditorDecorationType({ isWholeLine: true, borderWidth: '0 0 0 2px', borderStyle: 'solid', borderColor: new vscode.ThemeColor('editorInfo.foreground'), rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed })
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49)
  private readonly disposables: vscode.Disposable[]
  private cwd = ''

  constructor() {
    this.status.name = 'Apex session connection'
    this.status.command = 'apex.open'
    this.disposables = [
      vscode.window.registerFileDecorationProvider(this),
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, this),
      vscode.window.onDidChangeVisibleTextEditors(() => this.render()),
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        const activity = this.activities.get(document.uri.toString())
        if (activity) { activity.stale = true; this.render() }
      }),
    ]
  }

  observe(message: HostMessage) {
    if (message.type === 'state') {
      this.cwd = message.state.cwd ?? this.cwd
      this.status.text = message.state.connection === 'desktop' ? '$(link) Apex · Desktop' : '$(hubot) Apex · Local'
      this.status.tooltip = message.state.status === 'exited' ? message.state.error ?? 'Disconnected' : 'Agent activity is advisory. Your editor remains editable.'
      if (message.state.status === 'exited') { this.clear(); this.status.text = '$(debug-disconnect) Apex · Disconnected' }
      this.status.show()
    }
    if (message.type === 'reset') this.clear()
    if (message.type !== 'ops' && message.type !== 'reset') return
    for (const op of message.ops) {
      if (op.kind === 'saved') for (const part of op.message.parts) this.part(part, op.message.streaming === true)
      if (op.kind === 'event') this.event(op.event)
    }
    while (this.calls.size > 500) this.calls.delete(this.calls.keys().next().value!)
    this.render()
  }

  private part(part: MessagePart, live: boolean) {
    if (part.type === 'toolCall' && isRecord(part.args)) {
      this.calls.set(part.id ?? part.name, { name: part.name, args: part.args })
      this.record('Apex', part.name, part.args, live)
    }
    if (part.type === 'toolResult') {
      const call = [...this.calls.values()].reverse().find((item) => item.name === part.name)
      if (call) this.record('Apex', call.name, call.args, part.streaming === true)
      this.result(part.name ?? '', part.details, call?.args)
    }
  }

  private event(event: Record<string, unknown>) {
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : String(event.toolName)
    if (event.type === 'tool_execution_start' && typeof event.toolName === 'string' && isRecord(event.args)) {
      this.calls.set(id, { name: event.toolName, args: event.args })
      this.record('Apex', event.toolName, event.args, true)
    }
    if (event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
      const call = this.calls.get(id)
      if (call && event.type === 'tool_execution_end') this.record('Apex', call.name, call.args, false)
      const result = isRecord(event.result) ? event.result : isRecord(event.partialResult) ? event.partialResult : undefined
      this.result(call?.name ?? String(event.toolName), result?.details, call?.args)
    }
    if (event.type === 'agent_end' || event.type === 'agent_settled') for (const activity of this.activities.values()) activity.active = false
  }

  private result(tool: string, details: unknown, args?: Record<string, unknown>) {
    if (!isRecord(details)) return
    const worker = isRecord(details.worker) ? details.worker : details
    const id = typeof worker.id === 'string' ? worker.id : typeof args?.id === 'string' ? args.id : undefined
    const agent = typeof worker.agent === 'string' ? worker.agent : typeof args?.agent === 'string' ? args.agent : id ? this.workers.get(id) : undefined
    if (id && agent) this.workers.set(id, agent)
    if (!agent || !Array.isArray(worker.activities)) return
    for (const raw of worker.activities) {
      if (!isRecord(raw) || typeof raw.tool !== 'string') continue
      let input: unknown = raw.args
      if (typeof input !== 'object' && typeof raw.summary === 'string' && raw.summary.trim().startsWith('{')) {
        try { input = JSON.parse(raw.summary) } catch { continue }
      }
      if (isRecord(input)) this.record(agent, raw.tool, input, raw.status === 'running')
    }
    if (tool === 'task_close' || tool === 'task_abort') for (const activity of this.activities.values()) if (activity.actor === agent) activity.active = false
  }

  private record(actor: string, tool: string, args: Record<string, unknown>, active: boolean) {
    if (!this.cwd || !['read', 'edit', 'write', 'editor_read', 'editor_open', 'lsp'].includes(tool)) return
    const rawPath = typeof args.path === 'string' ? args.path : typeof args.uri === 'string' ? args.uri : undefined
    if (!rawPath) return
    const uri = rawPath.startsWith('file:') ? vscode.Uri.parse(rawPath) : vscode.Uri.file(isAbsolute(rawPath) ? rawPath : resolve(this.cwd, rawPath))
    if (uri.scheme !== 'file' || !isPathWithin(this.cwd, uri.fsPath)) return
    const position = typeof args.line === 'number' ? args.line : tool === 'read' && typeof args.offset === 'number' ? args.offset : undefined
    const line = position !== undefined && Number.isSafeInteger(position) && position > 0 ? position - 1 : undefined
    this.activities.set(uri.toString(), { uri, actor, tool, line, active, stale: false })
    if (this.activities.size > 100) {
      const first = this.activities.keys().next().value!
      const removed = this.activities.get(first)!
      this.activities.delete(first)
      this.change.fire([removed.uri])
    }
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const activity = this.activities.get(uri.toString())
    return activity ? { badge: activity.active ? 'A' : '·', tooltip: this.label(activity), propagate: false } : undefined
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const activity = this.activities.get(document.uri.toString())
    if (!activity) return []
    const line = activity.stale || document.isDirty ? 0 : Math.min(activity.line ?? 0, document.lineCount - 1)
    return [new vscode.CodeLens(new vscode.Range(line, 0, line, 0), { title: this.label(activity), command: 'apex.open' })]
  }

  private label(activity: Activity): string {
    return `${activity.actor} · ${activity.tool}${activity.active ? ' running' : ' observed'}${activity.stale ? ' · buffer changed' : ''} · advisory, not a lock`
  }
  private render() {
    for (const editor of vscode.window.visibleTextEditors) {
      const activity = this.activities.get(editor.document.uri.toString())
      editor.setDecorations(this.rail, activity?.active && activity.line !== undefined && !activity.stale && !editor.document.isDirty && activity.line < editor.document.lineCount
        ? [{ range: new vscode.Range(activity.line, 0, activity.line, 0), hoverMessage: this.label(activity) }] : [])
    }
    this.change.fire([...this.activities.values()].map((activity) => activity.uri))
    this.lenses.fire()
  }
  private clear() { const uris = [...this.activities.values()].map((activity) => activity.uri); this.activities.clear(); this.calls.clear(); this.workers.clear(); this.change.fire(uris); this.render() }
  dispose() { this.clear(); this.disposables.forEach((item) => item.dispose()); this.change.dispose(); this.lenses.dispose(); this.rail.dispose(); this.status.dispose() }
}
