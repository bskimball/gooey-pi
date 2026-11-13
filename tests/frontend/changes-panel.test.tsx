// @vitest-environment jsdom

import { act, useState } from 'react'
import { useTaskWorkflows } from '../../apps/desktop/src/hooks/useTaskWorkflows'
import { TaskWorkflowContext } from '../../apps/desktop/src/lib/task-context'
import { TaskWorkflowDialogs, TaskWorkflowToolbar } from '../../apps/desktop/src/components/TaskWorkflowDialogs'
import { ContextExcerpt } from '../../apps/desktop/src/components/ContextExcerpt'
import { UserMessage } from '../../apps/desktop/src/components/transcript/messages'
import type { ApexApi, ApexEventEnvelope, FinishedTask, FinishReview, RewindPreview, RewindResult, RunReceipt, RuntimeInfo, SessionChangeEvent, SessionRecord, SideConversation } from '../../apps/desktop/src/types/api'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import { ChangesCard } from '../../apps/desktop/src/components/ChangesCard'
import { ChangesPanel } from '../../apps/desktop/src/components/inspector/ChangesPanel'
import { changesPanelMachine } from '../../apps/desktop/src/components/inspector/changesPanelMachine'
import { INSPECTOR_DEFAULT, INSPECTOR_MIN, usePanelLayout } from '../../apps/desktop/src/hooks/usePanelLayout'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
  Reflect.deleteProperty(window, 'apex')
  vi.restoreAllMocks()
})

const parentSession: SessionRecord = { id: 'parent', filePath: '/sessions/parent.jsonl', projectPath: '/project', harness: 'pi', title: 'Parent', status: 'idle', depth: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const forkSession: SessionRecord = { ...parentSession, id: 'fork', filePath: '/sessions/fork.jsonl', title: 'Fork' }
const sideSession: SessionRecord = { ...parentSession, id: 'side', filePath: '/sessions/side.jsonl', title: 'Side' }
const runReceipt: RunReceipt = { id: 'run-1', sessionId: 'parent', startedAt: '2026-01-01', state: 'complete', anchorUserEntryId: 'saved-1', memberUserEntryIds: ['saved-1', 'saved-queued'], inputs: [], changes: [{ path: 'saved.txt', kind: 'modified' }], attribution: 'observed-checkout' }
const preview: RewindPreview = { token: 'preview-token', selectedUserEntryId: 'saved-queued', anchorUserEntryId: 'saved-1', prompt: 'Run starting prompt', rewindToRunStart: true, checkout: '/project', worktree: { linked: true, primary: false }, restore: { available: true, fingerprint: 'fingerprint', changes: [{ path: 'my-edit.txt', kind: 'modified' }] }, warning: 'Your own changes are included.' }
const finishReview: FinishReview = { token: 'finish-token', expiresAt: '2099-01-01', sessionFile: parentSession.filePath, cwd: '/project', git: { status: { isRepo: true, files: [{ path: 'my-edit.txt', status: 'M', staged: false, additions: 1, deletions: 0 }] }, integration: { kind: 'integrated', target: 'origin/main', evidence: 'local-cached-remote-tracking-ref' } }, worktree: { kind: 'linked', ownership: 'apex-created', ownershipReason: 'Recorded provenance', root: '/project' }, conflicts: [{ kind: 'terminal', terminalId: 'terminal-1' }], cleanup: { eligible: false, reasons: ['Uncommitted changes'] }, nextActions: ['Review the uncommitted files'] }

function workflowBridge() {
  let relation: SideConversation | null = null
  const sessions = {
    listFinishedTasks: vi.fn(async (): Promise<FinishedTask[]> => []), listRunReceipts: vi.fn(async () => [runReceipt]),
    read: vi.fn(async () => ['saved-1', 'saved-queued'].map((id) => ({ id, role: 'user', parts: [{ type: 'text', text: 'Saved prompt' }] }))),
    getSideConversation: vi.fn(async (file: string) => file === sideSession.filePath ? relation : null),
    listSideConversations: vi.fn(async (file: string) => file === parentSession.filePath && relation ? [relation] : []),
    onChanged: vi.fn((_callback: (event: SessionChangeEvent) => void) => () => undefined), list: vi.fn(async () => [parentSession, forkSession, sideSession]),
    previewRewind: vi.fn(async () => preview), rewind: vi.fn(async (): Promise<RewindResult> => ({ kind: 'rewound', sessionFile: forkSession.filePath, sessionId: 'fork', prompt: 'Run starting prompt', files: 'kept' })),
    readRunFile: vi.fn(async () => ({ before: { kind: 'symlink', target: 'old-target' }, after: { kind: 'file', binary: false, size: 12, base64: btoa('saved answer\nsecond line') } })),
    createSideConversation: vi.fn(async () => { relation = { parentSession: parentSession.filePath, sessionFile: sideSession.filePath, cwd: '/project', policy: 'read-only-tools', createdAt: '2026-01-01', initialContext: 'Selected parent context' }; return relation }),
    prepareSideReturn: vi.fn(async (_runtime: string, _side: string, text: string) => ({ sourceSession: sideSession.filePath, text })),
    reviewFinish: vi.fn(async () => finishReview), finishTask: vi.fn(async () => ({ status: 'finished', sessionFile: parentSession.filePath, finishedAt: '2026-01-01', review: finishReview })),
  }
  const runtimes: RuntimeInfo[] = [{ runtimeId: 'runtime-parent', harness: 'pi', sessionFile: parentSession.filePath, cwd: '/project', isStreaming: false }]
  const agent = {
    onEvent: vi.fn((_callback: (event: ApexEventEnvelope) => void) => () => undefined), list: vi.fn(async () => runtimes),
    start: vi.fn(async (options: Parameters<ApexApi['agent']['start']>[0]): Promise<RuntimeInfo> => {
      const resumed: RuntimeInfo = { runtimeId: 'resumed-saved-runtime', harness: 'pi', sessionFile: options.sessionPath, cwd: options.cwd, isStreaming: false }
      runtimes.push(resumed)
      return resumed
    }), stop: vi.fn(), command: vi.fn(),
  }
  Object.defineProperty(window, 'apex', { configurable: true, value: { sessions, agent } })
  return { sessions, agent }
}
function WorkflowHarness({ busy = false, resident = true }: { busy?: boolean; resident?: boolean }) {
  const [session, setSession] = useState(parentSession)
  const [, setSessions] = useState<SessionRecord[]>([])
  const workflow = useTaskWorkflows({ bridge: window.apex, session, runtime: resident ? { runtimeId: `runtime-${session.id}`, harness: 'pi', sessionFile: session.filePath, cwd: '/project', isStreaming: busy } : null, busy, setSessions, selectSession: async (next) => setSession(next), reportError: () => undefined })
  return <TaskWorkflowContext.Provider value={workflow.context}>
    <TaskWorkflowToolbar workflow={workflow} />
    <button type="button" onClick={() => setSession(forkSession)}>Select other session</button>
    <button type="button" onClick={() => setSession(parentSession)}>Select original session</button>
    <output aria-label="Current session">{session.id}</output><output aria-label="Recovered draft">{workflow.insertDraft?.text}</output>
    <output aria-label="Attached excerpts">{JSON.stringify(workflow.context.excerpts)}</output>
    <UserMessage message={{ id: 'saved-queued', role: 'user', parts: [{ type: 'text', text: 'Queued prompt' }] }} />
    <UserMessage message={{ id: 'desktop-user-temporary', role: 'user', parts: [{ type: 'text', text: 'Unsaved prompt' }] }} />
    <ContextExcerpt source="Assistant narrative" text="Only selected answer"><p>Only selected answer</p></ContextExcerpt>
    <p>Private thought and tool transcript</p>
    <TaskWorkflowDialogs workflow={workflow} />
  </TaskWorkflowContext.Provider>
}
const workflowButton = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === label)!
const clickWorkflow = async (label: string) => { await act(async () => { workflowButton(label).click(); await Promise.resolve() }) }

describe('Task review workflows', () => {
  it.each(['Edit from here', 'Finish task'])('resumes an absent saved runtime without a prompt for %s and confirms on its returned owner', async (action) => {
    const { agent, sessions } = workflowBridge()
    agent.list.mockResolvedValueOnce([])
    await act(async () => root.render(<WorkflowHarness resident={false} />))
    expect(workflowButton(action).disabled).toBe(false)
    await clickWorkflow(action)
    expect(agent.start).toHaveBeenCalledExactlyOnceWith({ cwd: parentSession.projectPath, sessionPath: parentSession.filePath, harness: 'pi' })
    // Even a stale resident runtime prop must not replace the dialog's owner.
    await act(async () => root.render(<WorkflowHarness />))
    if (action === 'Edit from here') {
      expect(sessions.previewRewind).toHaveBeenCalledWith('resumed-saved-runtime', parentSession.filePath, 'saved-queued')
      await clickWorkflow('Fork and keep files')
      expect(sessions.rewind).toHaveBeenCalledWith('resumed-saved-runtime', parentSession.filePath, 'preview-token', { restoreFiles: false })
    } else {
      expect(sessions.reviewFinish).toHaveBeenCalledWith('resumed-saved-runtime', parentSession.filePath)
      await clickWorkflow('Confirm finish task')
      expect(sessions.finishTask).toHaveBeenCalledWith('resumed-saved-runtime', parentSession.filePath, 'finish-token', 'finish')
    }
    expect(agent.command).not.toHaveBeenCalled(); expect(agent.stop).not.toHaveBeenCalled()
    expect(sessions.createSideConversation).not.toHaveBeenCalled()
  })
  it.each(['Edit from here', 'Finish task'])('refuses a fresh busy runtime for %s even when the rendered runtime is idle', async (action) => {
    const { agent, sessions } = workflowBridge()
    agent.list.mockResolvedValue([{ runtimeId: 'busy-owner', harness: 'pi', sessionFile: parentSession.filePath, cwd: '/project', isStreaming: true }])
    await act(async () => root.render(<WorkflowHarness />))
    await clickWorkflow(action)
    expect(document.body.textContent).toContain('This session is busy')
    expect(sessions.previewRewind).not.toHaveBeenCalled(); expect(sessions.reviewFinish).not.toHaveBeenCalled()
    expect(agent.start).not.toHaveBeenCalled(); expect(agent.command).not.toHaveBeenCalled(); expect(agent.stop).not.toHaveBeenCalled()
  })
  it('rechecks navigation after a delayed resume, including leaving and returning to the same session', async () => {
    const { agent, sessions } = workflowBridge()
    let resolveStarted!: (value: RuntimeInfo) => void
    const started = new Promise<RuntimeInfo>((resolve) => { resolveStarted = resolve })
    agent.list.mockResolvedValueOnce([])
    agent.start.mockReturnValueOnce(started)
    await act(async () => root.render(<WorkflowHarness resident={false} />))
    await clickWorkflow('Edit from here')
    expect(document.body.textContent).toContain('Preparing task action')
    await clickWorkflow('Select other session')
    await clickWorkflow('Select original session')
    await act(async () => resolveStarted({ runtimeId: 'late-owner', harness: 'pi', sessionFile: parentSession.filePath, cwd: '/project', isStreaming: false }))
    expect(sessions.previewRewind).not.toHaveBeenCalled()
    expect(document.querySelector('dialog')).toBeNull()
    expect(container.querySelector('[aria-label="Current session"]')?.textContent).toBe('parent')
    expect(agent.command).not.toHaveBeenCalled(); expect(agent.stop).not.toHaveBeenCalled()
  })
  it('rechecks current busy state after a delayed resume', async () => {
    const { agent, sessions } = workflowBridge()
    let resolveStarted!: (value: RuntimeInfo) => void
    const started = new Promise<RuntimeInfo>((resolve) => { resolveStarted = resolve })
    agent.list.mockResolvedValueOnce([])
    agent.start.mockReturnValueOnce(started)
    await act(async () => root.render(<WorkflowHarness resident={false} />))
    await clickWorkflow('Finish task')
    await act(async () => root.render(<WorkflowHarness resident={false} busy />))
    await act(async () => resolveStarted({ runtimeId: 'late-owner', harness: 'pi', sessionFile: parentSession.filePath, cwd: '/project', isStreaming: false }))
    expect(sessions.reviewFinish).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('This session is busy')
  })
  it('resumes an evicted parent at its catalog cwd and only brings back an attachment', async () => {
    const { agent, sessions } = workflowBridge()
    sessions.list.mockResolvedValue([{ ...parentSession, projectPath: '/parent-checkout' }, forkSession, sideSession])
    await act(async () => root.render(<WorkflowHarness />))
    await clickWorkflow('Side conversation')
    const answer = container.querySelector('.context-excerpt p')!
    const range = document.createRange(); range.setStart(answer.firstChild!, 5); range.setEnd(answer.firstChild!, 13)
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
    await act(async () => answer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
    agent.list.mockResolvedValueOnce([])
    await clickWorkflow('Bring back')
    expect(agent.start).toHaveBeenCalledExactlyOnceWith({ cwd: '/parent-checkout', sessionPath: parentSession.filePath, harness: 'pi' })
    expect(sessions.prepareSideReturn).toHaveBeenCalledWith('resumed-saved-runtime', sideSession.filePath, 'selected')
    expect(container.querySelector('[aria-label="Current session"]')?.textContent).toBe('parent')
    expect(container.querySelector('[aria-label="Attached excerpts"]')?.textContent).toContain('Side conversation reply')
    expect(agent.command).not.toHaveBeenCalled(); expect(agent.stop).not.toHaveBeenCalled()
  })
  it('refreshes a completed receipt on the delayed durable session notification without navigation', async () => {
    const { sessions, agent } = workflowBridge()
    sessions.listRunReceipts.mockResolvedValue([{ ...runReceipt, state: 'open' }])
    await act(async () => root.render(<WorkflowHarness />))
    await act(async () => agent.onEvent.mock.calls.at(-1)![0]({ runtimeId: 'runtime-parent', event: { type: 'agent_end' } }))
    expect(workflowButton('Review run')).toBeUndefined()
    sessions.listRunReceipts.mockResolvedValue([runReceipt])
    await act(async () => sessions.onChanged.mock.calls.at(-1)![0]({ filePath: parentSession.filePath, harness: 'pi' }))
    expect(workflowButton('Review run')).toBeDefined()
    expect(container.querySelector('[aria-label="Current session"]')?.textContent).toBe('parent')
    await clickWorkflow('Review run')
    expect(document.body.textContent).toContain('saved.txt · modified')
  })
  it('uses saved entry IDs, previews queued run anchors, defaults to keep-files, and navigates with an unsent prompt', async () => {
    const { sessions, agent } = workflowBridge()
    await act(async () => root.render(<WorkflowHarness />))
    const edits = [...container.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.textContent === 'Edit from here')
    expect(edits[1].disabled).toBe(true)
    await clickWorkflow('Edit from here')
    expect(sessions.previewRewind).toHaveBeenCalledWith('runtime-parent', parentSession.filePath, 'saved-queued')
    expect(document.body.textContent).toContain('rewinds to that run')
    expect(document.body.textContent).toContain('my-edit.txt')
    expect(document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    await clickWorkflow('Cancel')
    expect(sessions.rewind).not.toHaveBeenCalled()
    await clickWorkflow('Edit from here')
    await clickWorkflow('Fork and keep files')
    expect(sessions.rewind).toHaveBeenCalledWith('runtime-parent', parentSession.filePath, 'preview-token', { restoreFiles: false })
    expect(container.querySelector('[aria-label="Current session"]')?.textContent).toBe('fork')
    expect(container.querySelector('[aria-label="Recovered draft"]')?.textContent).toBe('Run starting prompt')
    expect(agent.command).not.toHaveBeenCalled()
  })
  it('requires explicit restore confirmation and follows the actual fork on a partial failure', async () => {
    const { sessions } = workflowBridge()
    sessions.rewind.mockResolvedValueOnce({ kind: 'restore-failed', sessionFile: forkSession.filePath, sessionId: 'fork', prompt: 'Run starting prompt', error: 'disk failure', filesMayBePartial: true })
    await act(async () => root.render(<WorkflowHarness />))
    await clickWorkflow('Edit from here')
    await act(async () => document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await clickWorkflow('Fork and restore files')
    expect(sessions.rewind).toHaveBeenCalledWith('runtime-parent', parentSession.filePath, 'preview-token', { restoreFiles: true, confirmation: 'restore', fingerprint: 'fingerprint' })
    expect(container.querySelector('[aria-label="Current session"]')?.textContent).toBe('fork')
    expect(document.body.textContent).toContain('Files may be partially restored')
  })
  it('reviews historical files through the run anchor and attaches only the selected saved span', async () => {
    const { sessions } = workflowBridge()
    await act(async () => root.render(<WorkflowHarness />))
    await clickWorkflow('Review run')
    expect(document.body.textContent).toContain('Changes observed during this run')
    await clickWorkflow('saved.txt · modified')
    expect(sessions.readRunFile).toHaveBeenCalledWith(parentSession.filePath, 'saved-1', 'saved.txt')
    expect(document.body.textContent).toContain('symlink → old-target')
    const line = document.body.querySelector('[data-context-line="1"]')!
    const range = document.createRange(); range.setStart(line.firstChild!, 6); range.setEnd(line.firstChild!, 12)
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
    await act(async () => line.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
    await clickWorkflow('Request a change')
    expect(container.querySelector('[aria-label="Attached excerpts"]')?.textContent).toContain('answer')
    expect(container.querySelector('[aria-label="Attached excerpts"]')?.textContent).toContain('lines 1–1')
    expect(container.querySelector('[aria-label="Attached excerpts"]')?.textContent).not.toContain('second line')
  })
  it('starts a side conversation without stopping the parent and brings back context only after an idle check', async () => {
    const { sessions, agent } = workflowBridge()
    await act(async () => root.render(<WorkflowHarness busy />))
    await clickWorkflow('Side conversation')
    expect(container.querySelector('[aria-label="Current session"]')?.textContent).toBe('side')
    expect(document.body.textContent).toContain('read/search-only tools')
    expect(container.querySelector('[aria-label="Attached excerpts"]')?.textContent).toContain('Selected parent context')
    expect(agent.stop).not.toHaveBeenCalled()
    const answer = container.querySelector('.context-excerpt p')!
    const range = document.createRange(); range.setStart(answer.firstChild!, 5); range.setEnd(answer.firstChild!, 13)
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
    await act(async () => answer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
    agent.list.mockResolvedValueOnce([{ runtimeId: 'runtime-parent', harness: 'pi', sessionFile: parentSession.filePath, cwd: '/project', isStreaming: true }])
    await clickWorkflow('Bring back')
    expect(sessions.prepareSideReturn).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Parent is busy')
    await clickWorkflow('Bring back')
    expect(sessions.prepareSideReturn).toHaveBeenCalledWith('runtime-parent', sideSession.filePath, 'selected')
    expect(container.querySelector('[aria-label="Current session"]')?.textContent).toBe('parent')
    expect(container.querySelector('[aria-label="Attached excerpts"]')?.textContent).toContain('Side conversation reply')
    expect(agent.command).not.toHaveBeenCalled(); expect(agent.stop).not.toHaveBeenCalled()
  })
  it('loads finished markers and refreshes them when resumed work invalidates them', async () => {
    const { sessions, agent } = workflowBridge()
    sessions.listFinishedTasks.mockResolvedValue([{ status: 'finished', sessionFile: parentSession.filePath, finishedAt: '2026-01-01', review: finishReview }])
    await act(async () => root.render(<WorkflowHarness />))
    expect(document.body.textContent).toContain('Task finished')
    sessions.listFinishedTasks.mockResolvedValue([])
    await act(async () => agent.onEvent.mock.calls.at(-1)![0]({ runtimeId: 'runtime-parent', event: { type: 'session_action_update' } }))
    expect(document.body.textContent).not.toContain('Task finished')
  })
  it('offers a keyboard excerpt fallback without quoting adjacent thoughts or tools', async () => {
    workflowBridge()
    await act(async () => root.render(<WorkflowHarness />))
    await clickWorkflow('Select excerpt…')
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Exact excerpt"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'selected answer')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await clickWorkflow('Ask about this')
    const attached = container.querySelector('[aria-label="Attached excerpts"]')!.textContent!
    expect(JSON.parse(attached)[0].text).toBe('selected answer')
    expect(attached).not.toContain('Private thought')
    expect(attached).not.toContain('Only selected')
  })
  it('does not offer fabricated historical snapshots for legacy turns', async () => {
    const { sessions } = workflowBridge()
    sessions.listRunReceipts.mockResolvedValue([])
    await act(async () => root.render(<WorkflowHarness />))
    expect(workflowButton('Review run')).toBeUndefined()
    expect(workflowButton('Edit from here').disabled).toBe(false)
  })
  it('hides unavailable restore and disables task mutations while busy', async () => {
    const { sessions } = workflowBridge()
    sessions.previewRewind.mockResolvedValue({ ...preview, restore: { available: false, reason: 'Primary checkout cannot be restored', changes: [] } })
    await act(async () => root.render(<WorkflowHarness />))
    await clickWorkflow('Edit from here')
    expect(document.body.querySelector('input[type="checkbox"]')).toBeNull()
    expect(document.body.textContent).toContain('Primary checkout cannot be restored')
    await clickWorkflow('Cancel')
    await act(async () => root.render(<WorkflowHarness busy />))
    expect(workflowButton('Edit from here').disabled).toBe(true)
    expect(workflowButton('Finish task').disabled).toBe(true)
  })
  it('shows finish evidence and persists only on explicit confirmation', async () => {
    const { sessions, agent } = workflowBridge()
    await act(async () => root.render(<WorkflowHarness />))
    await clickWorkflow('Finish task')
    expect(document.body.textContent).toContain('local cached remote-tracking ref')
    expect(document.body.textContent).toContain('terminal-1')
    expect(document.body.textContent).toContain('Stop it before any manual cleanup')
    expect(sessions.finishTask).not.toHaveBeenCalled()
    await clickWorkflow('Confirm finish task')
    expect(sessions.finishTask).toHaveBeenCalledWith('runtime-parent', parentSession.filePath, 'finish-token', 'finish')
    expect(document.body.textContent).toContain('Task finished')
    expect(agent.stop).not.toHaveBeenCalled(); expect(agent.command).not.toHaveBeenCalled()
  })
})

describe('ChangesPanel status states', () => {
  it('renders the no-repository state without an error banner', async () => {
    await act(async () => {
      root.render(<ChangesPanel cwd="/project" git={{ isRepo: false, files: [], error: 'Not a Git repository' }} onRefreshGit={vi.fn()} />)
    })
    expect(container.textContent).toContain('No Git repository')
    expect(container.textContent).not.toContain('Git status unavailable')
  })

  it('renders a distinct failure state with retry when the repo exists but status failed', async () => {
    const onRefreshGit = vi.fn()
    await act(async () => {
      root.render(<ChangesPanel cwd="/project" git={{ isRepo: true, files: [], error: 'Git status timed out; the result is unknown' }} onRefreshGit={onRefreshGit} />)
    })
    expect(container.textContent).toContain('Git status unavailable')
    expect(container.textContent).toContain('Git status timed out')
    expect(container.textContent).not.toContain('No Git repository')
    act(() => { container.querySelector('button')!.click() })
    expect(onRefreshGit).toHaveBeenCalledTimes(1)
  })
  it('dismisses the file changes card without opening the inspector', async () => {
    const onOpenChanges = vi.fn()
    const onClose = vi.fn()
    await act(async () => {
      root.render(<ChangesCard git={{ isRepo: true, files: [{ path: 'file.txt', status: 'M', staged: false, additions: 1, deletions: 0 }] }} onOpenChanges={onOpenChanges} onClose={onClose} />)
    })

    act(() => { container.querySelector<HTMLButtonElement>('.changes-card__close')!.click() })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpenChanges).not.toHaveBeenCalled()
  })

  it('confirms undoing the selected file before restoring it', async () => {
    const restore = vi.fn(async () => true)
    const diff = vi.fn(async () => ({ path: 'file.txt', staged: false, text: '', truncated: false }))
    Object.defineProperty(window, 'apex', { configurable: true, value: { git: { diff, restore } } })
    const onRefreshGit = vi.fn(async () => undefined)

    await act(async () => {
      root.render(<ChangesPanel cwd="/project" git={{ isRepo: true, files: [{ path: 'file.txt', status: 'M', staged: false, additions: 1, deletions: 0 }] }} onRefreshGit={onRefreshGit} />)
      await Promise.resolve()
    })
    act(() => {
      [...container.querySelectorAll<HTMLButtonElement>('.diff-header button')].find((button) => button.textContent?.includes('Undo changes'))!.click()
    })
    expect(document.body.textContent).toContain('This discards the staged and unstaged changes')

    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('.modal__footer button')].find((button) => button.textContent === 'Undo changes')!.click()
      await Promise.resolve()
    })
    expect(restore).toHaveBeenCalledWith('/project', ['file.txt'])
    expect(onRefreshGit).toHaveBeenCalledTimes(1)
  })

  it('disables mutating controls and offers an explicit grant for read-only projects', async () => {
    const onGrantProject = vi.fn(async () => undefined)
    const git = {
      isRepo: true,
      branch: 'main',
      files: [
        { path: 'file.txt', status: 'M', staged: false, additions: 1, deletions: 0 },
        { path: 'staged.txt', status: 'M', staged: true, additions: 1, deletions: 0 },
      ],
    }

    await act(async () => {
      root.render(<ChangesPanel git={git} readOnly onGrantProject={onGrantProject} onRefreshGit={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('read-only because it was discovered from session history')
    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === label)!
    expect(button('Stage').disabled).toBe(true)
    expect(button('Stage all').disabled).toBe(true)
    expect(button('Undo changes').disabled).toBe(true)
    expect(button('Commit').disabled).toBe(true)
    await act(async () => { button('Add project').click(); await Promise.resolve() })
    expect(onGrantProject).toHaveBeenCalledTimes(1)

    act(() => { button('Staged').click() })
    expect(button('Unstage').disabled).toBe(true)
    expect(button('Unstage all').disabled).toBe(true)
  })

  it('keeps mutating controls enabled for persisted projects', async () => {
    const git = {
      isRepo: true,
      branch: 'main',
      files: [
        { path: 'file.txt', status: 'M', staged: false, additions: 1, deletions: 0 },
        { path: 'staged.txt', status: 'M', staged: true, additions: 1, deletions: 0 },
      ],
    }

    await act(async () => {
      root.render(<ChangesPanel git={git} onRefreshGit={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === label)!
    expect(button('Stage').disabled).toBe(false)
    expect(button('Stage all').disabled).toBe(false)
    expect(button('Undo changes').disabled).toBe(false)
    expect(button('Commit').disabled).toBe(false)
    act(() => { button('Staged').click() })
    expect(button('Unstage').disabled).toBe(false)
    expect(button('Unstage all').disabled).toBe(false)
  })

  it('splits nested file paths into dimmed directory prefix and prominent basename', async () => {
    const git = {
      isRepo: true,
      branch: 'main',
      files: [{ path: 'src/components/inspector/ChangesPanel.tsx', status: 'M', staged: false, additions: 4, deletions: 2 }],
    }

    await act(async () => {
      root.render(<ChangesPanel git={git} onRefreshGit={vi.fn()} />)
      await Promise.resolve()
    })

    const label = container.querySelector<HTMLElement>('.file-changes .changes-file-path')!
    expect(label.getAttribute('title')).toBe('src/components/inspector/ChangesPanel.tsx')
    expect(label.querySelector('i')?.textContent).toBe('src/components/inspector/')
    expect(label.querySelector('b')?.textContent).toBe('ChangesPanel.tsx')
  })

  it('allocates a conversation-first initial inspector width while respecting saved widths', async () => {
    window.localStorage.removeItem('prime-work.inspector-width')
    window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false })) as unknown as typeof window.matchMedia
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver

    let latestWidth = 0
    function Harness({ rowWidth }: { rowWidth: number }) {
      const layout = usePanelLayout({
        sidebarOpen: true,
        setSidebarOpen: vi.fn(),
        inspectorOpen: true,
        setInspectorOpen: vi.fn(),
        closeSmallestPanels: vi.fn(),
        terminalOpen: false,
        view: 'session',
      })
      latestWidth = layout.inspectorWidth
      return (
        <div ref={(node) => {
          layout.sessionWorkspaceRef.current = node
        }}>
          <div ref={(node) => {
            if (node) Object.defineProperty(node, 'clientWidth', { configurable: true, value: rowWidth })
            layout.workspaceRowRef.current = node
          }} />
        </div>
      )
    }

    await act(async () => {
      root.render(<Harness rowWidth={790} />)
    })
    expect(latestWidth).toBeGreaterThanOrEqual(INSPECTOR_MIN)
    expect(latestWidth).toBeLessThanOrEqual(INSPECTOR_DEFAULT)
    expect(latestWidth).toBe(348)

    await act(async () => root.unmount())
    root = createRoot(container)
    window.localStorage.setItem('prime-work.inspector-width', '480')

    await act(async () => {
      root.render(<Harness rowWidth={1000} />)
    })
    expect(latestWidth).toBe(480)
    window.localStorage.removeItem('prime-work.inspector-width')
  })

  it('ignores stale diff responses and prevents opening commit and undo modals simultaneously', () => {
    const actor = createActor(changesPanelMachine, { input: { initialSelectedPath: 'a.ts' } }).start()
    actor.send({ type: 'DIFF_LOAD_START', requestId: 1 })
    actor.send({ type: 'DIFF_LOAD_START', requestId: 2 })
    actor.send({ type: 'DIFF_LOAD_SUCCESS', requestId: 1, diff: 'stale diff' })
    expect(actor.getSnapshot().matches({ diffView: 'loading' })).toBe(true)
    expect(actor.getSnapshot().context.diff).toBe('')

    actor.send({ type: 'DIFF_LOAD_SUCCESS', requestId: 2, diff: 'fresh diff' })
    expect(actor.getSnapshot().matches({ diffView: 'loaded' })).toBe(true)
    expect(actor.getSnapshot().context.diff).toBe('fresh diff')

    actor.send({ type: 'OPEN_COMMIT' })
    expect(actor.getSnapshot().matches({ modal: 'commit' })).toBe(true)
    actor.send({ type: 'OPEN_CONFIRM_UNDO', path: 'a.ts' })
    expect(actor.getSnapshot().matches({ modal: 'commit' })).toBe(true)
    expect(actor.getSnapshot().context.confirmUndoTarget).toBeNull()

    actor.send({ type: 'CLOSE_MODAL' })
    actor.send({ type: 'OPEN_CONFIRM_UNDO', path: 'a.ts' })
    expect(actor.getSnapshot().matches({ modal: 'confirmUndo' })).toBe(true)
    actor.send({ type: 'OPEN_COMMIT' })
    expect(actor.getSnapshot().matches({ modal: 'confirmUndo' })).toBe(true)
    actor.stop()
  })
})
