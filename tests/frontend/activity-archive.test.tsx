// @vitest-environment jsdom

import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activityNotificationSignature, sessionAttentionSignature, sessionCompanionNotificationSignature } from '../../apps/desktop/src/app/session-attention'
import { indexSidebarSessions } from '../../apps/desktop/src/components/Sidebar'
import { createWorkspaceActions, type WorkspaceActionsDeps } from '../../apps/desktop/src/hooks/useWorkspaceActions'
import { ActivityCoordinator } from '../../apps/desktop/src/components/activity/ActivityCoordinator'
import { ActivityQuestionCard } from '../../apps/desktop/src/components/activity/ActivityQuestionCard'
import { ActivityReplyBox } from '../../apps/desktop/src/components/activity/ActivityReplyBox'
import { useExtensionUi } from '../../apps/desktop/src/hooks/useExtensionUi'
import type { AgentTurnHandle } from '../../apps/desktop/src/app/agentTurnMachine'
import type { ApexApi, ApexEventEnvelope, ProjectRecord, SessionRecord } from '../../apps/desktop/src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project: ProjectRecord = {
  id: 'project', harness: 'pi', name: 'Project', path: '/project', folders: ['/project'], primaryFolder: '/project',
  pinned: false, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', sessionCount: 2,
}
const activeSession: SessionRecord = {
  id: 'active', harness: 'pi', filePath: '/sessions/active.jsonl', projectPath: '/project', title: 'Active chat',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', status: 'complete', depth: 0, unread: true,
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
      return <ActivityCoordinator bridge={bridge} controls={{ pendingByRuntime: extension.pendingByRuntime, onRecoverQuestion: extension.showExtensionUi, onRespondQuestion: extension.respondForRuntime }} />
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
  it('preserves Chief model controls and restores failed composer sends', async () => {
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
    await act(async () => root.render(<ActivityCoordinator bridge={bridge} />))
    expect(open).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.transcript')?.textContent).toContain('Chief is ready')
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Message Chief of Staff"]')!
    expect(input.value).toBe('')
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
  it('clears the chief chat after confirmation and reopens on a fresh session', async () => {
    const runtime = { runtimeId: 'chief-runtime', harness: 'pi', cwd: '/chief', isStreaming: false }
    const opened = (messages: unknown[], id: string) => ({ attachmentId: id, eventSequence: 0, session: { ...activeSession, id, role: 'coordinator' }, runtime, messages, pendingDialogs: [] })
    const open = vi.fn()
      .mockResolvedValueOnce(opened([{ id: 'm', role: 'assistant', timestamp: Date.now(), parts: [{ type: 'text', text: 'Old conversation' }] }], 'old'))
      .mockResolvedValueOnce(opened([], 'fresh'))
    const reset = vi.fn().mockResolvedValue(true)
    const bridge = { coordinator: { open, close: vi.fn().mockResolvedValue(true), reset }, agent: { onEvent: vi.fn(() => () => {}), command: vi.fn(), list: vi.fn().mockResolvedValue([runtime]) }, providers: { catalog: vi.fn().mockResolvedValue({ models: [], providers: [] }) } } as unknown as ApexApi
    await act(async () => root.render(<ActivityCoordinator bridge={bridge} />))
    expect(container.textContent).toContain('Old conversation')
    const clearButton = () => container.querySelector<HTMLButtonElement>('[aria-label="Clear chat"]') ?? undefined
    await act(async () => clearButton()!.click())
    expect(reset).not.toHaveBeenCalled()
    const confirm = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((button) => button.textContent?.trim() === 'Clear chat')!
    await act(async () => confirm.click())
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(reset).toHaveBeenCalledWith(undefined)
    await vi.waitFor(() => expect(container.textContent).not.toContain('Old conversation'))
    expect(clearButton()).toBeUndefined()
  })
  it('shows the styled loading state while the chief is opening', async () => {
    const bridge = { coordinator: { open: vi.fn(() => new Promise(() => {})), close: vi.fn().mockResolvedValue(true) }, agent: { onEvent: vi.fn(() => () => {}), command: vi.fn(), list: vi.fn().mockResolvedValue([]) }, providers: { catalog: vi.fn().mockResolvedValue({ models: [], providers: [] }) } } as unknown as ApexApi
    await act(async () => root.render(<ActivityCoordinator bridge={bridge} />))
    const loading = container.querySelector('.activity-coordinator__loading')
    expect(loading).not.toBeNull()
    expect(loading?.getAttribute('role')).toBe('status')
    expect(loading?.textContent).toContain('Opening Chief of Staff…')
    expect(loading?.querySelector('svg')).not.toBeNull()
  })
  it('keeps coordinator runs out of implementor rows, attention, companion notices, and sidebar counts', async () => {
    const coordinator: SessionRecord = { ...activeSession, id: 'coordinator', title: 'Hidden coordinator run', role: 'coordinator', status: 'running' }
    expect(indexSidebarSessions([project], [activeSession, coordinator]).activeSessions).toEqual([activeSession])
    for (const status of ['running', 'complete', 'waiting', 'failed'] as const) {
      const session = { ...coordinator, status }
      expect(activityNotificationSignature(session)).toBeUndefined()
      expect(sessionAttentionSignature(session)).toBeUndefined()
      expect(sessionCompanionNotificationSignature(session)).toBeUndefined()
    }
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

  it('answers a confirmation and sends a steer from standalone controls', async () => {
    const respond = vi.fn()
    const send = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(<><ActivityQuestionCard question={{ id: 'q', title: 'Proceed?', method: 'confirm', runtimeId: 'rt' }} now={Date.now()} onRespond={respond} /><ActivityReplyBox session={activeSession} runtimeId="rt" isRunning canFollowUp={false} onSend={send} /></>))
    await act(async () => container.querySelector<HTMLButtonElement>('.activity-question-card__yes')!.click())
    expect(respond).toHaveBeenCalledWith('rt', { confirmed: true })
    const input = container.querySelector<HTMLTextAreaElement>('.activity-reply__input')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Focus on tests'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(send).toHaveBeenCalledWith(activeSession, 'Focus on tests', 'steer', 'rt')
  })

})
