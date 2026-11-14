// @vitest-environment jsdom

import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activityNotificationSignature, sessionAttentionSignature, sessionCompanionNotificationSignature } from '../../apps/desktop/src/app/session-attention'
import { indexSidebarSessions } from '../../apps/desktop/src/components/Sidebar'
import { type SessionLiveMap } from '../../apps/desktop/src/app/session-live'
import { createWorkspaceActions, type WorkspaceActionsDeps } from '../../apps/desktop/src/hooks/useWorkspaceActions'
import { ActivityStatusPill } from '../../apps/desktop/src/components/activity/ActivityStatusPill'
import { ActivityPage } from '../../apps/desktop/src/pages/ActivityPage'
import { useExtensionUi } from '../../apps/desktop/src/hooks/useExtensionUi'
import type { AgentTurnHandle } from '../../apps/desktop/src/app/agentTurnMachine'
import type { ApexApi, ApexEventEnvelope, ProjectRecord, SessionRecord, TranscriptMessage } from '../../apps/desktop/src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project: ProjectRecord = {
  id: 'project', harness: 'pi', name: 'Project', path: '/project', folders: ['/project'], primaryFolder: '/project',
  pinned: false, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', sessionCount: 2,
}
const activeSession: SessionRecord = {
  id: 'active', harness: 'pi', filePath: '/sessions/active.jsonl', projectPath: '/project', title: 'Active chat',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', status: 'complete', depth: 0, unread: true,
}
const archivedSession: SessionRecord = {
  ...activeSession,
  id: 'archived',
  filePath: '/sessions/archived.jsonl',
  title: 'Archived chat',
  archived: true,
  status: 'failed',
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('archived activity cleanup', () => {
  it('preserves recovered deadlines, shortens the owner timer, and guards stale expiries and cancellation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const command = vi.fn().mockResolvedValue({ success: true })
    const stop = vi.fn().mockRejectedValue(new Error('stop failed'))
    const bridge = { agent: { command, stop } } as unknown as ApexApi
    let owner: ReturnType<typeof useExtensionUi>
    function Harness() {
      const runtimeSessionsRef = useRef(new Map<string, string>())
      owner = useExtensionUi({ bridge, runtimeSessionsRef, setSessions: () => {}, setRuntime: () => {}, agentTurn: { send: () => {} } as unknown as AgentTurnHandle, reportError: () => {} })
      return null
    }
    try {
      await act(async () => root.render(<Harness />))
      const untimed = { type: 'extension_ui_request', method: 'select', id: 'old', title: 'Old', options: ['__apex_ask_user__oldgroup:0:1', 'A'], receivedAt: -19_900 }
      await act(async () => owner.showExtensionUi('other', untimed))
      expect(owner!.pendingByRuntime.get('other')?.deadline).toBe(100_100)
      await act(async () => vi.advanceTimersByTime(100))
      expect(command).toHaveBeenCalledWith('other', { type: 'extension_ui_response', id: 'old', cancelled: true })
      command.mockClear()
      vi.setSystemTime(100_000)
      const first = { type: 'extension_ui_request', method: 'select', id: 'q0', title: 'First', options: ['__apex_ask_user__group:0:2', 'A'], receivedAt: 90_000, deadline: 110_000 }
      const second = { ...first, id: 'q1', title: 'Second', options: ['__apex_ask_user__group:1:2', 'B'], deadline: 105_000 }
      await act(async () => { owner.showExtensionUi('chief', first); owner.showExtensionUi('chief', second); owner.showExtensionUi('chief', first) })
      expect(owner!.pendingByRuntime.get('chief')?.deadline).toBe(105_000)
      await act(async () => vi.advanceTimersByTime(4_999))
      expect(command).not.toHaveBeenCalled()
      await act(async () => vi.advanceTimersByTime(1))
      expect(command).toHaveBeenCalledWith('chief', { type: 'extension_ui_response', id: 'q0', cancelled: true })
      expect(command).toHaveBeenCalledWith('chief', { type: 'extension_ui_response', id: 'q1', cancelled: true })
      await act(async () => owner.showExtensionUi('chief', second))
      expect(command).toHaveBeenCalledTimes(3)
      const replacement = { ...first, id: 'new', options: ['__apex_ask_user__newgroup:0:2', 'C'], receivedAt: 105_000, deadline: 125_000 }
      const replacementSecond = { ...replacement, id: 'new2', options: ['__apex_ask_user__newgroup:1:2', 'D'] }
      await act(async () => { owner.showExtensionUi('chief', replacement); owner.showExtensionUi('chief', replacementSecond) })
      await act(async () => vi.advanceTimersByTime(5_000))
      expect(owner!.pendingByRuntime.get('chief')?.request.id).toBe('newgroup')
      await act(async () => owner.respondForRuntime('chief', { cancelled: true }))
      expect(stop).toHaveBeenCalledWith('chief')
      expect(command).toHaveBeenCalledWith('chief', { type: 'extension_ui_response', id: 'new', cancelled: true })
      expect(command).toHaveBeenCalledWith('chief', { type: 'extension_ui_response', id: 'new2', cancelled: true })
      expect(owner!.pendingByRuntime.has('chief')).toBe(false)
      stop.mockResolvedValueOnce(true)
      command.mockClear()
      await act(async () => owner.showExtensionUi('chief', { ...replacement, id: 'last', options: ['__apex_ask_user__lastgroup:0:1', 'E'] }))
      await act(async () => owner.respondForRuntime('chief', { cancelled: true }))
      expect(stop).toHaveBeenCalledTimes(2)
      expect(command).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('recovers chief questionnaires into the shared owner and answers every request from the dock', async () => {
    window.sessionStorage.setItem('prime-work.composer-draft', 'normal draft')
    const runtime = { runtimeId: 'chief-runtime', harness: 'pi', cwd: '/chief', isStreaming: false }
    const dialogs = [0, 1].map((index) => ({ type: 'extension_ui_request', method: 'select', id: `q${index}`, title: `Question ${index + 1}`, options: [`__apex_ask_user__group:${index}:2`, `Choice ${index}`, 'Other (type your own answer)'] }))
    const command = vi.fn().mockResolvedValue({ success: true })
    const bridge = { coordinator: { open: vi.fn().mockResolvedValue({ attachmentId: 'chief', eventSequence: 0, session: { ...activeSession, role: 'coordinator' }, runtime, messages: [], pendingDialogs: dialogs }), close: vi.fn().mockResolvedValue(true) }, agent: { onEvent: vi.fn(() => () => {}), command, stop: vi.fn().mockResolvedValue(true), list: vi.fn().mockResolvedValue([runtime]) }, providers: { catalog: vi.fn().mockResolvedValue({ models: [], providers: [] }) } } as unknown as ApexApi
    function Harness() {
      const runtimeSessionsRef = useRef(new Map<string, string>())
      const extension = useExtensionUi({ bridge, runtimeSessionsRef, setSessions: () => {}, setRuntime: () => {}, agentTurn: { send: () => {} } as unknown as AgentTurnHandle, reportError: () => {} })
      return <ActivityPage bridge={bridge} sessions={[activeSession]} projects={[project]} clearedActivity={{}} onOpen={vi.fn()} onClear={vi.fn()} controls={{ pendingByRuntime: extension.pendingByRuntime, onRecoverQuestion: extension.showExtensionUi, onRespondQuestion: extension.respondForRuntime }} />
    }
    await act(async () => root.render(<Harness />))
    const dock = container.querySelector('.activity-coordinator .conversation-bottom-dock')!
    expect(dock.querySelector('.extension-questionnaire')).not.toBeNull()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(dock.textContent).toContain('Question 1')
    await act(async () => dock.querySelector<HTMLButtonElement>('.extension-question__options button')!.click())
    expect(dock.textContent).toContain('Question 2')
    await act(async () => dock.querySelector<HTMLButtonElement>('.extension-question__options button')!.click())
    await act(async () => Array.from(dock.querySelectorAll('button')).find((button) => button.textContent === 'Submit answers')!.click())
    expect(command).toHaveBeenCalledWith('chief-runtime', { type: 'extension_ui_response', id: 'q0', value: JSON.stringify({ answer: 'Choice 0', answerSource: 'option' }) })
    expect(command).toHaveBeenCalledWith('chief-runtime', { type: 'extension_ui_response', id: 'q1', value: JSON.stringify({ answer: 'Choice 1', answerSource: 'option' }) })
    expect(window.sessionStorage.getItem('prime-work.composer-draft')).toBe('normal draft')
    window.sessionStorage.clear()
  })
  it('keeps the chief attached while filtering the roster and restores failed composer sends', async () => {
    window.sessionStorage.setItem('prime-work.composer-draft', 'normal draft')
    let runtime = { runtimeId: 'chief-runtime', harness: 'pi', cwd: '/chief', isStreaming: false, imageInputSupported: true, model: { provider: 'test', id: 'model' }, thinkingLevel: 'medium' }
    let promptAttempts = 0
    const onEvent = vi.fn((_receive: (event: ApexEventEnvelope) => void) => () => {})
    const command = vi.fn().mockImplementation(async (_id, request) => {
      if (request.type === 'attached_prompt') {
        if (++promptAttempts === 1) throw new Error('not admitted')
        return { success: false, error: 'image rejected' }
      }
      if (request.type === 'abort') return { success: false, error: 'stop rejected' }
      if (request.type === 'set_model') runtime = { ...runtime, model: { provider: request.provider, id: request.modelId } }
      if (request.type === 'set_thinking_level') runtime = { ...runtime, thinkingLevel: request.level }
      return {}
    })
    const model = { key: 'test/model', provider: 'test', id: 'model', name: 'Model One', reasoning: true, input: ['text'], contextWindow: 1000, maxTokens: 100, availableThinkingLevels: ['medium', 'high'], fastModeSupported: false, available: true }
    const otherModel = { ...model, key: 'test/other', id: 'other', name: 'Model Two' }
    const open = vi.fn().mockResolvedValue({ attachmentId: 'chief-attachment', eventSequence: 0, session: { ...activeSession, id: 'chief', role: 'coordinator' }, runtime, messages: [{ id: 'm', role: 'assistant', timestamp: Date.now(), parts: [{ type: 'text', text: 'Chief is ready' }] }], pendingDialogs: [] })
    const bridge = { coordinator: { open, close: vi.fn().mockResolvedValue(true) }, agent: { onEvent, command, list: vi.fn().mockImplementation(async () => [runtime]) }, providers: { catalog: vi.fn().mockResolvedValue({ models: [model, otherModel], providers: [{ id: 'test', name: 'Test', configured: true, enabled: true }] }) } } as unknown as ApexApi
    await act(async () => root.render(<ActivityPage bridge={bridge} sessions={[activeSession]} projects={[project]} clearedActivity={{}} onOpen={vi.fn()} onClear={vi.fn()} />))
    expect(open).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.transcript')?.textContent).toContain('Chief is ready')
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Message Chief of Staff"]')!
    expect(input.value).toBe('')
    const tabs = container.querySelector('[role="tablist"][aria-label="Activity detail view"]')!
    const peekTab = tabs.querySelector<HTMLButtonElement>('[role="tab"][data-tab-value="peek"]')!
    const chiefTab = tabs.querySelector<HTMLButtonElement>('[role="tab"][data-tab-value="coordinator"]')!
    const peekPanel = document.getElementById(peekTab.getAttribute('aria-controls')!)!
    const chiefPanel = document.getElementById(chiefTab.getAttribute('aria-controls')!)!
    expect(chiefTab.getAttribute('aria-selected')).toBe('true')
    expect(peekTab.getAttribute('aria-selected')).toBe('false')
    expect(chiefPanel.getAttribute('aria-labelledby')).toBe(chiefTab.id)
    expect(peekPanel.getAttribute('aria-labelledby')).toBe(peekTab.id)
    expect(peekPanel.hidden).toBe(true)
    await act(async () => peekTab.click())
    expect(peekTab.getAttribute('aria-selected')).toBe('true')
    expect(chiefPanel.hidden).toBe(true)
    expect(peekPanel.hidden).toBe(false)
    expect(container.querySelector('[aria-label="Message Chief of Staff"]')).toBe(input)
    await act(async () => chiefTab.click())
    expect(chiefTab.getAttribute('aria-selected')).toBe('true')
    expect(chiefPanel.hidden).toBe(false)
    expect(open).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[aria-label="Message Chief of Staff"]')).toBe(input)
    await act(async () => {
      chiefTab.focus()
      chiefTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(peekTab)
    await act(async () => peekTab.click())
    expect(peekTab.getAttribute('aria-selected')).toBe('true')
    await act(async () => chiefTab.click())
    expect(open).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[aria-label="Message Chief of Staff"]')).toBe(input)
    await act(async () => {
      const filter = container.querySelector<HTMLSelectElement>('[aria-label="Activity project"]')!
      filter.value = 'project'
      filter.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(open).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[aria-label="Message Chief of Staff"]')).toBe(input)
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Chat settings"]')!.click())
    await act(async () => document.body.querySelector<HTMLButtonElement>('[aria-label="Model: Model One"]')!.click())
    await act(async () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find((option) => option.textContent?.includes('Model Two'))!.click())
    expect(command).toHaveBeenCalledWith('chief-runtime', { type: 'set_model', provider: 'test', modelId: 'other' })
    await act(async () => {
      await vi.waitFor(() => expect(runtime.model.id).toBe('other'))
      await vi.waitFor(() => expect(command).toHaveBeenCalledWith('chief-runtime', { type: 'set_thinking_level', level: 'medium' }))
    })
    await act(async () => document.body.querySelector<HTMLButtonElement>('[aria-label="Reasoning effort"]')!.click())
    await act(async () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find((option) => option.textContent?.trim() === 'High')!.click())
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith('chief-runtime', { type: 'set_thinking_level', level: 'high' }))
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, 'Check progress')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.click())
    expect(command).toHaveBeenCalledWith('chief-runtime', expect.objectContaining({ type: 'attached_prompt', message: 'Check progress', intent: 'queue' }))
    expect(input.value).toBe('Check progress')
    const file = new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
    const fileInput = container.querySelector<HTMLInputElement>('[aria-label="Choose files to attach"]')!
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] })
    await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.click())
    expect(command).toHaveBeenCalledWith('chief-runtime', { type: 'attached_prompt', message: 'Check progress', intent: 'queue', images: [{ type: 'image', mimeType: 'image/png', data: 'AQID' }] })
    expect(input.value).toBe('Check progress')
    expect(container.querySelector('[aria-label="Remove test.png"]')).not.toBeNull()
    expect(container.textContent).toContain('image rejected')
    await act(async () => onEvent.mock.calls[0][0]({ runtimeId: 'chief-runtime', event: { type: 'agent_start' }, sequence: 1 }))
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Stop Pi"]')!.click())
    expect(command).toHaveBeenCalledWith('chief-runtime', { type: 'abort' })
    expect(container.textContent).toContain('stop rejected')
    expect(window.sessionStorage.getItem('prime-work.composer-draft')).toBe('normal draft')
    window.sessionStorage.clear()
  })
  it('filters the feed and review actions to the selected project, including its worktrees', async () => {
    const otherProject: ProjectRecord = { ...project, id: 'other', name: 'Other', path: '/other', primaryFolder: '/other', folders: ['/other', '/other-worktree'] }
    const otherSession: SessionRecord = { ...activeSession, id: 'other-session', title: 'Other worktree run', filePath: '/sessions/other.jsonl', projectPath: '/other-worktree' }
    const onClear = vi.fn()
    await act(async () => root.render(<ActivityPage sessions={[activeSession, otherSession]} projects={[project, otherProject]} clearedActivity={{}} onOpen={vi.fn()} onClear={onClear} />))
    expect(container.textContent).toContain('Active chat')
    expect(container.textContent).toContain('Other worktree run')
    await act(async () => {
      const select = container.querySelector<HTMLSelectElement>('[aria-label="Activity project"]')!
      select.value = 'other'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.textContent).not.toContain('Active chat')
    expect(container.textContent).toContain('Other worktree run')
    await act(async () => container.querySelector<HTMLButtonElement>('.activity-clear-all')!.click())
    expect(onClear).toHaveBeenCalledWith([otherSession])
  })

  it('opens global coordination by default without taking over reply and Escape shortcuts', async () => {
    await act(async () => root.render(<ActivityPage sessions={[activeSession]} projects={[project]} clearedActivity={{}} controls={{ canFollowUpSession: () => true, onSendReply: vi.fn() }} onOpen={vi.fn()} onClear={vi.fn()} />))
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true })))
    expect(container.querySelector('[aria-label="Chief of Staff"]')?.textContent).toContain('All authorized projects')
    expect(container.querySelector('.activity-peek')).toBeNull()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true })))
    expect(container.querySelector('[role="tab"][data-tab-value="peek"]')?.getAttribute('aria-selected')).toBe('true')
    const reply = container.querySelector<HTMLTextAreaElement>('.activity-reply__input')!
    expect(document.activeElement).toBe(reply)
    await act(async () => reply.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.activeElement).not.toBe(reply)
  })

  it('keeps coordinator runs out of implementor rows, attention, companion notices, and sidebar counts', async () => {
    const coordinator: SessionRecord = { ...activeSession, id: 'coordinator', title: 'Hidden coordinator run', role: 'coordinator', status: 'running' }
    await act(async () => root.render(<ActivityPage sessions={[activeSession, coordinator]} projects={[project]} clearedActivity={{}} onOpen={vi.fn()} onClear={vi.fn()} />))
    expect(container.textContent).not.toContain('Hidden coordinator run')
    expect(indexSidebarSessions([project], [activeSession, coordinator]).activeSessions).toEqual([activeSession])
    for (const status of ['running', 'complete', 'waiting', 'failed'] as const) {
      const session = { ...coordinator, status }
      expect(activityNotificationSignature(session)).toBeUndefined()
      expect(sessionAttentionSignature(session)).toBeUndefined()
      expect(sessionCompanionNotificationSignature(session)).toBeUndefined()
    }
    await act(async () => root.render(<ActivityStatusPill sessions={[coordinator]} onOpen={vi.fn()} />))
    expect(container.querySelector('.activity-status-pill')).toBeNull()
  })

  it('never renders archived chats in Activity', async () => {
    const onOpen = vi.fn()
    await act(async () => {
      root.render(<ActivityPage sessions={[activeSession, archivedSession]} projects={[project]} clearedActivity={{}} onOpen={onOpen} onClear={vi.fn()} />)
    })

    expect(container.textContent).toContain('Active chat')
    expect(container.textContent).not.toContain('Archived chat')
    expect(container.querySelector('[aria-label="Activity filter"]')).toBeNull()

    await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"][data-tab-value="peek"]')!.click())
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Open Active chat"]')!.click()
    })
    expect(onOpen).toHaveBeenCalledWith(activeSession)
  })

  it('clears one notification from its icon and keeps running work out of clear all', async () => {
    const failedSession: SessionRecord = {
      ...activeSession,
      id: 'failed',
      filePath: '/sessions/failed.jsonl',
      title: 'Failed chat',
      status: 'failed',
    }
    const runningSession: SessionRecord = {
      ...activeSession,
      id: 'running',
      filePath: '/sessions/running.jsonl',
      title: 'Running chat',
      status: 'running',
    }
    const onClear = vi.fn()
    await act(async () => {
      root.render(<ActivityPage sessions={[activeSession, failedSession, runningSession]} projects={[project]} clearedActivity={{}} onOpen={vi.fn()} onClear={onClear} />)
    })

    expect(container.querySelector('[aria-label="Mark Active chat reviewed"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Mark Failed chat reviewed"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Mark Running chat reviewed"]')).toBeNull()
    const toolGroup = container.querySelector('.activity-tools__right')!
    expect(toolGroup.firstElementChild?.classList.contains('page-search')).toBe(true)
    expect(toolGroup.lastElementChild?.textContent).toBe('Mark all reviewed')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Mark Failed chat reviewed"]')!.click()
    })
    expect(onClear).toHaveBeenLastCalledWith([failedSession])

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.activity-clear-all')!.click()
    })
    expect(onClear).toHaveBeenLastCalledWith([activeSession, failedSession])
  })

  it('hides a cleared activity until its session revision changes', async () => {
    const signature = activityNotificationSignature(activeSession)!
    await act(async () => {
      root.render(<ActivityPage sessions={[activeSession]} projects={[project]} clearedActivity={{ [activeSession.id]: signature }} onOpen={vi.fn()} onClear={vi.fn()} />)
    })
    expect(container.textContent).not.toContain('Active chat')

    await act(async () => {
      root.render(<ActivityPage sessions={[{ ...activeSession, eventRevision: 1 }]} projects={[project]} clearedActivity={{ [activeSession.id]: signature }} onOpen={vi.fn()} onClear={vi.fn()} />)
    })
    expect(container.textContent).toContain('Active chat')
  })

  it('acknowledges and clears unread state when archiving succeeds', async () => {
    const archive = vi.fn(async () => true)
    const clearSessionAttention = vi.fn()
    const setToast = vi.fn()
    let sessions = [activeSession]
    const setSessions = vi.fn((update: (items: SessionRecord[]) => SessionRecord[]) => { sessions = update(sessions) })
    const actions = createWorkspaceActions(() => ({
      bridge: { sessions: { archive } },
      workspace: { workspaceRef: { current: { session: undefined } } },
      setSessions,
      setToast,
      clearSessionAttention,
      reportError: vi.fn(),
    } as unknown as WorkspaceActionsDeps))

    await actions.setSessionArchived(activeSession, true)

    expect(archive).toHaveBeenCalledWith(activeSession.filePath, true)
    expect(clearSessionAttention).toHaveBeenCalledWith(activeSession)
    expect(sessions[0]).toMatchObject({ id: activeSession.id, archived: true, unread: false })
    expect(setToast).toHaveBeenCalledWith('Session archived.')
  })

  it('recreates the browser host when archiving the open session', async () => {
    const archive = vi.fn(async () => true)
    const resetBrowserView = vi.fn()
    const activateWorkspace = vi.fn()
    const actions = createWorkspaceActions(() => ({
      bridge: { sessions: { archive } },
      initialized: true,
      activeProject: project,
      layout: { compactLayout: false },
      settingsState: {},
      workspace: { workspaceRef: { current: { project, session: activeSession } }, activateWorkspace },
      setSessions: vi.fn(),
      setView: vi.fn(),
      setPaletteOpen: vi.fn(),
      setToast: vi.fn(),
      resetBrowserView,
      clearSessionAttention: vi.fn(),
      reportError: vi.fn(),
    } as unknown as WorkspaceActionsDeps))

    await actions.setSessionArchived(activeSession, true)

    expect(resetBrowserView).toHaveBeenCalledOnce()
    expect(activateWorkspace).toHaveBeenCalledWith(project)
  })

  it('renders urgency-ordered sections, live tool/quiet state, and requires confirmation before stopping a run', async () => {
    const now = Date.now()
    const runningSession: SessionRecord = {
      ...activeSession,
      id: 'running-1',
      filePath: '/sessions/running-1.jsonl',
      title: 'Running suite',
      status: 'running',
      unread: false,
    }
    const quietSession: SessionRecord = {
      ...activeSession,
      id: 'running-2',
      filePath: '/sessions/running-2.jsonl',
      title: 'Quiet thinker',
      status: 'running',
      unread: false,
    }
    const questionSession: SessionRecord = {
      ...activeSession,
      id: 'question-1',
      filePath: '/sessions/question-1.jsonl',
      title: 'Release question',
      status: 'waiting',
    }
    const recentSession: SessionRecord = {
      ...activeSession,
      id: 'recent-1',
      filePath: '/sessions/recent-1.jsonl',
      title: 'Earlier chat',
      status: 'complete',
      unread: false,
      preview: 'Merged clean',
    }
    const liveBySession: SessionLiveMap = {
      [runningSession.filePath]: {
        runtimeId: 'rt-run-1',
        phase: 'tool',
        currentTool: { name: 'bash', summary: 'npm test', startedAt: now - 12_000 },
        runStartedAt: now - 65_000,
        lastEventAt: now - 2_000,
        contextUsage: { tokens: 24_000, contextWindow: 100_000, percent: 24 },
        sessionUsage: { cost: 0.42 },
      },
      [quietSession.filePath]: {
        runtimeId: 'rt-run-2',
        phase: 'thinking',
        runStartedAt: now - 240_000,
        lastEventAt: now - 240_000,
      },
      [questionSession.filePath]: {
        runtimeId: 'rt-q-1',
        phase: 'thinking',
        runStartedAt: now - 30_000,
        lastEventAt: now - 5_000,
        pendingQuestion: {
          id: 'q-1',
          title: 'Which release channel?',
          method: 'questionnaire',
          deadline: now + 90_000,
          runtimeId: 'rt-q-1',
        },
      },
    }
    const onStop = vi.fn()
    await act(async () => {
      root.render(
        <ActivityPage
          sessions={[recentSession, activeSession, runningSession, quietSession, questionSession]}
          projects={[project]}
          clearedActivity={{}}
          liveBySession={liveBySession}
          onOpen={vi.fn()}
          onClear={vi.fn()}
          onStop={onStop}
        />,
      )
    })

    const headings = [...container.querySelectorAll('.activity-section__heading')].map((el) => el.textContent)
    expect(headings).toEqual(['NEEDS YOU·1', 'RUNNING·2', 'READY TO REVIEW·1', 'RECENT·1'])
    expect(container.textContent).toContain('▶ bash · npm test')
    expect(container.textContent).toContain('$0.42')
    expect(container.textContent).toContain('quiet 4m')
    expect(container.textContent).toContain('Which release channel?')

    const runningRows = [...container.querySelectorAll('.activity-section--running .activity-main__title')].map((el) => el.textContent)
    expect(runningRows).toEqual(['Quiet thinker', 'Running suite'])

    const stopBtn = container.querySelector<HTMLButtonElement>('[aria-label="Stop Running suite"]')!
    expect(stopBtn).not.toBeNull()
    await act(async () => {
      stopBtn.click()
    })
    expect(onStop).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Stop this run?')

    const confirmGroup = container.querySelector<HTMLElement>('[aria-label="Confirm stopping Running suite"]')!
    await act(async () => {
      confirmGroup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[aria-label="Confirm stopping Running suite"]')).toBeNull()
    expect(onStop).not.toHaveBeenCalled()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Stop Running suite"]')!.click()
    })
    const confirmStopBtn = container.querySelector<HTMLButtonElement>('.activity-stop-confirm__confirm')!
    await act(async () => {
      confirmStopBtn.click()
    })
    expect(onStop).toHaveBeenCalledWith(runningSession, 'rt-run-1')
  })

  it('supports peek selection, keyboard navigation, inline questions, progress line, live tail, and steer/follow-up reply box', async () => {
    const now = Date.now()
    const questionSession: SessionRecord = {
      ...activeSession,
      id: 'q-confirm',
      filePath: '/sessions/q-confirm.jsonl',
      title: 'Deploy confirmation',
      status: 'waiting',
      model: 'claude-sonnet-4',
      provider: 'anthropic',
    }
    const runningSession: SessionRecord = {
      ...activeSession,
      id: 'run-bg',
      filePath: '/sessions/run-bg.jsonl',
      title: 'Background worker',
      status: 'running',
      unread: false,
      model: 'gpt-5',
      provider: 'openai',
    }
    const reviewSession: SessionRecord = {
      ...activeSession,
      id: 'review-1',
      filePath: '/sessions/review-1.jsonl',
      title: 'Finished audit',
      status: 'complete',
      unread: true,
    }
    const recentSession: SessionRecord = {
      ...activeSession,
      id: 'recent-idle',
      filePath: '/sessions/recent-idle.jsonl',
      title: 'Old idle thread',
      status: 'complete',
      unread: false,
    }

    const tailByFile: Record<string, TranscriptMessage[]> = {
      [questionSession.filePath]: [
        { id: 'm1', role: 'user', timestamp: now - 10_000, parts: [{ type: 'text', text: 'Deploy staging build' }] },
      ],
      [runningSession.filePath]: [
        { id: 'm2', role: 'user', timestamp: now - 20_000, parts: [{ type: 'text', text: 'Run checks and subagents' }] },
        {
          id: 'm3',
          role: 'assistant',
          timestamp: now - 15_000,
          parts: [
            {
              type: 'toolCall',
              id: 'tc-todo',
              name: 'todo_write',
              args: {
                todos: [
                  { id: '1', content: 'Compile types', status: 'completed' },
                  { id: '2', content: 'Run integration tests', status: 'in_progress' },
                ],
              },
            },
            { type: 'toolResult', partId: 'tc-todo', name: 'todo_write', text: 'ok' },
            {
              type: 'toolCall',
              id: 'tc-task',
              name: 'task',
              args: { agent: 'verifier', prompt: 'Verify build' },
            },
            { type: 'text', text: 'Running verification suite across workspaces.' },
          ],
        },
      ],
    }

    const readTranscript = vi.fn(async (filePath: string) => tailByFile[filePath] ?? [])
    const onRespondQuestion = vi.fn()
    const onOpenQuestionModal = vi.fn()
    const onSendReply = vi.fn(async () => undefined)
    const onOpen = vi.fn()
    const onClear = vi.fn()
    const onStop = vi.fn()

    const liveBySession: SessionLiveMap = {
      [questionSession.filePath]: {
        runtimeId: 'rt-confirm',
        phase: 'thinking',
        runStartedAt: now - 20_000,
        lastEventAt: now - 2_000,
        pendingQuestion: {
          id: 'req-confirm-1',
          title: 'Proceed with staging deploy?',
          method: 'confirm',
          deadline: now + 60_000,
          runtimeId: 'rt-confirm',
        },
      },
      [runningSession.filePath]: {
        runtimeId: 'rt-bg',
        phase: 'tool',
        currentTool: { name: 'bash', summary: 'npm run verify', startedAt: now - 4_000 },
        runStartedAt: now - 45_000,
        lastEventAt: now - 1_000,
      },
    }

    await act(async () => {
      root.render(
        <ActivityPage
          sessions={[recentSession, reviewSession, runningSession, questionSession]}
          projects={[project]}
          clearedActivity={{}}
          liveBySession={liveBySession}
          controls={{
            readTranscript,
            canFollowUpSession: (s) => s.id === reviewSession.id,
            onRespondQuestion,
            onOpenQuestionModal,
            onSendReply,
          }}
          onOpen={onOpen}
          onClear={onClear}
          onStop={onStop}
        />,
      )
    })

    // Peek selection picks first of Needs you
    await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"][data-tab-value="peek"]')!.click())
    const peek = container.querySelector('.activity-peek')!
    expect(peek.getAttribute('data-session-id')).toBe(questionSession.id)
    expect(peek.textContent).toContain('Proceed with staging deploy?')
    expect(peek.textContent).toContain('anthropic/claude-sonnet-4')

    // Answer confirm question inline with Yes
    const yesBtn = container.querySelector<HTMLButtonElement>('.activity-question-card__yes')!
    expect(yesBtn).not.toBeNull()
    await act(async () => {
      yesBtn.click()
    })
    expect(onRespondQuestion).toHaveBeenCalledWith('rt-confirm', { confirmed: true })

    // Keyboard 'j' moves selection to Running session
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
    })
    expect(peek.getAttribute('data-session-id')).toBe(runningSession.id)
    expect(readTranscript).toHaveBeenCalledWith(runningSession.filePath)
    expect(peek.textContent).toContain('1/2 todos')
    expect(peek.textContent).toContain('1 subagent running')
    expect(peek.textContent).toContain('Running verification suite across workspaces.')
    expect(peek.textContent).toContain('npm run verify')

    // Keyboard 'r' focuses reply textarea; Enter sends steer
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
    })
    const replyInput = container.querySelector<HTMLTextAreaElement>('.activity-reply__input')!
    expect(document.activeElement).toBe(replyInput)
    expect(replyInput.disabled).toBe(false)

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(replyInput, 'Focus on unit tests first')
      replyInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      replyInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onSendReply).toHaveBeenCalledWith(runningSession, 'Focus on unit tests first', 'steer', 'rt-bg')
    expect(container.textContent).toContain('Steer sent')

    // Esc blurs reply input; 'x' opens Stop confirmation in peek; Esc cancels it
    await act(async () => {
      replyInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.activeElement).not.toBe(replyInput)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    })
    expect(container.querySelector('[aria-label="Confirm stopping run"]')).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[aria-label="Confirm stopping run"]')).toBeNull()

    // Keyboard 'j' moves to Ready to review; 'e' marks it reviewed
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
    })
    expect(peek.getAttribute('data-session-id')).toBe(reviewSession.id)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }))
    })
    expect(onClear).toHaveBeenCalledWith([reviewSession])

    // Selecting non-resident recent idle session disables reply box with "Open session to continue"
    const recentRowBtn = container.querySelector<HTMLButtonElement>(`[aria-label="Select ${recentSession.title}"]`)!
    await act(async () => {
      recentRowBtn.click()
    })
    expect(peek.getAttribute('data-session-id')).toBe(recentSession.id)
    expect(replyInput.disabled).toBe(true)
    expect(replyInput.placeholder).toBe('Open session to continue')

    // Enter opens the selected session
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onOpen).toHaveBeenCalledWith(recentSession)
  })

  it('shows running and needs-you counts in ActivityStatusPill, hides when zero, and announces only needs-you increases', async () => {
    const onOpenActivity = vi.fn()
    const reviewSession: SessionRecord = {
      ...activeSession,
      id: 'review-only',
      filePath: '/sessions/review-only.jsonl',
      title: 'Ready review chat',
      status: 'complete',
      unread: true,
    }
    const runningA: SessionRecord = {
      ...activeSession,
      id: 'run-a',
      filePath: '/sessions/run-a.jsonl',
      title: 'Worker A',
      status: 'running',
      unread: false,
    }
    const runningB: SessionRecord = {
      ...activeSession,
      id: 'run-b',
      filePath: '/sessions/run-b.jsonl',
      title: 'Worker B',
      status: 'running',
      unread: false,
    }
    const failedSession: SessionRecord = {
      ...activeSession,
      id: 'fail-1',
      filePath: '/sessions/fail-1.jsonl',
      title: 'Failed deploy',
      status: 'failed',
      unread: true,
    }

    // Hidden when only ready-to-review or idle sessions exist
    await act(async () => {
      root.render(<ActivityStatusPill sessions={[reviewSession]} onOpen={onOpenActivity} />)
    })
    expect(container.querySelector('.activity-status-pill')).toBeNull()
    expect(container.querySelector('[role="status"]')?.textContent).toBe('')

    // Running count change does not announce in polite live region
    await act(async () => {
      root.render(<ActivityStatusPill sessions={[runningA, runningB]} onOpen={onOpenActivity} />)
    })
    const pillRunningOnly = container.querySelector<HTMLButtonElement>('.activity-status-pill')!
    expect(pillRunningOnly).not.toBeNull()
    expect(pillRunningOnly.textContent).toBe('2running')
    expect(pillRunningOnly.getAttribute('aria-label')).toBe('2 sessions running. Open Activity')
    expect(container.querySelector('[role="status"]')?.textContent).toBe('')

    // Needs-you increase announces in polite live region and renders both segments
    await act(async () => {
      root.render(<ActivityStatusPill sessions={[runningA, runningB, failedSession]} onOpen={onOpenActivity} />)
    })
    const pillBoth = container.querySelector<HTMLButtonElement>('.activity-status-pill')!
    expect(pillBoth.textContent).toBe('2running·1needs you')
    expect(pillBoth.getAttribute('aria-label')).toBe('2 sessions running, 1 needs your attention. Open Activity')
    expect(pillBoth.getAttribute('title')).toContain('Running: Worker A, Worker B')
    expect(pillBoth.getAttribute('title')).toContain('Needs you: Failed deploy')
    expect(container.querySelector('[role="status"]')?.textContent).toBe('1 session needs your attention')

    // Clearing the failed session filters it out of needs-you
    const failSig = activityNotificationSignature(failedSession)!
    await act(async () => {
      root.render(
        <ActivityStatusPill
          sessions={[runningA, runningB, failedSession]}
          clearedActivity={{ [failedSession.id]: failSig }}
          onOpen={onOpenActivity}
        />,
      )
    })
    expect(container.querySelector('.activity-status-pill')?.textContent).toBe('2running')

    // Clicking navigates to Activity unless already active
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.activity-status-pill')!.click()
    })
    expect(onOpenActivity).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.render(<ActivityStatusPill sessions={[runningA]} active onOpen={onOpenActivity} />)
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.activity-status-pill')!.click()
    })
    expect(onOpenActivity).toHaveBeenCalledTimes(1)
  })
})
