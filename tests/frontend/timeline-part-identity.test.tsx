// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantMessage } from '../../apps/desktop/src/components/transcript/messages'
import { Transcript } from '../../apps/desktop/src/components/Transcript'
import { WorkTimeline } from '../../apps/desktop/src/components/transcript/timeline'
import { replayPrimeEvents } from '../../apps/desktop/src/lib/events'
import type { TranscriptMessage } from '../../apps/desktop/src/types/api'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderTimeline(message: TranscriptMessage): void {
  act(() => {
    root.render(createElement(WorkTimeline, { parts: message.parts, showReasoning: true, showTools: true }))
  })
}

describe('timeline part identity', () => {
  it('does not render settled coalesced assistant rows during tail streaming', () => {
    const readHistoricalText = vi.fn(() => 'Settled answer')
    const history: TranscriptMessage[] = [
      { id: 'question', role: 'user', parts: [{ type: 'text', text: 'Earlier question' }] },
      { id: 'segment-a', role: 'assistant', parts: [{ type: 'text', get text() { return readHistoricalText() } }] },
      { id: 'segment-b', role: 'assistant', parts: [{ type: 'text', text: 'Continuation' }] },
      { id: 'next-question', role: 'user', parts: [{ type: 'text', text: 'Continue' }] },
    ]
    const git = { isRepo: false, files: [] }
    const noop = () => undefined
    const update = (text: string) => act(() => root.render(<Transcript
      messages={[...history, { id: 'live', role: 'assistant', streaming: true, parts: [{ type: 'text', text }] }]}
      git={git} active onOpenChanges={noop} onSuggestion={noop}
    />))
    update('First token')
    expect(readHistoricalText).toHaveBeenCalled()
    readHistoricalText.mockClear()
    for (let index = 0; index < 10; index++) update(`More tokens ${index}`)
    expect(readHistoricalText).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Settled answer')
  })

  it('defers closed tool formatting and retains expanded rows across unrelated updates', () => {
    const toJSON = vi.fn(() => ({ command: 'echo done' }))
    const parts: TranscriptMessage['parts'] = Array.from({ length: 80 }, (_, index) => [
      { type: 'toolCall' as const, id: `tool-${index}`, name: 'bash', args: { command: 'echo done', toJSON } },
      { type: 'toolResult' as const, name: 'bash', text: 'done' },
    ]).flat()
    renderTimeline({ id: 'tools', role: 'assistant', parts })
    for (let update = 0; update < 10; update++) {
      renderTimeline({ id: 'tools', role: 'assistant', parts: [...parts, { type: 'thinking', text: `Update ${update}` }] })
    }
    expect(toJSON).not.toHaveBeenCalled()
    const summary = container.querySelector<HTMLButtonElement>('.activity-tool__summary')
    expect(summary).not.toBeNull()
    act(() => summary?.click())
    expect(toJSON).toHaveBeenCalledTimes(1)
    const details = container.querySelector('.activity-tool__details')
    renderTimeline({ id: 'tools', role: 'assistant', parts: [...parts, { type: 'thinking', text: 'New thought' }] })
    expect(container.querySelector('.activity-tool__details')).toBe(details)
    expect(toJSON).toHaveBeenCalledTimes(1)
    const updated = [...parts]
    updated[1] = { type: 'toolResult', name: 'bash', text: 'changed result', isError: true }
    renderTimeline({ id: 'tools', role: 'assistant', parts: updated })
    expect(details?.textContent).toContain('changed result')
    expect(container.querySelector('.activity-line--tool')?.classList.contains('is-error')).toBe(true)
  })

  it('copies the promoted final report when reasoning trails it', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    act(() => {
      root.render(createElement(AssistantMessage, {
        message: {
          id: 'copy-final-report', role: 'assistant', completedAt: 2_000,
          parts: [
            { type: 'thinking', text: 'Earlier reasoning.' },
            { type: 'text', text: 'Primary final report.' },
            { type: 'thinking', text: 'Trailing reasoning.' },
          ],
        },
        showReasoning: true,
        showTools: true,
      }))
    })

    const copy = container.querySelector('[aria-label="Copy assistant message"]') as HTMLButtonElement
    expect(copy).not.toBeNull()
    await act(async () => { copy.click() })
    expect(writeText).toHaveBeenCalledWith('Primary final report.')
  })

  it('only shows the tool copy action after expanding and copies its contents', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderTimeline({
      id: 'copy-tool', role: 'assistant', parts: [
        { type: 'toolCall', id: 'tool-1', name: 'Read', args: { path: 'src/App.tsx' } },
        { type: 'toolResult', name: 'Read', text: 'file contents' },
      ],
    })

    expect(container.querySelector('[aria-label="Copy tool contents"]')).toBeNull()
    const summary = container.querySelector('.activity-tool__summary') as HTMLButtonElement
    act(() => { summary.click() })
    const copy = container.querySelector('[aria-label="Copy tool contents"]') as HTMLButtonElement
    expect(copy).not.toBeNull()

    await act(async () => { copy.click() })
    expect(writeText).toHaveBeenCalledWith('{\n  "path": "src/App.tsx"\n}\n\nfile contents')
    expect(container.querySelector('[aria-label="Copied tool contents"]')).not.toBeNull()
  })

  it('keeps an expanded activity panel attached to its content when a tool result is spliced in', () => {
    const streamed = replayPrimeEvents([], [
      { type: 'agent_start' },
      { type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'Read', args: { path: 'a.ts' } },
      {
        type: 'custom_message', customType: 'agent_message', content: 'fallback',
        details: { message: 'Subagent finished the review.', from: { sessionName: 'reviewer' } },
      },
    ])
    renderTimeline(streamed[0])
    const agentButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Message from agent'))
    expect(agentButton).toBeDefined()
    act(() => { agentButton!.click() })
    expect(container.querySelector('.activity-agent__details')?.textContent).toContain('Subagent finished the review.')

    // The tool result splices in between the tool call and the agent message.
    const finished = replayPrimeEvents(streamed, [
      { type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'Read', result: 'done' },
    ])
    expect(finished[0].parts.map((part) => part.type)).toEqual(['toolCall', 'toolResult', 'agentMessage'])
    renderTimeline(finished[0])

    expect(container.querySelector('.activity-agent__details')?.textContent).toContain('Subagent finished the review.')
  })

  it('mints stable ids for reducer-created parts and preserves them across updates', () => {
    const streamed = replayPrimeEvents([], [
      { type: 'agent_start' },
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'plan' } },
      { type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'Read', args: { path: 'a.ts' } },
    ])
    const ids = streamed[0].parts.map((part) => part.partId)
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)

    const finished = replayPrimeEvents(streamed, [
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: ' more' } },
      { type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'Read', result: 'done' },
    ])
    expect(finished[0].parts[0].partId).toBe(ids[0])
    expect(finished[0].parts[1].partId).toBe(ids[1])
  })
})
