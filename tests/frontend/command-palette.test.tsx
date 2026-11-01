// @vitest-environment jsdom
/// <reference types="vite/client" />

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessId } from '../../apps/desktop/src/types/api'
import { HARNESS_SHORT_NAMES } from '../../apps/desktop/src/lib/harness'
import App from '../../apps/desktop/src/App'
import { CommandPalette } from '../../apps/desktop/src/components/CommandPalette'
import { SAMPLE_PROJECTS } from '../../apps/desktop/src/lib/data'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const harnessState = vi.hoisted(() => ({ activeHarness: 'pi' as HarnessId }))

vi.mock('../../apps/desktop/src/hooks/useAppSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/desktop/src/hooks/useAppSettings')>()
  return {
    ...actual,
    useAppSettings(options: Parameters<typeof actual.useAppSettings>[0]) {
      const state = actual.useAppSettings(options)
      return { ...state, settings: { ...state.settings, activeHarness: harnessState.activeHarness } }
    },
  }
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class { observe() {} unobserve() {} disconnect() {} },
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0),
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: (id: number) => window.clearTimeout(id),
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function waitFor<T>(read: () => T | null | undefined, timeout = 4_000): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = read()
    if (value) return value
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 30)) })
  }
  throw new Error(`Timed out waiting for the command palette test condition after ${timeout}ms`)
}

async function openPalette(): Promise<HTMLElement> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
  })
  return waitFor(() => document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="Command palette"]'))
}

async function search(input: HTMLInputElement, query: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function commandOptions(dialog: HTMLElement, group = 'Commands'): HTMLButtonElement[] {
  return [...dialog.querySelectorAll<HTMLButtonElement>(`#command-results [role="option"][data-group="${group}"]`)]
}

function optionLabels(options: HTMLButtonElement[]): Array<string | null | undefined> {
  return options.map((option) => option.querySelector('strong')?.textContent)
}

const expectedOrder = [
  'New session',
  'Previous session',
  'Open Projects',
  'Open Activity',
  'Open Scheduled',
  'Open Capabilities',
  'Show changes',
  'Show overview',
  'Show agents',
  'Show files',
  'Toggle browser',
  'Toggle terminal',
  'Toggle sidebar',
  'Open Settings',
]

describe.each<HarnessId>(['pi'])('command palette for %s', (harness) => {
  it('keeps Scheduled searchable and activatable by keyboard and pointer', async () => {
    harnessState.activeHarness = harness
    await act(async () => { root.render(<App />) })

    let dialog = await openPalette()
    let input = dialog.querySelector<HTMLInputElement>('[role="combobox"]')!
    let options = commandOptions(dialog)
    await waitFor(() => document.activeElement === input ? input : null)
    expect(optionLabels(options)).toEqual(expectedOrder)
    // Recent sessions lead the empty palette, most recent first, without the open session.
    const recent = commandOptions(dialog, 'Recent sessions')
    expect(optionLabels(recent)).toEqual(['Polish browser annotations', 'Debug hydration error'])
    expect(recent[0].getAttribute('aria-selected')).toBe('true')

    await search(input, 'scheduled')
    options = commandOptions(dialog)
    expect(optionLabels(options)).toEqual(['Open Scheduled'])
    expect(options[0].getAttribute('aria-selected')).toBe('true')

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(document.body.querySelector('[role="dialog"][aria-label="Command palette"]')).toBeNull()
    await waitFor(() => [...document.body.querySelectorAll('h1')].find((heading) => heading.textContent === 'Scheduled'))
    expect(document.body.textContent).toContain(`Unattended ${HARNESS_SHORT_NAMES[harness]} work`)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.sidebar__primary button[title="Projects"]')!.click()
    })
    await waitFor(() => [...document.body.querySelectorAll('h1')].find((heading) => heading.textContent === 'Projects'))

    dialog = await openPalette()
    input = dialog.querySelector<HTMLInputElement>('[role="combobox"]')!
    await waitFor(() => document.activeElement === input ? input : null)
    const scheduled = commandOptions(dialog).find((option) => option.textContent?.includes('Open Scheduled'))!
    await act(async () => {
      scheduled.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(scheduled.getAttribute('aria-selected')).toBe('true')
    await act(async () => { scheduled.click() })
    expect(document.body.querySelector('[role="dialog"][aria-label="Command palette"]')).toBeNull()
    await waitFor(() => [...document.body.querySelectorAll('h1')].find((heading) => heading.textContent === 'Scheduled'))
    expect(document.body.textContent).toContain(`Unattended ${HARNESS_SHORT_NAMES[harness]} work`)
  })

  it('finds sessions and projects by any word and returns to the previous session', async () => {
    harnessState.activeHarness = harness
    await act(async () => { root.render(<App />) })
    const selectedTitle = () => container.querySelector('.session-row-wrap.is-selected .session-row__title')?.textContent
    await waitFor(() => selectedTitle() === 'Build the workspace shell' ? true : null)

    const dialog = await openPalette()
    const input = dialog.querySelector<HTMLInputElement>('[role="combobox"]')!
    await search(input, 'storefront hydration')
    expect(optionLabels(commandOptions(dialog, 'Sessions'))).toEqual(['Debug hydration error'])
    expect(commandOptions(dialog, 'Sessions')[0].textContent).toContain('storefront-redesign')
    await search(input, 'storefront')
    expect(optionLabels(commandOptions(dialog, 'Projects'))).toEqual(['storefront-redesign'])
    await search(input, 'hydration')
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(document.body.querySelector('[role="dialog"][aria-label="Command palette"]')).toBeNull()
    await waitFor(() => selectedTitle() === 'Debug hydration error' ? true : null)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    await waitFor(() => selectedTitle() === 'Build the workspace shell' ? true : null)
  })
})

describe('command palette file results', () => {
  it('selects file results that arrive after the query and opens them by absolute path', async () => {
    let resolveListing: (value: { entries: Array<{ path: string; type: 'file' | 'directory' }>; skipped: number }) => void = () => undefined
    const listFiles = vi.fn(() => new Promise<{ entries: Array<{ path: string; type: 'file' | 'directory' }>; skipped: number }>((resolve) => { resolveListing = resolve }))
    Object.defineProperty(window, 'prime', { configurable: true, value: { projects: { listFiles } } })
    const onOpenFile = vi.fn()
    const project = { ...SAMPLE_PROJECTS[0], id: 'files-project', primaryFolder: '/work/files-project', path: '/work/files-project' }
    const noop = () => undefined
    try {
      await act(async () => {
        root.render(<CommandPalette open platform="darwin" harness="pi" projects={[project]} sessions={[]} activeProject={project} onClose={noop} onNavigate={noop} onNewSession={noop} onPreviousSession={noop} onToggleSidebar={noop} onToggleTerminal={noop} onOpenBrowser={noop} onOpenInspectorTab={noop} onSelectSession={noop} onSelectProject={noop} onOpenFile={onOpenFile} />)
      })
      const dialog = await waitFor(() => document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="Command palette"]'))
      const input = dialog.querySelector<HTMLInputElement>('[role="combobox"]')!
      await search(input, 'zebra')
      await waitFor(() => listFiles.mock.calls.length ? true : null)
      expect(dialog.querySelectorAll('[role="option"]')).toHaveLength(0)
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      })
      await act(async () => { resolveListing({ entries: [{ path: 'src', type: 'directory' }, { path: 'src/zebra-stripes.ts', type: 'file' }], skipped: 0 }) })
      const files = await waitFor(() => commandOptions(dialog, 'Files').length ? commandOptions(dialog, 'Files') : null)
      expect(optionLabels(files)).toEqual(['zebra-stripes.ts'])
      expect(files[0].getAttribute('aria-selected')).toBe('true')
      expect(input.getAttribute('aria-activedescendant')).toBe(files[0].id)
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      })
      expect(onOpenFile).toHaveBeenCalledWith('/work/files-project/src/zebra-stripes.ts')
    } finally {
      Reflect.deleteProperty(window, 'prime')
    }
  })
})
