import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  app: {
    getAppPath: vi.fn(() => '/tmp/prime-work'),
    isPackaged: false,
    on: vi.fn(),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => false),
  },
  BrowserWindow: class {},
  dialog: { showMessageBoxSync: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
  nativeImage: { createFromPath: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  session: {},
  Tray: class {},
}))

vi.mock('electron', () => electron)

import { extensionRuntimeEnvironment, type CapabilityExtensionPaths } from '../../apps/desktop/electron/main/index'
import { PI_RPC_ADAPTER } from '../../apps/desktop/electron/main/agent-rpc'

const extensionPaths: CapabilityExtensionPaths = {
  schedule: '/app/extensions/apex-schedules.ts',
  browser: '/app/extensions/apex-browser.ts',
  askUser: '/app/extensions/apex-ask-user.ts',
}

/** What the schedule and browser bridges hand every runtime of the harness. */
const scheduleBridgeEnvironment = {
  APEX_SCHEDULE_URL: 'http://127.0.0.1:45001',
  APEX_SCHEDULE_TOKEN: 'schedule-token',
  APEX_SCHEDULE_SKILL_PATH: '/app/skills/apex-schedules',
}
const browserBridgeEnvironment = {
  APEX_BROWSER_URL: 'http://127.0.0.1:45002',
  APEX_BROWSER_TOKEN: 'browser-token',
  APEX_BROWSER_EXTENSION_PATH: '/app/extensions/apex-browser.ts',
  APEX_BROWSER_SKILL_PATH: '/app/skills/apex-browser',
}

describe('Pi capability extension environment', () => {
  it('populates the three shared extension paths and strips the Prime-only skill paths', () => {
    const environment = extensionRuntimeEnvironment(scheduleBridgeEnvironment, () => browserBridgeEnvironment, extensionPaths)

    expect(environment.APEX_SCHEDULE_EXTENSION_PATH).toBe('/app/extensions/apex-schedules.ts')
    expect(environment.APEX_BROWSER_EXTENSION_PATH).toBe('/app/extensions/apex-browser.ts')
    expect(environment.APEX_ASK_USER_EXTENSION_PATH).toBe('/app/extensions/apex-ask-user.ts')
    expect(environment.GOOEYPI_MANAGES_ASK_USER).toBe('1')
    // The Prime-only --skill inputs never reach an extension-based harness.
    expect(environment.APEX_SCHEDULE_SKILL_PATH).toBeUndefined()
    expect(environment.APEX_BROWSER_SKILL_PATH).toBeUndefined()
    // The loopback-broker contract from both bridges is preserved untouched.
    expect(environment.APEX_SCHEDULE_URL).toBe('http://127.0.0.1:45001')
    expect(environment.APEX_SCHEDULE_TOKEN).toBe('schedule-token')
    expect(environment.APEX_BROWSER_URL).toBe('http://127.0.0.1:45002')
    expect(environment.APEX_BROWSER_TOKEN).toBe('browser-token')
  })

  it.each([
    ['pi', PI_RPC_ADAPTER],
  ] as const)('turns the shared environment into all three --extension injections for %s runtimes', (_harness, adapter) => {
    const environment = extensionRuntimeEnvironment(scheduleBridgeEnvironment, () => browserBridgeEnvironment, extensionPaths)
    const args = adapter.buildStartArgs({ cwd: '/work', environment })

    const injected: string[] = []
    for (let index = 0; index < args.length - 1; index += 1) {
      if (args[index] === '--extension') injected.push(args[index + 1])
    }
    expect(injected).toEqual([
      '/app/extensions/apex-schedules.ts',
      '/app/extensions/apex-browser.ts',
      '/app/extensions/apex-ask-user.ts',
    ])
    // Neither extension-based harness receives Prime's --skill injections.
    expect(args).not.toContain('--skill')
  })

  it('injects the Pi fast-mode compatibility extension', () => {
    const environment = {
      ...extensionRuntimeEnvironment(scheduleBridgeEnvironment, () => browserBridgeEnvironment, extensionPaths),
      GOOEYPI_PI_FAST_MODE_EXTENSION_PATH: '/app/extensions/pi-work-fast-mode.ts',
    }
    expect(PI_RPC_ADAPTER.buildStartArgs({ cwd: '/work', environment })).toContain('/app/extensions/pi-work-fast-mode.ts')
    expect(PI_RPC_ADAPTER.buildStartArgs({ cwd: '/work', environment: { ...environment, APEX_VISUAL_PREVIEW_EXTENSION_PATH: '/app/extensions/apex-visual-previews.ts' } })).toContain('/app/extensions/apex-visual-previews.ts')
  })

  it('keeps standalone copies suppressed while omitting the bundled tool when disabled', () => {
    const environment = extensionRuntimeEnvironment(scheduleBridgeEnvironment, () => browserBridgeEnvironment, extensionPaths, false)
    expect(environment.GOOEYPI_MANAGES_ASK_USER).toBe('1')
    expect(environment.APEX_ASK_USER_EXTENSION_PATH).toBeUndefined()
    for (const adapter of [PI_RPC_ADAPTER]) {
      expect(adapter.buildStartArgs({ cwd: '/work', environment })).not.toContain(extensionPaths.askUser)
    }
  })

  it.each([
    ['pi', PI_RPC_ADAPTER],
  ] as const)('does not mint or inject a browser claim for %s when Browser is disabled', (_harness, adapter) => {
    const mintBrowserClaim = vi.fn(() => browserBridgeEnvironment)
    const environment = extensionRuntimeEnvironment(scheduleBridgeEnvironment, mintBrowserClaim, extensionPaths, true, false)
    expect(mintBrowserClaim).not.toHaveBeenCalled()
    expect(environment.APEX_BROWSER_EXTENSION_PATH).toBeUndefined()
    expect(environment.APEX_BROWSER_URL).toBeUndefined()
    expect(environment.APEX_BROWSER_TOKEN).toBeUndefined()
    expect(adapter.buildStartArgs({ cwd: '/work', environment })).not.toContain(extensionPaths.browser)
  })

  it.each([
    ['pi', PI_RPC_ADAPTER],
  ] as const)('injects session collaboration into %s without accepting an unsafe path', (_harness, adapter) => {
    const args = adapter.buildStartArgs({ cwd: '/work', environment: { GOOEYPI_COLLABORATION_EXTENSION_PATH: '/app/extensions/apex-collaboration.ts' } })
    expect(args.slice(-2)).toEqual(['--extension', '/app/extensions/apex-collaboration.ts'])
    const unsafe = adapter.buildStartArgs({ cwd: '/work', environment: { GOOEYPI_COLLABORATION_EXTENSION_PATH: '--session-injection' } })
    expect(unsafe).not.toContain('--session-injection')
  })
})
