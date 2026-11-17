// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Transcript } from '../../apps/desktop/src/components/Transcript'
import { LiveElapsed, WorkTimeline } from '../../apps/desktop/src/components/transcript/timeline'
import { cleanGoal, cleanOutcome } from '../../apps/desktop/src/components/transcript/subagent-lane'
import { replayApexEvents } from '../../apps/desktop/src/lib/events/reduce'
import type { TranscriptMessage } from '../../apps/desktop/src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../apps/desktop/src/components/ui', async () => {
  const actual = await vi.importActual<typeof import('../../apps/desktop/src/components/ui')>('../../apps/desktop/src/components/ui')
  const { createElement: element } = await import('react')
  return { ...actual, PiMark: ({ size = 24 }: { size?: number }) => element('span', { className: 'pi-mark', style: { width: size, height: size } }) }
})

const git = { isRepo: false, files: [] }
const noop = () => undefined

function render(messages: TranscriptMessage[], active = false, showTools = true): string {
  return renderToStaticMarkup(createElement(Transcript, {
    messages,
    git,
    active,
    showTools,
    onOpenChanges: noop,
    onSuggestion: noop,
  }))
}

describe('transcript rendering', () => {
  it('keeps steering replies outside tool history through append, expand, and settlement', async () => {
    const messages: TranscriptMessage[] = [
      { id: 'prompt', role: 'user', parts: [{ type: 'text', text: 'Inspect the app' }] },
      { id: 'before', role: 'assistant', parts: [
        { type: 'toolCall', id: 'read-before', name: 'read', args: { path: 'before.ts' } },
        { type: 'toolResult', name: 'read', text: 'Previous output' },
      ] },
      { id: 'steer', role: 'user', steerState: 'read', parts: [{ type: 'text', text: 'Focus on accessibility' }] },
      { id: 'reply', role: 'assistant', streaming: true, parts: [
        { type: 'text', text: 'I will focus on keyboard navigation.' },
        { type: 'toolCall', id: 'read-after', name: 'read', args: { path: 'after.ts' } },
      ] },
    ]
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const update = async (active: boolean) => act(async () => root.render(createElement(Transcript, { messages: [...messages], git, active, onOpenChanges: noop, onSuggestion: noop })))
    try {
      await update(true)
      expect(container.querySelectorAll('.work-group')).toHaveLength(2)
      expect(container.querySelectorAll('.work-group.is-live')).toHaveLength(1)
      const group = container.querySelector('.work-group.is-live')!
      expect(group.querySelector('.work-group__label')?.textContent).toBe('Running read: after.ts')
      const firstLabel = group.querySelector('.work-group__label')
      messages[3] = { ...messages[3], parts: [messages[3].parts[0], { type: 'toolCall', id: 'read-after', name: 'read', args: { path: 'after.tsx' } }] }
      await update(true)
      expect(group.querySelector('.work-group__label')).toBe(firstLabel)
      expect(firstLabel?.textContent).toBe('Running read: after.tsx')
      expect(group.querySelector('.work-group__body')).toBeNull()
      await act(async () => group.querySelector<HTMLButtonElement>('.work-group__summary')!.click())
      expect(group.querySelector('.work-group__body')?.textContent).toContain('after.ts')
      expect(group.querySelector('.work-group__body')?.textContent).not.toContain('before.ts')
      const reply = [...container.querySelectorAll('.prose')].find(node => node.textContent === 'I will focus on keyboard navigation.')!
      expect(reply).toBeDefined()
      expect(reply.closest('.work-group')).toBeNull()
      expect(container.textContent).toContain('Focus on accessibility')
      messages[3] = { ...messages[3], parts: [...messages[3].parts,
        { type: 'toolResult', name: 'read', text: 'Keyboard controls found' },
        { type: 'toolCall', id: 'read-next', name: 'read', args: { path: 'next.ts' } },
      ] }
      await update(true)
      expect(container.querySelector('.work-group.is-live .work-group__summary')?.getAttribute('aria-expanded')).toBe('true')
      const nextLabel = container.querySelector('.work-group.is-live .work-group__label')
      expect(nextLabel).not.toBe(firstLabel)
      expect(nextLabel?.textContent).toBe('Running read: next.ts')
      expect(container.querySelectorAll('.message--assistant .turn-receipt')).toHaveLength(1)
      const historicReceipt = container.querySelector('.message--assistant .turn-receipt')
      const liveArticle = container.querySelector('.message--assistant.message--streaming')!
      const liveGroup = container.querySelector('.work-group.is-live')!
      const openBody = liveGroup.querySelector('.work-group__body')!
      expect(liveArticle.querySelector('section.work-disclosure.is-running [role="status"]')).not.toBeNull()
      expect(container.textContent).toContain('I will focus on keyboard navigation.')
      messages[3] = { ...messages[3], streaming: false, parts: [...messages[3].parts,
        { type: 'toolResult', name: 'read', text: 'Complete', isError: true },
        { type: 'text', text: 'The keyboard review is complete.' },
      ] }
      await update(false)
      expect(container.querySelector('.work-group.is-live')).toBeNull()
      // Settlement reuses the live article and its work group; the reader's open history and scroll stay put.
      expect(liveArticle.isConnected).toBe(true)
      expect(liveArticle.classList.contains('message--streaming')).toBe(false)
      expect(liveArticle.querySelector('.work-disclosure.is-running, [role="status"]')).toBeNull()
      expect(liveGroup.isConnected).toBe(true)
      expect(liveGroup.querySelector('.work-group__summary')?.getAttribute('aria-expanded')).toBe('true')
      expect(openBody.isConnected).toBe(true)
      expect(liveArticle.querySelector('.turn-receipt')).not.toBeNull()
      expect(container.querySelector('.message--assistant .turn-receipt')).toBe(historicReceipt)
      expect(container.querySelector('.work-group__failed')?.textContent).toContain('1 failed')
      expect([...container.querySelectorAll('.work-group__label')].map(node => node.textContent)).toContain('Read 2 files')
      const settledLabel = [...container.querySelectorAll('.work-group__label')].at(-1)
      expect(settledLabel).not.toBe(nextLabel)
      expect(settledLabel?.textContent).toBe('Read 2 files')
      expect(container.querySelectorAll('.message--assistant .turn-receipt')).toHaveLength(2)
      expect(container.textContent).toContain('I will focus on keyboard navigation.')
      expect(container.textContent).toContain('The keyboard review is complete.')
      expect([...container.querySelectorAll('.message--user')].some(node => node.textContent?.includes('Focus on accessibility'))).toBe(true)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('expands live reasoning and follows tool history only while the reader is at the bottom', async () => {
    let message: TranscriptMessage = { id: 'live-scroll', role: 'assistant', streaming: true, parts: [
      { type: 'thinking', text: 'Checking **keyboard focus**.' },
    ] }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const update = async () => act(async () => root.render(createElement(Transcript, { messages: [message], git, active: true, onOpenChanges: noop, onSuggestion: noop })))
    try {
      await update()
      await act(async () => container.querySelector<HTMLButtonElement>('.work-group__summary')!.click())
      const body = container.querySelector<HTMLDivElement>('.work-group__body')!
      expect(body.querySelector('.activity-line--reasoning strong')?.textContent).toBe('keyboard focus')
      Object.defineProperties(body, { scrollHeight: { value: 900, configurable: true }, clientHeight: { value: 200 } })
      body.scrollTop = 700
      await act(async () => body.dispatchEvent(new Event('scroll')))
      message = { ...message, parts: [...message.parts, { type: 'toolCall', id: 'read-1', name: 'read', args: { path: 'first.ts' } }] }
      await update()
      expect(body.scrollTop).toBe(900)
      body.scrollTop = 100
      await act(async () => body.dispatchEvent(new Event('scroll')))
      Object.defineProperty(body, 'scrollHeight', { value: 1200 })
      message = { ...message, parts: [...message.parts, { type: 'toolCall', id: 'read-2', name: 'read', args: { path: 'second.ts' } }] }
      await update()
      expect(body.scrollTop).toBe(100)
      expect(body.textContent).toContain('first.ts')
      expect(body.textContent).toContain('second.ts')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('keeps current result images visible when the live tool history is collapsed', () => {
    const html = render([{ id: 'image-tool', role: 'assistant', streaming: true, parts: [
      { type: 'toolCall', id: 'capture', name: 'browser_screenshot' },
      { type: 'toolResult', name: 'browser_screenshot', text: 'Captured', images: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }] },
    ] }], true)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('.work-group__body')).toBeNull()
    expect(document.querySelector('img')?.getAttribute('src')).toContain('iVBORw0KGgo=')
  })

  it('opens the matching worker from an older delegation and keeps its failed outcome after close', async () => {
    const messages: TranscriptMessage[] = Array.from({ length: 10 }, (_, index) => ({
      id: `message-${index}`, role: 'assistant', parts: [
        { type: 'toolCall', id: `start-${index}`, name: 'task_start', args: { agent: 'scout', prompt: `Mission ${index}` } },
        { type: 'toolResult', name: 'task_start', text: `started task_${index}` },
      ],
    }))
    messages.push({ id: 'outcome', role: 'assistant', parts: [
      { type: 'toolCall', name: 'task_wait', args: { id: 'task_0' } },
      { type: 'toolResult', name: 'task_wait', text: 'lifecycle: failed\n--- result ---\nCould not finish' },
      { type: 'toolCall', name: 'task_close', args: { id: 'task_0' } },
      { type: 'toolResult', name: 'task_close', text: 'lifecycle: closed' },
    ] })
    const onOpenSpecialist = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(Transcript, { messages, git, onOpenChanges: noop, onSuggestion: noop, onOpenSpecialist })))
      const first = container.querySelector('.subagent-lane')!
      expect(first.querySelector('.subagent-lane__state')?.textContent).toBe('failed')
      const summary = first.querySelector('.subagent-lane__summary')!
      expect(summary.tagName).toBe('DIV')
      expect(summary.hasAttribute('role')).toBe(false)
      expect(summary.hasAttribute('tabindex')).toBe(false)
      expect(first.querySelector('.subagent-lane__open')).toBeNull()
      expect(first.querySelector('button button')).toBeNull()

      const primary = first.querySelector<HTMLButtonElement>('.subagent-lane__primary')!
      expect(primary.tagName).toBe('BUTTON')
      expect(primary.getAttribute('title')).toBe('Show agent in sidebar')
      expect(primary.hasAttribute('aria-expanded')).toBe(false)
      await act(async () => primary.click())
      expect(onOpenSpecialist).toHaveBeenCalledTimes(1)
      expect(onOpenSpecialist).toHaveBeenCalledWith('task_0')
      expect(first.querySelector('.subagent-lane__body')).toBeNull()
      onOpenSpecialist.mockClear()

      // Separate disclosure toggle expands/collapses the report without opening the sidebar.
      const toggle = first.querySelector<HTMLButtonElement>('.subagent-lane__toggle')!
      expect(toggle.tagName).toBe('BUTTON')
      expect(toggle.type).toBe('button')
      expect(toggle.getAttribute('aria-label')).toBe('Expand scout details')
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      await act(async () => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
      expect(onOpenSpecialist).not.toHaveBeenCalled()
      expect(toggle.getAttribute('aria-label')).toBe('Collapse scout details')
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      const body = first.querySelector('.subagent-lane__body')
      expect(body).not.toBeNull()
      expect(toggle.getAttribute('aria-controls')).toBe(body!.id)
      expect(body!.textContent).toContain('Could not finish')

      await act(async () => first.querySelector<HTMLButtonElement>('.subagent-lane__links button')!.click())
      expect(onOpenSpecialist).toHaveBeenCalledTimes(1)
      expect(onOpenSpecialist).toHaveBeenCalledWith('task_0')

      await act(async () => toggle.click())
      expect(toggle.getAttribute('aria-label')).toBe('Expand scout details')
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(first.querySelector('.subagent-lane__body')).toBeNull()
      expect(first.querySelector('.status-mark--running')).toBeNull()
      expect(first.querySelector('.subagent-lane__status .status-mark--failed')).not.toBeNull()
      expect(container.querySelector('.subagent-lane.is-running .status-mark--running')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('expands chain lanes without opening an arbitrary agent and selects per-agent transcript links', async () => {
    const messages: TranscriptMessage[] = [{
      id: 'chain-message',
      role: 'assistant',
      parts: [
        { type: 'toolCall', id: 'chain-1', name: 'task_chain', args: { steps: [{ agent: 'scout', prompt: 'Map' }, { agent: 'machinist', prompt: 'Implement' }] } },
        { type: 'toolResult', name: 'task_chain', text: 'step 1 ok\nstep 2 ok\n--- result ---\nChain finished' },
      ],
    }]
    const onOpenSpecialist = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(Transcript, { messages, git, onOpenChanges: noop, onSuggestion: noop, onOpenSpecialist })))
      const lane = container.querySelector('.subagent-lane')!
      const summary = lane.querySelector('.subagent-lane__summary')!
      expect(summary.tagName).toBe('DIV')
      expect(summary.hasAttribute('role')).toBe(false)
      expect(lane.querySelector('button button')).toBeNull()
      expect(lane.querySelector('.subagent-lane__open')).toBeNull()

      const primary = lane.querySelector<HTMLButtonElement>('.subagent-lane__primary')!
      const toggle = lane.querySelector<HTMLButtonElement>('.subagent-lane__toggle')!
      expect(primary.getAttribute('title')).toBe('Show agent details')
      expect(primary.getAttribute('aria-expanded')).toBe('false')
      expect(toggle.getAttribute('aria-label')).toBe('Expand scout → machinist details')

      await act(async () => primary.click())
      expect(onOpenSpecialist).not.toHaveBeenCalled()
      expect(primary.getAttribute('aria-expanded')).toBe('true')
      expect(toggle.getAttribute('aria-label')).toBe('Collapse scout → machinist details')

      const links = [...lane.querySelectorAll<HTMLButtonElement>('.subagent-lane__links button')]
      expect(links.map((link) => link.textContent)).toEqual(['Open scout transcript', 'Open machinist transcript'])
      await act(async () => links[0]!.click())
      expect(onOpenSpecialist).toHaveBeenLastCalledWith('chain-1-step-1')
      await act(async () => links[1]!.click())
      expect(onOpenSpecialist).toHaveBeenLastCalledWith('chain-1-step-2')
      expect(onOpenSpecialist).toHaveBeenCalledTimes(2)
      onOpenSpecialist.mockClear()

      await act(async () => toggle.click())
      expect(onOpenSpecialist).not.toHaveBeenCalled()
      expect(toggle.getAttribute('aria-label')).toBe('Expand scout → machinist details')
      expect(lane.querySelector('.subagent-lane__body')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it.each(['task_close', 'task_abort', 'task_status', 'task_send', 'task_wait'])('preserves failed %s receipts alongside the worker report', async (tool) => {
    const messages: TranscriptMessage[] = [{ id: 'worker', role: 'assistant', parts: [
      { type: 'toolCall', name: 'task_start', args: { agent: 'scout', prompt: 'Inspect' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_1' },
      { type: 'toolCall', name: 'task_wait', args: { id: 'task_1' } },
      { type: 'toolResult', name: 'task_wait', text: 'lifecycle: settled\n--- result ---\nCompleted report' },
      { type: 'toolCall', name: tool, args: { id: 'task_1' } },
      { type: 'toolResult', name: tool, text: 'Operation rejected: worker transport unavailable', isError: true },
    ] }]
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(Transcript, { messages, git, onOpenChanges: noop, onSuggestion: noop })))
      // The failed receipt folds into the work summary, which names the failure and expands to the row.
      const group = container.querySelector('.work-group')!
      expect(group.querySelector('.work-group__failed')?.textContent).toContain('1 failed')
      await act(async () => group.querySelector<HTMLButtonElement>('.work-group__summary')!.click())
      const operation = container.querySelector('.activity-line--tool.is-error')!
      expect(operation.textContent).toContain(tool)
      await act(async () => operation.querySelector<HTMLButtonElement>('.activity-tool__summary')!.click())
      expect(operation.textContent).toContain('Operation rejected: worker transport unavailable')
      if (tool !== 'task_wait') expect(container.querySelector('.subagent-lane__state')?.textContent).toBe('done')
      expect(container.querySelector('.subagent-lane')?.textContent).toContain('Completed report')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('does not offer a transcript link when historical delegation arguments cannot identify a worker', () => {
    const html = renderToStaticMarkup(createElement(Transcript, {
      messages: [{ id: 'history', role: 'assistant', parts: [
        { type: 'toolCall', id: 'old-call', name: 'task_start' },
        { type: 'toolResult', name: 'task_start', text: 'started task_1' },
      ] }], git, onOpenChanges: noop, onSuggestion: noop, onOpenSpecialist: noop,
    }))
    expect(html).not.toContain('Open agent transcript')
  })

  it('keeps live reasoning behind a compact disclosure without thinking dots', () => {
    const html = render([{
      id: 'active',
      role: 'assistant',
      timestamp: 1_000,
      startedAt: 1_000,
      streaming: true,
      parts: [{ type: 'thinking', text: 'Checking **the workspace** now.' }],
    }])

    expect(html).not.toContain('activity-line--reasoning')
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector('.work-group__summary[aria-expanded="false"]')?.textContent).toBe('Thinking')
    expect(html).not.toContain('work-disclosure__rail')
    expect(html).not.toContain('assistant-mark')
    expect(html).toContain('work-disclosure__status')
    expect(html).not.toContain('thinking-dots')
  })

  it.each([
    ['a running tool', true, 'read_file', { path: 'package.json' }, 'Running read_file: package.json'],
    ['a hidden running tool', false, 'read_file', { path: 'package.json' }, undefined],
    ['an ask_user wait', true, 'ask_user', { question: 'Which release channel?' }, 'Waiting for your answer'],
    ['a hidden ask_user wait', false, 'ask_user', { question: 'Which release channel?' }, undefined],
  ])('names the live work when reasoning transitions to %s', (_description, showTools, name, args, activity) => {
    const html = render([{
      id: 'active', role: 'assistant', timestamp: 1_000, streaming: true,
      parts: [{ type: 'thinking', text: 'Checking the workspace.' }, { type: 'toolCall', id: 'tool-1', name, args }],
    }], false, showTools)

    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelectorAll('.work-group__summary')).toHaveLength(1)
    expect(document.querySelector('.work-group__body')).toBeNull()
    expect(html).not.toContain('Checking the workspace.')
    // Questions stay outside the collapsed tool history so their controls remain reachable.
    expect(Boolean(document.querySelector('.activity-line--tool'))).toBe(showTools && name === 'ask_user')
    if (activity) {
      expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll("[role=\"status\"] > .work-disclosure__activity:first-child")].map(element => [element.getAttribute('title'), element.textContent])).toContainEqual([activity, activity])
      expect(html).not.toContain('live-work-verb')
    } else expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[role="status"] > .work-disclosure__verb:first-child')].map(element => element.textContent)).toContain('Working')
  })

  it('names a running subagent in the live status line', () => {
    const html = render([{
      id: 'active', role: 'assistant', timestamp: 1_000, streaming: true,
      parts: [{ type: 'toolCall', id: 'build', name: 'task_start', args: { agent: 'machinist', prompt: 'Build it' } }],
    }])
    expect(html).toContain('>Running machinist</span>')
  })

  it.each([[true, 'Working'], [false, 'Thinking']] as const)(
    'uses visible activity when showTools=%s for a completed generic tool',
    (showTools, status) => {
      const html = render([{
        id: 'active', role: 'assistant', timestamp: 1_000, streaming: true,
        parts: [
          { type: 'thinking', text: 'Plan ready.' },
          { type: 'toolCall', id: 'tool-1', name: 'read_file' },
          { type: 'toolResult', name: 'read_file', text: 'done' },
        ],
      }], false, showTools)
      expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll("[role=\"status\"] > .work-disclosure__verb:first-child")].map(element => element.textContent)).toContain(status)
    },
  )

  it('keeps a hidden tool Working through partial updates, then restores visible reasoning', () => {
    const updating = replayApexEvents([], [
      { type: 'agent_start' },
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'Plan ready.' } },
      { type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read_file' },
      { type: 'tool_execution_update', toolCallId: 'tool-1', toolName: 'read_file', partialResult: 'halfway' },
    ])
    expect([...new DOMParser().parseFromString(render(updating, false, false), 'text/html').querySelectorAll("[role=\"status\"] > .work-disclosure__verb:first-child")].map(element => element.textContent)).toContain("Working")

    const finished = replayApexEvents(updating, [
      { type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'read_file', result: 'done' },
    ])
    expect([...new DOMParser().parseFromString(render(finished, false, false), 'text/html').querySelectorAll("[role=\"status\"] > .work-disclosure__verb:first-child")].map(element => element.textContent)).toContain("Thinking")

    const ended = replayApexEvents(updating, [{ type: 'agent_end' }])
    expect(ended[0].parts.find((part) => part.type === 'toolResult')).toMatchObject({ streaming: false, isError: true })
  })

  it('keeps late results at their call site and follows newer reasoning or narrative', () => {
    const reasoning = replayApexEvents([], [
      { type: 'agent_start' },
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'First thought.' } },
      { type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read_file' },
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'New thought.' } },
      { type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'read_file', result: 'done' },
    ])
    expect(reasoning[0].parts.map((part) => part.type)).toEqual(['thinking', 'toolCall', 'toolResult', 'thinking'])
    expect([...new DOMParser().parseFromString(render(reasoning), 'text/html').querySelectorAll("[role=\"status\"] > .work-disclosure__verb:first-child")].map(element => element.textContent)).toContain("Thinking")

    const narrative = replayApexEvents(reasoning, [
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Final answer.' } },
    ])
    expect([...new DOMParser().parseFromString(render(narrative, false, false), 'text/html').querySelectorAll("[role=\"status\"] > .work-disclosure__verb:first-child")].map(element => element.textContent)).toContain("Working")
  })

  it('keeps external active work readable until the whole agent turn is done', () => {
    const html = render([{
      id: 'external-active',
      role: 'assistant',
      timestamp: 1_000,
      completedAt: 2_000,
      parts: [
        { type: 'thinking', text: 'Following the external session.' },
        { type: 'text', text: 'Explaining the next step.' },
        { type: 'toolCall', id: 'tool-1', name: 'read_file', args: { path: 'src/App.tsx' } },
        { type: 'toolResult', name: 'read_file', text: 'read complete' },
      ],
    }], true)

    expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll(".work-group__label")].map(element => element.textContent)).toContain("Thought")
    expect(html).not.toContain('Following the external session.')
    expect(html).toContain('Explaining the next step.')
    expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.work-group__label')].map(element => element.textContent)).toContain('Read 1 file')
    expect(html).not.toContain('read complete')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Agent work activity')
    expect(html).not.toContain('Worked for')
    expect(html).not.toContain('message-actions')
  })

  it('shows a fresh working placeholder instead of reopening the prior assistant after a user tail', () => {
    const html = render([{
      id: 'complete',
      role: 'assistant',
      timestamp: 1_000,
      completedAt: 2_000,
      parts: [{ type: 'thinking', text: 'Prior completed reasoning.' }],
    }, {
      id: 'new-user',
      role: 'user',
      timestamp: 3_000,
      parts: [{ type: 'text', text: 'Continue externally' }],
    }], true)

    expect(html).toContain('Turn finished in</span> 1s')
    // The prior turn's reasoning stays folded under its Thought summary rather than reopening as live work.
    expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll(".work-group__label")].map(element => element.textContent)).toContain("Thought")
    expect(html).not.toContain('Prior completed reasoning.')
    expect(html).toContain('sr-only')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('Pi is working')
  })

  it.each([
    ['pi', 'Pi'],
  ] as const)('keeps an accepted %s steer in history without duplicating the working indicator', (harness, shortName) => {
    const html = renderToStaticMarkup(createElement(Transcript, {
      messages: [
        { id: 'before', role: 'assistant', timestamp: 1_000, parts: [{ type: 'text', text: 'Current response' }] },
        { id: 'user-queued-steer', role: 'user', steerState: 'accepted', timestamp: 2_000, parts: [{ type: 'text', text: 'Pick this up' }] },
        { id: 'active', role: 'assistant', timestamp: 2_001, streaming: true, parts: [] },
      ],
      git,
      harness,
      active: true,
      onOpenChanges: noop,
      onSuggestion: noop,
    }))

    expect(html).toContain('Current response')
    expect(html).toContain('Pick this up')
    expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.sr-only')].filter((element) => element.textContent === `${shortName} is working`)).toHaveLength(1)
    expect(html).not.toContain('transcript-active-placeholder')
  })

  it('folds settled reasoning into an expandable Thought summary once the response yields', () => {
    const html = render([{
      id: 'complete',
      role: 'assistant',
      timestamp: 1_000,
      startedAt: 1_000,
      completedAt: 4_000,
      parts: [{ type: 'thinking', text: 'This stays visible after the turn.' }],
    }])

    expect(html).not.toContain('Worked for')
    expect(html).toContain('Turn finished in</span> 3s')
    expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll(".work-group__label")].map(element => element.textContent)).toContain("Thought")
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector(".work-group__summary[aria-expanded=\"false\"]")).not.toBeNull()
    expect(html).not.toContain('This stays visible after the turn.')
    expect(html).not.toContain('thinking-dots')
  })

  it('renders adjacent assistant continuations as one work disclosure', () => {
    const html = render([
      {
        id: 'first-segment', role: 'assistant', timestamp: 1_000, startedAt: 1_000, completedAt: 2_000,
        parts: [{ type: 'thinking', text: 'First activity segment.' }],
      },
      {
        id: 'second-segment', role: 'assistant', timestamp: 2_000, startedAt: 2_000, completedAt: 5_000,
        parts: [{ type: 'toolCall', id: 'read', name: 'read_file', args: { path: 'next.ts' } }, { type: 'toolResult', name: 'read_file', text: 'done' }],
      },
    ])

    expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll(".message.message--assistant")]).toHaveLength(1)
    expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll(".turn-receipt")]).toHaveLength(1)
    expect(html).toContain('Turn finished in</span> 4s')
  })


  it('renders one file changes card in the pinned transcript footer', () => {
    const html = renderToStaticMarkup(createElement(Transcript, {
      messages: [{ id: 'assistant', role: 'assistant', parts: [{ type: 'text', text: 'Done' }] }],
      git: { isRepo: true, files: [{ path: 'src/App.tsx', status: 'modified', additions: 2, deletions: 1, staged: false }] },
      onOpenChanges: noop,
      onSuggestion: noop,
    }))
    expect(html).toContain('transcript-changes-pin')
    expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll(".changes-card")]).toHaveLength(1)
    expect(html).toContain('1 file changed')
  })

  it('renders streamed tool images inline even when tool logs are hidden', () => {
    const data = 'iVBORw0KGgo='
    const messages = replayApexEvents([], [
      { type: 'agent_start' },
      { type: 'tool_execution_start', toolCallId: 'capture', toolName: 'browser_screenshot' },
      { type: 'tool_execution_end', toolCallId: 'capture', toolName: 'browser_screenshot', result: { content: [{ type: 'text', text: 'Captured page' }, { type: 'image', mimeType: 'image/png', data }] } },
      { type: 'agent_end' },
    ])
    expect(messages[0].parts.find((part) => part.type === 'toolResult')).toMatchObject({ images: [{ type: 'image', mimeType: 'image/png', data }] })
    for (const showTools of [true, false]) {
      const html = render(messages, false, showTools)
      expect(html.match(/src="data:image\/png;base64,iVBORw0KGgo="/g)).toHaveLength(1)
      expect(html).toContain('aria-label="Expand image"')
    }
  })

  it('renders valid user images and keeps truncated history as a safe placeholder', () => {
    const html = render([{
      id: 'user-image', role: 'user', parts: [
        { type: 'text', text: 'See this' },
        { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
        { type: 'image', mimeType: 'image/png', data: 'truncated', dataTruncated: true },
      ],
    }])

    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="')
    expect(html).toContain('aria-label="Expand image"')
    expect(html).toContain('Image attachment unavailable')
    expect(html).not.toContain('src="data:image/png;base64,truncated"')
  })

  it('keeps assistant images visible while streaming without activity and after settling', () => {
    const parts: TranscriptMessage['parts'] = [
      { type: 'text', text: 'Here is the chart.' },
      { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
    ]
    const live = render([{ id: 'live-image', role: 'assistant', timestamp: 1_000, streaming: true, parts }], true)
    expect(live).toContain('sr-only')
    expect(live).toContain('aria-live="polite"')
    expect(live).toContain('Here is the chart.')
    expect(live).toContain('src="data:image/png;base64,iVBORw0KGgo="')

    const settled = render([{ id: 'live-image', role: 'assistant', timestamp: 1_000, completedAt: 2_000, parts }])
    expect(settled).not.toContain('is working')
    expect(settled).toContain('Here is the chart.')
    expect(settled).toContain('src="data:image/png;base64,iVBORw0KGgo="')
  })

  it('hides model-only session UUID routing from the visible user transcript', () => {
    const html = render([{
      id: 'session-reference', role: 'user', parts: [{ type: 'text', text: 'Coordinate with @API owner.\n\n===== BEGIN GOOEYPI SESSION REFERENCES =====\n- "@API owner": pi session UUID secret-uuid. Use gooeypi_session_read.\n===== END GOOEYPI SESSION REFERENCES =====' }],
    }])
    expect(html).toContain('Coordinate with ')
    expect(html).toContain('>@API owner</button>.')
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector(".session-reference")).not.toBeNull()
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-label="Open session API owner"')
    expect(html).not.toContain('secret-uuid')
    expect(html).not.toContain('GOOEYPI SESSION REFERENCES')
  })

  it('renders goal summaries as collapsed disclosures rather than system errors', () => {
    const html = render([{
      id: 'goal',
      role: 'goal',
      timestamp: 1_000,
      parts: [{ type: 'text', text: 'Ship the blue goal summary.' }],
    }])

    expect(html).toContain('message--goal')
    expect(html).toContain('aria-label="Goal summary"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Ship the blue goal summary.')
    expect(html).not.toContain('message--system')
  })
  it('keeps a final answer visible and copyable when an agent message arrives late', () => {
    const html = render([{
      id: 'late-agent-message',
      role: 'assistant',
      timestamp: 1_000,
      completedAt: 2_000,
      parts: [
        { type: 'thinking', text: 'Earlier reasoning.' },
        { type: 'text', text: 'The final answer stays visible.' },
        { type: 'agentMessage', agentName: 'late-reviewer', text: 'Late details.' },
      ],
    }])

    expect(html).toContain('The final answer stays visible.')
    expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll(".work-group__label")].map(element => element.textContent)).toContain("1 agent message")
    expect(html).not.toContain('Late details.')
    expect(html).toContain('aria-label="Copy assistant message"')
  })

  it('keeps a final report visible when reasoning arrives after it', () => {
    const html = render([{
      id: 'trailing-reasoning',
      role: 'assistant',
      timestamp: 1_000,
      completedAt: 2_000,
      parts: [
        { type: 'thinking', text: 'Earlier reasoning.' },
        { type: 'text', text: 'The primary final report stays visible.' },
        { type: 'thinking', text: 'Trailing lightweight reasoning.' },
      ],
    }])

    expect(html).toContain('Turn finished in</span> 1s')
    expect(html).toContain('The primary final report stays visible.')
    // Both reasoning blocks fold into their own summary rows around the report.
    expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll(".work-group__label")].filter(element => element.textContent === "Thought")).toHaveLength(2)
    expect(html.indexOf('The primary final report stays visible.')).toBeGreaterThan(html.indexOf('work-group__label'))
    expect(html).not.toContain('Trailing lightweight reasoning.')
    expect(html).toContain('aria-label="Copy assistant message"')
  })

  it('keeps mid-turn narrative and tools visible in chronological order after the turn settles', () => {
    const html = render([{
      id: 'trailing-tool-and-note',
      role: 'assistant',
      timestamp: 1_000,
      completedAt: 2_000,
      parts: [
        { type: 'thinking', text: 'Earlier reasoning.' },
        { type: 'text', text: 'This is the complete substantive report with the requested conclusions and evidence.' },
        { type: 'toolCall', id: 'cleanup', name: 'update_todo' },
        { type: 'toolResult', name: 'update_todo', text: 'done' },
        { type: 'text', text: 'Cleanup complete.' },
      ],
    }])

    expect(html).toContain('Cleanup complete.')
    expect(html).not.toContain('Worked for')
    expect(html).toContain('Turn finished in</span> 1s')
    const report = html.indexOf('This is the complete substantive report with the requested conclusions and evidence.')
    const tool = html.indexOf('>Used 1 tool</span>')
    expect(report).toBeGreaterThan(html.indexOf('>Thought</span>'))
    expect(tool).toBeGreaterThan(report)
    expect(html.indexOf('Cleanup complete.')).toBeGreaterThan(tool)
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector(".turn-receipt")).not.toBeNull()
    expect(html).toContain('1 tool')
    expect(html).not.toContain('Earlier reasoning.')
    // Copy rides on the receipt line instead of a separate actions row.
    expect(html).toContain('turn-receipt__copy')
    expect(html).toContain('aria-label="Copy assistant message"')
    expect(html).not.toContain('message-actions')
  })

  it('renders subagent calls as inline lanes and plan updates as step headers', () => {
    const html = render([{
      id: 'orchestrated',
      role: 'assistant',
      timestamp: 1_000,
      parts: [
        { type: 'toolCall', id: 'plan', name: 'todo_write', args: { todos: [{ content: 'Scout the repo', status: 'completed' }, { content: 'Implement the lane', status: 'in_progress' }] } },
        { type: 'toolCall', id: 'scout', name: 'task', args: { agent: 'scout', prompt: 'Map the transcript code' } },
        { type: 'toolResult', name: 'task', text: 'Found it.', details: { finalReport: 'Transcript lives in messages.tsx' } },
        { type: 'toolCall', id: 'build', name: 'task_start', args: { agent: 'machinist', prompt: 'Build the lane' } },
        { type: 'toolResult', name: 'task_start', text: 'started task_3\nagent: machinist', details: { worker: { id: 'task_3', agent: 'machinist', model: 'muse-code/muse-ember-1.0', thinking: 'xhigh', lifecycle: 'running' } } },
      ],
    }], true)

    expect(html).toContain('1/2 done')
    expect(html).toContain('Implement the lane')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect([...doc.querySelectorAll('.subagent-lane')]).toHaveLength(2)
    expect(html).toContain('>scout</span>')
    expect(html).toContain('>machinist</span>')
    expect(html).toContain('subagent-lane is-done')
    expect(html).toContain('subagent-lane is-running')
    expect(doc.querySelector('.status-mark.status-mark--running')).not.toBeNull()
    // Single-line default: no stacked tree rail, no awaiting-update placeholder, no View full report row.
    expect(doc.querySelectorAll('.subagent-lane__tree')).toHaveLength(0)
    expect(doc.querySelectorAll('.subagent-lane__leaf')).toHaveLength(0)
    expect(html).not.toContain('Awaiting a recorded update…')
    expect(html).not.toContain('View full report')
    const missions = [...doc.querySelectorAll('.subagent-lane__mission')].map((element) => element.textContent)
    expect(missions).toContain('Transcript lives in messages.tsx')
    expect(missions).toContain('Build the lane')
    expect([...doc.querySelectorAll('.subagent-lane__name')].map((element) => element.textContent)).toEqual(['task_3'])
    const model = doc.querySelector('.subagent-lane__model')
    expect(model?.textContent).toBe('muse-ember-1.0 · xhigh')
    expect(model?.getAttribute('title')).toBe('muse-code/muse-ember-1.0')
  })

  it('folds a task_wait into the lane of the task it started and summarizes the settled outcome on one line', () => {
    const html = render([{
      id: 'paired',
      role: 'assistant',
      timestamp: 1_000,
      completedAt: 2_000,
      parts: [
        { type: 'toolCall', id: 'start', name: 'task_start', args: { agent: 'scout', prompt: 'Repo: C:\\repo\n## Goal\nMap the code' } },
        { type: 'toolResult', name: 'task_start', text: 'Started task_1 in background' },
        { type: 'text', text: 'Waiting on the scout.' },
        { type: 'toolCall', id: 'wait', name: 'task_wait', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_wait', text: 'lifecycle: settled\n--- result ---\n## Findings\n- Lanes live in subagent-lane.tsx\n- Pairing is by id' },
      ],
    }])

    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect([...doc.querySelectorAll('.subagent-lane')]).toHaveLength(1)
    expect(html).toContain('subagent-lane is-done')
    expect(html).toContain('>done</span>')
    expect(doc.querySelector('.subagent-lane__mission')?.textContent).toBe('Lanes live in subagent-lane.tsx')
    expect(html).not.toContain('Waiting on</span>')
    expect(html).not.toContain('<code>task_1</code>')
    expect(html.indexOf('Waiting on the scout.')).toBeGreaterThan(html.indexOf('subagent-lane is-done'))
  })

  it('extracts concise goal and outcome summaries without prompt preamble or handoff fences', () => {
    expect(cleanGoal('Repo: C:\\Users\\dev\\pi-desktop\nRead AGENTS.md first\nWorktree: clean\n## Goal\nMake `SubagentLane` minimal')).toBe('Make SubagentLane minimal')
    expect(cleanGoal('Goal: Audit the sidebar state')).toBe('Audit the sidebar state')
    expect(cleanOutcome('## Summary\n---\n```handoff\noutcome: Reduced SubagentLane to one 28px row\n```')).toBe('Reduced SubagentLane to one 28px row')
    expect(cleanOutcome('{"outcome": "All 4 checks passed"}')).toBe('All 4 checks passed')
  })

  it('marks a failed turn on its prompt and shows the latest turn diff inline', () => {
    const html = renderToStaticMarkup(createElement(Transcript, {
      messages: [
        { id: 'prompt', role: 'user', parts: [{ type: 'text', text: 'Try it' }] },
        { id: 'reply', role: 'assistant', timestamp: 1_000, startedAt: 1_000, completedAt: 3_000, errorMessage: 'Provider failed', parts: [{ type: 'toolCall', id: 'r', name: 'read_file', args: { path: 'a.ts' } }, { type: 'toolResult', name: 'read_file', text: 'ok' }] },
      ],
      git: { isRepo: true, files: [{ path: 'src/App.tsx', status: 'M', additions: 2, deletions: 1, staged: false }] },
      showPinnedChanges: false,
      onOpenChanges: noop,
      onSuggestion: noop,
    }))

    expect(html).toContain('message__turn-status is-failed')
    expect(html).toContain('Turn failed')
    expect(html).toContain('turn-receipt is-failed')
    expect(html).toContain('1 file changed')
    expect(html).not.toContain('changes-card')
  })

  it('keeps a later segment failure when coalescing assistant segments', () => {
    const html = render([
      { id: 'prompt', role: 'user', parts: [{ type: 'text', text: 'Try it' }] },
      { id: 'first', role: 'assistant', timestamp: 1_000, completedAt: 2_000, parts: [{ type: 'toolCall', id: 'r', name: 'read_file', args: { path: 'a.ts' } }, { type: 'toolResult', name: 'read_file', text: 'ok' }] },
      { id: 'second', role: 'assistant', timestamp: 2_000, completedAt: 3_000, errorMessage: 'Provider failed', parts: [{ type: 'text', text: 'Partial answer.' }] },
    ])

    expect(html).toContain('message__turn-status is-failed')
    expect(html).toContain('Turn failed')
    expect(html).toContain('turn-receipt is-failed')
    expect(html).toContain('Provider failed')
  })

  it('counts subagents that follow the final report in the turn receipt', () => {
    const html = render([{
      id: 'report-then-task',
      role: 'assistant',
      timestamp: 1_000,
      completedAt: 2_000,
      parts: [
        { type: 'thinking', text: 'Planning.' },
        { type: 'text', text: 'Here is the complete report with the requested conclusions and supporting evidence.' },
        { type: 'toolCall', id: 'scout', name: 'task', args: { agent: 'scout', prompt: 'Map it' } },
        { type: 'toolResult', name: 'task', text: 'Found it.' },
      ],
    }])

    expect(new DOMParser().parseFromString(html, 'text/html').querySelector(".turn-receipt")).not.toBeNull()
    expect(html).toContain('1 agent')
  })

  it('summarizes earlier agent messages in active work without opening their contents', () => {
    const html = render([{
      id: 'active-agent-message',
      role: 'assistant',
      streaming: true,
      parts: [
        { type: 'thinking', text: '**Coordinating agents**' },
        { type: 'agentMessage', agentName: 'reviewer', text: 'Detailed child-agent response.' },
        { type: 'toolCall', id: 'next', name: 'read_file', args: { path: 'src/App.tsx' } },
      ],
    }])

    expect([...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.work-group__label')].map(element => element.textContent)).toContain('Running read_file: src/App.tsx')
    expect(html).not.toContain('activity-line--tool')
    expect(html).not.toContain('Detailed child-agent response.')
    expect(html).not.toContain('message--agent')
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(1)
  })

  it('renders system failures as compact expandable activity instead of red boxes', () => {
    const html = render([{ id: 'failure', role: 'system', parts: [{ type: 'text', text: 'Request failed with details.' }] }])
    expect(html).toContain('message--activity')
    expect(html).toContain('Pi message')
    expect(html).toContain('failed')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Request failed with details.')
    expect(html).not.toContain('message--system')
  })

  it('renders compaction activity and completion separately from system failures', () => {
    const runningHtml = render([{
      id: 'compaction-running',
      role: 'system',
      parts: [{ type: 'compaction', status: 'running', reason: 'threshold', tokensBefore: 80_000 }],
    }])
    expect(runningHtml).toContain('activity-line--compaction is-running')
    expect(runningHtml).toContain('Compacting context')
    expect(runningHtml).toContain('automatic threshold')
    expect(runningHtml).toContain('80,000 tokens before')
    expect(runningHtml.match(/status-mark--running/g)).toHaveLength(1)
    expect(runningHtml).toContain('activity-tool__state')
    expect(runningHtml).not.toContain('width="14"')

    const html = render([{
      id: 'compaction',
      role: 'system',
      parts: [{ type: 'compaction', status: 'done', reason: 'overflow', tokensBefore: 99_175, summary: 'The earlier work was summarized.' }],
    }])
    expect(html).toContain('activity-line--compaction')
    expect(html).toContain('Context compacted')
    expect(html).toContain('overflow recovery')
    expect(html).toContain('99,175 tokens before')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Pi message')
  })

  it('renders standalone informational output as a collapsed tool row', () => {
    const html = render([{
      id: 'ipython-state',
      role: 'tool',
      parts: [
        { type: 'toolCall', id: 'ipython-state', name: 'IPython state restored' },
        { type: 'toolResult', name: 'IPython state restored', text: 'Large diagnostic details.' },
      ],
    }])

    expect(html).toContain('message--activity')
    expect(html).toContain('IPython state restored')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Large diagnostic details.')
    expect(html).not.toContain('message--system')
  })

  it('shows live elapsed time while work is running and keeps the final duration once finished', () => {
    vi.useFakeTimers()
    const now = new Date('2026-01-01T00:00:00.000Z')
    vi.setSystemTime(now)
    try {
      const runningStartedAt = now.getTime() - 65_000
      const running = render([{
        id: 'live-prompt',
        role: 'user',
        timestamp: runningStartedAt,
        parts: [{ type: 'text', text: 'Keep going.' }],
      }, {
        id: 'live-active',
        role: 'assistant',
        timestamp: runningStartedAt,
        startedAt: runningStartedAt,
        streaming: true,
        parts: [{ type: 'thinking', text: 'Still thinking.' }],
      }], true)
      // Elapsed time lives on the prompt's turn header; the work disclosure no longer repeats it.
      expect(running.match(/live-elapsed/g)).toHaveLength(1)
      expect(running).toContain('1m05s')

      const finishedStartedAt = now.getTime() - 66_000
      const finished = render([{
        id: 'live-done',
        role: 'assistant',
        timestamp: finishedStartedAt,
        startedAt: finishedStartedAt,
        completedAt: now.getTime() - 1_000,
        parts: [{ type: 'thinking', text: 'Done thinking.' }],
      }], false)
      expect(finished).toContain('Turn finished in</span> 1m05s')
      expect(finished).not.toContain('live-elapsed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('omits the live elapsed label when no start time is available', () => {
    expect(renderToStaticMarkup(createElement(LiveElapsed, {}))).toBe('')
  })

  it('renders the Seigaiha Fin Mon welcome emblem on blank chat and no gutter mark on messages', () => {
    const emptyHtml = renderToStaticMarkup(createElement(Transcript, {
      messages: [],
      git,
      harness: 'pi',
      onOpenChanges: noop,
      onSuggestion: noop,
    }))
    expect(emptyHtml).toContain('session-welcome')
    expect(emptyHtml).toContain('pi-welcome-mark')
    expect(emptyHtml).toContain('aria-label="Apex wave crest"')

    const replyHtml = renderToStaticMarkup(createElement(Transcript, {
      messages: [{ id: 'reply-1', role: 'assistant', timestamp: 1_000, parts: [{ type: 'text', text: 'Ready.' }] }],
      git,
      harness: 'pi',
      onOpenChanges: noop,
      onSuggestion: noop,
    }))
    expect(replyHtml).not.toContain('pi-mark')
    expect(replyHtml).not.toContain('harness-mark--apex')
  })

  it('anchors the live thinking/working status indicator below active timeline items', () => {
    const html = render([{
      id: 'running-bottom-status',
      role: 'assistant',
      timestamp: 1_000,
      startedAt: 1_000,
      streaming: true,
      parts: [
        { type: 'thinking', text: 'Inspecting files first.' },
        { type: 'toolCall', id: 'tool-1', name: 'read_file', args: { path: 'src/App.tsx' } },
        { type: 'toolResult', name: 'read_file', text: 'done' },
      ],
    }], true)

    const timelineEnd = html.indexOf('Thought, read 1 file')
    const statusStart = html.indexOf('work-disclosure__status')
    expect(timelineEnd).toBeGreaterThan(-1)
    expect(statusStart).toBeGreaterThan(timelineEnd)
  })

  it('preserves ReasoningPart body DOM node across live-to-settled transition and folds on click', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const parts: TranscriptMessage['parts'] = [{ type: 'thinking', partId: 'think-1', text: 'Checking **morph**.' }]
    try {
      await act(async () => root.render(createElement(WorkTimeline, { parts, showReasoning: true, showTools: true, streaming: true })))
      const liveRow = container.querySelector('.activity-line--reasoning')!
      const proseNode = liveRow.querySelector('.prose')!
      expect(liveRow.classList.contains('is-settled')).toBe(false)
      expect(liveRow.querySelector('.activity-thought__summary')).toBeNull()
      expect(proseNode.textContent).toContain('Checking morph.')

      await act(async () => root.render(createElement(WorkTimeline, { parts, showReasoning: true, showTools: true, streaming: false })))
      expect(container.querySelector('.activity-line--reasoning')).toBe(liveRow)
      expect(liveRow.classList.contains('is-settled')).toBe(true)
      expect(liveRow.querySelector('.prose')).toBe(proseNode)
      const summary = liveRow.querySelector<HTMLButtonElement>('.activity-thought__summary')!
      expect(summary).not.toBeNull()
      expect(summary.getAttribute('aria-expanded')).toBe('true')
      expect(liveRow.querySelector('.activity-thought__body')).not.toBeNull()

      await act(async () => summary.click())
      expect(summary.getAttribute('aria-expanded')).toBe('false')
      expect(liveRow.querySelector('.activity-thought__body')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('transitions ToolPart, SubagentLane, and TodoStep from running to settled/done cleanly', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(WorkTimeline, {
        parts: [
          { type: 'toolCall', id: 'cmd-1', name: 'bash', args: { command: 'echo hi' } },
          { type: 'toolCall', id: 'sub-1', name: 'task_start', args: { agent: 'scout', prompt: 'Check' } },
          { type: 'toolCall', id: 'todo-1', name: 'todo_write', args: { todos: [{ content: 'Step 1', status: 'in_progress' }, { content: 'Step 2', status: 'pending' }] } },
        ],
        showReasoning: true,
        showTools: true,
        streaming: true,
      })))
      expect(container.querySelector('.activity-line--tool.is-running .activity-tool__state')?.textContent).toContain('running')
      expect(container.querySelector('.subagent-lane.is-running .subagent-lane__state')?.textContent).toBe('running')
      expect(container.querySelector('.todo-step__count')?.textContent).toBe('0/2 done')
      expect(container.querySelector('.todo-step__label')?.textContent).toBe('Step 1')

      await act(async () => root.render(createElement(WorkTimeline, {
        parts: [
          { type: 'toolCall', id: 'cmd-1', name: 'bash', args: { command: 'echo hi' } },
          { type: 'toolResult', name: 'bash', text: 'hi' },
          { type: 'toolCall', id: 'sub-1', name: 'task_start', args: { agent: 'scout', prompt: 'Check' } },
          { type: 'toolResult', name: 'task_start', text: 'started task_1' },
          { type: 'toolCall', id: 'wait-1', name: 'task_wait', args: { id: 'task_1' } },
          { type: 'toolResult', name: 'task_wait', text: 'lifecycle: settled\n--- result ---\nAll good' },
          { type: 'toolCall', id: 'todo-1', name: 'todo_write', args: { todos: [{ content: 'Step 1', status: 'completed' }, { content: 'Step 2', status: 'completed' }] } },
        ],
        showReasoning: true,
        showTools: true,
        streaming: false,
      })))
      expect(container.querySelector('.activity-line--tool.is-done .activity-tool__state')?.textContent).toContain('done')
      expect(container.querySelector('.subagent-lane.is-done .subagent-lane__state')?.textContent).toBe('done')
      expect(container.querySelector('.todo-step.is-finished .todo-step__count')?.textContent).toBe('2/2 done')
      expect(container.querySelector('.todo-step.is-finished .todo-step__label')?.textContent).toBe('All steps complete')
      await act(async () => container.querySelector<HTMLButtonElement>('.todo-step__summary')!.click())
      expect(container.querySelectorAll('.todo-step__list li.is-completed')).toHaveLength(2)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

})
