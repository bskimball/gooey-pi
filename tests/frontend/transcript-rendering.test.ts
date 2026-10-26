// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Transcript } from '../../apps/desktop/src/components/Transcript'
import { LiveElapsed, LiveWorkVerb } from '../../apps/desktop/src/components/transcript/timeline'
import { replayPrimeEvents } from '../../apps/desktop/src/lib/events/reduce'
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
  it('streams reasoning inside a distinct process rail with animated thinking dots', () => {
    const html = render([{
      id: 'active',
      role: 'assistant',
      timestamp: 1_000,
      startedAt: 1_000,
      streaming: true,
      parts: [{ type: 'thinking', text: 'Checking **the workspace** now.' }],
    }])

    expect(html).toContain('activity-line--reasoning')
    expect(html).toContain('work-disclosure__rail')
    expect(html).toContain('work-disclosure__status')
    expect(html).toContain('role="status"><span class="sr-only">Thinking</span><span class="live-work-verb" aria-hidden="true">Thinking</span>')
    expect(html).toContain('Checking <strong>the workspace</strong> now.')
    expect(html).not.toContain('**the workspace**')
    expect(html).not.toContain('Worked for')
    expect(html).toContain('thinking-dots')
    expect(html.match(/class="thinking-dots"[^>]*><svg[^>]*><path [^>]*stroke="currentColor"/)).not.toBeNull()
  })

  it.each([
    ['a running tool', true, 'read_file', { path: 'package.json' }],
    ['a hidden running tool', false, 'read_file', { path: 'package.json' }],
    ['an ask_user wait', true, 'ask_user', { question: 'Which release channel?' }],
    ['a hidden ask_user wait', false, 'ask_user', { question: 'Which release channel?' }],
  ])('announces Working when reasoning transitions to %s', (_description, showTools, name, args) => {
    const html = render([{
      id: 'active', role: 'assistant', timestamp: 1_000, streaming: true,
      parts: [{ type: 'thinking', text: 'Checking the workspace.' }, { type: 'toolCall', id: 'tool-1', name, args }],
    }], false, showTools)

    expect(html).toContain('activity-line--reasoning')
    expect(html.includes('activity-line--tool')).toBe(showTools)
    expect(html).toContain('role="status"><span class="sr-only">Working</span><span class="live-work-verb" aria-hidden="true">Working</span>')
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
      expect(html).toContain(`role="status"><span class="sr-only">${status}</span>`)
    },
  )

  it('keeps a hidden tool Working through partial updates, then restores visible reasoning', () => {
    const updating = replayPrimeEvents([], [
      { type: 'agent_start' },
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'Plan ready.' } },
      { type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read_file' },
      { type: 'tool_execution_update', toolCallId: 'tool-1', toolName: 'read_file', partialResult: 'halfway' },
    ])
    expect(render(updating, false, false)).toContain('role="status"><span class="sr-only">Working</span>')

    const finished = replayPrimeEvents(updating, [
      { type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'read_file', result: 'done' },
    ])
    expect(render(finished, false, false)).toContain('role="status"><span class="sr-only">Thinking</span>')
  })

  it('keeps late results at their call site and follows newer reasoning or narrative', () => {
    const reasoning = replayPrimeEvents([], [
      { type: 'agent_start' },
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'First thought.' } },
      { type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read_file' },
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'New thought.' } },
      { type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'read_file', result: 'done' },
    ])
    expect(reasoning[0].parts.map((part) => part.type)).toEqual(['thinking', 'toolCall', 'toolResult', 'thinking'])
    expect(render(reasoning)).toContain('role="status"><span class="sr-only">Thinking</span>')

    const narrative = replayPrimeEvents(reasoning, [
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Final answer.' } },
    ])
    expect(render(narrative, false, false)).toContain('role="status"><span class="sr-only">Working</span>')
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

    expect(html).toContain('Following the external session.')
    expect(html).toContain('Explaining the next step.')
    expect(html).toContain('read_file')
    expect(html).toContain('src/App.tsx')
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

    expect(html).toContain('Worked for 1s')
    expect(html).not.toContain('Prior completed reasoning.')
    expect(html).toContain('transcript-active-placeholder')
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
    expect(html.match(new RegExp(`<span class="sr-only">${shortName} is working</span>`, 'g'))).toHaveLength(1)
    expect(html).not.toContain('transcript-active-placeholder')
  })

  it('collapses all work behind the caret as soon as the response yields', () => {
    const html = render([{
      id: 'complete',
      role: 'assistant',
      timestamp: 1_000,
      startedAt: 1_000,
      completedAt: 4_000,
      parts: [{ type: 'thinking', text: 'This stays collapsed until requested.' }],
    }])

    expect(html).toContain('Worked for 3s')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('This stays collapsed until requested.')
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

    expect(html.match(/class="message message--assistant"/g)).toHaveLength(1)
    expect(html.match(/Worked for/g)).toHaveLength(1)
    expect(html).toContain('Worked for 4s')
  })


  it('renders one file changes card in the pinned transcript footer', () => {
    const html = renderToStaticMarkup(createElement(Transcript, {
      messages: [{ id: 'assistant', role: 'assistant', parts: [{ type: 'text', text: 'Done' }] }],
      git: { isRepo: true, files: [{ path: 'src/App.tsx', status: 'modified', additions: 2, deletions: 1, staged: false }] },
      onOpenChanges: noop,
      onSuggestion: noop,
    }))
    expect(html).toContain('transcript-changes-pin')
    expect(html.match(/class="changes-card"/g)).toHaveLength(1)
    expect(html).toContain('1 file changed')
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
    expect(html).toContain('aria-label="Expand pasted image"')
    expect(html).toContain('Image attachment unavailable')
    expect(html).not.toContain('src="data:image/png;base64,truncated"')
  })

  it('hides model-only session UUID routing from the visible user transcript', () => {
    const html = render([{
      id: 'session-reference', role: 'user', parts: [{ type: 'text', text: 'Coordinate with @API owner.\n\n===== BEGIN GOOEYPI SESSION REFERENCES =====\n- "@API owner": pi session UUID secret-uuid. Use gooeypi_session_read.\n===== END GOOEYPI SESSION REFERENCES =====' }],
    }])
    expect(html).toContain('Coordinate with ')
    expect(html).toContain('>@API owner</button>.')
    expect(html).toContain('class="session-reference"')
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
    expect(html).toContain('Message from agent')
    expect(html).toContain('late-reviewer')
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

    expect(html).toContain('Worked for 1s')
    expect(html).toContain('The primary final report stays visible.')
    expect(html).toContain('Trailing lightweight reasoning.')
    expect(html).not.toContain('Earlier reasoning.')
    expect(html).toContain('aria-label="Copy assistant message"')
  })

  it('promotes a substantive report ahead of trailing activity and an incidental note', () => {
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

    expect(html).toContain('This is the complete substantive report with the requested conclusions and evidence.')
    expect(html).toContain('Cleanup complete.')
    expect(html).toContain('update_todo')
  })

  it('nests agent messages in active work without opening their contents', () => {
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

    expect(html).toContain('activity-line--agent')
    expect(html).toContain('Message from agent')
    expect(html).toContain('reviewer')
    expect(html).not.toContain('Detailed child-agent response.')
    expect(html).not.toContain('message--agent')
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2)
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
        id: 'live-active',
        role: 'assistant',
        timestamp: runningStartedAt,
        startedAt: runningStartedAt,
        streaming: true,
        parts: [{ type: 'thinking', text: 'Still thinking.' }],
      }], true)
      expect(running).toContain('live-elapsed')
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
      expect(finished).toContain('Worked for 1m05s')
      expect(finished).not.toContain('live-elapsed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('omits the live elapsed label when no start time is available', () => {
    expect(renderToStaticMarkup(createElement(LiveElapsed, {}))).toBe('')
  })

  it('renders the Seigaiha Fin Mon welcome emblem on blank chat and the Pi mark on messages', () => {
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
    expect(replyHtml).toContain('pi-mark')
    expect(replyHtml).not.toContain('harness-mark--prime')
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

    const timelineEnd = html.indexOf('src/App.tsx')
    const statusStart = html.indexOf('work-disclosure__status')
    expect(timelineEnd).toBeGreaterThan(-1)
    expect(statusStart).toBeGreaterThan(timelineEnd)
  })

  it('cycles decorative work verbs while keeping the screen-reader status label stable until mode changes', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      act(() => {
        root.render(createElement(LiveWorkVerb, { mode: 'Thinking' }))
      })
      expect(container.querySelector('.sr-only')?.textContent).toBe('Thinking')
      expect(container.querySelector('.live-work-verb')?.getAttribute('aria-hidden')).toBe('true')
      expect(container.querySelector('.live-work-verb')?.textContent).toBe('Thinking')

      act(() => {
        vi.advanceTimersByTime(2_600)
      })
      expect(container.querySelector('.sr-only')?.textContent).toBe('Thinking')
      expect(container.querySelector('.live-work-verb')?.textContent).toBe('Sounding')

      act(() => {
        root.render(createElement(LiveWorkVerb, { mode: 'Working' }))
      })
      expect(container.querySelector('.sr-only')?.textContent).toBe('Working')
      expect(container.querySelector('.live-work-verb')?.textContent).toBe('Working')

      act(() => {
        vi.advanceTimersByTime(2_600)
      })
      expect(container.querySelector('.sr-only')?.textContent).toBe('Working')
      expect(container.querySelector('.live-work-verb')?.textContent).toBe('Cresting')
    } finally {
      act(() => {
        root.unmount()
      })
      container.remove()
      vi.useRealTimers()
    }
  })

})
