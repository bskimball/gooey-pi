import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParallelWorkService } from '../../apps/desktop/electron/main/parallel-work'
import { parallelTree } from '../../apps/desktop/electron/main/git-parallel'
import { CheckoutService } from '../../apps/desktop/electron/main/checkouts'
import { GitService } from '../../apps/desktop/electron/main/git'
import { ProjectService } from '../../apps/desktop/electron/main/projects'
import { RepositoryUseGate } from '../../apps/desktop/electron/main/repository-use-gate'
import { JsonStateStore } from '../../apps/desktop/electron/main/store'
import type { CheckoutStrategy } from '../../apps/desktop/src/types/api'

vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() } }))

const dirs: string[] = []
const parallelServices: ParallelWorkService[] = []
afterEach(async () => { for (const service of parallelServices.splice(0)) await service.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); vi.unstubAllEnvs() })

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
  const service = new CheckoutService(() => strategy, projects, gate)
  let runtimeCount = 0
  const agents = {
    start: vi.fn(async ({ cwd }: { cwd: string }) => ({ runtimeId: `runtime-${++runtimeCount}`, cwd, sessionFile: join(cwd, 'session.jsonl') })),
    command: vi.fn(async () => ({ success: true })),
    runPromptToCompletion: vi.fn(async (_id: string, _message: string, _timeoutMs: number) => {}),
    stop: vi.fn(async (_id: string) => true),
    has: vi.fn(() => true),
    list: vi.fn(() => []),
    pinAttachment: vi.fn(() => vi.fn()),
  }
  const deps = { file: join(dir, 'parallel.json'), projects, agents: agents as never, gate, chooseDirectory: vi.fn(async () => dir), confirmPromotion: vi.fn(async () => true) }
  const parallel = new ParallelWorkService(deps)
  parallelServices.push(parallel)
  return { root: canonical, store, projects, service, gate, agents, deps, parallel, setStrategy: (value: CheckoutStrategy) => { strategy = value } }
}

describe('CheckoutService', () => {
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

describe('parallel alternatives', () => {
  it('creates two worktrees at one base, preserves the active project, and promotes only a reviewed immutable snapshot', async () => {
    const { root, parallel, projects } = await setup()
    const base = runGit(root, 'rev-parse', 'HEAD')
    const run = await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['Approach A', 'Approach B'], maxMinutes: 15 })
    expect(run?.status).toBe('ready')
    expect(run?.base).toBe(base)
    expect((await projects.resolveCheckoutProject('project')).primaryFolder).toBe(root)
    const [a, b] = run!.variants
    expect(runGit(a.path, 'rev-parse', 'HEAD')).toBe(base)
    expect(runGit(b.path, 'rev-parse', 'HEAD')).toBe(base)
    writeFileSync(join(a.path, 'file.txt'), 'staged change\n')
    runGit(a.path, 'add', 'file.txt')
    const index = runGit(a.path, 'write-tree')
    writeFileSync(join(a.path, 'file.txt'), 'candidate A\n')
    writeFileSync(join(a.path, 'new.txt'), 'untracked addition\n')
    writeFileSync(join(b.path, 'file.txt'), 'candidate B\n')
    const review = await parallel.review('project', run!.id, 'a')
    expect(review.diff).toContain('+candidate A')
    expect(review.diff).toContain('+untracked addition')
    expect(review.files).toEqual(['file.txt', 'new.txt'])
    expect(runGit(a.path, 'write-tree')).toBe(index)
    expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe('base\n')
    expect((await parallel.promote('project', run!.id, review.id)).status).toBe('promoted')
    expect(runGit(root, 'rev-parse', 'HEAD')).toBe(review.commit)
    expect(readFileSync(join(root, 'new.txt'), 'utf8')).toBe('untracked addition\n')
    expect(readFileSync(join(b.path, 'file.txt'), 'utf8')).toBe('candidate B\n')
    expect(runGit(root, 'status', '--porcelain')).toBe('')
    expect((await parallel.promote('project', run!.id, review.id)).promotedVariant).toBe('a')
    await expect(parallel.review('project', run!.id, 'b')).rejects.toThrow('already has')
  })

  it('rejects dirty creation, invalid limits, wrong project/variant, and worktree parents inside the target', async () => {
    const { root, parallel, deps } = await setup()
    const options = { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 15 }
    await expect(parallel.create('project', { ...options, maxMinutes: 0 })).rejects.toThrow('1–60')
    await expect(parallel.create('project', { ...options, prompts: ['A'] })).rejects.toThrow('two')
    writeFileSync(join(root, 'untracked.txt'), 'keep')
    await expect(parallel.create('project', options)).rejects.toThrow('clean')
    rmSync(join(root, 'untracked.txt'))
    deps.chooseDirectory.mockResolvedValueOnce(root)
    await expect(parallel.create('project', options)).rejects.toThrow('outside')
    deps.chooseDirectory.mockResolvedValueOnce(null as never)
    expect(await parallel.create('project', options)).toBeNull()
    const run = await parallel.create('project', options)
    await expect(parallel.review('project', run!.id, 'c')).rejects.toThrow('Invalid alternative')
    await expect(parallel.review('missing', run!.id, 'a')).rejects.toThrow('granted')
    await expect(parallel.promote('project', run!.id, 'not-a-review')).rejects.toThrow('Review')
  })

  it('invalidates stale reviews and refuses changed target revisions, dirty targets, and active workspace use', async () => {
    const { root, parallel, gate, deps } = await setup()
    const run = (await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 1 }))!
    const a = run.variants[0]
    writeFileSync(join(a.path, 'file.txt'), 'A\n')
    const stale = await parallel.review('project', run.id, 'a')
    writeFileSync(join(a.path, 'file.txt'), 'new A\n')
    await expect(parallel.promote('project', run.id, stale.id)).rejects.toThrow('changed since review')
    const review = await parallel.review('project', run.id, 'a')
    await expect(parallel.promote('project', run.id, stale.id)).rejects.toThrow('Review')
    const lease = await gate.beginWorkspaceUse(a.path, { kind: 'terminal', terminalId: 'editor-terminal' })
    await expect(parallel.promote('project', run.id, review.id)).rejects.toThrow('terminal')
    lease.release()
    deps.confirmPromotion.mockResolvedValueOnce(false)
    expect((await parallel.promote('project', run.id, review.id)).status).toBe('ready')
    writeFileSync(join(root, 'file.txt'), 'target edits\n')
    await expect(parallel.promote('project', run.id, review.id)).rejects.toThrow('clean')
    runGit(root, 'add', 'file.txt'); runGit(root, 'commit', '-qm', 'target advanced')
    await expect(parallel.promote('project', run.id, review.id)).rejects.toThrow('revision or branch changed')
    expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe('target edits\n')
  })

  it('checks source and target again after native promotion confirmation', async () => {
    const { root, parallel, deps } = await setup()
    const run = (await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 1 }))!
    const review = await parallel.review('project', run.id, 'a')
    deps.confirmPromotion.mockImplementationOnce(async () => { writeFileSync(join(run.variants[0].path, 'late.txt'), 'late change'); return true })
    await expect(parallel.promote('project', run.id, review.id)).rejects.toThrow('changed since review')
    expect(runGit(root, 'rev-parse', 'HEAD')).toBe(run.base)
  })

  it('starts exactly two independent sessions, records completion, and never replays a pair', async () => {
    const { root, parallel, agents } = await setup()
    const run = (await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 1 }))!
    expect((await parallel.start('project', run.id)).status).toBe('running')
    await vi.waitFor(async () => expect((await parallel.list('project'))[0].variants.map((item) => item.status)).toEqual(['completed', 'completed']))
    expect(agents.start.mock.calls.map(([options]) => options.cwd)).toEqual(run.variants.map((variant) => variant.path))
    const state = (await parallel.list('project'))[0]
    expect(new Set(state.variants.map((variant) => variant.sessionFile)).size).toBe(2)
    expect(agents.runPromptToCompletion).toHaveBeenCalledTimes(2)
    expect(agents.runPromptToCompletion.mock.calls.map((call) => call[2])).toEqual([60_000, 60_000])
    expect(agents.stop).toHaveBeenCalledTimes(2)
    await expect(parallel.start('project', run.id)).rejects.toThrow('newly prepared')
  })

  it('limits concurrency to one pair and stops both writers before allowing review', async () => {
    const { root, parallel, agents } = await setup()
    const pending = new Map<string, () => void>()
    agents.runPromptToCompletion.mockImplementation((id) => new Promise((resolve) => { pending.set(id, resolve) }))
    agents.stop.mockImplementation(async (id) => { pending.get(id)?.(); return true })
    const first = (await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 1 }))!
    const second = (await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['C', 'D'], maxMinutes: 1 }))!
    await parallel.start('project', first.id)
    await vi.waitFor(() => expect(pending.size).toBe(2))
    await expect(parallel.start('project', second.id)).rejects.toThrow('Only one pair')
    await expect(parallel.review('project', first.id, 'a')).rejects.toThrow('Stop both')
    expect((await parallel.stop('project', first.id)).variants.map((variant) => variant.status)).toEqual(['stopped', 'stopped'])
    expect((await parallel.review('project', first.id, 'a')).truncated).toBe(false)
  })

  it('enforces the wall-clock limit without retrying either prompt', async () => {
    const { root, parallel, agents } = await setup()
    const pending = new Map<string, () => void>()
    agents.runPromptToCompletion.mockImplementation((id) => new Promise((resolve) => { pending.set(id, resolve) }))
    agents.stop.mockImplementation(async (id) => { pending.get(id)?.(); return true })
    const run = (await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 1 }))!
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await parallel.start('project', run.id)
    await vi.waitFor(() => expect(pending.size).toBe(2))
    await vi.advanceTimersByTimeAsync(60_000)
    vi.useRealTimers()
    await vi.waitFor(async () => expect((await parallel.list('project'))[0].status).toBe('stopped'))
    expect((await parallel.list('project'))[0].error).toContain('Time limit')
    expect(agents.runPromptToCompletion).toHaveBeenCalledTimes(2)
  })

  it('preserves partial setup paths and reloads interrupted runs without restarting models', async () => {
    const { root, parallel, deps, agents } = await setup()
    vi.spyOn(deps.projects, 'adoptCheckoutWorktree').mockRejectedValueOnce(new Error('grant failed'))
    const run = (await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 15 }))!
    expect(run.status).toBe('error')
    expect(run.error).toContain('preserved')
    expect(runGit(run.variants[0].path, 'rev-parse', 'HEAD')).toBe(run.base)
    await parallel.close()
    const saved = JSON.parse(readFileSync(deps.file, 'utf8'))
    saved[0].status = 'running'; saved[0].variants[0].status = 'running'; saved[0].variants[0].runtimeId = 'old-id'
    writeFileSync(deps.file, JSON.stringify(saved))
    const restarted = new ParallelWorkService(deps)
    parallelServices.push(restarted)
    const restored = (await restarted.list('project'))[0]
    expect(restored.status).toBe('stopped')
    expect(restored.variants[0].runtimeId).toBeUndefined()
    expect(agents.start).not.toHaveBeenCalled()
  })

  it('waits for completion after prompt acceptance before stopping either alternative', async () => {
    const { root, parallel, agents } = await setup()
    const pending = new Map<string, () => void>()
    agents.runPromptToCompletion.mockImplementation(async (id) => { await agents.command(); await new Promise<void>((resolve) => { pending.set(id, resolve) }) })
    const run = (await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 1 }))!
    await parallel.start('project', run.id)
    await vi.waitFor(() => expect(agents.command).toHaveBeenCalledTimes(2))
    expect((await parallel.list('project'))[0].variants.map((variant) => variant.status)).toEqual(['running', 'running'])
    expect(agents.stop).not.toHaveBeenCalled()
    for (const finish of pending.values()) finish()
    await vi.waitFor(async () => expect((await parallel.list('project'))[0].variants.map((variant) => variant.status)).toEqual(['completed', 'completed']))
    expect(agents.stop).toHaveBeenCalledTimes(2)
  })

  it('preserves ignored target data when the reviewed snapshot would track that path', async () => {
    const { root, parallel } = await setup()
    writeFileSync(join(root, '.gitignore'), 'local.env\n')
    runGit(root, 'add', '.gitignore'); runGit(root, 'commit', '-qm', 'ignore local data')
    const run = (await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 1 }))!
    writeFileSync(join(root, 'local.env'), 'USER_DATA')
    writeFileSync(join(run.variants[0].path, '.gitignore'), '')
    writeFileSync(join(run.variants[0].path, 'local.env'), 'REVIEWED_SAMPLE')
    const review = await parallel.review('project', run.id, 'a')
    expect(runGit(root, 'status', '--porcelain')).toBe('')
    await expect(parallel.promote('project', run.id, review.id)).rejects.toThrow('overwritten')
    expect(readFileSync(join(root, 'local.env'), 'utf8')).toBe('USER_DATA')
    expect(runGit(root, 'rev-parse', 'HEAD')).toBe(run.base)
  })

  it('rejects attribute-defined filters even when the driver is only configured globally', async () => {
    const { root, parallel } = await setup()
    const run = (await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 1 }))!
    const home = join(root, '..', 'filter-home')
    mkdirSync(home)
    writeFileSync(join(home, '.gitconfig'), '[filter "example"]\n  clean = false\n')
    vi.stubEnv('HOME', home)
    writeFileSync(join(run.variants[0].path, '.gitattributes'), '*.bin filter=example\n')
    writeFileSync(join(run.variants[0].path, 'asset.bin'), 'raw sample')
    await expect(parallel.review('project', run.id, 'a')).rejects.toThrow('filters')
  })

  it('validates filters against the snapshot index even for ignored paths removed from the real index', async () => {
    const { root, parallel } = await setup()
    const run = (await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 1 }))!
    const candidate = run.variants[0].path
    runGit(candidate, 'rm', '--cached', 'file.txt')
    writeFileSync(join(candidate, '.gitignore'), 'file.txt\n')
    writeFileSync(join(candidate, '.gitattributes'), 'file.txt filter=example\n')
    writeFileSync(join(candidate, 'file.txt'), 'RAW_UNFILTERED_CONTENT')
    const indexPath = runGit(candidate, 'rev-parse', '--path-format=absolute', '--git-path', 'index')
    const indexBefore = readFileSync(indexPath)
    await expect(parallel.review('project', run.id, 'a')).rejects.toThrow('filters')
    expect(readFileSync(indexPath)).toEqual(indexBefore)
    expect(readFileSync(join(candidate, 'file.txt'), 'utf8')).toBe('RAW_UNFILTERED_CONTENT')
  })

  it('rejects nested repositories in the captured temporary index', async () => {
    const { root, parallel } = await setup()
    const run = (await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 1 }))!
    const nested = join(run.variants[0].path, 'nested')
    mkdirSync(nested)
    runGit(nested, 'init', '-q'); runGit(nested, 'config', 'user.name', 'Fixture'); runGit(nested, 'config', 'user.email', 'fixture@example.com')
    writeFileSync(join(nested, 'file.txt'), 'nested base')
    runGit(nested, 'add', '.'); runGit(nested, 'commit', '-qm', 'nested base')
    writeFileSync(join(nested, 'file.txt'), 'uncommitted nested edits')
    await expect(parallel.review('project', run.id, 'a')).rejects.toThrow('submodules')
    expect(runGit(run.variants[0].path, 'diff', '--cached')).toBe('')
    expect(readFileSync(join(nested, 'file.txt'), 'utf8')).toBe('uncommitted nested edits')
  })

  it('uses configured global identity for the review snapshot without enabling global hooks or filters', async () => {
    const { root, parallel } = await setup()
    const run = (await parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 1 }))!
    const home = join(root, '..', 'identity-home')
    mkdirSync(home)
    writeFileSync(join(home, '.gitconfig'), `[user]\n  name = Review User\n  email = review@example.com\n[core]\n  excludesFile = ${join(home, 'ignore').replaceAll('\\', '/')}\n`)
    writeFileSync(join(home, 'ignore'), 'local-only.tmp\n')
    writeFileSync(join(run.variants[0].path, 'local-only.tmp'), 'excluded local data')
    runGit(root, 'config', '--unset', 'user.name'); runGit(root, 'config', '--unset', 'user.email')
    vi.stubEnv('HOME', home)
    const review = await parallel.review('project', run.id, 'a')
    expect(runGit(root, 'show', '-s', '--format=%an <%ae>', review.commit)).toBe('Review User <review@example.com>')
    expect(review.files).not.toContain('local-only.tmp')
  })

  it('does not execute configured clean filters while creating or snapshotting alternatives', async () => {
    const { root, parallel } = await setup()
    runGit(root, 'config', 'filter.example.clean', 'false')
    await expect(parallel.create('project', { cwd: root, baseRef: 'HEAD', prompts: ['A', 'B'], maxMinutes: 1 })).rejects.toThrow('filters')
    await expect(parallelTree(root)).rejects.toThrow('filters')
  })
})
