// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResizeHandle } from '../../apps/desktop/src/components/ResizeHandle'
import { SIDEBAR_DEFAULT, usePanelLayout } from '../../apps/desktop/src/hooks/usePanelLayout'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('sidebar resizing', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    container.className = 'app-shell'
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.removeItem('prime-work.sidebar-width')
    vi.unstubAllGlobals()
  })

  const separator = () => {
    const node = container.querySelector<HTMLElement>('[role="separator"]')
    if (!node) throw new Error('Missing resize separator')
    return node
  }

  it('grows toward the end edge with ArrowRight and resets on double-click', () => {
    const onChange = vi.fn()
    act(() => root.render(<ResizeHandle orientation="vertical" edge="end" label="Resize sidebar" value={300} min={200} max={480} defaultValue={252} onChange={onChange} />))
    act(() => separator().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith(312)
    act(() => separator().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith(252)
    act(() => separator().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith(252)
    act(() => separator().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith(200)
    act(() => separator().dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith(480)
  })

  it.each(['vertical', 'horizontal'] as const)('preserves the default %s panel keyboard direction', (orientation) => {
    const onChange = vi.fn()
    act(() => root.render(<ResizeHandle orientation={orientation} label="Resize panel" value={300} min={170} max={600} defaultValue={310} onChange={onChange} />))
    act(() => separator().dispatchEvent(new KeyboardEvent('keydown', { key: orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp', bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith(312)
  })

  it('live-updates the app shell while dragging right and commits on pointerup', () => {
    const onChange = vi.fn()
    act(() => root.render(<ResizeHandle orientation="vertical" edge="end" cssVariable="--sidebar-width" scopeSelector=".app-shell" label="Resize sidebar" value={252} min={200} max={480} defaultValue={252} onChange={onChange} />))
    Object.defineProperties(separator(), {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: vi.fn() },
    })
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { clientX, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      return event
    }
    act(() => separator().dispatchEvent(pointer('pointerdown', 252)))
    expect(document.body.classList.contains('is-resizing-vertical')).toBe(true)
    act(() => window.dispatchEvent(pointer('pointermove', 310)))
    expect(container.style.getPropertyValue('--sidebar-width')).toBe('310px')
    expect(onChange).not.toHaveBeenCalled()
    act(() => window.dispatchEvent(pointer('pointerup', 310)))
    expect(onChange).toHaveBeenCalledWith(310)
    expect(document.body.classList.contains('is-resizing-vertical')).toBe(false)
  })

  function LayoutHarness() {
    const layout = usePanelLayout({
      sidebarOpen: true,
      setSidebarOpen: vi.fn(),
      inspectorOpen: false,
      setInspectorOpen: vi.fn(),
      closeSmallestPanels: vi.fn(),
      terminalOpen: false,
      view: 'session',
    })
    return <><output>{layout.sidebarWidth}</output><button onClick={() => layout.setSidebarWidth(360)}>Resize</button></>
  }

  const renderLayout = () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    act(() => root.render(<LayoutHarness />))
  }

  it.each([['900', 480], ['100', 200], ['invalid', SIDEBAR_DEFAULT]])('clamps saved width %s on load', (saved, expected) => {
    vi.stubGlobal('innerWidth', 1400)
    window.localStorage.setItem('prime-work.sidebar-width', saved)
    renderLayout()
    expect(container.querySelector('output')?.textContent).toBe(String(expected))
    expect(window.localStorage.getItem('prime-work.sidebar-width')).toBe(String(expected))
  })

  it('persists changes across remounts and clamps to resized window bounds', () => {
    vi.stubGlobal('innerWidth', 1400)
    renderLayout()
    expect(container.querySelector('output')?.textContent).toBe(String(SIDEBAR_DEFAULT))
    act(() => container.querySelector('button')?.click())
    expect(window.localStorage.getItem('prime-work.sidebar-width')).toBe('360')
    act(() => root.unmount())
    root = createRoot(container)
    renderLayout()
    expect(container.querySelector('output')?.textContent).toBe('360')
    vi.stubGlobal('innerWidth', 800)
    act(() => window.dispatchEvent(new Event('resize')))
    expect(container.querySelector('output')?.textContent).toBe('320')
    expect(window.localStorage.getItem('prime-work.sidebar-width')).toBe('320')
  })
})
