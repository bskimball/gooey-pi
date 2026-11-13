import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  app: { getApplicationNameForProtocol: vi.fn(() => 'Visual Studio Code') },
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
}))

vi.mock('electron', () => electronMocks)

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpc, type IpcRegistration } from '../../apps/desktop/electron/main/ipc'
import { SessionHandoff } from '../../apps/desktop/electron/main/session-handoff'
import * as runtimeOwners from 'apex-core/sessions/runtime-owners'

const EXPECTED_URL = 'prime-work://app/'

function serviceStub(): Record<string, unknown> {
  return new Proxy({}, { get: () => vi.fn(async () => undefined) })
}

function services(): Record<string, unknown> {
  return {
    meta: { version: '0.0.0-test' },
    projects: serviceStub(),
    sessions: { ...serviceStub(), onDidChange: vi.fn(() => () => undefined) },
    agents: serviceStub(),
    terminals: { ...serviceStub(), input: vi.fn(), killOwner: vi.fn(async () => undefined) },
    git: serviceStub(),
    plugins: serviceStub(),
    catalog: serviceStub(),
    settings: serviceStub(),
    schedules: { ...serviceStub(), onDidChange: vi.fn(() => () => undefined) },
    browser: { ...serviceStub(), onDidChange: vi.fn(() => vi.fn()), onPointer: vi.fn(() => vi.fn()), onActivity: vi.fn(() => vi.fn()) },
    pets: { list: vi.fn(async () => [{ id: 'orb' }]), sprite: vi.fn(async () => 'data:image/webp;base64,pet') },
    applyInterfaceZoom: vi.fn(),
  }
}

interface FakeSenderOptions {
  id?: number
  url?: string
  frameUrl?: string
  destroyed?: boolean
  subFrame?: boolean
}

function fakeEvent(options: FakeSenderOptions = {}) {
  const mainFrame = { url: options.frameUrl ?? EXPECTED_URL }
  const sender = {
    id: options.id ?? 1,
    isDestroyed: () => options.destroyed === true,
    getURL: () => options.url ?? EXPECTED_URL,
    setZoomFactor: vi.fn(),
    mainFrame,
  }
  // A sub-frame sender presents a senderFrame that is not the main frame,
  // even when that frame reports the trusted URL.
  const senderFrame = options.subFrame ? { url: options.frameUrl ?? EXPECTED_URL } : mainFrame
  return { sender, senderFrame }
}

describe('registerIpc verify gate', () => {
  let handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>
  let listeners: Map<string, (event: unknown, ...args: unknown[]) => void>
  let registration: IpcRegistration
  let stubs: Record<string, unknown>

  beforeEach(() => {
    handlers = new Map()
    listeners = new Map()
    electronMocks.ipcMain.handle.mockReset()
    electronMocks.ipcMain.on.mockReset()
    electronMocks.ipcMain.handle.mockImplementation((channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, listener)
    })
    electronMocks.ipcMain.on.mockImplementation((channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
      listeners.set(channel, listener)
    })
    stubs = services()
    registration = registerIpc(stubs as never, EXPECTED_URL)
  })

  it('validates run receipt IPC arguments before forwarding', async () => {
    const list = vi.fn(() => [])
    const file = vi.fn(() => ({ before: null, after: null }))
    stubs.agents = { runReceipts: () => ({ list, file }) }
    const event = fakeEvent()
    const receipts = handlers.get('sessions:run-receipts')!
    const runFile = handlers.get('sessions:run-file')!
    expect(() => receipts(event, 'session.jsonl')).toThrow('IPC sender is not authorized')
    registration.authorize(event.sender as never)
    expect(() => receipts(event, 42)).toThrow('filePath must be a string')
    expect(() => runFile(event, 'session.jsonl', 42, 'file.txt')).toThrow('user entry id must be a string')
    expect(() => runFile(event, 'session.jsonl', 'entry', 42)).toThrow('path must be a string')
    expect(list).not.toHaveBeenCalled()
    expect(file).not.toHaveBeenCalled()
    expect(receipts(event, 'session.jsonl')).toEqual([])
    expect(runFile(event, 'session.jsonl', 'entry', 'file.txt')).toEqual({ before: null, after: null })
    expect(list).toHaveBeenCalledWith('session.jsonl')
    expect(file).toHaveBeenCalledWith('session.jsonl', 'entry', 'file.txt')
    await registration.dispose()
  })

  it('runs effective config only after sender, input and project authorization', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'apex-effect-config-'))
    mkdirSync(join(directory, '.git'))
    writeFileSync(join(directory, 'AGENTS.md'), 'project instructions')
    const authorizeReadOnlyCwd = vi.fn(async () => directory)
    stubs.projects = { authorizeReadOnlyCwd }
    stubs.extensionPathContext = { isPackaged: false, appPath: directory, resourcesPath: directory }
    const event = fakeEvent()
    const invoke = handlers.get('runtime:effective-config')!
    try {
      expect(() => invoke(event, directory)).toThrow('IPC sender is not authorized')
      expect(authorizeReadOnlyCwd).not.toHaveBeenCalled()
      registration.authorize(event.sender as never)
      await expect(invoke(event, 42)).rejects.toThrow('cwd must be a string')
      expect(authorizeReadOnlyCwd).not.toHaveBeenCalled()
      const result = await invoke(event, directory)
      expect(result).toMatchObject({ instructionSources: expect.arrayContaining([
        { scope: 'project', kind: 'AGENTS.md', path: join(directory, 'AGENTS.md'), bytes: 20 },
      ]) })
      expect(authorizeReadOnlyCwd).toHaveBeenCalledWith(directory)
      const denied = new Error('Project is not granted')
      authorizeReadOnlyCwd.mockRejectedValueOnce(denied)
      await expect(invoke(event, directory)).rejects.toBe(denied)
    } finally {
      await registration.dispose()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('interrupts in-flight config requests on disposal before the scan can start', async () => {
    const event = fakeEvent()
    registration.authorize(event.sender as never)
    let finishAuthorization!: (path: string) => void
    const authorizeReadOnlyCwd = vi.fn(() => new Promise<string>((resolve) => { finishAuthorization = resolve }))
    stubs.projects = { authorizeReadOnlyCwd }
    const scanStarted = vi.fn(() => { throw new Error('Scan must not start after shutdown') })
    Object.defineProperty(stubs, 'extensionPathContext', { get: scanStarted })
    const invoke = handlers.get('runtime:effective-config')!
    const pending = invoke(event, process.cwd())
    const interrupted = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(authorizeReadOnlyCwd).toHaveBeenCalledOnce())
    await registration.dispose()
    await interrupted
    finishAuthorization(process.cwd())
    await new Promise((resolve) => setImmediate(resolve))
    expect(scanStarted).not.toHaveBeenCalled()
    expect(() => invoke(event, process.cwd())).toThrow('IPC sender is not authorized')
    await registration.dispose()
  })

  it('enables a provider and clears only that provider model exclusions', async () => {
    const event = fakeEvent()
    registration.authorize(event.sender as never)
    const catalog = { providers: [{ id: 'provider' }], models: [{ provider: 'provider', key: 'provider/model' }] }
    const update = vi.fn().mockResolvedValue(undefined)
    stubs.catalog = { catalog: vi.fn().mockResolvedValue(catalog) }
    stubs.settings = { get: () => ({ piDisabledProviders: ['provider', 'other'], piDisabledModels: ['provider/model', 'other/model'] }), update }
    await expect(handlers.get('providers:set-enabled')!(event, 'provider', true)).resolves.toEqual(catalog)
    expect(update).toHaveBeenCalledWith({ piDisabledProviders: ['other'], piDisabledModels: ['other/model'] })
    await handlers.get('providers:set-enabled')!(event, 'provider', false)
    expect(update).toHaveBeenLastCalledWith({ piDisabledProviders: ['other', 'provider'], piDisabledModels: ['other/model', 'provider/model'] })
    await expect(handlers.get('providers:set-enabled')!(event, 'unknown', true)).rejects.toThrow('Provider was not found')
    await expect(handlers.get('providers:set-enabled')!(event, 'provider', 'yes')).rejects.toThrow('enabled must be a boolean')
    registration.dispose()
  })

  it('resolves page source metadata only inside the active granted workspace without changing files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'apex-browser-source-'))
    const cwd = join(directory, 'workspace')
    const outside = join(directory, 'outside')
    mkdirSync(cwd); mkdirSync(outside)
    const file = join(cwd, 'Button.tsx')
    writeFileSync(file, 'export function Button() {\n  return <button>Save</button>\n}\n')
    writeFileSync(join(outside, 'Other.tsx'), 'private outside source')
    symlinkSync(outside, join(cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const event = fakeEvent()
    registration.authorize(event.sender as never)
    const authorizeCwd = vi.fn(async (requested: string) => { if (requested !== cwd) throw new Error('Not granted'); return realpathSync(cwd) })
    stubs.projects = { authorizeCwd }
    const invoke = (hint: unknown, workspace = cwd) => handlers.get('app:resolve-browser-source')!(event, workspace, hint)
    try {
      expect(await invoke({ kind: 'explicit', path: 'Button.tsx', line: 2 })).toEqual({ kind: 'resolved', path: realpathSync(file), line: 2, evidence: 'explicit' })
      expect(await invoke({ kind: 'astro', path: pathToFileURL(file).href })).toMatchObject({ kind: 'resolved', path: realpathSync(file) })
      for (const hint of [null, { kind: 'guess', path: file }, { kind: 'explicit', path: file, line: 100 }, { kind: 'explicit', path: file, line: 0 }, { kind: 'explicit', path: 'missing.tsx' }, { kind: 'explicit', path: cwd }, { kind: 'explicit', path: '../outside/Other.tsx' }, { kind: 'explicit', path: 'linked/Other.tsx' }, { kind: 'explicit', path: 'https://example.com/src/Button.tsx', line: 2 }]) {
        expect(await invoke(hint)).toMatchObject({ kind: 'unknown' })
      }
      expect(await invoke({ kind: 'explicit', path: file }, outside)).toMatchObject({ kind: 'unknown' })
      expect(readFileSync(file, 'utf8')).toBe('export function Button() {\n  return <button>Save</button>\n}\n')
      expect(electronMocks.shell.openExternal).not.toHaveBeenCalled()
    } finally { rmSync(directory, { recursive: true, force: true }); registration.dispose() }
  })

  it('routes runtime, update and application actions to their desktop services', async () => {
    const event = fakeEvent()
    registration.authorize(event.sender as never)
    const cases = [
      ['agent:command', 'agents', 'command', ['runtime', { type: 'abort' }]],
      ['agent:stop', 'agents', 'stop', ['runtime']],
      ['agent:list', 'agents', 'list', []],
      ['updates:get-state', 'updates', 'getState', []],
      ['updates:check', 'updates', 'check', []],
      ['updates:download-and-install', 'updates', 'downloadAndInstall', []],
    ] as const
    for (const [channel, service, method, args] of cases) {
      const operation = vi.fn().mockResolvedValue('result')
      stubs[service] = { [method]: operation }
      await expect(handlers.get(channel)!(event, ...args)).resolves.toBe('result')
      expect(operation).toHaveBeenCalledWith(...args)
    }
    const refreshHarnesses = vi.fn().mockResolvedValue('refreshed')
    const popupApplicationMenu = vi.fn()
    const setTitleBarTheme = vi.fn()
    Object.assign(stubs, { refreshHarnesses, popupApplicationMenu, setTitleBarTheme })
    await expect(handlers.get('app:refresh-harnesses')!(event)).resolves.toBe('refreshed')
    handlers.get('app:popup-menu')!(event, 'file', 10, 20)
    expect(popupApplicationMenu).toHaveBeenCalledWith(event.sender, 'file', 10, 20)
    handlers.get('app:set-title-bar-theme')!(event, 'dark')
    expect(setTitleBarTheme).toHaveBeenCalledWith(event.sender, 'dark')
    registration.dispose()
  })

  it('opens file URLs in their default app only for existing authorized paths and reports shell failures', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'apex-file-link-'))
    const path = join(directory, 'Migration plan #1.docx')
    writeFileSync(path, 'sample file')
    const event = fakeEvent()
    registration.authorize(event.sender as never)
    const authorizePath = vi.fn(async (value: string) => value)
    stubs.projects = { authorizePath }
    electronMocks.shell.openPath.mockReset().mockResolvedValue('')
    electronMocks.shell.openExternal.mockReset()
    const open = handlers.get('app:open-external')!
    const url = pathToFileURL(path).href
    try {
      await expect(open(event, `${url}#L10`)).resolves.toBe(true)
      expect(electronMocks.shell.openPath).toHaveBeenLastCalledWith(realpathSync(path))
      expect(authorizePath).toHaveBeenLastCalledWith(realpathSync(path))
      expect(electronMocks.shell.openExternal).not.toHaveBeenCalled()
      const source = join(directory, 'source #1.tsx')
      writeFileSync(source, 'export {}\n')
      const sourceUrl = pathToFileURL(source).href
      const editorUrl = `vscode://file${pathToFileURL(realpathSync(source)).pathname}`
      electronMocks.shell.openPath.mockClear()
      await expect(open(event, `${sourceUrl}#L10-L20`)).resolves.toBe(true)
      expect(electronMocks.shell.openExternal).toHaveBeenLastCalledWith(`${editorUrl}:10`, { activate: true })
      expect(electronMocks.shell.openPath).not.toHaveBeenCalled()
      for (const fragment of ['', '#L0', '#L2147483648', '#other']) {
        await expect(open(event, `${sourceUrl}${fragment}`)).resolves.toBe(true)
        expect(electronMocks.shell.openExternal).toHaveBeenLastCalledWith(editorUrl, { activate: true })
      }
      electronMocks.app.getApplicationNameForProtocol.mockReturnValueOnce('')
      await expect(open(event, sourceUrl)).resolves.toBe(true)
      expect(electronMocks.shell.openPath).toHaveBeenLastCalledWith(realpathSync(source))
      const folder = join(directory, 'folder.ts')
      mkdirSync(folder)
      await expect(open(event, pathToFileURL(folder).href)).resolves.toBe(true)
      expect(electronMocks.shell.openPath).toHaveBeenLastCalledWith(realpathSync(folder))
      electronMocks.shell.openPath.mockResolvedValue('No application is associated with this file')
      await expect(open(event, url)).resolves.toBe(false)
      electronMocks.shell.openPath.mockClear()
      await expect(open(event, pathToFileURL(join(directory, 'missing.docx')).href)).resolves.toBe(false)
      await expect(open(event, 'file:///bad%00path')).resolves.toBe(false)
      await expect(open(event, 'file://remote.example/share/plan.docx')).resolves.toBe(false)
      await expect(open(event, 'javascript:alert(1)')).resolves.toBe(false)
      authorizePath.mockRejectedValue(new Error('Path is outside registered projects'))
      await expect(open(event, url)).resolves.toBe(false)
      expect(electronMocks.shell.openPath).not.toHaveBeenCalled()
      await expect(open(event, 'https://example.com')).resolves.toBe(true)
      expect(electronMocks.shell.openExternal).toHaveBeenLastCalledWith('https://example.com/', { activate: true })
    } finally {
      registration.dispose()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('opens authorized files in VS Code at an optional bounded line and rejects invalid input', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'apex-vscode-line-'))
    const path = join(directory, 'source #1.ts')
    writeFileSync(path, 'export {}\n')
    const event = fakeEvent()
    registration.authorize(event.sender as never)
    const authorizePath = vi.fn().mockImplementation(async (value: string) => value)
    stubs.projects = { authorizePath }
    electronMocks.shell.openExternal.mockReset()
    const open = handlers.get('app:open-in-vscode')!
    const uri = `vscode://file${pathToFileURL(realpathSync(path)).pathname}`
    try {
      await expect(open(event, path)).resolves.toBe(true)
      expect(electronMocks.shell.openExternal).toHaveBeenLastCalledWith(uri, { activate: true })
      await expect(open(event, path, 42)).resolves.toBe(true)
      expect(electronMocks.shell.openExternal).toHaveBeenLastCalledWith(`${uri}:42`, { activate: true })
      await expect(open(event, path, 2_147_483_647)).resolves.toBe(true)
      electronMocks.shell.openExternal.mockClear()
      for (const line of [0, -1, 1.5, NaN, Infinity, 2_147_483_648, '42', null]) {
        await expect(open(event, path, line)).resolves.toBe(false)
      }
      await expect(open(event, join(directory, 'missing.ts'), 1)).resolves.toBe(false)
      authorizePath.mockRejectedValue(new Error('Path is outside registered projects'))
      await expect(open(event, path, 1)).resolves.toBe(false)
      expect(electronMocks.shell.openExternal).not.toHaveBeenCalled()
    } finally {
      registration.dispose()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('routes project operations to Pi with their arguments intact', async () => {
    const event = fakeEvent()
    registration.authorize(event.sender as never)
    const cases = [
      ['projects:list-files', 'listFiles', ['/repo']],
      ['projects:add', 'add', []],
      ['projects:grant-inferred', 'grantInferred', ['/repo']],
      ['projects:remove', 'remove', ['project']],
      ['projects:touch', 'touch', ['project']],
      ['projects:pin', 'setPinned', ['project', true]],
      ['projects:update-scripts', 'updateScripts', ['project', { run: 'npm test' }]],
      ['projects:mark-setup-started', 'markSetupStarted', ['project', 'setup']],
      ['projects:finish-setup', 'finishSetup', ['project', 'setup', 0]],
    ] as const
    for (const [channel, method, args] of cases) {
      const operation = vi.fn().mockResolvedValue('result')
      stubs.projects = { [method]: operation }
      await expect(handlers.get(channel)!(event, ...args)).resolves.toBe('result')
      expect(operation).toHaveBeenCalledWith(...args)
    }
    const list = vi.fn().mockResolvedValue(['checkout'])
    const execute = vi.fn().mockResolvedValue('executed')
    stubs.checkouts = { pi: { list, execute } }
    await expect(handlers.get('projects:list-checkouts')!(event, 'project')).resolves.toEqual(['checkout'])
    await expect(handlers.get('projects:execute-checkout')!(event, 'project', 'action')).resolves.toBe('executed')
    expect(list).toHaveBeenCalledWith('project')
    expect(execute).toHaveBeenCalledWith('project', 'action')
    registration.dispose()
  })

  it('authorizes session paths before creation, reading, renaming and archiving', async () => {
    const event = fakeEvent()
    registration.authorize(event.sender as never)
    const authorizePath = vi.fn().mockResolvedValue('/authorized')
    const requireSessionPath = vi.fn().mockResolvedValue('/session')
    const create = vi.fn().mockResolvedValue('created')
    const read = vi.fn().mockResolvedValue('transcript')
    const rename = vi.fn().mockResolvedValue(true)
    const archive = vi.fn().mockResolvedValue(true)
    const closeForSession = vi.fn()
    const unbindSession = vi.fn()
    stubs.projects = { authorizePath }
    stubs.sessions = { requireSessionPath, create, read, rename, archive }
    stubs.browser = { closeForSession }
    stubs.terminals = { unbindSession }
    await expect(handlers.get('sessions:create')!(event, '/repo')).resolves.toBe('created')
    expect(create).toHaveBeenCalledWith('/authorized')
    await expect(handlers.get('sessions:read')!(event, '/session')).resolves.toBe('transcript')
    await expect(handlers.get('sessions:follow-up')!(event, '/session')).resolves.toBe(false)
    await expect(handlers.get('sessions:rename')!(event, '/session', 'Title')).resolves.toBe(true)
    expect(rename).toHaveBeenCalledWith('/session', 'Title')
    await expect(handlers.get('sessions:archive')!(event, '/session', true)).resolves.toBe(true)
    expect(closeForSession).toHaveBeenCalledWith('/session')
    expect(unbindSession).toHaveBeenCalledWith('/session')
    requireSessionPath.mockRejectedValue(new Error('denied'))
    await expect(handlers.get('sessions:archive')!(event, '/denied', true)).rejects.toThrow('denied')
    expect(archive).toHaveBeenCalledOnce()
    registration.dispose()
  })

  it('opens busy and idle authorized sessions alongside VS Code while retaining Desktop ownership', async () => {
    const event = fakeEvent()
    registration.authorize(event.sender as never)
    const ownersDir = mkdtempSync(join(tmpdir(), 'apex-handoff-'))
    const sessionPath = join(ownersDir, 'held session.jsonl')
    let streaming = true
    const runtimes = [{ runtimeId: 'r1', sessionFile: sessionPath, isStreaming: true, isCompacting: false }]
    const order: string[] = []
    const agents = {
      list: vi.fn(() => runtimes.map((runtime) => ({ ...runtime, isStreaming: streaming }))),
      getForSession: vi.fn(() => runtimes[0] && { ...runtimes[0], isStreaming: streaming }),
      stopForSession: vi.fn(async () => { order.push('stop'); runtimes.length = 0 }),
      releaseIdleSession: vi.fn(async () => {
        if (streaming) return false
        order.push('release')
        runtimes.length = 0
        return true
      }),
      pinAttachment: vi.fn(() => vi.fn()),
      setSessionAttachGuard: vi.fn(),
      setSessionClaimProvider: vi.fn(),
    }
    const openExternal = vi.fn(async (url: string) => { order.push(url) })
    const authorizePath = vi.fn(async (path: string) => { order.push(`authorize ${path}`); return '/work/repo' })
    let readOnly = false
    const handoff = new SessionHandoff({
      isReadOnlySession: () => readOnly,
      agents: agents as never,
      sessions: { requireSessionPath: vi.fn(async () => sessionPath), list: vi.fn(async () => [{ filePath: sessionPath, projectPath: '/work/repo' }]) } as never,
      projects: { authorizePath },
      openExternal,
      ownersDir,
      focusDelayMs: 0,
    })
    stubs.sessionHandoff = handoff
    try {
      expect(agents.setSessionAttachGuard).toHaveBeenCalledOnce()
      readOnly = true
      for (const mode of ['transfer', 'attach']) await expect(handlers.get('sessions:continue-in-vscode')!(event, sessionPath, mode)).rejects.toThrow('side read-only sessions cannot continue in VS Code')
      expect(agents.releaseIdleSession).not.toHaveBeenCalled()
      expect(agents.pinAttachment).not.toHaveBeenCalled()
      expect(openExternal).not.toHaveBeenCalled()
      readOnly = false
      await expect(handlers.get('sessions:continue-in-vscode')!(event, sessionPath, 'invalid')).rejects.toThrow('Invalid VS Code handoff mode')
      await expect(handlers.get('sessions:continue-in-vscode')!(event, sessionPath)).rejects.toThrow('Stop the current run')
      expect(openExternal).not.toHaveBeenCalled()
      await expect(handlers.get('sessions:continue-in-vscode')!(event, sessionPath, 'attach')).resolves.toBeUndefined()
      expect(agents.stopForSession).not.toHaveBeenCalled()

      streaming = false
      order.length = 0
      await handlers.get('sessions:continue-in-vscode')!(event, sessionPath, 'attach')
      expect(order).toEqual([
        'authorize /work/repo',
        expect.stringMatching(/^vscode:\/\/file\/.*work\/repo$/),
        `vscode://bdkinc.apex-vscode/attach?session=${encodeURIComponent(sessionPath)}`,
      ])
      const record = JSON.parse(readFileSync(join(ownersDir, `desktop-${process.pid}.json`), 'utf8')) as { sessions: string[] }
      expect(record.sessions).toEqual([join(realpathSync(ownersDir), 'held session.jsonl')])
      expect(agents.stopForSession).not.toHaveBeenCalled()
      order.length = 0
      await handlers.get('sessions:continue-in-vscode')!(event, sessionPath, 'transfer')
      expect(order).toEqual([
        'authorize /work/repo', 'release',
        expect.stringMatching(/^vscode:\/\/file\/.*work\/repo$/),
        `vscode://bdkinc.apex-vscode/open?session=${encodeURIComponent(sessionPath)}`,
      ])
      const released = JSON.parse(readFileSync(join(ownersDir, `desktop-${process.pid}.json`), 'utf8')) as { sessions: string[] }
      expect(released.sessions).toEqual([])
      await expect(handlers.get('sessions:runtime-owners')!(event)).resolves.toEqual([])
    } finally {
      await handoff.dispose()
      await handoff.publish(true)
      expect(() => readFileSync(join(ownersDir, `desktop-${process.pid}.json`), 'utf8')).toThrow()
      registration.dispose()
      rmSync(ownersDir, { recursive: true, force: true })
    }
  })

  it('releases an idle session Apex for VS Code requests and keeps a busy one', async () => {
    const ownersDir = mkdtempSync(join(tmpdir(), 'apex-handoff-release-'))
    const sessionPath = join(ownersDir, 'held.jsonl')
    writeFileSync(sessionPath, '')
    let busy = true
    let runtime: { sessionFile: string } | undefined = { sessionFile: sessionPath }
    const agents = {
      list: vi.fn(() => (runtime ? [runtime] : [])),
      getForSession: vi.fn(() => runtime),
      releaseIdleSession: vi.fn(async () => {
        if (busy) return false
        runtime = undefined
        return true
      }),
      setSessionAttachGuard: vi.fn(),
      setSessionClaimProvider: vi.fn(),
    }
    let readOnly = true
    const handoff = new SessionHandoff({ agents: agents as never, sessions: {} as never, projects: {} as never, isReadOnlySession: () => readOnly, openExternal: vi.fn(), ownersDir })
    try {
      await runtimeOwners.requestSessionRelease(sessionPath, ownersDir)
      await handoff.releaseRequestedSessions()
      expect(agents.releaseIdleSession).not.toHaveBeenCalled()
      expect(runtime).toBeDefined()
      expect(await runtimeOwners.readSessionReleaseRequests(ownersDir)).toHaveLength(1)
      readOnly = false
      await handoff.releaseRequestedSessions()
      expect(runtime).toBeDefined()

      busy = false
      await handoff.releaseRequestedSessions()
      expect(agents.releaseIdleSession).toHaveBeenLastCalledWith(realpathSync(sessionPath))
      expect(await runtimeOwners.readSessionReleaseRequests(ownersDir)).toEqual([])
      const record = JSON.parse(readFileSync(join(ownersDir, `desktop-${process.pid}.json`), 'utf8')) as { sessions: string[] }
      expect(record.sessions).toEqual([])
    } finally {
      await handoff.dispose()
      rmSync(ownersDir, { recursive: true, force: true })
    }
  })

  it('drains an in-flight desktop owner publication before disposal removes its record', async () => {
    const ownersDir = mkdtempSync(join(tmpdir(), 'apex-handoff-dispose-'))
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const originalPublish = runtimeOwners.publishRuntimeOwner
    const publish = vi.spyOn(runtimeOwners, 'publishRuntimeOwner').mockImplementation(async (owner, dir) => {
      await pending
      await originalPublish(owner, dir)
    })
    const handoff = new SessionHandoff({
      agents: { list: () => [], setSessionAttachGuard: vi.fn(), setSessionClaimProvider: vi.fn() } as never,
      sessions: {} as never,
      projects: {} as never,
      isReadOnlySession: () => false,
      openExternal: vi.fn(),
      ownersDir,
    })
    try {
      await Promise.resolve()
      expect(publish).toHaveBeenCalledOnce()
      const queued = handoff.publish(true)
      const disposed = handoff.dispose()
      finish()
      await Promise.all([queued, disposed])
      await handoff.publish(true)
      expect(publish).toHaveBeenCalledOnce()
      expect(() => readFileSync(join(ownersDir, `desktop-${process.pid}.json`), 'utf8')).toThrow()
    } finally {
      finish()
      await handoff.dispose()
      publish.mockRestore()
      rmSync(ownersDir, { recursive: true, force: true })
    }
  })

  it('allows an authorized main-frame sender at the trusted URL', () => {
    const event = fakeEvent()
    registration.authorize(event.sender as never)
    expect(handlers.get('app:get-meta')!(event)).toEqual({ version: '0.0.0-test' })
    registration.dispose()
  })

  it('exposes fixed read-only pet discovery channels to an authorized renderer', async () => {
    const event = fakeEvent()
    registration.authorize(event.sender as never)
    await expect(handlers.get('pets:list')!(event)).resolves.toEqual([{ id: 'orb' }])
    await expect(handlers.get('pets:sprite')!(event, 'gooey-pi')).resolves.toBe('data:image/webp;base64,pet')
    registration.dispose()
  })

  it('applies a validated interface scale to every renderer only after the settings update succeeds', async () => {
    const event = fakeEvent()
    const update = vi.fn(async () => ({ interfaceFontScale: 115, askUserEnabled: true }))
    const applyInterfaceZoom = stubs.applyInterfaceZoom as ReturnType<typeof vi.fn>
    stubs.settings = { get: () => ({ interfaceFontScale: 110, askUserEnabled: true }), update }
    registration.authorize(event.sender as never)

    await expect(handlers.get('settings:update')!(event, { interfaceFontScale: 115 })).resolves.toEqual({ interfaceFontScale: 115, askUserEnabled: true })
    expect(update).toHaveBeenCalledWith({ interfaceFontScale: 115 })
    expect(applyInterfaceZoom).toHaveBeenCalledWith(115)
    expect(event.sender.setZoomFactor).not.toHaveBeenCalled()

    applyInterfaceZoom.mockClear()
    update.mockRejectedValueOnce(new TypeError('Invalid interface font scale'))
    await expect(handlers.get('settings:update')!(event, { interfaceFontScale: 125 })).rejects.toThrow('Invalid interface font scale')
    expect(applyInterfaceZoom).not.toHaveBeenCalled()
    registration.dispose()
  })

  it('leaves renderer zoom untouched for settings patches that do not change the scale', async () => {
    const event = fakeEvent()
    const applyInterfaceZoom = stubs.applyInterfaceZoom as ReturnType<typeof vi.fn>
    stubs.settings = {
      get: () => ({ interfaceFontScale: 110, askUserEnabled: true }),
      update: vi.fn(async () => ({ interfaceFontScale: 110, askUserEnabled: true })),
    }
    registration.authorize(event.sender as never)

    await handlers.get('settings:update')!(event, { theme: 'dark' })

    expect(applyInterfaceZoom).not.toHaveBeenCalled()
    registration.dispose()
  })

  it('recycles Pi runtimes when the ask_user toggle changes', async () => {
    const event = fakeEvent()
    const refreshPi = vi.fn(async () => undefined)
    stubs.settings = {
      get: () => ({ askUserEnabled: true }),
      update: vi.fn(async () => ({ interfaceFontScale: 110, askUserEnabled: false })),
    }
    stubs.agents = { ...serviceStub(), requestRuntimeEnvironmentRefresh: refreshPi }
    registration.authorize(event.sender as never)

    await handlers.get('settings:update')!(event, { askUserEnabled: false })

    expect(refreshPi).toHaveBeenCalledOnce()
    registration.dispose()
  })

  it('routes omitted harnesses to Pi and rejects removed runtime identifiers', async () => {
    const event = fakeEvent()
    const start = vi.fn(async (options) => ({ harness: 'pi', ...options }))
    const list = vi.fn(async () => ['pi-project'])
    stubs.agents = { start }
    stubs.projects = { list }
    registration.authorize(event.sender as never)

    await expect(handlers.get('agent:start')!(event, { cwd: '/repo' })).resolves.toMatchObject({ harness: 'pi', cwd: '/repo' })
    await expect(handlers.get('projects:list')!(event)).resolves.toEqual(['pi-project'])
    for (const harness of ['prime', 'omp']) {
      expect(() => handlers.get('agent:start')!(event, { cwd: '/repo', harness })).toThrow('Invalid harness')
      expect(() => handlers.get('projects:list')!(event, harness)).toThrow('Invalid harness')
      expect(() => handlers.get('providers:catalog')!(event, false, harness)).toThrow('Invalid harness')
      expect(() => handlers.get('schedules:list')!(event, harness)).toThrow('Invalid harness')
    }
    expect(start).toHaveBeenCalledOnce()
    expect(list).toHaveBeenCalledOnce()
    stubs.schedules = { get: () => ({ id: 'legacy-schedule', harness: 'omp' }) }
    for (const channel of ['schedules:get', 'schedules:update', 'schedules:pause', 'schedules:resume', 'schedules:delete', 'schedules:run-now']) {
      expect(() => handlers.get(channel)!(event, 'legacy-schedule', {})).toThrow('Invalid harness')
    }
    stubs.sessions = { requireSessionPath: vi.fn(async () => { throw new TypeError('Session path is outside the Pi session directory') }) }
    await expect(handlers.get('sessions:read')!(event, '/home/user/.omp/agent/sessions/legacy.jsonl')).rejects.toThrow('outside the Pi session directory')
    for (const channel of ['heartbeats:list', 'heartbeats:manage', 'providers:save-api-key', 'providers:logout', 'providers:start-oauth', 'providers:respond-oauth', 'providers:cancel-oauth']) {
      expect(handlers.has(channel)).toBe(false)
    }
    registration.dispose()
  })

  it('rejects a sub-frame sender even when its URL is trusted', () => {
    const event = fakeEvent({ subFrame: true })
    registration.authorize(event.sender as never)
    expect(() => handlers.get('app:get-meta')!(event)).toThrow('IPC sender is not authorized')
    registration.dispose()
  })

  it('reports renderer readiness once the trusted renderer completes its bootstrap invoke', async () => {
    const event = fakeEvent()
    let ready = false
    void registration.whenRendererReady.then(() => { ready = true })

    registration.authorize(event.sender as never)
    handlers.get('app:get-meta')!(event)
    await registration.whenRendererReady

    expect(ready).toBe(true)
    registration.dispose()
  })

  it('never reports renderer readiness for a rejected sender', async () => {
    const untrusted = fakeEvent({ subFrame: true })
    registration.authorize(untrusted.sender as never)
    expect(() => handlers.get('app:get-meta')!(untrusted)).toThrow('IPC sender is not authorized')

    const unauthorized = fakeEvent({ id: 42 })
    expect(() => handlers.get('app:get-meta')!(unauthorized)).toThrow('IPC sender is not authorized')

    await expect(Promise.race([registration.whenRendererReady, Promise.resolve('pending')])).resolves.toBe('pending')
    registration.dispose()
  })

  it('rejects a destroyed sender that is still in the authorized set', () => {
    const event = fakeEvent({ destroyed: true })
    registration.authorize(event.sender as never)
    expect(() => handlers.get('app:get-meta')!(event)).toThrow('IPC sender is not authorized')
    registration.dispose()
  })

  it('rejects every call after dispose, including previously authorized senders', () => {
    const event = fakeEvent()
    registration.authorize(event.sender as never)
    registration.dispose()
    expect(() => handlers.get('app:get-meta')!(event)).toThrow('IPC sender is not authorized')
  })

  it('rejects a sender id that was never authorized', () => {
    const event = fakeEvent({ id: 99 })
    expect(() => handlers.get('app:get-meta')!(event)).toThrow('IPC sender is not authorized')
    registration.dispose()
  })

  it('rejects a sender revoked after authorization', () => {
    const event = fakeEvent()
    registration.authorize(event.sender as never)
    registration.revoke(event.sender.id)
    expect(() => handlers.get('app:get-meta')!(event)).toThrow('IPC sender is not authorized')
    registration.dispose()
  })

  it('rejects a frame navigated away from the renderer URL', () => {
    const event = fakeEvent({ frameUrl: 'https://attacker.example/' , url: 'https://attacker.example/' })
    registration.authorize(event.sender as never)
    expect(() => handlers.get('app:get-meta')!(event)).toThrow('IPC sender is not authorized')
    registration.dispose()
  })

  it('rejects when the frame URL and the WebContents URL disagree', () => {
    // Frame URL trusted, sender.getURL() not: both must match the renderer URL.
    const mismatchedContents = fakeEvent({ url: 'https://attacker.example/' })
    registration.authorize(mismatchedContents.sender as never)
    expect(() => handlers.get('app:get-meta')!(mismatchedContents)).toThrow('IPC sender is not authorized')

    const mismatchedFrame = fakeEvent({ id: 2, frameUrl: 'https://attacker.example/' })
    registration.authorize(mismatchedFrame.sender as never)
    expect(() => handlers.get('app:get-meta')!(mismatchedFrame)).toThrow('IPC sender is not authorized')
    registration.dispose()
  })

  it('drops unauthorized fire-and-forget events without invoking the service', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const input = (stubs.terminals as { input: ReturnType<typeof vi.fn> }).input
    const event = fakeEvent({ id: 7 })
    listeners.get('terminal:input')!(event, 'terminal-1', 'ls\r')
    expect(input).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('terminal:input'), 'IPC sender is not authorized')
    warn.mockRestore()
    registration.dispose()
  })
})
