// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../apps/desktop/src/App'
import { useBrowserAnnotations, type BrowserAnnotationsApi } from '../../apps/desktop/src/hooks/useBrowserAnnotations'
import type { InspectorProps } from '../../apps/desktop/src/components/Inspector'
import { RunConfigSection } from '../../apps/desktop/src/components/inspector/RunConfigSection'
import { SpecialistsPanel } from '../../apps/desktop/src/components/inspector/SpecialistsPanel'
import type { EffectiveRunConfig, RuntimeInfo, TranscriptMessage } from '../../apps/desktop/src/types/api'

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
  Object.defineProperty(window, 'prime', { configurable: true, writable: true, value: undefined })
  vi.restoreAllMocks()
})

const toggleSidebar = async () => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true })) })

const renderApp = async () => {
  // Resolve the lazy inspector chunk up front so its Suspense boundary settles on mount.
  await import('../../apps/desktop/src/components/Inspector')
  await act(async () => { root.render(<App />) })
  await act(async () => {})
  // The inspector starts closed; open it the way a user would.
  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Toggle inspector"]')?.click() })
}

const openChangesTab = async () => {
  const changesTab = [...container.querySelectorAll<HTMLButtonElement>('.inspector__tabs button')].find((button) => button.textContent?.startsWith('Changes'))
  expect(changesTab).toBeDefined()
  await act(async () => { changesTab?.click() })
  expect(container.querySelector('#inspector-panel-changes')).not.toBeNull()
}

describe('Phase 2 coordination', () => {
  it('shows compact specialist tabs and opens only an observed source position', async () => {
    const openInVsCode = vi.fn(async () => true)
    Object.defineProperty(window, 'prime', { configurable: true, value: { app: { openInVsCode } } })
    const onSelect = vi.fn()
    const messages: TranscriptMessage[] = [{ id: 'parent', role: 'assistant', parts: [
      { type: 'toolCall', name: 'task_start', args: { agent: 'scout', prompt: 'Inspect source', cwd: '/repo' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_1', details: { worker: { activities: [{ tool: 'read', args: { path: 'src/a.ts', offset: 42 }, status: 'completed' }], waiting_ui_requests: [{ id: 'confirm' }] } } },
      { type: 'toolCall', name: 'task_start', args: { agent: 'oracle', prompt: 'Review source' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_2' },
    ] }]
    await act(async () => root.render(<SpecialistsPanel messages={messages} selectedId="task_1" onSelect={onSelect} cwd="/repo" />))
    const rows = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(rows.map((row) => row.querySelector('strong')?.textContent)).toEqual(['scout', 'oracle'])
    expect(rows[0].getAttribute('aria-label')).toContain('Waiting for input')
    const details = container.querySelector<HTMLDetailsElement>('.specialist-header__details')!
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toContain('Waiting for input')
    await act(async () => details.querySelector('summary')!.click())
    expect(details.open).toBe(true)
    expect(details.textContent).toContain('task_1')
    expect(details.textContent).toContain('Inspect source')
    await act(async () => rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(onSelect).toHaveBeenCalledWith('task_2')
    const filesSummary = container.querySelector<HTMLElement>('.specialist-files summary')!
    expect(filesSummary.textContent).toContain('1')
    await act(async () => filesSummary.click())
    const source = container.querySelector<HTMLButtonElement>('.specialist-files button')!
    expect(source.textContent).toContain('/repo/src/a.ts:42')
    await act(async () => source.click())
    expect(openInVsCode).toHaveBeenCalledWith('/repo/src/a.ts', 42)
    expect(container.textContent).toContain('not file locks')
  })
})

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
  it.each([false, true])('keeps the initial report landing through delayed disk hydration unless the reader scrolls (scrolled: %s)', async (scrolled) => {
    let finishRead: ((messages: TranscriptMessage[]) => void) | undefined
    Object.defineProperty(window, 'prime', { configurable: true, value: { sessions: { read: () => new Promise<TranscriptMessage[]>((resolve) => { finishRead = resolve }) } } })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const body = this.closest<HTMLDivElement>('.specialists-panel__body')
      const offset = body?.textContent?.includes('Earlier worker commentary') ? 900 : 120
      return new DOMRect(0, this.classList.contains('specialist-result') ? offset - (body?.scrollTop ?? 0) : 0, 300, 1000)
    })
    const messages: TranscriptMessage[] = [{ id: 'parent', role: 'assistant', parts: [
      { type: 'toolCall', name: 'task_start', args: { agent: 'scout', prompt: 'Inspect the project' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_1', details: { worker: { sessionFile: '/worker.jsonl' } } },
      { type: 'toolCall', name: 'task_wait', args: { id: 'task_1' } },
      { type: 'toolResult', name: 'task_wait', text: 'lifecycle: settled\n--- result ---\nFinal report' },
    ] }]
    await act(async () => root.render(<SpecialistsPanel messages={messages} selectedId="task_1" onSelect={vi.fn()} />))
    const scroller = container.querySelector<HTMLDivElement>('.specialists-panel__body')!
    expect(scroller.scrollTop).toBe(120)
    await act(async () => scroller.dispatchEvent(new Event('scroll', { bubbles: true })))
    if (scrolled) {
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 })
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 })
      await act(async () => { scroller.scrollTop = 40; scroller.dispatchEvent(new Event('scroll', { bubbles: true })) })
    }
    await act(async () => finishRead?.([{ id: 'disk', role: 'assistant', parts: [
      { type: 'text', text: 'Earlier worker commentary' },
      { type: 'text', text: 'Final report' },
    ] }]))
    expect(scroller.scrollTop).toBe(scrolled ? 40 : 900)
    expect(container.querySelector('.specialist-result')?.textContent).toBe('ResultFinal report')
    Reflect.deleteProperty(window, 'prime')
  })

  it('pauses following while reading, does not repin when a disk transcript arrives, and jumps explicitly', async () => {
    let finishRead: ((messages: TranscriptMessage[]) => void) | undefined
    Object.defineProperty(window, 'prime', { configurable: true, value: { sessions: { read: () => new Promise<TranscriptMessage[]>((resolve) => { finishRead = resolve }) } } })
    const messages: TranscriptMessage[] = [{ id: 'start', role: 'assistant', parts: [
      { type: 'toolCall', name: 'task_start', args: { agent: 'scout', prompt: 'Investigate navigation' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_1', details: { worker: { sessionFile: '/worker.jsonl' } } },
    ] }]
    await act(async () => root.render(<SpecialistsPanel messages={messages} selectedId="task_1" onSelect={vi.fn()} />))
    const scroller = container.querySelector<HTMLDivElement>('.specialists-panel__body')!
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 })
    await act(async () => { scroller.scrollTop = 100; scroller.dispatchEvent(new Event('scroll', { bubbles: true })) })
    expect(container.querySelector('.specialist-jump')?.textContent).toBe('Jump to latest')
    await act(async () => finishRead?.([{ id: 'disk', role: 'assistant', parts: [{ type: 'text', text: 'Fresh worker commentary' }] }]))
    expect(container.textContent).toContain('Fresh worker commentary')
    expect(scroller.scrollTop).toBe(100)
    await act(async () => container.querySelector<HTMLButtonElement>('.specialist-jump')!.click())
    expect(scroller.scrollTop).toBe(1000)
    expect(container.querySelector('.specialist-jump')).toBeNull()
    Reflect.deleteProperty(window, 'prime')
  })

  it('keeps commentary and tool activity in order and marks only the recorded final report as Result', async () => {
    Object.defineProperty(window, 'prime', { configurable: true, value: { sessions: { read: async (): Promise<TranscriptMessage[]> => [{ id: 'disk', role: 'assistant', parts: [
      { type: 'text', text: 'First commentary' },
      { type: 'toolCall', name: 'bash', args: { command: 'echo inspected' } },
      { type: 'toolResult', name: 'bash', text: 'inspected' },
      { type: 'text', text: 'Second commentary' },
      { type: 'text', text: 'Final report' },
    ] }] } } })
    const messages: TranscriptMessage[] = [{ id: 'parent', role: 'assistant', parts: [
      { type: 'toolCall', name: 'task_start', args: { agent: 'scout', prompt: 'Inspect the project' } },
      { type: 'toolResult', name: 'task_start', text: 'started task_1', details: { worker: { sessionFile: '/worker.jsonl' } } },
      { type: 'toolCall', name: 'task_wait', args: { id: 'task_1' } },
      { type: 'toolResult', name: 'task_wait', text: 'lifecycle: settled\n--- result ---\nFinal report' },
    ] }]
    await act(async () => root.render(<SpecialistsPanel messages={messages} selectedId="task_1" onSelect={vi.fn()} />))
    const text = container.querySelector('.specialist-transcript')!.textContent!
    expect(text.indexOf('First commentary')).toBeLessThan(text.indexOf('echo inspected'))
    expect(text.indexOf('echo inspected')).toBeLessThan(text.indexOf('Second commentary'))
    expect(text.indexOf('Second commentary')).toBeLessThan(text.indexOf('Final report'))
    expect(container.querySelector('.specialist-result')?.textContent).toBe('ResultFinal report')
    Reflect.deleteProperty(window, 'prime')
  })

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
    expect(container.querySelector('.specialist-transcript')?.textContent).not.toContain('Session B prompt')
    expect(container.querySelector('.specialist-header__mission')?.textContent).toBe('Session B prompt')

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
            text: 'task_1 settled sidekick · 1 turn\n--- result ---\nNew specialist output at bottom',
            details: { worker: { id: 'task_1', instanceId: 'inst-session-b', agent: 'sidekick', latestText: 'New specialist output at bottom' } },
          },
        ],
      },
    ]
    Object.defineProperty(bodyScroller!, 'scrollHeight', { configurable: true, value: 920 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, this.classList.contains('specialist-result') ? 120 - bodyScroller!.scrollTop : 0, 300, 100)
    })

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
    expect(container.querySelector('.specialist-result')?.textContent).toContain('ResultNew specialist output at bottom')
    expect(bodyScroller!.scrollTop).toBe(120)
  })
})

describe('RunConfigSection disclosure and formatting', () => {
  it('starts collapsed with a compact summary and expands to show formatted instructions, skills, and extension chips', async () => {
    const effectiveConfig: EffectiveRunConfig = {
      instructionSources: [
        { scope: 'user', kind: 'AGENTS.md', path: '/home/user/.pi/agent/AGENTS.md', bytes: 512 },
        { scope: 'project', kind: 'AGENTS.md', path: '/repo/project/AGENTS.md', bytes: 2458 },
      ],
      skillDirs: [
        { path: '/repo/project/.agents/skills', count: 4 },
      ],
      injectedCapabilities: [
        { capability: 'piFastMode', filename: 'pi-work-fast-mode.ts', present: true },
        { capability: 'schedule', filename: 'omp-work-schedules.ts', present: false },
      ],
    }
    Object.defineProperty(window, 'prime', {
      configurable: true,
      value: { runtime: { effectiveConfig: vi.fn(async () => effectiveConfig) } },
    })

    const runtime: RuntimeInfo = {
      runtimeId: 'rt-1',
      harness: 'pi',
      cwd: '/repo/project',
      isStreaming: false,
      thinkingLevel: 'high',
      model: { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' },
    }

    await act(async () => {
      root.render(
        <RunConfigSection
          runtime={runtime}
          behaviorMode="Regular"
          cwd="/repo/project"
          sessionKey="session-1"
        />,
      )
    })
    await act(async () => {})

    const toggle = container.querySelector<HTMLButtonElement>('.run-config__toggle')
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.run-config__summary')?.textContent).toBe('Claude Sonnet 4.6 · high · Regular')
    expect(container.querySelector('.run-config__alert')?.getAttribute('title')).toBe('1 bundled extension missing')
    expect(container.querySelector('.run-config__body')).toBeNull()

    await act(async () => { toggle?.click() })
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    const body = container.querySelector('.run-config__body')
    expect(body).not.toBeNull()
    expect(body?.textContent).toContain('2 files · 4 skills')
    expect(body?.textContent).toContain('512 B')
    expect(body?.textContent).toContain('2.4 KB')
    expect(body?.textContent).toContain('.agents/skills')
    expect(body?.textContent).toContain('1/2 bundled')
    expect(body?.textContent).toContain('Fast mode')
    expect(body?.textContent).toContain('Schedules')
    expect(container.querySelector('.run-config__chips li.is-missing')?.textContent).toBe('Schedules')

    Reflect.deleteProperty(window, 'prime')
  })
})

describe('VS Code webview sub-agent inspection', () => {
  it('opens sub-agent transcripts from the lane or toolbar and loads worker sessions via sessions:read', async () => {
    const posted: Array<Record<string, unknown>> = []
    Object.defineProperty(globalThis, 'acquireVsCodeApi', {
      configurable: true,
      value: () => ({
        postMessage(message: Record<string, unknown>) {
          posted.push(message)
          if (message.type === 'sessions:list') {
            window.dispatchEvent(new MessageEvent('message', {
              data: { type: 'sessions:list', requestId: message.requestId, sessions: [], currentPath: '/repo/session.jsonl' },
            }))
          } else if (message.type === 'sessions:read') {
            window.dispatchEvent(new MessageEvent('message', {
              data: {
                type: 'sessions:read',
                requestId: message.requestId,
                messages: [
                  { id: 'w-u', role: 'user', parts: [{ type: 'text', text: 'Inspect the VS Code extension' }] },
                  { id: 'w-a', role: 'assistant', parts: [{ type: 'text', text: 'Live sub-agent findings from disk' }] },
                ],
              },
            }))
          }
        },
      }),
    })
    const { installPrimeShim } = await import('../../packages/vscode/webview/host')
    const { App: VsCodeApp } = await import('../../packages/vscode/webview/App')
    installPrimeShim()

    await act(async () => {
      root.render(<VsCodeApp />)
    })
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'state',
          state: {
            status: 'ready',
            cwd: '/repo',
            homeDir: '/home/dev',
            isStreaming: true,
            thinkingLevel: 'medium',
            thinkingLevels: ['off', 'medium', 'high'],
            models: [],
            providers: [],
            commands: [],
            statuses: {},
            queued: [],
            messageEnterAction: 'queue',
          },
        },
      }))
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'reset',
          ops: [{
            kind: 'saved',
            message: {
              id: 'm-1',
              role: 'assistant',
              parts: [
                { type: 'toolCall', id: 'call-1', name: 'task_start', args: { agent: 'scout', prompt: 'Inspect the VS Code extension' } },
                { type: 'toolResult', name: 'task_start', text: 'started task_1', details: { worker: { id: 'task_1', instanceId: 'worker-42', agent: 'scout' } } },
              ],
            },
          }],
        },
      }))
    })

    const toolbarTrigger = container.querySelector<HTMLButtonElement>('.apex-agents-trigger')!
    expect(toolbarTrigger).not.toBeNull()
    expect(toolbarTrigger.classList.contains('is-running')).toBe(true)
    expect(toolbarTrigger.querySelector('.apex-agents-trigger__count')?.textContent).toBe('1')
    expect(container.querySelector('.apex-specialists-pane')).toBeNull()

    // Click the sub-agent lane in the transcript to open its transcript view.
    const openLink = container.querySelector<HTMLButtonElement>('.subagent-lane__links button')!
    expect(openLink?.textContent).toBe('Open agent transcript')
    await act(async () => { openLink.click() })
    await act(async () => {})

    const pane = container.querySelector('.apex-specialists-pane')
    expect(pane).not.toBeNull()
    expect(posted).toContainEqual(expect.objectContaining({
      type: 'sessions:read',
      path: '/home/dev/.pi/agent/sessions/rpc-workers/worker-42/worker.jsonl',
    }))
    expect(pane?.textContent).toContain('Live sub-agent findings from disk')

    // Close via Back to chat button and reopen via toolbar trigger.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.apex-specialists-pane__close')!.click()
    })
    expect(container.querySelector('.apex-specialists-pane')).toBeNull()

    await act(async () => { toolbarTrigger.click() })
    expect(container.querySelector('.apex-specialists-pane')).not.toBeNull()

    // Escape closes the sub-agents pane and returns to chat.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    })
    expect(container.querySelector('.apex-specialists-pane')).toBeNull()

    Reflect.deleteProperty(window, 'prime')
  })
})
