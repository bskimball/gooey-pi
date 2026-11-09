// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserPanel } from '../../apps/desktop/src/components/inspector/BrowserPanel'
import { useBrowserAnnotations } from '../../apps/desktop/src/hooks/useBrowserAnnotations'
import type { BrowserAnnotationsApi } from '../../apps/desktop/src/hooks/useBrowserAnnotations'
import type { BrowserAnnotation } from '../../apps/desktop/src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const capturedPayload = JSON.stringify([
  {
    selector: '#cta',
    tagName: 'BUTTON',
    id: 'cta',
    classes: ['btn'],
    text: 'Join now',
    href: 'https://example.com/signup',
    rect: { x: 5, y: 6, width: 100, height: 30 },
  },
])

let container: HTMLDivElement
let root: Root
let executed: string[]
let takeResult: string | null
let webviewUrl: string
let webviewDomReady: boolean

// jsdom renders <webview> as HTMLUnknownElement; give the prototype the small
// Electron surface BrowserPanel relies on.
const webviewProto = window.HTMLUnknownElement.prototype as unknown as Record<string, unknown>
const webviewMethods = {
  loadURL: async () => undefined,
  getURL: () => webviewUrl,
  getTitle: () => 'Example Page',
  goBack: () => undefined,
  goForward: () => undefined,
  canGoBack: () => false,
  canGoForward: () => false,
  reload: () => undefined,
  stop: () => undefined,
  // Electron throws SYNCHRONOUSLY (not a rejected promise) until the guest
  // emits dom-ready; the mock mirrors that so mount-time calls crash tests
  // the same way they crash the real renderer.
  executeJavaScript: (code: string) => {
    if (!webviewDomReady) throw new Error('The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.')
    executed.push(code)
    return Promise.resolve(code.includes('.take()') ? takeResult : undefined)
  },
}

let latestApi: BrowserAnnotationsApi
function Harness({ pollIntervalMs = 50, scope = 'first' }: { pollIntervalMs?: number; scope?: string }) {
  latestApi = useBrowserAnnotations(scope)
  return <BrowserPanel key={scope} cwd="/repo" platform="linux" home="https://example.com/" onOpenExternal={() => undefined} annotations={latestApi} pollIntervalMs={pollIntervalMs} />
}

beforeEach(() => {
  Object.defineProperty(window, 'prime', { configurable: true, writable: true, value: undefined })
  vi.useFakeTimers()
  executed = []
  takeResult = null
  webviewUrl = 'https://example.com/'
  webviewDomReady = false
  Object.assign(webviewProto, webviewMethods)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  for (const key of Object.keys(webviewMethods)) delete webviewProto[key]
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const webviewElement = () => container.querySelector('webview') as HTMLElement

const makeDomReady = async () => {
  webviewDomReady = true
  await act(async () => {
    webviewElement().dispatchEvent(new Event('dom-ready'))
  })
}

const toggleAnnotate = async () => {
  await act(async () => {
    ;(container.querySelector('button[aria-label="Annotate page"], button[aria-label="Stop annotating"]') as HTMLButtonElement).click()
  })
}

const setComment = async (value: string) => {
  const textarea = container.querySelector('.annotation-popover textarea') as HTMLTextAreaElement
  await act(async () => {
    const previous = textarea.value
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, value)
    ;(textarea as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker?.setValue(previous)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('BrowserPanel annotation mode', () => {
  it('mounts safely before dom-ready and defers page scripts until it fires', async () => {
    // Regression: executeJavaScript throws synchronously pre-dom-ready; a
    // mount-time call escaped the effect and blanked the app behind the
    // root error boundary.
    await act(async () => root.render(<Harness />))
    expect(executed).toHaveLength(0)
    await toggleAnnotate()
    expect(executed).toHaveLength(0)

    await makeDomReady()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60)
    })
    expect(executed.some((code) => code.includes('__primeAnnotator'))).toBe(true)
  })

  it('injects the picker, captures a clicked element, and stores the comment', async () => {
    await act(async () => root.render(<Harness />))
    await makeDomReady()
    await toggleAnnotate()

    expect(executed.some((code) => code.includes('__primeAnnotator.start()'))).toBe(true)
    expect(container.querySelector('.annotation-hint')).not.toBeNull()

    takeResult = capturedPayload
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120)
    })
    takeResult = null

    // Selection stops picking (page listeners cleaned up) and opens the comment popover.
    expect(executed.some((code) => code.includes('__primeAnnotator.stop()'))).toBe(true)
    const popover = container.querySelector('.annotation-popover')
    expect(popover?.textContent).toContain('Comment on element 1')
    // The DOM label is intentionally not shown; the header and comment field suffice.
    expect(popover?.textContent).not.toContain('button#cta.btn')

    await setComment('Make this button blue')
    await act(async () => {
      ;(container.querySelector('.button--primary') as HTMLButtonElement).click()
    })

    expect(latestApi.annotations).toHaveLength(1)
    expect(latestApi.annotations[0].comment).toBe('Make this button blue')
    expect(latestApi.annotations[0].pageUrl).toBe('https://example.com/')
    expect(latestApi.annotations[0].pageTitle).toBe('Example Page')
    expect(container.querySelector('.annotation-popover')).toBeNull()
    expect(container.querySelector('.annotation-count')?.textContent).toContain('1 of 20')

    // The stored annotation now renders as a persistent numbered marker in the page.
    const markerCall = [...executed].reverse().find((code) => code.includes('setMarkers'))
    expect(markerCall).toContain('"selector":"#cta"')
    expect(markerCall).toContain('"index":1')
  })

  it('shows checked source, navigates only on request, and attaches evidence without sending', async () => {
    const resolveBrowserSource = vi.fn(async () => ({ kind: 'resolved', path: '/repo/Button.tsx', line: 2, evidence: 'explicit' }))
    const openInVsCode = vi.fn(async () => true)
    Object.defineProperty(window, 'prime', { configurable: true, writable: true, value: { app: { resolveBrowserSource, openInVsCode } } })
    await act(async () => root.render(<Harness />))
    await makeDomReady(); await toggleAnnotate()
    takeResult = JSON.stringify([{ selector: '#cta', tagName: 'button', component: 'Button', sourceHint: { kind: 'explicit', path: 'Button.tsx', line: 2 } }])
    await act(async () => { await vi.advanceTimersByTimeAsync(120) })
    takeResult = null
    expect(container.textContent).toContain('/repo/Button.tsx:2')
    expect(container.textContent).toContain('Component reported by page: Button')
    expect(openInVsCode).not.toHaveBeenCalled()
    expect(latestApi.annotations).toHaveLength(0)
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Open source in VS Code')!
    await act(async () => open.click())
    expect(openInVsCode).toHaveBeenCalledWith('/repo/Button.tsx', 2)
    expect(resolveBrowserSource).toHaveBeenCalledTimes(2)
    await setComment('Change this button')
    await act(async () => (container.querySelector('.button--primary') as HTMLButtonElement).click())
    expect(latestApi.annotations[0].source).toEqual({ kind: 'resolved', path: '/repo/Button.tsx', line: 2, evidence: 'explicit' })
    expect(latestApi.sendSignal).toBe(0)
  })

  it('keeps unmapped selections useful and discards pending source checks on navigation', async () => {
    let finish: ((value: { kind: 'resolved'; path: string; evidence: 'explicit' }) => void) | undefined
    const resolveBrowserSource = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    Object.defineProperty(window, 'prime', { configurable: true, writable: true, value: { app: { resolveBrowserSource } } })
    await act(async () => root.render(<Harness />))
    await makeDomReady(); await toggleAnnotate()
    takeResult = capturedPayload
    await act(async () => { await vi.advanceTimersByTimeAsync(120) })
    takeResult = null
    expect(container.textContent).toContain('Source unknown')
    expect(resolveBrowserSource).not.toHaveBeenCalled()
    await setComment('Keep visual context')
    await act(async () => (container.querySelector('.button--primary') as HTMLButtonElement).click())
    expect(latestApi.annotations[0].source?.kind).toBe('unknown')
    await toggleAnnotate()
    takeResult = JSON.stringify([{ selector: '#cta', tagName: 'button', sourceHint: { kind: 'explicit', path: 'Button.tsx' } }])
    await act(async () => { await vi.advanceTimersByTimeAsync(120) })
    takeResult = null
    expect(container.textContent).toContain('Checking source')
    webviewUrl = 'https://example.com/new-route'
    await act(async () => webviewElement().dispatchEvent(new Event('did-navigate-in-page')))
    await act(async () => { finish?.({ kind: 'resolved', path: '/repo/Button.tsx', evidence: 'explicit' }) })
    expect(container.querySelector('.annotation-popover')).toBeNull()
    expect(latestApi.annotations[0].stale).toBe(true)
  })

  it('does not carry source attachments or send requests into another session', async () => {
    await act(async () => root.render(<Harness />))
    await act(async () => {
      latestApi.add({ comment: 'First session', element: { selector: '#first', tagName: 'button', id: '', classes: [], text: '', rect: { x: 0, y: 0, width: 1, height: 1 } }, source: { kind: 'resolved', path: '/repo/First.tsx', line: 2, evidence: 'explicit' }, pageUrl: webviewUrl, pageTitle: 'First' })
      latestApi.requestSend()
    })
    expect(latestApi.annotations).toHaveLength(1)
    expect(latestApi.sendSignal).toBe(1)
    const previousSession = latestApi
    const firstInput = previousSession.annotations[0]
    await act(async () => root.render(<Harness scope="second" />))
    expect(latestApi.annotations).toEqual([])
    expect(latestApi.sendSignal).toBe(0)
    await act(async () => {
      latestApi.add({ ...firstInput, comment: 'Second session' })
      previousSession.clear()
      previousSession.requestSend()
      expect(previousSession.add(firstInput)).toBe(false)
    })
    expect(latestApi.annotations.map((entry) => entry.comment)).toEqual(['Second session'])
    expect(latestApi.sendSignal).toBe(0)
    await act(async () => root.render(<Harness scope="first" />))
    await act(async () => {
      latestApi.add({ ...firstInput, comment: 'New draft after returning to first session' })
      previousSession.clear()
      previousSession.requestSend()
      expect(previousSession.add(firstInput)).toBe(false)
    })
    expect(latestApi.annotations.map((entry) => entry.comment)).toEqual(['New draft after returning to first session'])
    expect(latestApi.sendSignal).toBe(0)
  })

  it('saves on Enter and saves-then-sends on Ctrl+Enter in the comment popover', async () => {
    await act(async () => root.render(<Harness />))
    await makeDomReady()

    const capture = async () => {
      await toggleAnnotate()
      takeResult = capturedPayload
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120)
      })
      takeResult = null
    }
    const keydown = async (init: KeyboardEventInit) => {
      const textarea = container.querySelector('.annotation-popover textarea') as HTMLTextAreaElement
      await act(async () => {
        textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
      })
    }

    await capture()
    // Linux uses PC keyboard labels in the annotation hints.
    const hints = container.querySelector('.annotation-popover__hints')
    expect(hints?.textContent).toContain('Enter add to chat')
    expect(hints?.textContent).toContain('Ctrl+Enter send now')
    await setComment('plain enter saves')
    const signalBefore = latestApi.sendSignal
    await keydown({ key: 'Enter' })
    expect(latestApi.annotations.map((entry) => entry.comment)).toEqual(['plain enter saves'])
    expect(container.querySelector('.annotation-popover')).toBeNull()
    expect(latestApi.sendSignal).toBe(signalBefore)

    await capture()
    await setComment('ctrl enter sends')
    await keydown({ key: 'Enter', ctrlKey: true })
    expect(latestApi.annotations.map((entry) => entry.comment)).toEqual(['plain enter saves', 'ctrl enter sends'])
    expect(container.querySelector('.annotation-popover')).toBeNull()
    expect(latestApi.sendSignal).toBe(signalBefore + 1)

    // Enter with an empty comment neither saves nor closes the popover.
    await capture()
    await keydown({ key: 'Enter' })
    expect(latestApi.annotations).toHaveLength(2)
    expect(container.querySelector('.annotation-popover')).not.toBeNull()
  })

  it('blocks entering annotation mode at the 20-annotation cap with clear feedback', async () => {
    const annotations: BrowserAnnotation[] = Array.from({ length: 20 }, (_, index) => ({
      id: `a-${index}`,
      comment: `c-${index}`,
      element: { selector: `#e-${index}`, tagName: 'div', id: '', classes: [], text: '', rect: { x: 0, y: 0, width: 0, height: 0 } },
      pageUrl: 'https://example.com/',
      pageTitle: 'Example',
      stale: false,
      createdAt: index,
    }))
    const api: BrowserAnnotationsApi = { annotations, atCapacity: true, add: vi.fn(() => false), remove: vi.fn(), clear: vi.fn(), handleNavigation: vi.fn(), sendSignal: 0, requestSend: vi.fn() }
    await act(async () => root.render(<BrowserPanel home="https://example.com/" onOpenExternal={() => undefined} annotations={api} pollIntervalMs={50} />))
    await makeDomReady()
    const injectedBefore = executed.filter((code) => code.includes('__primeAnnotator.start()')).length

    await toggleAnnotate()

    expect(container.querySelector('.annotation-notice')?.textContent).toContain('at most 20 annotations')
    expect(container.querySelector('.annotation-hint')).toBeNull()
    expect(executed.filter((code) => code.includes('__primeAnnotator.start()')).length).toBe(injectedBefore)
  })

  it('marks annotations stale on navigation and exits annotation mode', async () => {
    await act(async () => root.render(<Harness />))
    await makeDomReady()
    act(() => {
      latestApi.add({
        comment: 'Original page note',
        element: { selector: '#hero', tagName: 'div', id: 'hero', classes: [], text: '', rect: { x: 0, y: 0, width: 10, height: 10 } },
        pageUrl: 'https://example.com/',
        pageTitle: 'Example',
      })
    })
    await toggleAnnotate()
    expect(container.querySelector('.annotation-hint')).not.toBeNull()

    webviewUrl = 'https://example.com/other'
    await act(async () => {
      webviewElement().dispatchEvent(new Event('did-navigate'))
    })

    expect(latestApi.annotations[0].stale).toBe(true)
    expect(container.querySelector('.annotation-hint')).toBeNull()
    expect(container.querySelector('.annotation-count')?.textContent).toContain('1 from earlier pages')

    // Navigating back to the captured page revives the marker.
    webviewUrl = 'https://example.com/'
    await act(async () => {
      webviewElement().dispatchEvent(new Event('did-navigate'))
    })
    expect(latestApi.annotations[0].stale).toBe(false)
    const markerCall = [...executed].reverse().find((code) => code.includes('setMarkers'))
    expect(markerCall).toContain('"selector":"#hero"')
  })

  it('rejects malformed picker payloads without leaving annotation mode', async () => {
    await act(async () => root.render(<Harness />))
    await makeDomReady()
    await toggleAnnotate()

    takeResult = JSON.stringify([{ tagName: 'div' }])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120)
    })
    takeResult = 'not json at all'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120)
    })

    expect(container.querySelector('.annotation-popover')).toBeNull()
    expect(container.querySelector('.annotation-hint')).not.toBeNull()
    expect(latestApi.annotations).toHaveLength(0)
  })

  it('keeps the comment popover editable and cancellable when a save hits capacity, and expires the notice across navigation', async () => {
    let allowAdd = false
    const api: BrowserAnnotationsApi = {
      annotations: [],
      atCapacity: false,
      add: vi.fn(() => allowAdd),
      remove: vi.fn(),
      clear: vi.fn(),
      handleNavigation: vi.fn(),
      sendSignal: 0,
      requestSend: vi.fn(),
    }
    await act(async () => root.render(<BrowserPanel home="https://example.com/" onOpenExternal={() => undefined} annotations={api} pollIntervalMs={50} />))
    await makeDomReady()
    await toggleAnnotate()

    takeResult = capturedPayload
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120)
    })
    takeResult = null

    await setComment('First draft')
    await act(async () => {
      ;(container.querySelector('.annotation-popover .button--primary') as HTMLButtonElement).click()
    })

    // Rejected save shows the notice while keeping the popover interactive and cancellable.
    expect(container.querySelector('.annotation-notice')?.textContent).toContain('at most 20 annotations')
    expect(container.querySelector('.annotation-popover')).not.toBeNull()
    expect(api.add).toHaveBeenCalledOnce()
    expect(api.add).toHaveBeenLastCalledWith(expect.objectContaining({ comment: 'First draft' }))

    // Even after the 5-second notice expires, the popover stays in commenting mode and can be cancelled or saved.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100)
    })
    expect(container.querySelector('.annotation-notice')).toBeNull()
    expect(container.querySelector('.annotation-popover')).not.toBeNull()

    // Retrying after freeing capacity saves and dismisses the popover, and re-triggering capacity notice expires across navigation.
    await act(async () => {
      ;(container.querySelector('.annotation-popover .button--primary') as HTMLButtonElement).click()
    })
    expect(container.querySelector('.annotation-notice')?.textContent).toContain('at most 20 annotations')

    allowAdd = true
    await act(async () => {
      ;(container.querySelector('.annotation-popover .button--primary') as HTMLButtonElement).click()
    })
    expect(api.add).toHaveBeenCalledTimes(3)
    expect(container.querySelector('.annotation-popover')).toBeNull()

    // Navigation does not pin the notice forever; the 5s timer still clears it.
    webviewUrl = 'https://example.com/next'
    await act(async () => {
      webviewElement().dispatchEvent(new Event('did-navigate'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100)
    })
    expect(container.querySelector('.annotation-notice')).toBeNull()
  })

  it('cancels an in-flight open-source revalidation if the popover unmounts before resolution', async () => {
    let resolvePendingOpen: ((value: { kind: 'resolved'; path: string; line: number; evidence: 'explicit' }) => void) | undefined
    let callCount = 0
    const resolveBrowserSource = vi.fn(() => {
      callCount += 1
      if (callCount === 1) return Promise.resolve({ kind: 'resolved' as const, path: '/repo/Button.tsx', line: 2, evidence: 'explicit' as const })
      return new Promise<{ kind: 'resolved'; path: string; line: number; evidence: 'explicit' }>((resolve) => {
        resolvePendingOpen = resolve
      })
    })
    const openInVsCode = vi.fn(async () => true)
    Object.defineProperty(window, 'prime', { configurable: true, writable: true, value: { app: { resolveBrowserSource, openInVsCode } } })

    await act(async () => root.render(<Harness />))
    await makeDomReady()
    await toggleAnnotate()
    takeResult = JSON.stringify([{ selector: '#cta', tagName: 'button', component: 'Button', sourceHint: { kind: 'explicit', path: 'Button.tsx', line: 2 } }])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120)
    })
    takeResult = null

    const openBtn = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Open source in VS Code')!
    await act(async () => {
      openBtn.click()
    })
    expect(openBtn.textContent).toBe('Opening…')

    // Dismiss the popover before the second resolveBrowserSource settles.
    await act(async () => {
      ;(container.querySelector('button[aria-label="Discard annotation"]') as HTMLButtonElement).click()
    })
    expect(container.querySelector('.annotation-popover')).toBeNull()

    await act(async () => {
      resolvePendingOpen?.({ kind: 'resolved', path: '/repo/Button.tsx', line: 2, evidence: 'explicit' })
      await Promise.resolve()
    })
    expect(openInVsCode).not.toHaveBeenCalled()
  })
})
