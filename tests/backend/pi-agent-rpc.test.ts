import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { spawnSync } from 'node:child_process'
import { RunReceipts } from '../../apps/desktop/electron/main/run-receipts'
import { SideConversations } from '../../apps/desktop/electron/main/side-conversations'
import { FinishTaskService } from '../../apps/desktop/electron/main/finish-task'
import { GitService } from '../../apps/desktop/electron/main/git'
import { WorktreeProvenance } from '../../apps/desktop/electron/main/worktree-provenance'
import { SessionService } from '../../apps/desktop/electron/main/sessions'
import { piSessionServiceOptions } from 'apex-core/sessions/pi'
import { JsonStateStore } from '../../apps/desktop/electron/main/store'
import { RewindService } from '../../apps/desktop/electron/main/rewind'
import { RepositoryUseGate } from '../../apps/desktop/electron/main/repository-use-gate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRpcManager, PI_RPC_ADAPTER } from '../../apps/desktop/electron/main/agent-rpc'
import type { ProviderCatalog } from '../../apps/desktop/electron/main/agent-rpc'
import type { ApexModelDescriptor } from '../../apps/desktop/src/types/api'
import { waitUntil } from '../helpers/wait'
import { ActivityCoordinatorService } from '../../apps/desktop/electron/main/collaboration/coordinator'
import { ProjectService } from '../../apps/desktop/electron/main/projects'

vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }))

const dirs: string[] = []
const managers: AgentRpcManager[] = []

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.stopAll()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface FakePiOptions {
  /** JavaScript statements the fake runs after acknowledging a prompt. */
  promptScript?: string
  /** Initial model reported by get_state before any set_model RPC. */
  initialModel?: { provider: string; id: string; name: string }
  receipts?: boolean
  noReadOnlyFlags?: boolean
}

function fakePiAgent(options: FakePiOptions = {}): { cwd: string; executable: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'apex-pi-rpc-'))
  dirs.push(cwd)
  const executable = join(cwd, 'fake-pi.cjs')
  const initialModel = JSON.stringify(options.initialModel ?? { provider: 'openai-codex', id: 'gpt-5.6-luna', name: 'Luna GPT-5.6' })
  // Like the real pi, the fake pushes no ready frame and knows no native
  // negotiate_protocol, branch, or fast-mode commands; get_state carries
  // hostile serviceTier/fastModeEnabled/contextUsage fields the adapter must
  // ignore, and get_session_stats owns the authoritative context usage.
  writeFileSync(executable, `#!/usr/bin/env node
const readline = require('node:readline')
const fs = require('node:fs')
if (process.argv.includes('--help')) { console.log(${JSON.stringify(options.noReadOnlyFlags ? '--tools' : '--tools\n--no-extensions\n--no-mcp')}); process.exit(0) }
const receipts = ${JSON.stringify(Boolean(options.receipts))}
let busy = false
let transcript = []
let baseline = true
let sessionFile = process.argv.includes('--session') ? process.argv[process.argv.indexOf('--session') + 1] : process.cwd() + '/session.jsonl'
let sessionId = 'pi-session'
let forkCount = 0
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
let currentModel = ${initialModel}
let currentThinking = 'medium'
send({ type: 'fake_argv', argv: process.argv.slice(2) })
send({ type: 'fake_cwd', cwd: process.cwd() })
send({ type: 'fake_env', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('PI_'))) })
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line)
  if (receipts && command.type === 'get_entries') {
    const reply = () => send({ id: command.id, type: 'response', command: 'get_entries', success: true, data: { entries: transcript, leafId: transcript.length ? transcript[transcript.length - 1].id : null } })
    if (baseline) { baseline = false; send({ type: 'fake_baseline_wait' }); const timer = setInterval(() => { if (fs.existsSync('allow-baseline')) { clearInterval(timer); reply() } }, 10) }
    else if (fs.existsSync('hold-post')) { fs.unlinkSync('hold-post'); send({ type: 'fake_post_wait' }); const timer = setInterval(() => { if (fs.existsSync('allow-post')) { clearInterval(timer); reply() } }, 10) }
    else reply()
  } else if (command.type === 'prompt' && command.message === 'reject me') {
    send({ id: command.id, type: 'response', command: command.type, success: false, error: 'Prompt rejected for test' })
  } else if (receipts && (command.type === 'prompt' || command.type === 'follow_up' || command.type === 'steer')) {
    const id = 'user-' + (transcript.length + 1)
    transcript.push({ type: 'message', id, parentId: transcript.length ? transcript[transcript.length - 1].id : null, message: { role: 'user', content: command.message } })
    busy = true
    if (command.message === 'work resumed without receipts') send({ type: 'agent_start' })
    send({ type: 'fake_prompt', message: command.message, command: command.type })
    send({ id: command.id, type: 'response', command: command.type, success: true, data: { disposition: transcript.length === 1 ? 'started' : 'queued' } })
  } else if (command.type === 'get_state') {
    const reply = () => send({ id: command.id, type: 'response', command: 'get_state', success: true, data: {
      sessionId, sessionFile: receipts || process.argv.includes('--session') ? sessionFile : undefined, isStreaming: busy, isCompacting: false, pendingMessageCount: 0, thinkingLevel: currentThinking,
      model: currentModel,
      serviceTier: 'priority', fastModeEnabled: true,
      contextUsage: { tokens: 999999, contextWindow: 272000, percent: 99 },
    } })
    if (fs.existsSync('hold-state')) { fs.unlinkSync('hold-state'); send({ type: 'fake_state_wait' }); const timer = setInterval(() => { if (fs.existsSync('allow-state')) { clearInterval(timer); reply() } }, 10) } else reply()
  } else if (command.type === 'set_model') {
    currentModel = { provider: command.provider, id: command.modelId, name: command.modelId }
    send({ type: 'fake_set_model', provider: command.provider, modelId: command.modelId })
    send({ id: command.id, type: 'response', command: 'set_model', success: true, data: currentModel })
  } else if (command.type === 'set_thinking_level') {
    currentThinking = command.level
    send({ type: 'fake_set_thinking_level', level: command.level })
    send({ id: command.id, type: 'response', command: 'set_thinking_level', success: true })
  } else if (command.type === 'get_session_stats') {
    send({ id: command.id, type: 'response', command: 'get_session_stats', success: true, data: { contextUsage: { tokens: 12000, contextWindow: 272000, percent: 4 }, tokens: { input: 10000, output: 2000, cacheRead: 500, cacheWrite: 100, total: 12600 }, cost: 0.4321 } })
  } else if (receipts && command.type === 'get_fork_messages') {
    send({ id: command.id, type: 'response', command: command.type, success: true, data: { messages: transcript.map((item) => ({ entryId: item.id, text: item.message.content })) } })
  } else if (receipts && command.type === 'fork') {
    send({ type: 'fake_fork', entryId: command.entryId })
    const selected = transcript.find((item) => item.id === command.entryId)
    const cancelled = fs.existsSync('cancel-fork')
    if (!cancelled) { if (fs.existsSync('change-on-fork')) fs.writeFileSync('work.txt', 'race'); sessionFile = process.cwd() + '/fork-' + (++forkCount) + '.jsonl'; sessionId = 'fork-session'; fs.writeFileSync(sessionFile, '') }
    send({ id: command.id, type: 'response', command: command.type, success: true, data: { text: selected?.message.content, cancelled } })
  } else if (command.type === 'fork' || command.type === 'get_fork_messages') {
    send({ id: command.id, type: 'response', command: command.type, success: true, data: { received: command.type, entryId: command.entryId } })
  } else if (command.type === 'prompt') {
    send({ type: 'fake_prompt', message: command.message })
    send({ id: command.id, type: 'response', command: 'prompt', success: true, data: { agentInvoked: true } })
    ${options.promptScript ?? ''}
  } else if (command.type === 'bash') {
    require('node:child_process').execSync(command.command, { cwd: process.cwd() })
    send({ id: command.id, type: 'response', command: 'bash', success: true })
  } else if (command.type === 'abort') {
    busy = false
    send({ type: 'agent_settled' })
    send({ id: command.id, type: 'response', command: 'abort', success: true })
  } else {
    send({ type: 'fake_unknown_command', command: command.type })
    send({ id: command.id, type: 'response', command: command.type, success: false, error: 'Unknown command ' + command.type })
  }
})
if (receipts) setInterval(() => {
  if (fs.existsSync('emit-end')) { fs.unlinkSync('emit-end'); send({ type: 'agent_end' }) }
  if (fs.existsSync('settle')) { fs.unlinkSync('settle'); busy = false; send({ type: 'agent_settled' }) }
}, 10)
`)
  chmodSync(executable, 0o755)
  if (process.platform === 'win32') {
    const dist = join(cwd, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist')
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(dist, 'cli.js'), readFileSync(executable))
    const shim = join(cwd, 'pi.cmd')
    writeFileSync(shim, '@echo off\r\n"%_prog%" "%dp0%\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js" %*\r\n')
    return { cwd, executable: shim }
  }
  return { cwd, executable }
}

const lunaModel: ApexModelDescriptor = {
  key: 'openai-codex/gpt-5.6-luna', provider: 'openai-codex', id: 'gpt-5.6-luna', name: 'Luna GPT-5.6',
  reasoning: true, input: ['text', 'image'], contextWindow: 272_000, maxTokens: 64_000,
  availableThinkingLevels: ['off', 'low', 'medium', 'high'], fastModeSupported: true, available: true,
}

const piCatalog: ProviderCatalog = {
  requireAvailableModel: async () => lunaModel,
  capabilities: async (provider, modelId) => provider === 'openai-codex' && modelId === 'gpt-5.6-luna' ? lunaModel : undefined,
}

function piManager(executable: string, options: { providers?: ProviderCatalog } = {}): AgentRpcManager {
  const manager = new AgentRpcManager(
    executable,
    async (cwd) => cwd,
    async (path) => path,
    options.providers,
    () => new Set(),
  )
  managers.push(manager)
  return manager
}

describe('read-only side conversations', () => {
  it('reports unsupported Pi flags before creating a side session', async () => {
    const fake = fakePiAgent({ noReadOnlyFlags: true })
    const root = join(fake.cwd, 'sessions'); mkdirSync(root)
    const sessions = new SessionService(new JsonStateStore(join(fake.cwd, 'state.json')), null, undefined, piSessionServiceOptions(root))
    const manager = new AgentRpcManager(fake.executable, async (cwd) => cwd, (path) => sessions.requireSessionPath(path))
    managers.push(manager)
    const sides = new SideConversations(join(fake.cwd, 'side-metadata'), sessions, manager, async (cwd) => cwd)
    const parent = await sessions.create(fake.cwd)
    await expect(sides.create(parent.filePath)).rejects.toThrow('Configured Pi does not support the required read-only side conversation flags')
    expect(await sides.list(parent.filePath)).toEqual([])
    expect(await sessions.list(undefined, true, true)).toHaveLength(1)
  })
  it('persists independent policy, protects resumes and commands, and admits return only to an idle parent', async () => {
    const fake = fakePiAgent({ receipts: true })
    const root = join(fake.cwd, 'sessions'); mkdirSync(root)
    const sessions = new SessionService(new JsonStateStore(join(fake.cwd, 'state.json')), null, undefined, piSessionServiceOptions(root))
    const manager = new AgentRpcManager(fake.executable, async (cwd) => cwd, (path) => sessions.requireSessionPath(path))
    managers.push(manager)
    const gate = new RepositoryUseGate()
    manager.setWorkspaceUseProvider((cwd, owner, retire) => gate.beginWorkspaceUse(cwd, owner, retire))
    manager.setRuntimeEnvironmentProvider(() => ({ APEX_EDITOR_EXTENSION_PATH: '/explicit-extension.ts', GOOEYPI_COMPUTER_USE_SKILL_PATH: '/explicit-skill' }))
    const storage = join(fake.cwd, 'side-metadata')
    let sides = new SideConversations(storage, sessions, manager, async (cwd) => cwd)
    manager.setReadOnlySessionProvider((path) => sides.isReadOnly(path))
    const events: Array<{ runtimeId: string; event: Record<string, unknown> }> = []
    manager.subscribe((event) => events.push(event))
    const parentSession = await sessions.create(fake.cwd)
    const parent = await manager.start({ cwd: fake.cwd, sessionPath: parentSession.filePath })
    await manager.command(parent.runtimeId, { type: 'prompt', message: 'parent is working' })
    await waitUntil(() => manager.getForSession(parentSession.filePath)?.isStreaming === true)
    const createSession = sessions.create.bind(sessions)
    let reveal!: (path: string) => void
    let release!: () => void
    const visible = new Promise<string>((resolve) => { reveal = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    const createSpy = vi.spyOn(sessions, 'create').mockImplementation(async (cwd, beforeWrite) => {
      const child = await createSession(cwd, (path) => {
        beforeWrite?.(path)
        expect(sides.isReadOnly(path)).toBe(true)
        expect(existsSync(path)).toBe(false)
      })
      reveal(child.filePath)
      await held
      return child
    })
    const creating = sides.create(parentSession.filePath, { excerpt: 'chosen context' })
    const visiblePath = await visible
    const starting = manager.start({ cwd: fake.cwd, sessionPath: visiblePath })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(manager.getForSession(visiblePath)).toBeUndefined()
    release()
    const side = await creating
    createSpy.mockRestore()
    expect(side.sessionFile).not.toBe(parentSession.filePath)
    expect(side.initialContext).toBe('chosen context')
    const child = await starting
    expect(manager.getForSession(parentSession.filePath)?.isStreaming).toBe(true)
    const argv = events.find((item) => item.runtimeId === child.runtimeId && item.event.type === 'fake_argv')?.event.argv as string[]
    expect(argv).toContain('--no-extensions'); expect(argv).toContain('--no-mcp')
    expect(argv.slice(argv.indexOf('--tools'), argv.indexOf('--tools') + 2)).toEqual(['--tools', 'read,grep,find,ls'])
    expect(argv).not.toContain('--extension'); expect(argv).not.toContain('--skill')
    const sentinel = join(fake.cwd, 'mutation-sentinel')
    await expect(manager.command(child.runtimeId, { type: 'bash', command: 'node -e "require(\'fs\').writeFileSync(\'mutation-sentinel\',\'bad\')"' })).rejects.toThrow('Read-only side conversation blocks RPC command bash')
    expect(existsSync(sentinel)).toBe(false)
    await expect(manager.command(child.runtimeId, { type: 'prompt', message: '!echo unsafe' })).rejects.toThrow('blocks shell and slash commands')
    await expect(manager.command(child.runtimeId, { type: 'new_session' })).rejects.toThrow('Read-only side conversation blocks RPC command new_session')
    await expect(sides.prepareReturn(parent.runtimeId, side.sessionFile, 'selected')).rejects.toThrow(/busy/)
    await manager.command(parent.runtimeId, { type: 'abort' })
    await waitUntil(() => manager.getForSession(parentSession.filePath)?.isStreaming === false)
    await manager.command(parent.runtimeId, { type: 'bash', command: 'node -e "require(\'fs\').writeFileSync(\'control-sentinel\',\'ok\')"' })
    expect(existsSync(join(fake.cwd, 'control-sentinel'))).toBe(true)
    await manager.command(parent.runtimeId, { type: 'get_state' })
    writeFileSync(join(fake.cwd, 'hold-state'), '')
    const returning = sides.prepareReturn(parent.runtimeId, side.sessionFile, 'selected')
    await waitUntil(() => events.some((item) => item.runtimeId === parent.runtimeId && item.event.type === 'fake_state_wait'))
    await expect(manager.command(parent.runtimeId, { type: 'prompt', message: 'race' })).rejects.toThrow('session change is already in progress')
    writeFileSync(join(fake.cwd, 'allow-state'), '')
    expect(await returning).toEqual({ sourceSession: side.sessionFile, text: 'selected' })
    await manager.stop(child.runtimeId)
    const resumedManager = new AgentRpcManager(fake.executable, async (cwd) => cwd, (path) => sessions.requireSessionPath(path))
    managers.push(resumedManager)
    resumedManager.setRuntimeEnvironmentProvider(() => ({ APEX_EDITOR_EXTENSION_PATH: '/explicit-extension.ts', GOOEYPI_COMPUTER_USE_SKILL_PATH: '/explicit-skill' }))
    resumedManager.subscribe((event) => events.push(event))
    sides = new SideConversations(storage, sessions, resumedManager, async (cwd) => cwd)
    resumedManager.setReadOnlySessionProvider((path) => sides.isReadOnly(path))
    expect(await sides.list(parentSession.filePath)).toEqual([side])
    expect(await sides.get(side.sessionFile)).toEqual(side)
    const resumed = await resumedManager.start({ cwd: side.cwd, sessionPath: side.sessionFile })
    const resumedArgs = events.find((item) => item.runtimeId === resumed.runtimeId && item.event.type === 'fake_argv')?.event.argv as string[]
    expect(resumedArgs).toContain('--no-extensions'); expect(resumedArgs).toContain('--no-mcp')
    expect(resumedArgs).not.toContain('--extension'); expect(resumedArgs).not.toContain('--skill')
    await expect(resumedManager.command(resumed.runtimeId, { type: 'bash', command: 'node -e "require(\'fs\').writeFileSync(\'mutation-sentinel\',\'bad\')"' })).rejects.toThrow('blocks RPC command bash')
    expect(existsSync(sentinel)).toBe(false)
    await expect(manager.command(parent.runtimeId, { type: 'switch_session', sessionPath: side.sessionFile })).rejects.toThrow('must be opened in its own runtime')
  })
})

describe('finish task', () => {
  const finishFixture = () => {
    const fake = fakePiAgent({ receipts: true })
    const checkout = join(fake.cwd, 'checkout'); mkdirSync(checkout)
    const sessionRoot = join(fake.cwd, 'sessions'); mkdirSync(sessionRoot)
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: checkout, encoding: 'utf8' })
      if (result.status !== 0) throw new Error(result.stderr)
      return result.stdout.trim()
    }
    git('init', '-q'); git('config', 'user.email', 'finish@example.test'); git('config', 'user.name', 'Finish Test')
    writeFileSync(join(checkout, 'tracked.txt'), 'base\n')
    git('add', 'tracked.txt'); git('commit', '-qm', 'base')
    const target = git('branch', '--show-current')
    const sessions = new SessionService(new JsonStateStore(join(fake.cwd, 'state.json')), null, undefined, piSessionServiceOptions(sessionRoot))
    const manager = new AgentRpcManager(fake.executable, async (cwd) => cwd, (path) => sessions.requireSessionPath(path)); managers.push(manager)
    const gate = new RepositoryUseGate()
    manager.setWorkspaceUseProvider((cwd, owner, retire) => gate.beginWorkspaceUse(cwd, owner, retire))
    return { fake, checkout, git, target, sessions, manager, gate, storage: join(fake.cwd, 'finished') }
  }

  it('rechecks fresh observations, retains files and refs, and persists explicit completion', async () => {
    const { fake, checkout, git, target, sessions, manager, gate, storage } = finishFixture()
    git('checkout', '-qb', 'finish-feature')
    writeFileSync(join(checkout, 'tracked.txt'), 'committed\n')
    git('commit', '-qam', 'feature')
    git('config', 'branch.finish-feature.remote', '.'); git('config', 'branch.finish-feature.merge', `refs/heads/${target}`)
    writeFileSync(join(checkout, 'dirty.txt'), 'user work')
    const session = await sessions.create(checkout)
    const runtime = await manager.start({ cwd: checkout, sessionPath: session.filePath })
    const service = () => new FinishTaskService(storage, manager, new GitService(async (cwd) => cwd), gate, (path) => sessions.requireSessionPath(path), () => sessions.list(undefined, true, true), async () => [])
    const finish = service()
    manager.setPromptAcceptedListener((path) => finish.clearForAcceptedPrompt(path))
    const first = await finish.review(runtime.runtimeId, session.filePath)
    expect(first.worktree.kind).toBe('primary')
    expect(first.worktree.ownership).toBe('unknown')
    expect(first.git.integration.kind).toBe('not-integrated')
    expect(first.git.status.files.map((item) => item.path)).toContain('dirty.txt')
    expect(first.cleanup.eligible).toBe(false)
    expect(first.cleanup.reasons.join(' ')).toMatch(/Primary worktree/)
    await expect(finish.finish(runtime.runtimeId, session.filePath, first.token, 'no')).rejects.toThrow('explicit confirmation')
    writeFileSync(join(checkout, 'second.txt'), 'new work')
    await expect(finish.finish(runtime.runtimeId, session.filePath, first.token, 'finish')).rejects.toThrow('stale')
    const terminal = await gate.beginWorkspaceUse(checkout, { kind: 'terminal', terminalId: 'terminal-1' })
    const shared = await finish.review(runtime.runtimeId, session.filePath)
    expect(shared.conflicts).toContainEqual({ kind: 'terminal', terminalId: 'terminal-1' })
    terminal.release()
    await expect(finish.finish(runtime.runtimeId, session.filePath, shared.token, 'finish')).rejects.toThrow('stale')
    const beforeBusy = await finish.review(runtime.runtimeId, session.filePath)
    await manager.command(runtime.runtimeId, { type: 'prompt', message: 'still working' })
    await waitUntil(() => manager.getForSession(session.filePath)?.isStreaming === true)
    await expect(finish.review(runtime.runtimeId, session.filePath)).rejects.toThrow(/busy/)
    await expect(finish.finish(runtime.runtimeId, session.filePath, beforeBusy.token, 'finish')).rejects.toThrow('invalid or expired')
    expect(await finish.get(session.filePath)).toBeNull()
    await manager.command(runtime.runtimeId, { type: 'abort' })
    await waitUntil(() => manager.getForSession(session.filePath)?.isStreaming === false)
    const review = await finish.review(runtime.runtimeId, session.filePath)
    const statusBefore = git('status', '--porcelain=v1', '--untracked-files=all')
    const refsBefore = git('show-ref')
    let result = await finish.finish(runtime.runtimeId, session.filePath, review.token, 'finish')
    expect(result.review.git.integration.kind).toBe('not-integrated')
    expect(result.review.nextActions.join(' ')).toMatch(/uncommitted/)
    expect(git('status', '--porcelain=v1', '--untracked-files=all')).toBe(statusBefore)
    expect(git('show-ref')).toBe(refsBefore)
    expect(readFileSync(join(checkout, 'dirty.txt'), 'utf8')).toBe('user work')
    expect(existsSync(session.filePath)).toBe(true)
    expect(await service().get(session.filePath)).toEqual(result)
    expect(await service().list()).toEqual([result])
    await expect(finish.finish(runtime.runtimeId, session.filePath, review.token, 'finish')).rejects.toThrow('invalid or expired')
    await expect(manager.command(runtime.runtimeId, { type: 'prompt', message: 'reject me' })).rejects.toThrow('Prompt rejected for test')
    expect(await service().get(session.filePath)).toEqual(result)
    await manager.command(runtime.runtimeId, { type: 'prompt', message: 'work resumed without receipts' })
    expect(await service().get(session.filePath)).toBeNull()
    await manager.command(runtime.runtimeId, { type: 'abort' })
    await waitUntil(() => manager.getForSession(session.filePath)?.isStreaming === false)
    const rereview = await finish.review(runtime.runtimeId, session.filePath)
    result = await finish.finish(runtime.runtimeId, session.filePath, rereview.token, 'finish')
    await manager.stop(runtime.runtimeId)
    const resumed = await manager.start({ cwd: checkout, sessionPath: session.filePath })
    const reloaded = service()
    manager.setPromptAcceptedListener((path) => reloaded.clearForAcceptedPrompt(path))
    manager.setRunReceipts(new RunReceipts(join(fake.cwd, 'run-receipts'), (path) => sessions.requireSessionPath(path)))
    writeFileSync(join(checkout, 'allow-baseline'), '')
    expect(await reloaded.get(session.filePath)).toEqual(result)
    await expect(manager.command(resumed.runtimeId, { type: 'prompt', message: 'reject me' })).rejects.toThrow('Prompt rejected for test')
    expect(await service().get(session.filePath)).toEqual(result)
    await manager.command(resumed.runtimeId, { type: 'prompt', message: 'work resumed' })
    expect(await service().get(session.filePath)).toBeNull()
    expect(await service().list()).toEqual([])
  })

  it('rechecks linked worktree integration, provenance, and repository use before completion', async () => {
    const { fake, checkout, git, sessions, manager, gate, storage } = finishFixture()
    const linked = join(fake.cwd, 'linked')
    git('worktree', 'add', '-qb', 'finish-linked', linked)
    git('remote', 'add', 'origin', checkout)
    git('update-ref', 'refs/remotes/origin/target', 'refs/heads/finish-linked')
    git('config', 'branch.finish-linked.remote', 'origin')
    git('config', 'branch.finish-linked.merge', 'refs/heads/target')
    const linkedSession = await sessions.create(linked)
    const linkedRuntime = await manager.start({ cwd: linked, sessionPath: linkedSession.filePath })
    const linkedFinish = new FinishTaskService(storage, manager, new GitService(async (cwd) => cwd), gate, (path) => sessions.requireSessionPath(path), () => sessions.list(undefined, true, true), async () => [{ app: 'vscode', label: 'other window', sessions: [join(fake.cwd, 'missing-session.jsonl')] }])
    const linkedReview = await linkedFinish.review(linkedRuntime.runtimeId, linkedSession.filePath)
    expect(linkedReview.worktree.kind).toBe('linked')
    expect(linkedReview.worktree.ownership).toBe('unknown')
    expect(linkedReview.git.integration).toEqual({ kind: 'integrated', target: 'origin/target', evidence: 'local-cached-remote-tracking-ref' })
    expect(linkedReview.conflicts).toContainEqual({ kind: 'external-session', app: 'vscode', label: 'other window', session: join(fake.cwd, 'missing-session.jsonl') })
    expect(linkedReview.cleanup.eligible).toBe(false)
    expect(linkedReview.cleanup.reasons.join(' ')).toMatch(/provenance is unknown/)
    const linkedRefs = git('show-ref')
    await linkedFinish.finish(linkedRuntime.runtimeId, linkedSession.filePath, linkedReview.token, 'finish')
    expect(git('show-ref')).toBe(linkedRefs)
    expect(existsSync(linked)).toBe(true)
    const provenance = new WorktreeProvenance(join(fake.cwd, 'worktree-provenance'))
    const candidateService = new FinishTaskService(storage, manager, new GitService(async (cwd) => cwd), gate, (path) => sessions.requireSessionPath(path), () => sessions.list(undefined, true, true), async () => [], provenance)
    expect((await candidateService.review(linkedRuntime.runtimeId, linkedSession.filePath)).cleanup.eligible).toBe(false)
    provenance.recordCreated(linked)
    const candidate = await candidateService.review(linkedRuntime.runtimeId, linkedSession.filePath)
    expect(candidate.worktree.ownership).toBe('apex-created')
    expect(candidate.cleanup).toEqual({ eligible: true, reasons: [] })
    expect(candidate.nextActions.join(' ')).toMatch(/Stop the task runtime/)
    writeFileSync(join(linked, 'dirty-later.txt'), 'changed')
    await expect(candidateService.finish(linkedRuntime.runtimeId, linkedSession.filePath, candidate.token, 'finish')).rejects.toThrow('stale')
    expect((await candidateService.review(linkedRuntime.runtimeId, linkedSession.filePath)).cleanup.eligible).toBe(false)
    rmSync(join(linked, 'dirty-later.txt'))
    const clean = await candidateService.review(linkedRuntime.runtimeId, linkedSession.filePath)
    expect(clean.cleanup.eligible).toBe(true)
    const sharedLease = await gate.beginWorkspaceUse(linked, { kind: 'terminal', terminalId: 'shared-linked' })
    await expect(candidateService.finish(linkedRuntime.runtimeId, linkedSession.filePath, clean.token, 'finish')).rejects.toThrow('stale')
    const sharedCandidate = await candidateService.review(linkedRuntime.runtimeId, linkedSession.filePath)
    expect(sharedCandidate.cleanup.eligible).toBe(false)
    expect(sharedCandidate.conflicts).toContainEqual({ kind: 'terminal', terminalId: 'shared-linked' })
    sharedLease.release()
    git('config', '--unset', 'branch.finish-linked.merge')
    const noTarget = await linkedFinish.review(linkedRuntime.runtimeId, linkedSession.filePath)
    expect(noTarget.git.integration.kind).toBe('unknown')
    expect(noTarget.cleanup.eligible).toBe(false)
    expect(noTarget.cleanup.reasons.join(' ')).toMatch(/target or result is unknown/)
  })
})

describe('run receipts', () => {
  it('preserves attached intent for an already busy runtime without an open receipt', async () => {
    const fake = fakePiAgent({ receipts: true })
    const manager = piManager(fake.executable)
    const events: Array<Record<string, unknown>> = []
    manager.setEventSink(({ event }) => events.push(event))
    const runtime = await manager.start({ cwd: fake.cwd })
    await manager.command(runtime.runtimeId, { type: 'prompt', message: 'work resumed without receipts' })
    await waitUntil(() => manager.getForSession(join(fake.cwd, 'session.jsonl'))?.isStreaming === true)
    const storage = mkdtempSync(join(tmpdir(), 'apex-receipts-')); dirs.push(storage)
    manager.setRunReceipts(new RunReceipts(storage, async (path) => path))
    await manager.command(runtime.runtimeId, { type: 'attached_prompt', intent: 'steer', message: 'steering' })
    await manager.command(runtime.runtimeId, { type: 'attached_prompt', intent: 'queue', message: 'queued' })
    expect(events.filter((event) => event.type === 'fake_prompt').map(({ message, command }) => ({ message, command }))).toEqual([
      { message: 'work resumed without receipts', command: 'prompt' },
      { message: 'steering', command: 'steer' },
      { message: 'queued', command: 'follow_up' },
    ])
    expect(events.some((event) => event.type === 'fake_baseline_wait')).toBe(false)
  })

  it('reserves initial capture, joins queued messages, and finalizes only when Pi is idle', async () => {
    const fake = fakePiAgent({ receipts: true })
    const init = spawnSync('git', ['init', '-q'], { cwd: fake.cwd })
    expect(init.status).toBe(0)
    writeFileSync(join(fake.cwd, '.git', 'info', 'exclude'), 'allow-baseline\nemit-end\nsettle\nhold-post\nallow-post\nsession.jsonl\n')
    const storage = mkdtempSync(join(tmpdir(), 'apex-receipts-')); dirs.push(storage)
    const session = join(fake.cwd, 'session.jsonl')
    writeFileSync(session, '')
    writeFileSync(join(fake.cwd, 'work.txt'), 'before')
    const manager = piManager(fake.executable)
    const changes: string[] = []
    let notify!: (path: string) => void
    const terminal = new Promise<string>((resolve) => { notify = resolve })
    const receipts = new RunReceipts(storage, async (path) => path, (path) => { changes.push(path); notify(path) })
    manager.setRunReceipts(receipts)
    const events: Array<Record<string, unknown>> = []
    manager.setEventSink(({ event }) => events.push(event))
    const runtime = await manager.start({ cwd: fake.cwd })
    const first = manager.command(runtime.runtimeId, { type: 'prompt', message: 'first' })
    await waitUntil(() => events.some((event) => event.type === 'fake_baseline_wait'))
    expect(events.some((event) => event.type === 'fake_prompt')).toBe(false)
    expect((await manager.command(runtime.runtimeId, { type: 'abort' })).success).toBe(true)
    writeFileSync(join(fake.cwd, 'allow-baseline'), '')
    await first
    await manager.command(runtime.runtimeId, { type: 'attached_prompt', intent: 'queue', message: 'second' })
    writeFileSync(join(fake.cwd, 'work.txt'), 'after')
    writeFileSync(join(fake.cwd, 'emit-end'), '')
    await waitUntil(() => events.some((event) => event.type === 'agent_end'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect((await receipts.list(session))[0].state).toBe('open')
    writeFileSync(join(fake.cwd, 'hold-post'), '')
    writeFileSync(join(fake.cwd, 'settle'), '')
    await waitUntil(() => events.some((event) => event.type === 'fake_post_wait'))
    expect(changes).toEqual([])
    const third = manager.command(runtime.runtimeId, { type: 'prompt', message: 'third' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(events.filter((event) => event.type === 'fake_prompt')).toHaveLength(2)
    writeFileSync(join(fake.cwd, 'allow-post'), '')
    await third
    expect(normalize(await terminal)).toBe(session)
    const reopened = new RunReceipts(storage, async (path) => path)
    const receipt = (await reopened.list(session)).find((item) => item.state === 'complete')
    expect(receipt).toMatchObject({ state: 'complete', anchorUserEntryId: 'user-1', memberUserEntryIds: ['user-1', 'user-2'], attribution: 'observed-checkout', inputs: [{ kind: 'prompt', disposition: 'started' }, { kind: 'follow_up', disposition: 'queued' }] })
    await expect(reopened.file(join(fake.cwd, 'other.jsonl'), 'user-1', 'work.txt')).rejects.toThrow('unavailable')
    expect(await reopened.file(session, 'user-2', 'work.txt')).toMatchObject({ before: { base64: Buffer.from('before').toString('base64') }, after: { base64: Buffer.from('after').toString('base64') } })
    expect((await reopened.list(session))).toHaveLength(2)
    await manager.stop(runtime.runtimeId)
    expect(changes.map(normalize)).toEqual([session, session])
    const interrupted = (await reopened.list(session)).find((item) => item.state === 'incomplete')
    expect(interrupted?.error).toMatch(/exited|interrupted/)
  }, 15_000)
})

describe('rewind contract', () => {
  it('checks worktree, busy and stale state, honors cancellation, then forks the run anchor and restores', async () => {
    const fake = fakePiAgent({ receipts: true })
    const git = (...args: string[]) => { const result = spawnSync('git', args, { cwd: fake.cwd, encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr) }
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
    writeFileSync(join(fake.cwd, 'work.txt'), 'before')
    git('add', 'work.txt'); git('commit', '-qm', 'base')
    writeFileSync(join(fake.cwd, '.git', 'info', 'exclude'), 'allow-baseline\nemit-end\nsettle\ncancel-fork\nchange-on-fork\nsession.jsonl\nfork-*.jsonl\nignored.txt\n')
    const parent = mkdtempSync(join(tmpdir(), 'apex-rewind-tree-')); dirs.push(parent)
    const checkout = join(parent, 'linked')
    git('worktree', 'add', '-qb', 'rewind-fixture', checkout)
    const headBefore = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).stdout
    const indexBefore = spawnSync('git', ['ls-files', '--stage'], { cwd: checkout, encoding: 'utf8' }).stdout
    const storage = mkdtempSync(join(tmpdir(), 'apex-rewind-store-')); dirs.push(storage)
    const session = join(checkout, 'session.jsonl'); writeFileSync(session, '')
    const manager = piManager(fake.executable)
    const gate = new RepositoryUseGate()
    manager.setWorkspaceUseProvider((cwd, owner, retire) => gate.beginWorkspaceUse(cwd, owner, retire))
    const receipts = new RunReceipts(storage, async (path) => path)
    manager.setRunReceipts(receipts)
    let otherSessions: string[] = []
    const rewind = new RewindService(manager, receipts, gate,
      async () => [{ id: 'other', harness: 'pi', filePath: 'other-session.jsonl', projectPath: checkout, title: 'Other', createdAt: '', updatedAt: '', status: 'running', depth: 0 }],
      async () => otherSessions.length ? [{ app: 'vscode', label: 'VS Code', sessions: otherSessions }] : [])
    const events: Array<Record<string, unknown>> = []
    manager.setEventSink(({ event }) => events.push(event))
    const runtime = await manager.start({ cwd: checkout })
    const first = manager.command(runtime.runtimeId, { type: 'prompt', message: 'first prompt' })
    await waitUntil(() => events.some((event) => event.type === 'fake_baseline_wait'))
    writeFileSync(join(checkout, 'allow-baseline'), ''); await first
    await manager.command(runtime.runtimeId, { type: 'attached_prompt', intent: 'queue', message: 'queued prompt' })
    await expect(rewind.preview(runtime.runtimeId, session, 'user-2')).rejects.toThrow(/busy/)
    writeFileSync(join(checkout, 'work.txt'), 'after')
    writeFileSync(join(checkout, 'ignored.txt'), 'ignored')
    writeFileSync(join(checkout, 'settle'), '')
    let done = false
    for (let n = 0; n < 200 && !done; n++) { done = (await receipts.list(session)).some((r) => r.state === 'complete'); if (!done) await new Promise((r) => setTimeout(r, 10)) }
    expect(done).toBe(true)
    await expect(rewind.preview(runtime.runtimeId, session, 'desktop-user-1')).rejects.toThrow(/not available/)
    const busyPreview = await rewind.preview(runtime.runtimeId, session, 'user-1')
    await manager.command(runtime.runtimeId, { type: 'prompt', message: 'another run' })
    await expect(rewind.execute(runtime.runtimeId, session, busyPreview.token)).rejects.toThrow(/busy/)
    writeFileSync(join(checkout, 'settle'), '')
    let secondDone = false
    for (let n = 0; n < 200 && !secondDone; n++) { secondDone = (await receipts.list(session)).filter((r) => r.state === 'complete').length === 2; if (!secondDone) await new Promise((r) => setTimeout(r, 10)) }
    expect(secondDone).toBe(true)
    const preview = await rewind.preview(runtime.runtimeId, session, 'user-2')
    await expect(rewind.execute(runtime.runtimeId, join(checkout, 'other.jsonl'), preview.token)).rejects.toThrow(/invalid or expired/)
    expect(preview).toMatchObject({ anchorUserEntryId: 'user-1', rewindToRunStart: true, prompt: 'first prompt', worktree: { linked: true, primary: false }, restore: { available: true } })
    writeFileSync(join(checkout, 'work.txt'), 'later')
    await expect(rewind.execute(runtime.runtimeId, session, preview.token, { restoreFiles: true, confirmation: 'restore', fingerprint: preview.restore.fingerprint })).rejects.toThrow('Stale restore preview')
    expect(events.some((event) => event.type === 'fake_fork')).toBe(false)
    otherSessions = ['other-session.jsonl']
    const registered = await rewind.preview(runtime.runtimeId, session, 'user-1')
    expect(registered.restore.reason).toMatch(/registered session/)
    otherSessions = []
    const unconfirmed = await rewind.preview(runtime.runtimeId, session, 'user-1')
    await expect(rewind.execute(runtime.runtimeId, session, unconfirmed.token, { restoreFiles: true, fingerprint: unconfirmed.restore.fingerprint })).rejects.toThrow(/Confirmed/)
    const beforeConflict = await rewind.preview(runtime.runtimeId, session, 'user-1')
    const conflict = await gate.beginWorkspaceUse(checkout, { kind: 'terminal', terminalId: 'other' })
    const blocked = await rewind.preview(runtime.runtimeId, session, 'user-1')
    expect(blocked.restore.available).toBe(false)
    await expect(rewind.execute(runtime.runtimeId, session, beforeConflict.token, { restoreFiles: true, confirmation: 'restore', fingerprint: beforeConflict.restore.fingerprint })).rejects.toMatchObject({ code: 'active-work' })
    expect(events.some((event) => event.type === 'fake_fork')).toBe(false)
    conflict.release()
    writeFileSync(join(checkout, 'cancel-fork'), '')
    const cancelled = await rewind.preview(runtime.runtimeId, session, 'user-2')
    expect(await rewind.execute(runtime.runtimeId, session, cancelled.token, { restoreFiles: true, confirmation: 'restore', fingerprint: cancelled.restore.fingerprint })).toEqual({ kind: 'cancelled' })
    expect(readFileSync(join(checkout, 'work.txt'), 'utf8')).toBe('later')
    rmSync(join(checkout, 'cancel-fork'))
    const final = await rewind.preview(runtime.runtimeId, session, 'user-2')
    expect(await rewind.execute(runtime.runtimeId, session, final.token, { restoreFiles: true, confirmation: 'restore', fingerprint: final.restore.fingerprint })).toMatchObject({ kind: 'rewound', sessionId: 'fork-session', prompt: 'first prompt', files: 'restored' })
    expect(events.filter((event) => event.type === 'fake_fork').every((event) => event.entryId === 'user-1')).toBe(true)
    expect(readFileSync(join(checkout, 'work.txt'), 'utf8')).toBe('before')
    expect(readFileSync(join(checkout, 'ignored.txt'), 'utf8')).toBe('ignored')
    expect(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).stdout).toBe(headBefore)
    expect(spawnSync('git', ['ls-files', '--stage'], { cwd: checkout, encoding: 'utf8' }).stdout).toBe(indexBefore)
    const forkSession = join(checkout, 'fork-1.jsonl')
    await manager.command(runtime.runtimeId, { type: 'prompt', message: 'race prompt' })
    writeFileSync(join(checkout, 'work.txt'), 'run-edited')
    writeFileSync(join(checkout, 'settle'), '')
    let raceDone = false
    for (let n = 0; n < 200 && !raceDone; n++) { raceDone = (await receipts.list(forkSession)).some((r) => r.state === 'complete'); if (!raceDone) await new Promise((r) => setTimeout(r, 10)) }
    expect(raceDone).toBe(true)
    const racePreview = await rewind.preview(runtime.runtimeId, forkSession, 'user-4')
    writeFileSync(join(checkout, 'change-on-fork'), '')
    expect(await rewind.execute(runtime.runtimeId, forkSession, racePreview.token, { restoreFiles: true, confirmation: 'restore', fingerprint: racePreview.restore.fingerprint })).toMatchObject({ kind: 'restore-failed', filesMayBePartial: false, error: expect.stringMatching(/Stale restore preview/) })
    expect(readFileSync(join(checkout, 'work.txt'), 'utf8')).toBe('race')
    rmSync(join(checkout, 'change-on-fork'))
    const secondForkSession = join(checkout, 'fork-2.jsonl')
    await manager.command(runtime.runtimeId, { type: 'prompt', message: 'disk failure prompt' })
    writeFileSync(join(checkout, 'work.txt'), 'changed again')
    writeFileSync(join(checkout, 'settle'), '')
    let failureRunDone = false
    for (let n = 0; n < 200 && !failureRunDone; n++) { failureRunDone = (await receipts.list(secondForkSession)).some((r) => r.state === 'complete'); if (!failureRunDone) await new Promise((r) => setTimeout(r, 10)) }
    expect(failureRunDone).toBe(true)
    const failurePreview = await rewind.preview(runtime.runtimeId, secondForkSession, 'user-5')
    vi.spyOn(receipts, 'restoreCheckpoint').mockImplementationOnce(() => { writeFileSync(join(checkout, 'work.txt'), 'partial'); throw new Error('disk failure') })
    expect(await rewind.execute(runtime.runtimeId, secondForkSession, failurePreview.token, { restoreFiles: true, confirmation: 'restore', fingerprint: failurePreview.restore.fingerprint })).toMatchObject({ kind: 'restore-failed', filesMayBePartial: true, error: 'disk failure' })
    expect(readFileSync(join(checkout, 'work.txt'), 'utf8')).toBe('partial')

    const primarySession = join(fake.cwd, 'session.jsonl'); writeFileSync(primarySession, '')
    writeFileSync(join(fake.cwd, 'allow-baseline'), '')
    const primary = await manager.start({ cwd: fake.cwd })
    await manager.command(primary.runtimeId, { type: 'prompt', message: 'primary prompt' })
    writeFileSync(join(fake.cwd, 'settle'), '')
    let primaryDone = false
    for (let n = 0; n < 200 && !primaryDone; n++) { primaryDone = (await receipts.list(primarySession)).some((r) => r.state === 'complete'); if (!primaryDone) await new Promise((r) => setTimeout(r, 10)) }
    expect(primaryDone).toBe(true)
    const primaryPreview = await rewind.preview(primary.runtimeId, primarySession, 'user-1')
    expect(primaryPreview.worktree.primary).toBe(true)
    expect(primaryPreview.restore).toMatchObject({ available: false, reason: expect.stringMatching(/primary/) })
    await expect(rewind.execute(primary.runtimeId, primarySession, primaryPreview.token, { restoreFiles: true, confirmation: 'restore', fingerprint: primaryPreview.restore.fingerprint })).rejects.toThrow(/Confirmed/)
    const emptyStorage = mkdtempSync(join(tmpdir(), 'apex-rewind-empty-')); dirs.push(emptyStorage)
    const noCheckpoint = new RewindService(manager, new RunReceipts(emptyStorage, async (path) => path), gate, async () => [], async () => [])
    const conversationOnly = await noCheckpoint.preview(primary.runtimeId, primarySession, 'user-1')
    expect(conversationOnly.restore).toMatchObject({ available: false, reason: expect.stringMatching(/No completed checkpoint/) })
    await expect(noCheckpoint.execute(primary.runtimeId, primarySession, conversationOnly.token)).resolves.toMatchObject({ kind: 'rewound', files: 'kept', prompt: 'primary prompt' })
  }, 20_000)
})

describe('pi RPC adapter argv', () => {
  const baseInput = { cwd: '/work/project', environment: {} as NodeJS.ProcessEnv }

  it('builds the base argv without a --cwd flag and declares spawnsInCwd instead', () => {
    expect(PI_RPC_ADAPTER.buildStartArgs(baseInput)).toEqual(['--mode', 'rpc'])
    expect(PI_RPC_ADAPTER.spawnsInCwd).toBe(true)
  })

  it('resumes with --session, never the interactive --resume selector', () => {
    const args = PI_RPC_ADAPTER.buildStartArgs({ ...baseInput, sessionPath: '/sessions/bucket/run.jsonl' })
    expect(args).toEqual(['--mode', 'rpc', '--session', '/sessions/bucket/run.jsonl'])
    expect(args).not.toContain('--resume')
  })

  it('passes the model as split --provider/--model flags like Prime', () => {
    const args = PI_RPC_ADAPTER.buildStartArgs({ ...baseInput, providerId: 'openai-codex', modelId: 'gpt-5.6-luna', thinking: 'high' })
    expect(args).toEqual(['--mode', 'rpc', '--provider', 'openai-codex', '--model', 'gpt-5.6-luna', '--thinking', 'high'])
  })

  it('passes an unresolved model string without --provider and rejects unsafe values', () => {
    expect(PI_RPC_ADAPTER.buildStartArgs({ ...baseInput, modelId: 'gpt-5.6-luna' }))
      .toEqual(['--mode', 'rpc', '--model', 'gpt-5.6-luna'])
    expect(() => PI_RPC_ADAPTER.buildStartArgs({ ...baseInput, modelId: '--resume' })).toThrow('Invalid model')
    expect(() => PI_RPC_ADAPTER.buildStartArgs({ ...baseInput, providerId: 'p', modelId: 'model\nid' })).toThrow('Invalid model')
  })

  it('injects only the enabled computer-use skill and forwards the scoped app extensions', () => {
    const environment = {
      APEX_SCHEDULE_SKILL_PATH: '/skills/schedule.md',
      APEX_BROWSER_SKILL_PATH: '/skills/browser.md',
      APEX_SCHEDULE_EXTENSION_PATH: '/extensions/schedules.ts',
      APEX_BROWSER_EXTENSION_PATH: '/extensions/browser.ts',
      APEX_ASK_USER_EXTENSION_PATH: '/extensions/ask-user.ts',
      GOOEYPI_COLLABORATION_EXTENSION_PATH: '/extensions/collaboration.ts',
      GOOEYPI_PI_FAST_MODE_EXTENSION_PATH: '/extensions/pi-fast-mode.ts',
      GOOEYPI_COMPUTER_USE_SKILL_PATH: '/skills/computer-use.md',
    } as NodeJS.ProcessEnv
    const args = PI_RPC_ADAPTER.buildStartArgs({ ...baseInput, environment })
    expect(args.slice(-12)).toEqual([
      '--skill', '/skills/computer-use.md',
      '--extension', '/extensions/pi-fast-mode.ts',
      '--extension', '/extensions/schedules.ts',
      '--extension', '/extensions/browser.ts',
      '--extension', '/extensions/ask-user.ts',
      '--extension', '/extensions/collaboration.ts',
    ])
  })

  it('drops unsafe extension paths instead of passing them through', () => {
    const environment = { APEX_BROWSER_EXTENSION_PATH: '--extension-injection' } as NodeJS.ProcessEnv
    expect(PI_RPC_ADAPTER.buildStartArgs({ ...baseInput, environment })).toEqual(['--mode', 'rpc'])
  })
})

describe('pi RPC handshake', () => {
  it('owns a durable project coordinator separately, pins each attachment, and wakes background follow-ups only in granted projects', async () => {
    const fake = fakePiAgent()
    const cwd = realpathSync(fake.cwd)
    const statePath = join(cwd, 'coordinator-state.json')
    const store = new JsonStateStore(statePath)
    const info = lstatSync(cwd, { bigint: true })
    await store.update((draft) => { draft.projects.push({
      id: 'project', harness: 'pi', name: 'Project', path: cwd, folders: [cwd], primaryFolder: cwd, pinned: false,
      createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(),
      folderIdentities: { [cwd]: { dev: info.dev.toString(), ino: info.ino.toString(), birthtimeNs: info.birthtimeNs.toString() } },
    }) })
    const projects = new ProjectService(store, () => null)
    const sessions = new SessionService(store, () => null, 5000, piSessionServiceOptions(join(cwd, 'sessions')))
    const manager = new AgentRpcManager(fake.executable, (path) => projects.authorizeCwd(path), (path) => sessions.requireSessionPath(path))
    managers.push(manager)
    const control = new ActivityCoordinatorService(store, projects, sessions, manager)
    const events: Record<string, unknown>[] = []
    const unsubscribe = manager.subscribe(({ event }) => events.push(event))
    try {
      await expect(control.open(1, 'not-granted')).rejects.toThrow('explicitly granted')
      const [first, second] = await Promise.all([control.open(1, 'project'), control.open(2, 'project')])
      expect(first.session.filePath).toBe(second.session.filePath)
      expect(first.runtime.runtimeId).toBe(second.runtime.runtimeId)
      expect(first.attachmentId).not.toBe(second.attachmentId)
      expect(first.pendingDialogs).toEqual([])
      expect((await sessions.list()).filter((session) => session.role === 'coordinator')).toHaveLength(1)
      expect(events.some((event) => event.type === 'fake_prompt')).toBe(false)
      expect(control.close(2, first.attachmentId)).toBe(false)
      expect(control.close(1, first.attachmentId)).toBe(true)
      expect(control.close(1, first.attachmentId)).toBe(false)
      for (let i = 0; i < 4; i += 1) {
        const worker = await sessions.create(cwd)
        await manager.start({ cwd, sessionPath: worker.filePath })
      }
      expect(manager.getForSession(first.session.filePath)?.runtimeId).toBe(first.runtime.runtimeId)
      expect(control.close(2, second.attachmentId)).toBe(true)
      await manager.stop(first.runtime.runtimeId)
      await expect(control.followUp(first.session.filePath, 'Summarize the implementor results.', 'queue')).resolves.toBe(true)
      await waitUntil(() => events.some((event) => event.type === 'fake_prompt'))
      expect(events.find((event) => event.type === 'fake_prompt')?.message).toBe('Summarize the implementor results.')
      expect(manager.getForSession(first.session.filePath)?.runtimeId).not.toBe(first.runtime.runtimeId)
      const reopenedStore = new JsonStateStore(statePath)
      await reopenedStore.ready()
      expect(reopenedStore.getCoordinatorSessions().project).toBe(first.session.filePath)
      await reopenedStore.beginShutdown()
      await store.update((draft) => { draft.projects = [] })
      await expect(control.followUp(first.session.filePath, 'Should be denied', 'queue')).rejects.toThrow()
      await expect(control.open(1, 'project')).rejects.toThrow('explicitly granted')
    } finally {
      unsubscribe()
      control.dispose()
      await store.beginShutdown()
    }
  }, 60_000)

  it('releases the exact runtime environment after Pi termination', async () => {
    const fake = fakePiAgent()
    const manager = piManager(fake.executable)
    const environment = { GOOEYPI_COLLABORATION_TOKEN: 'pi-runtime-token' }
    const ended = vi.fn()
    manager.setRuntimeEnvironmentProvider(() => environment)
    manager.setRuntimeEndListener(ended)
    const runtime = await manager.start({ cwd: fake.cwd })

    expect(ended).not.toHaveBeenCalled()
    await manager.stop(runtime.runtimeId)
    expect(ended).toHaveBeenCalledOnce()
    expect(ended.mock.calls[0][0]).toBe(environment)
    expect(ended.mock.calls[0][1]).toMatchObject({ runtimeId: runtime.runtimeId, harness: 'pi' })
  })

  it('handshakes Prime-style without protocol negotiation and reads no harness state fields', async () => {
    const fake = fakePiAgent()
    const manager = piManager(fake.executable)
    const events: Array<Record<string, unknown>> = []
    manager.setEventSink(({ event }) => events.push(event))

    const runtime = await manager.start({ cwd: fake.cwd })

    expect(runtime.harness).toBe('pi')
    expect(runtime.sessionId).toBe('pi-session')
    expect(runtime.model).toEqual({ provider: 'openai-codex', id: 'gpt-5.6-luna', name: 'Luna GPT-5.6' })
    // readState returns {}: the hostile serviceTier/fastModeEnabled fields in
    // get_state never reach the runtime info.
    expect(runtime.serviceTier).toBeUndefined()
    expect(runtime.fastModeAvailable).toBeUndefined()
    // Context usage flows through the shared get_session_stats path, not the
    // contextUsage field pi's get_state does not really carry.
    await waitUntil(() => manager.list()[0]?.contextUsage !== undefined)
    expect(manager.list()[0]?.contextUsage).toEqual({ tokens: 12_000, contextWindow: 272_000, percent: 4 })
    expect(manager.list()[0]?.sessionUsage).toEqual({ cost: 0.4321, tokens: { input: 10_000, output: 2_000, cacheRead: 500, cacheWrite: 100, total: 12_600 } })
    // A negotiate_protocol frame would have been answered with a failure that
    // aborts the handshake; the fake also records every unknown command.
    expect(events.some((event) => event.type === 'fake_unknown_command')).toBe(false)
  })

  it('spawns the child in the authorized cwd because pi has no --cwd flag', async () => {
    const fake = fakePiAgent()
    const manager = piManager(fake.executable)
    const events: Array<Record<string, unknown>> = []
    manager.setEventSink(({ event }) => events.push(event))

    await manager.start({ cwd: fake.cwd })

    await waitUntil(() => events.some((event) => event.type === 'fake_cwd'))
    const reported = (events.find((event) => event.type === 'fake_cwd') as { cwd: string }).cwd
    expect(realpathSync(reported)).toBe(realpathSync(fake.cwd))
    const argv = (events.find((event) => event.type === 'fake_argv') as { argv: string[] }).argv
    expect(argv).not.toContain('--cwd')
  })

  it('does not inherit a parent agent session identity but keeps user Pi configuration', async () => {
    const inherited = {
      PI_SUBAGENT: '1', PI_SUBAGENT_AGENT: 'sidekick', PI_SUBAGENT_MODEL: 'openai/gpt', PI_FUSION_SIDEKICK: '1', PI_ASYNC_RPC: '1',
      PI_BEHAVIOR_MODE: 'fusion', PI_SESSION_ID: 'parent-session', PI_SESSION_FILE: '/parent.jsonl', PI_INTERCOM_SESSION_ID: 'parent-intercom',
      PI_CODING_AGENT_DIR: '/home/user/.pi/agent',
    }
    for (const [key, value] of Object.entries(inherited)) vi.stubEnv(key, value)
    try {
      const fake = fakePiAgent()
      const manager = piManager(fake.executable)
      const events: Array<Record<string, unknown>> = []
      manager.setEventSink(({ event }) => events.push(event))

      await manager.start({ cwd: fake.cwd })

      await waitUntil(() => events.some((event) => event.type === 'fake_env'))
      const env = (events.find((event) => event.type === 'fake_env') as { env: Record<string, string> }).env
      for (const key of Object.keys(inherited).filter((key) => key !== 'PI_CODING_AGENT_DIR')) expect(env[key]).toBeUndefined()
      expect(env.PI_CODING_AGENT_DIR).toBe('/home/user/.pi/agent')
    } finally { vi.unstubAllEnvs() }
  })

  it('spawns with --session, split provider/model flags, and scoped extensions', async () => {
    const fake = fakePiAgent()
    const manager = piManager(fake.executable, { providers: piCatalog })
    manager.setRuntimeEnvironmentProvider(() => ({
      APEX_SCHEDULE_SKILL_PATH: '/skills/schedule.md',
      APEX_BROWSER_SKILL_PATH: '/skills/browser.md',
      APEX_SCHEDULE_EXTENSION_PATH: '/extensions/schedules.ts',
      APEX_BROWSER_EXTENSION_PATH: '/extensions/browser.ts',
      APEX_ASK_USER_EXTENSION_PATH: '/extensions/ask-user.ts',
      GOOEYPI_COLLABORATION_EXTENSION_PATH: '/extensions/collaboration.ts',
      GOOEYPI_PI_FAST_MODE_EXTENSION_PATH: '/extensions/pi-fast-mode.ts',
    }))
    const events: Array<Record<string, unknown>> = []
    manager.setEventSink(({ event }) => events.push(event))

    const sessionPath = join(fake.cwd, 'run.jsonl')
    writeFileSync(sessionPath, '')
    await manager.start({ cwd: fake.cwd, sessionPath, model: 'openai-codex/gpt-5.6-luna', thinking: 'high' })

    await waitUntil(() => events.some((event) => event.type === 'fake_argv'))
    const argv = (events.find((event) => event.type === 'fake_argv') as { argv: string[] }).argv
    expect(argv[argv.indexOf('--session') + 1]).toBe(sessionPath)
    expect(argv).not.toContain('--resume')
    expect(argv[argv.indexOf('--provider') + 1]).toBe('openai-codex')
    expect(argv[argv.indexOf('--model') + 1]).toBe('gpt-5.6-luna')
    expect(argv[argv.indexOf('--thinking') + 1]).toBe('high')
    expect(argv).not.toContain('--skill')
    expect(argv).not.toContain('--approval-mode')
    const extensionPaths = argv.flatMap((value, index) => value === '--extension' ? [argv[index + 1]] : [])
    expect(extensionPaths).toEqual(['/extensions/pi-fast-mode.ts', '/extensions/schedules.ts', '/extensions/browser.ts', '/extensions/ask-user.ts', '/extensions/collaboration.ts'])
  })

  it('reconciles the requested model and thinking level when a startup extension overrides CLI flags', async () => {
    const fake = fakePiAgent({
      initialModel: { provider: 'openai', id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
    })
    const manager = piManager(fake.executable, { providers: piCatalog })
    const events: Array<Record<string, unknown>> = []
    manager.setEventSink(({ event }) => events.push(event))

    const sessionPath = join(fake.cwd, 'run.jsonl')
    writeFileSync(sessionPath, '')
    const runtime = await manager.start({
      cwd: fake.cwd,
      sessionPath,
      model: 'openai-codex/gpt-5.6-luna',
      thinking: 'high',
    })

    expect(runtime.model).toMatchObject({ provider: 'openai-codex', id: 'gpt-5.6-luna' })
    expect(runtime.thinkingLevel).toBe('high')
    expect(events).toContainEqual({ type: 'fake_set_model', provider: 'openai-codex', modelId: 'gpt-5.6-luna' })
    expect(events).toContainEqual({ type: 'fake_set_thinking_level', level: 'high' })
  })
})

describe('pi RPC command translation', () => {
  it('passes fork and get_fork_messages through untranslated', async () => {
    const fake = fakePiAgent()
    const manager = piManager(fake.executable)
    const runtime = await manager.start({ cwd: fake.cwd })

    const fork = await manager.command(runtime.runtimeId, { type: 'fork', entryId: 'entry-123' })
    expect(fork.command).toBe('fork')
    expect(fork.data).toEqual({ received: 'fork', entryId: 'entry-123' })

    const messages = await manager.command(runtime.runtimeId, { type: 'get_fork_messages' })
    expect(messages.command).toBe('get_fork_messages')
    expect(messages.data).toMatchObject({ received: 'get_fork_messages' })
  })

  it('rejects Prime-only daemon commands with a clear error before they reach the agent', async () => {
    const fake = fakePiAgent()
    const manager = piManager(fake.executable)
    const events: Array<Record<string, unknown>> = []
    manager.setEventSink(({ event }) => events.push(event))
    const runtime = await manager.start({ cwd: fake.cwd })

    await expect(manager.command(runtime.runtimeId, { type: 'send_message', targetActiveSessionId: 'session-1', message: 'hello' }))
      .rejects.toThrow('RPC command send_message is not supported by the Pi harness')
    await expect(manager.command(runtime.runtimeId, { type: 'clone' }))
      .rejects.toThrow('RPC command clone is not supported by the Pi harness')
    await expect(manager.command(runtime.runtimeId, { type: 'list_heartbeats' }))
      .rejects.toThrow('RPC command list_heartbeats is not exposed to the renderer')
    expect(events.some((event) => event.type === 'fake_unknown_command')).toBe(false)
  })

  it('maps set_service_tier onto the bundled Pi fast-mode command', async () => {
    const fake = fakePiAgent()
    const manager = piManager(fake.executable, { providers: piCatalog })
    const events: Array<Record<string, unknown>> = []
    manager.setEventSink(({ event }) => events.push(event))
    const runtime = await manager.start({ cwd: fake.cwd })

    await manager.command(runtime.runtimeId, { type: 'set_service_tier', serviceTier: 'priority' })
    expect(manager.list()[0]?.serviceTier).toBe('priority')
    await manager.command(runtime.runtimeId, { type: 'set_service_tier', serviceTier: 'default' })
    expect(manager.list()[0]?.serviceTier).toBe('default')
    expect(events.filter((event) => event.type === 'fake_prompt').map((event) => event.message)).toEqual([
      '/gooeypi-fast-mode priority',
      '/gooeypi-fast-mode default',
    ])
    expect(events.some((event) => event.type === 'fake_unknown_command')).toBe(false)
  })
})

describe('pi RPC event normalization', () => {
  it('passes Prime-vocabulary events through unmodified, including unknown types', async () => {
    const fake = fakePiAgent({ promptScript: `
    send({ type: 'agent_start' })
    send({ type: 'session_info_changed', name: 'Renamed session' })
    send({ type: 'agent_end', isTerminal: false })` })
    const manager = piManager(fake.executable)
    const events: Array<Record<string, unknown>> = []
    manager.setEventSink(({ event }) => events.push(event))
    const runtime = await manager.start({ cwd: fake.cwd })

    await manager.command(runtime.runtimeId, { type: 'prompt', message: 'continue' })

    await waitUntil(() => events.some((event) => event.type === 'agent_end'))
    // Unknown event types are forwarded for the reducer to ignore, and pi's
    // agent_end is terminal Prime-style even without an isTerminal marker.
    expect(events.find((event) => event.type === 'session_info_changed')).toMatchObject({ name: 'Renamed session' })
    expect(events.filter((event) => event.type === 'agent_end')).toHaveLength(1)
    expect(manager.list()[0]?.isStreaming).toBe(false)
  })

  it('reads {} from get_state for harness fields', () => {
    expect(PI_RPC_ADAPTER.readState({
      serviceTier: 'priority',
      fastModeEnabled: true,
      contextUsage: { tokens: 1, contextWindow: 100, percent: 1 },
    })).toEqual({})
  })
})
