// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../apps/desktop/src/App'
import { DEFAULT_SETTINGS } from '../../apps/desktop/src/lib/data'
import { composerDraftStorageKey } from '../../apps/desktop/src/lib/composer-draft'
import type { AppMeta, PrimeWorkApi, ProjectRecord, SessionRecord } from '../../apps/desktop/src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project = (id: string, name: string, lastOpenedAt: string, overrides: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id,
  harness: 'pi',
  name,
  path: `/${id}`,
  folders: [`/${id}`],
  primaryFolder: `/${id}`,
  pinned: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt,
  sessionCount: 0,
  ...overrides,
})

const projects = [
  project('zeta', 'Zeta', '2026-01-01T00:00:00.000Z'),
  project('alpha', 'Alpha', '2026-02-01T00:00:00.000Z'),
  project('inferred', 'Inferred', '2026-03-01T00:00:00.000Z', { inferred: true, readOnly: true }),
]

const meta: AppMeta = {
  version: 'test',
  platform: 'linux',
  homeDir: '/home/test',
  harnesses: {
    pi: { path: '/usr/bin/pi', version: 'test' },
  },
}

let settings = { ...DEFAULT_SETTINGS, activeHarness: 'pi' as const }
let bridge: PrimeWorkApi
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  settings = { ...DEFAULT_SETTINGS, activeHarness: 'pi' }
  bridge = {
    app: {
      getMeta: vi.fn(async () => meta),
      refreshHarnesses: vi.fn(async () => ({ meta, settings })),
      openExternal: vi.fn(async () => true),
      revealPath: vi.fn(async () => true),
      popupMenu: vi.fn(async () => true),
      setTitleBarTheme: vi.fn(async () => true),
      onOpenSettings: vi.fn(() => () => undefined),
    },
    updates: {
      getState: vi.fn(async () => ({ phase: 'idle' as const })),
      check: vi.fn(async () => ({ phase: 'idle' as const })),
      downloadAndInstall: vi.fn(async () => true),
      onChanged: vi.fn(() => () => undefined),
    },
    projects: {
      list: vi.fn(async () => projects),
      listFiles: vi.fn(async () => ({ entries: [], skipped: 0 })),
      listWorktrees: vi.fn(async () => []),
      openWorktree: vi.fn(async () => projects[0]),
      createWorktree: vi.fn(async () => projects[0]),
      add: vi.fn(async () => null),
      grantInferred: vi.fn(async () => projects[2]),
      remove: vi.fn(async () => true),
      touch: vi.fn(async () => true),
      setPinned: vi.fn(async () => true),
    },
    sessions: {
      list: vi.fn(async () => []),
      read: vi.fn(async () => []),
      followUp: vi.fn(async () => true),
      rename: vi.fn(async () => true),
      archive: vi.fn(async () => true),
      onChanged: vi.fn(() => () => undefined),
    },
    agent: {
      start: vi.fn(async () => undefined),
      command: vi.fn(async () => ({})),
      stop: vi.fn(async () => true),
      list: vi.fn(async () => []),
      onEvent: vi.fn(() => () => undefined),
    },
    pets: {
      list: vi.fn(async () => []),
      sprite: vi.fn(async () => null),
    },
    providers: {
      catalog: vi.fn(async () => ({ models: [], providers: [] })),
      setEnabled: vi.fn(async () => true),
      setDisabled: vi.fn(async () => true),
      setModelEnabled: vi.fn(async () => true),
    },
    plugins: {
      list: vi.fn(async () => ({ skills: [], warnings: [] })),
      install: vi.fn(async () => ({ ok: true, output: '' })),
      installExtension: vi.fn(async () => ({ ok: true, output: '' })),
      setMcpSupport: vi.fn(async () => true),
      connectMcp: vi.fn(async () => ({ ok: true })),
      setMcpEnabled: vi.fn(async () => true),
      mutateCapability: vi.fn(async () => true),
    },
    browser: {
      state: vi.fn(async () => ({ tabs: [] })),
      attachTab: vi.fn(async () => true),
      selectTab: vi.fn(async () => true),
      closeTab: vi.fn(async () => true),
      navigateTab: vi.fn(async () => true),
      setPreviewContext: vi.fn(async () => true),
      onChanged: vi.fn(() => () => undefined),
      onPointer: vi.fn(() => () => undefined),
      onActivity: vi.fn(() => () => undefined),
    },
    schedules: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
      pause: vi.fn(async () => true),
      resume: vi.fn(async () => true),
      delete: vi.fn(async () => true),
      runNow: vi.fn(async () => true),
      preview: vi.fn(async (timing) => ({ timing, occurrences: [] })),
      onChanged: vi.fn(() => () => undefined),
    },
    settings: {
      get: vi.fn(async () => settings),
      update: vi.fn(async (patch) => {
        settings = { ...settings, ...patch }
        return settings
      }),
      resetBrowserData: vi.fn(async () => true),
    },
    git: {
      status: vi.fn(async () => ({ isRepo: false, files: [] })),
      diff: vi.fn(async () => ''),
      restore: vi.fn(async () => true),
    },
  } as unknown as PrimeWorkApi
  Object.defineProperty(window, 'prime', { configurable: true, value: bridge })
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  Object.defineProperty(window, 'prime', { configurable: true, value: undefined })
  vi.restoreAllMocks()
})

async function waitFor<T>(read: () => T | null | undefined): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < 4_000) {
    const value = read()
    if (value) return value
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 20)) })
  }
  throw new Error('Timed out waiting for the app')
}

async function press(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('session creation in App', () => {
  it.each([false, true])('preserves an attachment and restores a failed first prompt across adoption (submit while creating: %s)', async (submitWhileCreating) => {
    vi.mocked(bridge.providers.catalog).mockResolvedValue({
      primeVersion: 'test', refreshedAt: new Date().toISOString(),
      models: [{ key: 'provider/vision', provider: 'provider', id: 'vision', name: 'Vision', reasoning: true, input: ['text', 'image'], contextWindow: 100_000, maxTokens: 8_000, availableThinkingLevels: ['medium'], fastModeSupported: false, available: true }],
      providers: [{ id: 'provider', name: 'Provider', authMethod: 'api_key', configured: true, modelCount: 1, availableModelCount: 1, enabled: true }],
    })
    let finish!: (session: SessionRecord) => void
    bridge.sessions.create = vi.fn(() => new Promise<SessionRecord>((resolve) => { finish = resolve }))
    vi.mocked(bridge.agent.start).mockRejectedValue(new Error('Pi unavailable'))
    const created: SessionRecord = {
      id: 'created', harness: 'pi', filePath: '/sessions/created.jsonl', projectPath: projects[0].path,
      title: 'Untitled session', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'idle', depth: 0,
    }
    await act(async () => root.render(<App />))
    await waitFor(() => container.querySelector('.sidebar__section-heading'))
    await press(container.querySelector('.sidebar__title-actions [aria-label^="New session"]')!)
    await waitFor(() => vi.mocked(bridge.sessions.create).mock.calls.length || null)
    const textarea = container.querySelector<HTMLTextAreaElement>('.composer textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Keep my image and prompt')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
      const file = new File([bytes], 'draft.png', { type: 'image/png' })
      Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
      const input = container.querySelector<HTMLInputElement>('.composer input[type="file"]')!
      Object.defineProperty(input, 'files', { configurable: true, value: [file] })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => container.querySelector('.composer-attachment'))
    const send = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')
      return button && !button.disabled ? button : null
    })
    if (submitWhileCreating) await press(send)
    await act(async () => finish(created))
    if (!submitWhileCreating) {
      expect(container.querySelector('.composer-attachment')?.textContent).toContain('draft.png')
      expect(container.querySelector<HTMLTextAreaElement>('.composer textarea')?.value).toBe('Keep my image and prompt')
      await press(container.querySelector('[aria-label="Send message"]')!)
    }
    await waitFor(() => vi.mocked(bridge.agent.start).mock.calls.length || null)
    expect(container.querySelector<HTMLTextAreaElement>('.composer textarea')?.value).toBe('Keep my image and prompt')
    expect(container.querySelector('.composer-attachment')?.textContent).toContain('draft.png')
    expect(JSON.parse(window.sessionStorage.getItem(composerDraftStorageKey('zeta:created')) ?? '{}').text).toBe('Keep my image and prompt')
    expect(window.sessionStorage.getItem(composerDraftStorageKey('zeta:new'))).toBeNull()
  })
})

describe('project ordering controls in App', () => {
  it.each(['project', 'session'])('keeps an older project in Recent after opening its %s and switching away', async (target) => {
    const library = Array.from({ length: 8 }, (_, index) => project(`project-${index}`, `Project ${index}`, `2026-01-0${index + 1}T00:00:00.000Z`))
    const sessions: SessionRecord[] = [7, 1].map((index) => ({
      id: `session-${index}`, harness: 'pi', filePath: `/sessions/${index}.jsonl`, projectPath: `/project-${index}`,
      title: `Conversation ${index}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'idle', depth: 0,
    }))
    vi.mocked(bridge.projects.list).mockResolvedValue(library)
    vi.mocked(bridge.sessions.list).mockResolvedValue(sessions)
    await act(async () => root.render(<App />))
    await waitFor(() => container.querySelector('.sidebar__section-heading'))
    const rowNames = () => [...container.querySelectorAll('.project-row__main')].map((button) => button.textContent)
    expect(rowNames()).not.toContain('Project 1')
    const input = container.querySelector<HTMLInputElement>('#session-search')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, target === 'project' ? 'Project 1' : 'Conversation 1')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await press(container.querySelector(target === 'project' ? '.project-row__main' : '.session-row')!)
    await press([...container.querySelectorAll('.project-row__main')].find((button) => button.textContent === 'Project 7')!)
    expect(rowNames()).toContain('Project 1')
    expect(rowNames()).toHaveLength(5)
    expect(bridge.projects.touch).toHaveBeenCalledWith('project-1', 'pi')
  })

  it('switches sidebar sorting persistently and pins projects while excluding inferred records', async () => {
    await act(async () => root.render(<App />))
    await waitFor(() => container.querySelector('.sidebar__section-heading'))

    expect([...container.querySelectorAll('.project-row__main')].map((button) => button.textContent)).toEqual(['Inferred', 'Alpha', 'Zeta'])
    await press(container.querySelector('[aria-label="Sort projects"]')!)
    await press([...container.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent?.includes('Alphabetical'))!)
    expect(bridge.settings.update).toHaveBeenCalledWith({ projectSortMode: 'alphabetical' })

    await press(container.querySelector('[aria-label="Sort projects"]')!)
    expect([...container.querySelectorAll('.project-row__main')].map((button) => button.textContent)).toEqual(['Alpha', 'Inferred', 'Zeta'])
    await act(async () => {
      container.querySelector('.project-row')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
    })
    const pin = [...container.querySelectorAll('[aria-label^="Project options"] button')].find((button) => button.textContent?.includes('Pin project'))
    expect(pin).toBeDefined()
    await press(pin!)
    expect(bridge.projects.setPinned).toHaveBeenCalledWith('alpha', true, 'pi')
    expect([...container.querySelectorAll('[aria-label^="Project options"] button')].some((button) => button.textContent?.includes('Pin project'))).toBe(false)
  })
})
