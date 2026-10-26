// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../apps/desktop/src/App'
import { useBrowserAnnotations, type BrowserAnnotationsApi } from '../../apps/desktop/src/hooks/useBrowserAnnotations'
import type { InspectorProps } from '../../apps/desktop/src/components/Inspector'
import { SpecialistsPanel } from '../../apps/desktop/src/components/inspector/SpecialistsPanel'
import type { TranscriptMessage } from '../../apps/desktop/src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const observed = vi.hoisted(() => ({ inspectorProps: [] as unknown[], changesPanelRenders: 0 }))

// Wraps the memoized Inspector, so every App render is observed even when the
// memo (correctly) skips the inspector subtree.
vi.mock('../../apps/desktop/src/components/Inspector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/desktop/src/components/Inspector')>()
  return {
    ...actual,
    Inspector(props: InspectorProps) {
      observed.inspectorProps.push(props)
      return <actual.Inspector {...props} />
    },
  }
})

// Rendered inside the memo, so its render count is exactly the number of times
// the memo let a re-render through on the changes tab.
vi.mock('../../apps/desktop/src/components/inspector/ChangesPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/desktop/src/components/inspector/ChangesPanel')>()
  return {
    ...actual,
    ChangesPanel(props: Parameters<typeof actual.ChangesPanel>[0]) {
      observed.changesPanelRenders += 1
      return <actual.ChangesPanel {...props} />
    },
  }
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  observed.inspectorProps = []
  observed.changesPanelRenders = 0
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class { observe() {} unobserve() {} disconnect() {} },
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

const toggleSidebar = async () => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true })) })

const renderApp = async () => {
  // Resolve the lazy inspector chunk up front so its Suspense boundary settles on mount.
  await import('../../apps/desktop/src/components/Inspector')
  await act(async () => { root.render(<App />) })
  await act(async () => {})
}

const openChangesTab = async () => {
  const changesTab = [...container.querySelectorAll<HTMLButtonElement>('.inspector__tabs button')].find((button) => button.textContent?.startsWith('Changes'))
  expect(changesTab).toBeDefined()
  await act(async () => { changesTab?.click() })
  expect(container.querySelector('#inspector-panel-changes')).not.toBeNull()
}

describe('inspector re-render containment', () => {
  it('keeps the memoized inspector subtree mounted across App re-renders on the changes tab', async () => {
    await renderApp()
    await openChangesTab()

    const rendersAfterTabChange = observed.changesPanelRenders
    const appRendersAfterTabChange = observed.inspectorProps.length
    expect(rendersAfterTabChange).toBeGreaterThan(0)

    await toggleSidebar()
    await toggleSidebar()

    // App re-rendered, the memo held: no work reached the inspector subtree.
    expect(observed.inspectorProps.length).toBeGreaterThan(appRendersAfterTabChange)
    expect(observed.changesPanelRenders).toBe(rendersAfterTabChange)
  })

  it('hands the inspector stable messages, git and annotation identities while the changes tab is active', async () => {
    await renderApp()
    const props = observed.inspectorProps as InspectorProps[]
    // The summary tab is the default and does consume the transcript.
    expect(props[props.length - 1].messages.length).toBeGreaterThan(0)

    await openChangesTab()
    const first = props[props.length - 1]
    await toggleSidebar()
    const last = props[props.length - 1]
    expect(last).not.toBe(first)
    // Off the summary tab nothing reads the transcript, so it never reaches the memo boundary.
    expect(last.messages).toHaveLength(0)
    expect(last.messages).toBe(first.messages)
    expect(last.git).toBe(first.git)
    expect(last.browserAnnotations).toBe(first.browserAnnotations)
    expect(last.automations).toBe(first.automations)
    expect(last.onSelectAgentTab).toBe(first.onSelectAgentTab)
    expect(last.onPreviewContext).toBe(first.onPreviewContext)
    expect(last.onNavigateAgentTab).toBe(first.onNavigateAgentTab)
    expect(last.onGrantProject).toBe(first.onGrantProject)
    expect(last.onOpenAutomation).toBe(first.onOpenAutomation)
    expect(last.onShowBrowserPreview).toBe(first.onShowBrowserPreview)
  })
})

describe('useBrowserAnnotations identity', () => {
  it('keeps one container identity across re-renders and swaps it only when its data changes', async () => {
    const seen: BrowserAnnotationsApi[] = []
    let rerender = () => {}
    function Harness() {
      const [, setTick] = useState(0)
      rerender = () => setTick((tick) => tick + 1)
      seen.push(useBrowserAnnotations())
      return null
    }

    await act(async () => { root.render(<Harness />) })
    await act(async () => { rerender() })
    await act(async () => { rerender() })
    expect(seen.length).toBeGreaterThan(2)
    expect(seen[seen.length - 1]).toBe(seen[0])

    const stable = seen[seen.length - 1]
    await act(async () => {
      stable.add({
        comment: 'Tighten this copy',
        element: { selector: '#cta', tagName: 'BUTTON', id: 'cta', classes: ['btn'], text: 'Join now', rect: { x: 5, y: 6, width: 100, height: 30 } },
        pageUrl: 'https://example.com/',
        pageTitle: 'Example Page',
      })
    })
    const updated = seen[seen.length - 1]
    expect(updated).not.toBe(stable)
    expect(updated.annotations).toHaveLength(1)
  })
})

describe('SpecialistsPanel transcript scoping and loading', () => {
  it('isolates cached worker transcripts across parent sessions and loads task / chain step session files', async () => {
    const readSession = vi.fn(async (filePath: string): Promise<TranscriptMessage[]> => {
      if (filePath.includes('inst-session-a')) {
        return [
          { id: 'sys-a', role: 'system', parts: [{ type: 'text', text: '' }] },
          { id: 'u-a', role: 'user', parts: [{ type: 'text', text: 'Session A full prompt' }] },
          { id: 'a-a', role: 'assistant', parts: [{ type: 'text', text: 'Session A full disk transcript' }] },
        ]
      }
      if (filePath.includes('inst-chain-step-1')) {
        return [
          { id: 'sys-c1', role: 'system', parts: [{ type: 'text', text: '' }] },
          { id: 'u-c1', role: 'user', parts: [{ type: 'text', text: 'Chain step 1 prompt' }] },
          { id: 'sys-c1-note', role: 'system', parts: [{ type: 'text', text: 'Branch summary notice' }] },
          { id: 'a-c1', role: 'assistant', parts: [{ type: 'text', text: 'Chain step 1 full disk transcript' }] },
        ]
      }
      throw new Error('Transcript not found')
    })
    Object.defineProperty(window, 'prime', {
      configurable: true,
      value: { sessions: { read: readSession } },
    })

    const sessionAMessages: TranscriptMessage[] = [
      {
        id: 'm-a',
        role: 'assistant',
        parts: [
          { type: 'toolCall', id: 'call-a', name: 'task_start', args: { agent: 'sidekick', prompt: 'Session A prompt' } },
          { type: 'toolResult', name: 'task_start', text: 'started task_1', details: { worker: { id: 'task_1', instanceId: 'inst-session-a', agent: 'sidekick' } } },
        ],
      },
    ]
    const sessionBMessages: TranscriptMessage[] = [
      {
        id: 'm-b',
        role: 'assistant',
        parts: [
          { type: 'toolCall', id: 'call-b', name: 'task_start', args: { agent: 'sidekick', prompt: 'Session B prompt' } },
          { type: 'toolResult', name: 'task_start', text: 'started task_1', details: { worker: { id: 'task_1', instanceId: 'inst-session-b', agent: 'sidekick' } } },
          { type: 'toolCall', id: 'chain-b', name: 'task_chain', args: { steps: [{ agent: 'scout', prompt: 'Step 1' }, { agent: 'machinist', prompt: 'Step 2' }] } },
          {
            type: 'toolResult',
            name: 'task_chain',
            text: 'step 1 ok scout · 2s\nstep 2 ok machinist · 3s',
            details: {
              steps: [
                { step: 1, agent: 'scout', instanceId: 'inst-chain-step-1', status: 'ok', report: 'Scout report' },
                { step: 2, agent: 'machinist', status: 'ok', report: 'Machinist report' },
              ],
            },
          },
        ],
      },
    ]

    await act(async () => {
      root.render(
        <SpecialistsPanel
          messages={sessionAMessages}
          selectedId="task_1"
          onSelect={vi.fn()}
          homeDir="/home/test"
          sessionKey="session-A"
        />,
      )
    })
    await act(async () => {})
    expect(container.textContent).toContain('Session A full disk transcript')
    expect(container.querySelector('.specialist-header__source')).toBeNull()
    const sessionATurns = [...container.querySelectorAll('.specialist-turn')]
    expect(sessionATurns).toHaveLength(2)
    expect(sessionATurns[0]?.classList.contains('specialist-turn--user')).toBe(true)
    expect(sessionATurns[1]?.classList.contains('specialist-turn--assistant')).toBe(true)

    // Switch to session B where task_1's disk read fails: must never show Session A's transcript.
    await act(async () => {
      root.render(
        <SpecialistsPanel
          messages={sessionBMessages}
          selectedId="task_1"
          onSelect={vi.fn()}
          homeDir="/home/test"
          sessionKey="session-B"
        />,
      )
    })
    await act(async () => {})
    expect(container.textContent).not.toContain('Session A full disk transcript')
    expect(container.querySelector('.specialist-header__source')).not.toBeNull()
    const workOrderToggle = container.querySelector<HTMLButtonElement>('.specialist-turn--user .specialist-turn__toggle')
    expect(workOrderToggle).not.toBeNull()
    expect(workOrderToggle?.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('Session B prompt')

    await act(async () => { workOrderToggle?.click() })
    expect(workOrderToggle?.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('Session B prompt')

    // Select chain step 1 in session B, which has an instanceId on disk.
    await act(async () => {
      root.render(
        <SpecialistsPanel
          messages={sessionBMessages}
          selectedId="chain-b-step-1"
          onSelect={vi.fn()}
          homeDir="/home/test"
          sessionKey="session-B"
        />,
      )
    })
    await act(async () => {})
    expect(container.textContent).toContain('Chain step 1 full disk transcript')
    expect(container.textContent).toContain('Branch summary notice')
    expect(container.querySelector('.specialist-header__source')).toBeNull()

    const bodyScroller = container.querySelector<HTMLDivElement>('.specialists-panel__body')
    expect(bodyScroller).not.toBeNull()
    Object.defineProperty(bodyScroller!, 'scrollHeight', { configurable: true, value: 640 })
    Object.defineProperty(bodyScroller!, 'clientHeight', { configurable: true, value: 240 })
    bodyScroller!.scrollTop = 640

    const updatedSessionBMessages: TranscriptMessage[] = [
      ...sessionBMessages,
      {
        id: 'm-b-2',
        role: 'assistant',
        parts: [
          { type: 'toolCall', id: 'wait-b', name: 'task_wait', args: { id: 'task_1' } },
          {
            type: 'toolResult',
            name: 'task_wait',
            text: 'task_1 settled sidekick · 1 turn\n\nNew specialist output at bottom',
            details: { worker: { id: 'task_1', instanceId: 'inst-session-b', agent: 'sidekick', latestText: 'New specialist output at bottom' } },
          },
        ],
      },
    ]
    Object.defineProperty(bodyScroller!, 'scrollHeight', { configurable: true, value: 920 })

    await act(async () => {
      root.render(
        <SpecialistsPanel
          messages={updatedSessionBMessages}
          selectedId="task_1"
          onSelect={vi.fn()}
          homeDir="/home/test"
          sessionKey="session-B"
        />,
      )
    })
    await act(async () => {})
    expect(container.textContent).toContain('New specialist output at bottom')
    expect(bodyScroller!.scrollTop).toBe(920)
  })
})
