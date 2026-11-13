import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CheckoutService } from '../../apps/desktop/electron/main/checkouts'
import { GitService } from '../../apps/desktop/electron/main/git'
import { ProjectService } from '../../apps/desktop/electron/main/projects'
import { RepositoryUseGate } from '../../apps/desktop/electron/main/repository-use-gate'
import { JsonStateStore } from '../../apps/desktop/electron/main/store'
import { WorktreeProvenance } from '../../apps/desktop/electron/main/worktree-provenance'
import type { CheckoutStrategy } from '../../apps/desktop/src/types/api'

vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() } }))

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function runGit(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'gooeypi-checkouts-'))
  dirs.push(dir)
  const root = join(dir, 'project')
  mkdirSync(root)
  runGit(root, 'init', '-q')
  runGit(root, 'config', 'user.name', 'Apex Test')
  runGit(root, 'config', 'user.email', 'test@example.com')
  writeFileSync(join(root, 'file.txt'), 'base\n')
  runGit(root, 'add', 'file.txt')
  runGit(root, 'commit', '-qm', 'base')
  runGit(root, 'branch', 'feature/local')
  const canonical = realpathSync(root)
  const info = lstatSync(canonical, { bigint: true })
  const store = new JsonStateStore(join(dir, 'state.json'))
  const now = new Date().toISOString()
  await store.update((state) => { state.projects.push({
    id: 'project', harness: 'pi', name: 'Project', path: canonical, folders: [canonical], primaryFolder: canonical,
    pinned: false, createdAt: now, lastOpenedAt: now,
    folderIdentities: { [canonical]: { dev: info.dev.toString(), ino: info.ino.toString(), birthtimeNs: info.birthtimeNs.toString() } },
  }) })
  const projects = new ProjectService(store, () => null)
  const git = new GitService(async (cwd) => cwd)
  projects.bindProviders({ sessions: async () => [], branch: (cwd) => git.branch(cwd) })
  await projects.list()
  let strategy: CheckoutStrategy = 'branch'
  const gate = new RepositoryUseGate()
  const provenanceDir = join(dir, 'provenance')
  const provenance = new WorktreeProvenance(provenanceDir)
  const service = new CheckoutService(() => strategy, projects, gate, provenance)
  return { root: canonical, dir, store, projects, service, gate, provenance, provenanceDir, setStrategy: (value: CheckoutStrategy) => { strategy = value } }
}

describe('CheckoutService', () => {
  it('records only successfully created linked worktrees, not adopted worktrees', async () => {
    const { root, dir, projects, service, provenance, provenanceDir, setStrategy } = await setup()
    setStrategy('worktree')
    const adopted = join(dir, 'adopted')
    runGit(root, 'worktree', 'add', '-qb', 'external-branch', adopted)
    const created = join(dir, 'created')
    vi.spyOn(projects, 'chooseCheckoutWorktreePath').mockResolvedValue(created)
    expect(provenance.isCreated(adopted)).toBe(false)
    expect((await service.execute('project', { strategy: 'worktree', operation: 'create', branch: 'created-branch' })).kind).toBe('applied')
    expect(new WorktreeProvenance(provenanceDir).isCreated(created)).toBe(true)
    expect((await service.execute('project', { strategy: 'worktree', operation: 'open', path: adopted })).kind).toBe('applied')
    expect(provenance.isCreated(adopted)).toBe(false)
    expect(provenance.isCreated(root)).toBe(false)
    const gitLink = join(created, '.git')
    const contents = readFileSync(gitLink, 'utf8')
    renameSync(gitLink, `${gitLink}.old`); writeFileSync(gitLink, contents)
    expect(provenance.isCreated(created)).toBe(false)
  })
  it('switches a clean local branch without changing project identity or folders', async () => {
    const { root, service } = await setup()
    const before = await service.list('project')
    expect(before).toMatchObject({ strategy: 'branch', activeName: runGit(root, 'branch', '--show-current') })

    const result = await service.execute('project', { strategy: 'branch', operation: 'switch', branch: 'feature/local' })

    expect(result).toMatchObject({ kind: 'applied', project: { id: 'project', path: root, primaryFolder: root, folders: [root], gitBranch: 'feature/local' } })
    expect(runGit(root, 'branch', '--show-current')).toBe('feature/local')
  })

  it('refuses dirty files and active workspace use without changing branches', async () => {
    const { root, service, gate } = await setup()
    const initial = runGit(root, 'branch', '--show-current')
    writeFileSync(join(root, 'untracked.txt'), 'keep\n')
    await expect(service.execute('project', { strategy: 'branch', operation: 'switch', branch: 'feature/local' })).resolves.toMatchObject({ kind: 'refused', code: 'dirty-worktree' })
    expect(runGit(root, 'branch', '--show-current')).toBe(initial)
    rmSync(join(root, 'untracked.txt'))

    const lease = await gate.beginWorkspaceUse(root, { kind: 'agent', harness: 'pi', runtimeId: 'runtime' })
    await expect(service.execute('project', { strategy: 'branch', operation: 'switch', branch: 'feature/local' })).resolves.toMatchObject({ kind: 'refused', code: 'active-work' })
    expect(runGit(root, 'branch', '--show-current')).toBe(initial)
    lease.release()
  })

  it('keeps worktrees as the default strategy and rejects stale strategy actions', async () => {
    const { root, service, setStrategy } = await setup()
    setStrategy('worktree')
    await expect(service.list('project')).resolves.toMatchObject({ strategy: 'worktree', activePath: root })
    await expect(service.execute('project', { strategy: 'branch', operation: 'switch', branch: 'feature/local' })).resolves.toMatchObject({ kind: 'refused', code: 'strategy-changed' })
    expect(runGit(root, 'branch', '--show-current')).not.toBe('feature/local')
  })
})
