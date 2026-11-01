import type { GitFileChange, GitStatus } from 'apex-core/types/api'

export const GIT_ENTRY_LIMIT = 1000

/** The slice of the built-in `vscode.git` extension API (version 1) that Apex reads. */
export interface GitChange { uri: { fsPath: string }; status: number }
export interface GitRepository {
  rootUri: { fsPath: string }
  state: {
    HEAD?: { name?: string }
    indexChanges: GitChange[]
    workingTreeChanges: GitChange[]
    mergeChanges: GitChange[]
    untrackedChanges?: GitChange[]
    onDidChange(listener: () => void): { dispose(): void }
  }
}
export interface GitApi {
  readonly state: 'uninitialized' | 'initialized'
  onDidChangeState(listener: (state: 'uninitialized' | 'initialized') => void): { dispose(): void }
  onDidOpenRepository(listener: (repository: GitRepository) => void): { dispose(): void }
  onDidCloseRepository(listener: (repository: GitRepository) => void): { dispose(): void }
  getRepository(uri: { fsPath: string }): GitRepository | null
}
export interface GitExtensionExports { getAPI(version: 1): GitApi }

/** Porcelain-style codes, from the `Status` enum of the vscode.git API. Ignored entries map to undefined. */
const STATUS_CODES: Record<number, string | undefined> = {
  0: 'M', 1: 'A', 2: 'D', 3: 'R', 4: 'C', 5: 'M', 6: 'D', 7: '??', 8: undefined, 9: 'A', 10: 'R', 11: 'T',
  12: 'U', 13: 'U', 14: 'U', 15: 'U', 16: 'U', 17: 'U', 18: 'U',
}

/** Counts are unavailable from the git extension, so they stay 0 and `lineCounts` is false. */
export function gitStatusFromRepository(repository: GitRepository, relativePath: (fsPath: string) => string): GitStatus {
  const files: GitFileChange[] = []
  let truncated = false
  const add = (changes: GitChange[], staged: boolean) => {
    for (const change of changes) {
      const status = STATUS_CODES[change.status]
      if (!status) continue
      if (files.length >= GIT_ENTRY_LIMIT) { truncated = true; return }
      files.push({ path: relativePath(change.uri.fsPath), status, staged, additions: 0, deletions: 0 })
    }
  }
  add(repository.state.indexChanges, true)
  add(repository.state.mergeChanges, false)
  add(repository.state.workingTreeChanges, false)
  add(repository.state.untrackedChanges ?? [], false)
  const branch = repository.state.HEAD?.name
  return { isRepo: true, ...(branch ? { branch } : {}), files, ...(truncated ? { truncated } : {}), lineCounts: false }
}
