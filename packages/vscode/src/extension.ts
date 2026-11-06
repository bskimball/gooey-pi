import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import { ApexSession } from './apex-session'
import { AgentPresence } from './agent-presence'
import { editorFileContext } from './editor'
import { DiagnosticActions, FIX_DIAGNOSTIC_COMMAND, selectionDraft } from './editor-commands'
import { GitStatusSource } from './git-source'
import type { HostMessage, WebviewMessage } from './protocol'

class ApexViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined
  readonly session: ApexSession
  readonly presence = new AgentPresence()
  private started = false
  private ready = false
  private readonly pendingDrafts: string[] = []
  readonly git = new GitStatusSource((git) => this.post({ type: 'git', git }))
  private resizeRequestId = 0
  private readonly resizeRequests = new Map<number, (data?: string) => void>()

  constructor(private readonly extensionUri: vscode.Uri) {
    this.session = new ApexSession((message) => this.post(message), vscode.Uri.joinPath(extensionUri, 'dist').fsPath,
      (dataUrl, width, height, quality) => this.resizeScreenshot(dataUrl, width, height, quality))
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view
    this.ready = false
    const root = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
    view.webview.options = { enableScripts: true, localResourceRoots: [root] }
    view.webview.html = this.html(view.webview, root)
    view.webview.onDidReceiveMessage((message: WebviewMessage) => {
      if (message.type === 'screenshotResized') this.resizeRequests.get(message.requestId)?.(message.data)
      else {
        if (message.type === 'ready') {
          this.ready = true
          this.postEditorContext()
          this.post({ type: 'git', git: this.git.current })
          if (this.pendingDrafts.length) this.post({ type: 'insertDraft', text: this.pendingDrafts.splice(0).join('\n\n') })
        }
        void this.session.handle(message)
      }
    })
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined
        this.ready = false
        for (const finish of this.resizeRequests.values()) finish()
      }
    })
    if (!this.started) {
      this.started = true
      this.session.start()
    }
  }

  postEditorContext() {
    this.post({ type: 'editorContext', file: editorFileContext() })
  }

  /** Adds text to the composer draft without sending; held until the webview has loaded. */
  insertDraft(text: string) {
    this.reveal()
    if (this.ready) this.post({ type: 'insertDraft', text })
    else this.pendingDrafts.push(text)
  }

  reveal() {
    if (this.view) this.view.show(false)
    else void vscode.commands.executeCommand('apex.chat.focus')
  }

  private resizeScreenshot(dataUrl: string, width: number, height: number, quality: number): Promise<string | undefined> {
    const view = this.view
    if (!view) return Promise.resolve(undefined)
    const requestId = ++this.resizeRequestId
    return new Promise(resolve => {
      const finish = (data?: string) => {
        if (!this.resizeRequests.delete(requestId)) return
        clearTimeout(timer)
        resolve(data)
      }
      const timer = setTimeout(() => finish(), 5000)
      this.resizeRequests.set(requestId, finish)
      void view.webview.postMessage({ type: 'resizeScreenshot', requestId, dataUrl, width, height, quality } satisfies HostMessage)
        .then(sent => { if (!sent) finish() }, () => finish())
    })
  }

  private post(message: HostMessage) {
    this.presence.observe(message)
    void this.view?.webview.postMessage(message)
  }

  private html(webview: vscode.Webview, root: vscode.Uri) {
    const nonce = randomBytes(16).toString('base64')
    const script = webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.js'))
    const style = webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.css'))
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data: https:`,
      `font-src ${webview.cspSource} data:`,
    ].join('; ')
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${style}">
  <title>Apex</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`
  }
}

/** VS Code already decoded the query. This URI has one parameter, whose value may contain '&' or '+'. */
export function sessionPathFromUri(uri: Pick<vscode.Uri, 'path' | 'query'>): string | null {
  return (uri.path === '/open' || uri.path === '/attach') && uri.query.startsWith('session=') ? uri.query.slice('session='.length) : null
}

let activeProvider: ApexViewProvider | undefined

export function activate(context: vscode.ExtensionContext) {
  const provider = new ApexViewProvider(context.extensionUri)
  activeProvider = provider
  void provider.git.start()
  context.subscriptions.push(
    provider.session,
    provider.presence,
    provider.git,
    vscode.window.onDidChangeActiveTextEditor(() => provider.postEditorContext()),
    vscode.window.onDidChangeTextEditorSelection(() => provider.postEditorContext()),
    vscode.workspace.onDidChangeTextDocument(() => provider.postEditorContext()),
    vscode.workspace.onDidSaveTextDocument(() => provider.postEditorContext()),
    vscode.workspace.onDidCloseTextDocument(() => provider.postEditorContext()),
    vscode.window.registerWebviewViewProvider('apex.chat', provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('apex.open', () => provider.reveal()),
    vscode.commands.registerCommand('apex.newSession', () => provider.session.newSession()),
    vscode.commands.registerCommand('apex.stop', () => provider.session.stop()),
    vscode.commands.registerCommand('apex.restart', () => provider.session.start()),
    vscode.commands.registerCommand('apex.continueInDesktop', () => provider.session.continueInDesktop()),
    vscode.commands.registerCommand('apex.askAboutSelection', () => {
      const draft = selectionDraft()
      if (draft) provider.insertDraft(draft)
      else void vscode.window.showInformationMessage('Apex: select some text in the editor first.')
    }),
    vscode.commands.registerCommand(FIX_DIAGNOSTIC_COMMAND, (draft: unknown) => { if (typeof draft === 'string') provider.insertDraft(draft) }),
    vscode.languages.registerCodeActionsProvider([{ scheme: 'file' }, { scheme: 'untitled' }], new DiagnosticActions(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    // /attach preserves Desktop ownership; /open transfers a released session to this editor.
    vscode.window.registerUriHandler({
      handleUri(uri) {
        const session = sessionPathFromUri(uri)
        if (!session) return
        provider.reveal()
        void provider.session.openFromDesktop(session, uri.path === '/attach')
      },
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('apex.piPath')) void vscode.window.showInformationMessage('Apex: restart Pi to use the new pi path.', 'Restart Pi').then((choice) => { if (choice) provider.session.start() })
    }),
  )
}

export function deactivate() {
  return activeProvider?.session.dispose()
}
