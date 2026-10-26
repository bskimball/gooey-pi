// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkTimeline } from '../../apps/desktop/src/components/transcript/timeline'
import { RECENT_TIMELINE_PAGES, TIMELINE_PAGE_SIZE } from '../../apps/desktop/src/components/transcript/TimelinePage'
import type { MessagePart } from '../../apps/desktop/src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
const recentLimit = TIMELINE_PAGE_SIZE * RECENT_TIMELINE_PAGES
const tools = (count: number): MessagePart[] => Array.from({ length: count }, (_, index): MessagePart[] => [
  { type: 'toolCall', id: `call-${index}`, name: 'probe', args: { command: `command-${index}` } },
  { type: 'toolResult', name: 'probe', text: `result-${index}` },
]).flat()
const render = (parts: MessagePart[]) => act(() => root.render(<WorkTimeline parts={parts} showReasoning showTools streaming />))
const toolRows = () => container.querySelectorAll('.activity-line--tool')
const toggle = () => container.querySelector<HTMLButtonElement>('.timeline-page__toggle')

beforeEach(() => {
  container = document.createElement('div')
  container.className = 'scroll-area'
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('bounded long-turn timelines', () => {
  it('mounts only recent completed activity and reveals older pages with accessible controls', () => {
    render(tools(300))
    expect(toolRows()).toHaveLength(recentLimit)
    expect(toggle()?.textContent).toContain('steps 1-50')
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false')
    const bodyId = toggle()?.getAttribute('aria-controls')
    expect(bodyId).toBeTruthy()
    expect(document.getElementById(bodyId!)?.hidden).toBe(true)
    expect(container.textContent).not.toContain('command-0')
    act(() => toggle()?.click())
    expect(toolRows()).toHaveLength(recentLimit + TIMELINE_PAGE_SIZE)
    expect(document.getElementById(bodyId!)?.hidden).toBe(false)
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('command-0')
    act(() => toggle()?.click())
    expect(toolRows()).toHaveLength(recentLimit)
  })

  it('keeps mounted activity bounded as a turn grows from its first tool', () => {
    const parts = tools(300)
    for (let count = 1; count <= 300; count += 10) {
      render(parts.slice(0, count * 2))
      expect(toolRows().length).toBeLessThanOrEqual(recentLimit)
    }
  })

  it('does not discard expanded or keyboard-focused tool rows when their page ages out', () => {
    const parts = tools(300)
    render(parts.slice(0, recentLimit * 2))
    const first = container.querySelector<HTMLButtonElement>('.activity-tool__summary')
    act(() => { first?.focus(); first?.click() })
    const details = container.querySelector('.activity-tool__details')
    expect(details?.textContent).toContain('result-0')
    render(parts)
    expect(container.querySelector('.activity-tool__details')).toBe(details)
    expect(document.activeElement).toBe(first)
    expect(toolRows()).toHaveLength(recentLimit + TIMELINE_PAGE_SIZE)
  })

  it('keeps pending tools visible outside the recent pages', () => {
    const parts = tools(300)
    parts[1] = { type: 'toolResult', name: 'probe', text: 'still running', streaming: true }
    render(parts)
    expect(toolRows()).toHaveLength(recentLimit + TIMELINE_PAGE_SIZE)
    expect(container.textContent).toContain('still running')
    const completed = [...parts]
    completed[1] = { type: 'toolResult', name: 'probe', text: 'done' }
    render(completed)
    expect(toolRows()).toHaveLength(recentLimit)
  })

  it('retains a visible outgoing page while the user is reading history', () => {
    const parts = tools(300)
    render(parts.slice(0, recentLimit * 2))
    Object.defineProperties(container, { scrollHeight: { configurable: true, value: 4000 }, clientHeight: { configurable: true, value: 600 } })
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
    const body = container.querySelector<HTMLElement>('.timeline-page__body')!
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, -100, 800, 400))
    render(parts)
    expect(body.hidden).toBe(false)
    expect(body.textContent).toContain('command-0')
  })

  it('keeps tool/result pairs and expansion state together when a late result is inserted', () => {
    const parts = tools(150)
    const missing = parts.filter((_, index) => index !== 201)
    render(missing)
    const summary = [...container.querySelectorAll<HTMLButtonElement>('.activity-tool__summary')].find((button) => button.textContent?.includes('command-100'))
    act(() => summary?.click())
    render(parts)
    expect(container.querySelector('.activity-tool__details')?.textContent).toContain('result-100')
    expect(container.querySelectorAll('.activity-line--result')).toHaveLength(0)
  })
})
