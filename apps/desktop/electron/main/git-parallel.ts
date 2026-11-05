import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { commitIdentityOverrides, inspectGitWorktreeClean, listGitWorktrees, requireFilterFreeGit, requireProcessSuccess, runGit } from './git'

async function git(cwd: string, args: string[], indexFile?: string, input?: string, overrides: readonly string[] = []): Promise<string> {
  const result = await runGit(cwd, args, { timeoutMs: 120_000, maxBytes: 2 * 1024 * 1024, indexFile, input }, overrides)
  requireProcessSuccess(`Git ${args[0]}`, result)
  return result.stdout.trim()
}

export async function parallelHead(cwd: string, ref = 'HEAD'): Promise<string> {
  return git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
}

export async function parallelBranch(cwd: string): Promise<string> {
  return git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
}

export async function requireCleanParallelTarget(cwd: string, base: string, branch: string): Promise<void> {
  if (await parallelHead(cwd) !== base || await parallelBranch(cwd) !== branch) throw new Error('Target revision or branch changed. Create new alternatives from the current target.')
  if ((await inspectGitWorktreeClean(cwd)).kind !== 'clean') throw new Error('Target checkout must be clean. No files were changed.')
  await requireFilterFreeGit(cwd)
}

export async function createParallelWorktree(cwd: string, path: string, branch: string, base: string): Promise<void> {
  await requireFilterFreeGit(cwd)
  await git(cwd, ['worktree', 'add', '-b', branch, '--', path, base])
}

export async function requireParallelWorktree(cwd: string, path: string, branch: string, base: string): Promise<void> {
  const linked = (await listGitWorktrees(cwd)).find((item) => resolve(item.path) === resolve(path))
  if (!linked || linked.branch !== branch) throw new Error('The alternative worktree or its branch changed.')
  await git(path, ['merge-base', '--is-ancestor', base, 'HEAD'])
}

/** Captures working files, including untracked additions, without altering the user's index. */
export async function parallelTree(cwd: string): Promise<{ head: string; tree: string }> {
  if (await git(cwd, ['ls-files', '--unmerged'])) throw new Error('Resolve candidate conflicts before review.')
  const directory = await mkdtemp(join(tmpdir(), 'apex-review-index-'))
  try {
    const indexFile = join(directory, 'index')
    const head = await parallelHead(cwd)
    await git(cwd, ['read-tree', head], indexFile)
    const overrides = await requireFilterFreeGit(cwd, indexFile)
    await git(cwd, ['add', '--all', '--', '.'], indexFile, undefined, overrides)
    // Inspect the captured index: untracked nested repositories also become gitlinks.
    const captured = await git(cwd, ['ls-files', '--stage'], indexFile)
    if (/^160000 /m.test(captured)) throw new Error('Parallel snapshot review does not support repositories with submodules. Review them with a Git client.')
    const tree = await git(cwd, ['write-tree'], indexFile)
    if (await parallelHead(cwd) !== head) throw new Error('Candidate revision changed while taking a snapshot. Review again.')
    return { head, tree }
  } finally { await rm(directory, { recursive: true, force: true }) }
}

export async function parallelSnapshot(cwd: string, base: string, label: string) {
  const snapshot = await parallelTree(cwd)
  const commit = await git(cwd, ['commit-tree', snapshot.tree, '-p', base], undefined, `Apex alternative ${label}\n`, await commitIdentityOverrides(cwd))
  const result = await runGit(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--no-color', base, commit, '--'], { timeoutMs: 30_000, maxBytes: 2 * 1024 * 1024 })
  if (!result.outputExceeded) requireProcessSuccess('Git snapshot diff', result)
  const names = await runGit(cwd, ['diff', '--name-only', '-z', base, commit, '--'], { timeoutMs: 30_000, maxBytes: 2 * 1024 * 1024 })
  requireProcessSuccess('Git snapshot file list', names)
  return { ...snapshot, commit, diff: result.stdout, truncated: result.outputExceeded || result.timedOut, files: names.stdout.split('\0').filter(Boolean) }
}

export async function promoteParallelSnapshot(cwd: string, commit: string): Promise<void> {
  await git(cwd, ['merge', '--ff-only', '--no-edit', '--no-overwrite-ignore', commit])
}
