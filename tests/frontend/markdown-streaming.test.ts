// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText, STREAMING_PARSE_INTERVAL_MS } from '../../apps/desktop/src/components/MarkdownText'

describe('streaming Markdown rendering', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  })

  it('throttles newline-heavy updates without starving the latest snapshot', () => {
    const render = (text: string, streaming = true) => act(() => root.render(createElement(MarkdownText, { text, streaming })))
    render('Start')
    for (let index = 1; index <= 9; index++) {
      act(() => vi.advanceTimersByTime(10))
      render(`Start\n\nLine ${index}\n`)
      expect(container.textContent).toBe('Start')
    }
    act(() => vi.advanceTimersByTime(10))
    expect(container.textContent).toContain('Line 9')
    render('Start\n\nFinal answer', false)
    expect(container.textContent).toContain('Final answer')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('replaces shrunk text and clears pending timers when unmounted', () => {
    act(() => root.render(createElement(MarkdownText, { text: 'Longer initial text', streaming: true })))
    act(() => root.render(createElement(MarkdownText, { text: 'Longer initial text plus a tail', streaming: true })))
    expect(vi.getTimerCount()).toBe(1)
    act(() => root.render(createElement(MarkdownText, { text: 'Short', streaming: true })))
    expect(container.textContent).toBe('Short')
    act(() => root.render(createElement(MarkdownText, { text: 'Short with pending text', streaming: true })))
    expect(vi.getTimerCount()).toBe(1)
    act(() => root.render(null))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('holds punctuation in the pending snapshot instead of rendering it as a separate block', () => {
    const render = (text: string) => act(() => root.render(createElement(MarkdownText, { text, streaming: true })))

    render('Let me do some web searches')
    render('Let me do some web searches|')
    render('Let me do some web searches|.')

    expect(container.textContent).toBe('Let me do some web searches')
    expect(container.querySelectorAll('.prose > p')).toHaveLength(1)
    expect(container.querySelector('.prose-stream-tail')).toBeNull()

    act(() => vi.advanceTimersByTime(STREAMING_PARSE_INTERVAL_MS))

    expect(container.textContent).toBe('Let me do some web searches|.')
    expect(container.querySelectorAll('.prose > p')).toHaveLength(1)
  })
})
