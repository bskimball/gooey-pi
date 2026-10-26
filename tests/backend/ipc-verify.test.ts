import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  app: {},
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

vi.mock('electron', () => electronMocks)

import { registerIpc, type IpcRegistration } from '../../apps/desktop/electron/main/ipc'

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
    const killForSession = vi.fn().mockResolvedValue(undefined)
    stubs.projects = { authorizePath }
    stubs.sessions = { requireSessionPath, create, read, rename, archive }
    stubs.browser = { closeForSession }
    stubs.terminals = { killForSession }
    await expect(handlers.get('sessions:create')!(event, '/repo')).resolves.toBe('created')
    expect(create).toHaveBeenCalledWith('/authorized')
    await expect(handlers.get('sessions:read')!(event, '/session')).resolves.toBe('transcript')
    await expect(handlers.get('sessions:follow-up')!(event, '/session')).resolves.toBe(false)
    await expect(handlers.get('sessions:rename')!(event, '/session', 'Title')).resolves.toBe(true)
    expect(rename).toHaveBeenCalledWith('/session', 'Title')
    await expect(handlers.get('sessions:archive')!(event, '/session', true)).resolves.toBe(true)
    expect(closeForSession).toHaveBeenCalledWith('/session')
    expect(killForSession).toHaveBeenCalledWith('/session')
    requireSessionPath.mockRejectedValue(new Error('denied'))
    await expect(handlers.get('sessions:archive')!(event, '/denied', true)).rejects.toThrow('denied')
    expect(archive).toHaveBeenCalledOnce()
    registration.dispose()
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
