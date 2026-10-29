// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activityNotificationSignature, sessionShowsCompanionNotification } from '../../apps/desktop/src/app/session-attention'
import { type SessionLiveMap } from '../../apps/desktop/src/app/session-live'
import { createWorkspaceActions, type WorkspaceActionsDeps } from '../../apps/desktop/src/hooks/useWorkspaceActions'
import { ActivityStatusPill } from '../../apps/desktop/src/components/activity/ActivityStatusPill'
import { ActivityPage } from '../../apps/desktop/src/pages/ActivityPage'
import type { ProjectRecord, SessionRecord, TranscriptMessage } from '../../apps/desktop/src/types/api'

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
  it('never renders archived chats in Activity', async () => {
    const onOpen = vi.fn()
    await act(async () => {
      root.render(<ActivityPage sessions={[activeSession, archivedSession]} projects={[project]} clearedActivity={{}} onOpen={onOpen} onClear={vi.fn()} />)
    })

    expect(container.textContent).toContain('Active chat')
    expect(container.textContent).not.toContain('Archived chat')
    expect(container.querySelector('[aria-label="Activity filter"]')).toBeNull()

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

  it('suppresses notifications from sessions that are already archived', () => {
    expect(sessionShowsCompanionNotification(archivedSession)).toBe(false)
  })

  it('acknowledges and clears unread state when archiving succeeds', async () => {
    const archive = vi.fn(async () => true)
    const clearSessionAttention = vi.fn()
    const closeTerminalForSession = vi.fn()
    const setToast = vi.fn()
    let sessions = [activeSession]
    const setSessions = vi.fn((update: (items: SessionRecord[]) => SessionRecord[]) => { sessions = update(sessions) })
    const actions = createWorkspaceActions(() => ({
      bridge: { sessions: { archive } },
      workspace: { workspaceRef: { current: { session: undefined } } },
      setSessions,
      setToast,
      closeTerminalForSession,
      clearSessionAttention,
      reportError: vi.fn(),
    } as unknown as WorkspaceActionsDeps))

    await actions.setSessionArchived(activeSession, true)

    expect(archive).toHaveBeenCalledWith(activeSession.filePath, true)
    expect(clearSessionAttention).toHaveBeenCalledWith(activeSession)
    expect(closeTerminalForSession).toHaveBeenCalledWith(activeSession.filePath)
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
      closeTerminalForSession: vi.fn(),
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

    // Default selection picks first of Needs you
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
