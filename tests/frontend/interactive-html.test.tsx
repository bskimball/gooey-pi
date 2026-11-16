// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HtmlFence } from '../../apps/desktop/src/components/HtmlFence'
import { InteractiveChatProvider } from '../../apps/desktop/src/components/InteractiveChatContext'
import { INTERACTIVE_PREVIEW_POLICY, interactivePreviewUrl } from '../../packages/core/src/interactive-preview'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('interactive HTML', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { sessionStorage.clear(); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('isolates scripts with a policy before untrusted content', () => {
    act(() => root.render(<HtmlFence source={'</head><script>window.test = 1</script>'} />))
    const frame = container.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toBe('')
    const doc = frame.getAttribute('srcdoc')!
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('</head><script>'))
    expect(INTERACTIVE_PREVIEW_POLICY).toContain("connect-src 'none'")
    expect(INTERACTIVE_PREVIEW_POLICY).toContain('sandbox allow-scripts')
    expect(new URL(interactivePreviewUrl('<script>1</script>')).searchParams.get('html')).toBe('<script>1</script>')
    expect(doc).toContain("form-action 'none'")
  })

  it('uses the dedicated preview protocol in the desktop app', () => {
    Object.defineProperty(window, 'apex', { configurable: true, value: {} })
    try {
      act(() => root.render(<HtmlFence source="<script>1</script>" />))
      const frame = container.querySelector('iframe')!
      expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
      expect(new URL(frame.getAttribute('src')!).searchParams.get('html')).toBe('<script>1</script>')
      expect(frame.hasAttribute('srcdoc')).toBe(false)
    } finally {
      Reflect.deleteProperty(window, 'apex')
    }
  })

  it('keeps a failed draft, sends it on retry, and isolates sessions', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    const render = (sessionKey: string) => root.render(<InteractiveChatProvider sessionKey={sessionKey} onSendFeedback={send}><HtmlFence source="<button>Blue</button>" /></InteractiveChatProvider>)
    act(() => render('one'))
    const input = container.querySelector('textarea')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => { setter.call(input, 'Choose blue'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === 'Send feedback')!
    await act(async () => { button.click() })
    expect(input.value).toBe('Choose blue')
    expect(container.textContent).toContain('Could not send feedback')
    act(() => render('other'))
    expect(container.querySelector('textarea')!.value).toBe('')
    act(() => render('one'))
    expect(container.querySelector('textarea')!.value).toBe('Choose blue')
    const retry = [...container.querySelectorAll('button')].find((item) => item.textContent === 'Send feedback')!
    await act(async () => { retry.click() })
    expect(send).toHaveBeenCalledWith('Choose blue')
    expect(container.textContent).toContain('Sent')
    act(() => render('two'))
    expect(container.querySelector('textarea')!.value).toBe('')
    expect(container.textContent).not.toContain('Sent')
  })

  it('accepts bounded drafts only from its own frame and preserves user edits and failed sends', async () => {
    Object.defineProperty(window, 'apex', { configurable: true, value: {} })
    const send = vi.fn().mockRejectedValue(new Error('offline'))
    try {
      const render = (sessionKey: string) => root.render(<InteractiveChatProvider sessionKey={sessionKey} onSendFeedback={send}><HtmlFence source="<button>Choose</button>" /></InteractiveChatProvider>)
      act(() => render('bridge-one'))
      const frame = container.querySelector('iframe')!.contentWindow!
      const input = container.querySelector('textarea')!
      const offer = (source: Window, text: unknown) => act(() => { window.dispatchEvent(new MessageEvent('message', { source, data: { type: 'apex:feedback', text } })) })
      offer(window, 'Wrong frame')
      offer(frame, 'x'.repeat(4001))
      offer(frame, { invalid: true })
      expect(input.value).toBe('')
      offer(frame, 'Choose blue')
      expect(input.value).toBe('Choose blue')
      expect(send).not.toHaveBeenCalled()
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      act(() => { setter.call(input, 'My own answer'); input.dispatchEvent(new Event('input', { bubbles: true })) })
      offer(frame, 'Replace user text')
      expect(input.value).toBe('My own answer')
      act(() => { setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })) })
      offer(frame, 'Choose green')
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent === 'Send feedback')!
      await act(async () => { button.click() })
      offer(frame, 'Replace failed draft')
      expect(input.value).toBe('Choose green')
      expect(send).toHaveBeenCalledWith('Choose green')
      act(() => render('bridge-two'))
      offer(frame, 'Late message from previous session')
      expect(container.querySelector('textarea')!.value).toBe('')
    } finally { Reflect.deleteProperty(window, 'apex') }
  })

  it('does not erase a newer saved draft when an earlier send finishes after remounting', async () => {
    let finish!: () => void
    const send = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const render = (sessionKey: string) => root.render(<InteractiveChatProvider sessionKey={sessionKey} onSendFeedback={send}><HtmlFence source="A preview" /></InteractiveChatProvider>)
    const type = (text: string) => act(() => {
      const input = container.querySelector('textarea')!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => render('returning'))
    type('First answer')
    act(() => { [...container.querySelectorAll('button')].find((item) => item.textContent === 'Send feedback')!.click() })
    act(() => render('elsewhere'))
    act(() => render('returning'))
    type('')
    type('First answer')
    await act(async () => finish())
    act(() => render('elsewhere'))
    act(() => render('returning'))
    expect(container.querySelector('textarea')!.value).toBe('First answer')
  })
})

