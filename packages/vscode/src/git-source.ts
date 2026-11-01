import * as vscode from 'vscode'
import type { GitStatus } from 'apex-core/types/api'
import { gitStatusFromRepository, type GitApi, type GitExtensionExports } from './git-status'

const DEBOUNCE_MS = 300
const NO_GIT: GitStatus = { isRepo: false, files: [] }

/** Mirrors the built-in vscode.git extension's view of the workspace repository. Never spawns git itself. */
export class GitStatusSource implements vscode.Disposable {
  current: GitStatus = NO_GIT
  private readonly subscriptions: vscode.Disposable[] = []
  private repositorySubscription: vscode.Disposable | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private api: GitApi | undefined

  constructor(private readonly onChange: (status: GitStatus) => void) {
    // Enabling or disabling the git extension changes the extension list; retry until its API is available.
    this.subscriptions.push(vscode.extensions.onDidChange(() => { if (!this.api) void this.start() }))
  }

  async start() {
    if (this.api) return
    try {
      const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git')
      if (!extension) return
      const api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1)
      if (this.api) return
      this.api = api
      this.subscriptions.push(
        api.onDidOpenRepository(() => this.bind(api)),
        api.onDidCloseRepository(() => this.bind(api)),
        api.onDidChangeState(() => this.bind(api)),
        vscode.workspace.onDidChangeWorkspaceFolders(() => this.bind(api)),
      )
      this.bind(api)
    } catch {
      // The git extension is disabled or not ready; the workspace is treated as having no repository.
    }
  }

  private bind(api: GitApi) {
    this.repositorySubscription?.dispose()
    this.repositorySubscription = undefined
    clearTimeout(this.timer)
    const folder = vscode.workspace.workspaceFolders?.[0]
    const repository = folder ? api.getRepository(folder.uri) : null
    if (!repository) return this.publish(NO_GIT)
    this.repositorySubscription = repository.state.onDidChange(() => {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.publish(gitStatusFromRepository(repository, path => vscode.workspace.asRelativePath(path, false))), DEBOUNCE_MS)
    })
    this.publish(gitStatusFromRepository(repository, path => vscode.workspace.asRelativePath(path, false)))
  }

  private publish(status: GitStatus) {
    if (JSON.stringify(status) === JSON.stringify(this.current)) return
    this.current = status
    this.onChange(status)
  }

  dispose() {
    clearTimeout(this.timer)
    this.repositorySubscription?.dispose()
    for (const subscription of this.subscriptions) subscription.dispose()
  }
}
