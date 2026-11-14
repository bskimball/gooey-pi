// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Composer } from '../../apps/desktop/src/components/Composer'
import type { CheckoutCatalog, GitWorktree } from '../../apps/desktop/src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const worktrees: GitWorktree[] = [
  { path: '/repo', name: 'repo', branch: 'main', head: 'abc123', current: true, detached: false },
  { path: '/repo-feature', name: 'repo-feature', branch: 'feature/picker', head: 'def456', current: false, detached: false },
]
const worktreeCatalog: CheckoutCatalog = { strategy: 'worktree', activePath: '/repo', checkouts: worktrees }

function props(overrides: Record<string, unknown> = {}) {
  return {
    busy: false,
    model: '',
    effort: 'medium' as const,
    modelsByProvider: new Map(),
    providers: [],
    reasoningLevels: ['medium' as const],
    fast: false,
    fastSupported: false,
    fastAvailable: false,
    imageInputSupported: true,
    skills: [],
    onModelChange: vi.fn(),
    onEffortChange: vi.fn(),
    onFastChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  }
}

function statusBarProps(overrides: Record<string, unknown> = {}) {
  return {
    checkoutCatalog: worktreeCatalog,
    onExecuteCheckout: vi.fn(),
    ...overrides,
  }
}

describe('composer worktree picker', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.sessionStorage.clear()
  })

  function openSettings() {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Chat settings"]')!.click())
    return document.body
  }

  it('does not expose an automatic model choice before the catalog loads', () => {
    act(() => root.render(<Composer {...props()} />))

    const trigger = openSettings().querySelector<HTMLButtonElement>('button[aria-label="Model: No model available"]')
    expect(trigger?.textContent).toContain('No model available')
    expect(trigger?.disabled).toBe(true)
  })

  it('shows the checkout name instead of a generic Workspace label before the catalog loads', () => {
    act(() => root.render(<Composer {...props(statusBarProps({ checkoutCatalog: undefined, checkoutLabel: 'feature/current' }))} />))

    const trigger = openSettings().querySelector<HTMLButtonElement>('[aria-label="Checkout: feature/current"]')
    expect(trigger?.textContent).toContain('feature/current')
    expect(trigger?.textContent).not.toBe('Workspace')
  })

  it('shows the active branch and switches to another worktree', async () => {
    const onExecuteCheckout = vi.fn()
    act(() => root.render(<Composer {...props(statusBarProps({ onExecuteCheckout }))} />))

    const dialog = openSettings()
    const trigger = dialog.querySelector<HTMLButtonElement>('[aria-label="Checkout: main"]')
    expect(trigger).not.toBeNull()
    expect(container.textContent).not.toContain('Local')
    act(() => trigger?.click())

    const options = dialog.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    expect(options).toHaveLength(2)
    expect(options[0].getAttribute('aria-checked')).toBe('true')
    expect(options[1].textContent).toContain('feature/picker')
    expect(options[1].textContent).toContain('/repo-feature')

    await act(async () => options[1].click())
    expect(onExecuteCheckout).toHaveBeenCalledWith({ strategy: 'worktree', operation: 'open', path: '/repo-feature' })
    expect(dialog.querySelector('[role="menu"]')).toBeNull()
  })

  it('returns focus to the checkout trigger on Escape, but not on outside dismissal', async () => {
    vi.useFakeTimers()
    try {
      act(() => root.render(<Composer {...props(statusBarProps())} />))
      const dialog = openSettings()
      const trigger = dialog.querySelector<HTMLButtonElement>('[aria-label="Checkout: main"]')!
      act(() => trigger.click())
      const input = dialog.querySelector<HTMLInputElement>('[placeholder="New branch name"]')!
      act(() => { input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
      act(() => vi.runAllTimers())
      expect(dialog.querySelector('[role="menu"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)

      act(() => trigger.click())
      const outside = container.querySelector<HTMLTextAreaElement>('textarea')!
      act(() => { outside.focus(); outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
      act(() => vi.runAllTimers())
      expect(document.activeElement).toBe(outside)
    } finally { vi.useRealTimers() }
  })

  it('creates a worktree from an inline branch form', async () => {
    const onExecuteCheckout = vi.fn().mockResolvedValue(undefined)
    act(() => root.render(<Composer {...props(statusBarProps({ onExecuteCheckout }))} />))
    const dialog = openSettings()
    act(() => dialog.querySelector<HTMLButtonElement>('[aria-label="Checkout: main"]')?.click())

    const input = dialog.querySelector<HTMLInputElement>('[placeholder="New branch name"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'feature/new-picker')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = input.closest('form')!
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

    expect(onExecuteCheckout).toHaveBeenCalledWith({ strategy: 'worktree', operation: 'create', branch: 'feature/new-picker' })
    expect(dialog.querySelector('[role="menu"]')).toBeNull()
  })

  it('switches local branches without showing checkout folders', () => {
    const onExecuteCheckout = vi.fn()
    const checkoutCatalog: CheckoutCatalog = {
      strategy: 'branch',
      activeName: 'main',
      checkouts: [{ name: 'main', current: true }, { name: 'feature/local', current: false }],
    }
    act(() => root.render(<Composer {...props(statusBarProps({ checkoutCatalog, onExecuteCheckout }))} />))
    const dialog = openSettings()
    act(() => dialog.querySelector<HTMLButtonElement>('[aria-label="Checkout: main"]')?.click())

    expect(dialog.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Git branches')
    expect(dialog.textContent).not.toContain('/repo')
    const options = dialog.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    act(() => options[1].click())
    expect(onExecuteCheckout).toHaveBeenCalledWith({ strategy: 'branch', operation: 'switch', branch: 'feature/local' })
  })

  it('closes a busy checkout menu on Escape without closing settings or repeating the operation', async () => {
    let resolve!: () => void
    const onExecuteCheckout = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    act(() => root.render(<Composer {...props(statusBarProps({ onExecuteCheckout }))} />))
    const page = openSettings()
    const trigger = page.querySelector<HTMLButtonElement>('[aria-label="Checkout: main"]')!
    act(() => trigger.click())
    await act(async () => page.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[1].click())
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => { trigger.focus(); trigger.dispatchEvent(escape) })
    expect(escape.defaultPrevented).toBe(true)
    expect(page.querySelector('[role="dialog"]')).not.toBeNull()
    expect(page.querySelector('[role="menu"]')).toBeNull()
    act(() => trigger.click())
    await act(async () => page.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[1].click())
    expect(onExecuteCheckout).toHaveBeenCalledTimes(1)
    await act(async () => resolve())
  })

  it('keeps checkout operations single-flight across closing and reopening settings', async () => {
    let resolve!: () => void
    const onExecuteCheckout = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    act(() => root.render(<Composer {...props(statusBarProps({ onExecuteCheckout }))} />))
    const dialog = openSettings()
    act(() => dialog.querySelector<HTMLButtonElement>('[aria-label="Checkout: main"]')!.click())
    await act(async () => dialog.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[1].click())
    expect(onExecuteCheckout).toHaveBeenCalledTimes(1)
    act(() => dialog.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Close"]')!.click())
    openSettings()
    await act(async () => dialog.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[1].click())
    expect(onExecuteCheckout).toHaveBeenCalledTimes(1)
    await act(async () => resolve())
    expect(dialog.querySelector('[role="menu"]')).toBeNull()
  })

  it('locks checkout switching while a run is in flight', () => {
    act(() => root.render(<Composer {...props(statusBarProps({ busy: true }))} />))
    expect(openSettings().querySelector<HTMLButtonElement>('[aria-label="Checkout: main"]')?.disabled).toBe(true)
  })

  it('restores an unsent draft and model after the composer remounts', async () => {
    act(() => root.render(<Composer {...props({ draftKey: 'project:new', model: 'openai:chosen' })} />))
    const textarea = container.querySelector('textarea')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'Keep this prompt')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => root.unmount())
    root = createRoot(container)
    const onModelChange = vi.fn()
    act(() => root.render(<Composer {...props({ draftKey: 'project:new', model: '', onModelChange })} />))
    expect(container.querySelector('textarea')?.value).toBe('Keep this prompt')
    expect(onModelChange).toHaveBeenCalledWith('openai:chosen')
  })
})
