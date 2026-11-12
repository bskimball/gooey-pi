// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createAgentTurnHandle } from '../../apps/desktop/src/app/agentTurnMachine'
import { createWorkspaceActions, type WorkspaceActionsDeps } from '../../apps/desktop/src/hooks/useWorkspaceActions'
import { readComposerDraft, saveComposerDraft } from '../../apps/desktop/src/lib/composer-draft'
import type { ProjectRecord, SessionRecord } from '../../apps/desktop/src/types/api'

const project: ProjectRecord = {
  id: 'project', harness: 'pi', name: 'Project', path: '/project', folders: ['/project'], primaryFolder: '/project',
  pinned: false, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', sessionCount: 1,
}

const other: ProjectRecord = {
  ...project,
  id: 'other',
  name: 'Other',
  path: '/other',
  folders: ['/other'],
  primaryFolder: '/other',
}

const session: SessionRecord = {
  id: 'session', harness: 'pi', filePath: '/sessions/session.jsonl', projectPath: '/project', title: 'Session',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'idle', depth: 0,
}

describe('selectProject workspace resume', () => {
  it('returns to the current unsent project chat instead of replacing it with the latest session', async () => {
    const activateWorkspace = vi.fn(() => 2)
    const setView = vi.fn()
    const actions = createWorkspaceActions(() => ({
      layout: { compactLayout: false, setSmallestSidebarAllowed: vi.fn() },
      settingsState: { setSidebarOpen: vi.fn() },
      sessions: [session],
      workspace: {
        workspaceRef: { current: { project, session: undefined, generation: 1 } },
        activateWorkspace,
        reconcileRuntime: vi.fn(),
      },
      setView,
      setSessions: vi.fn(),
      clearSessionAttention: vi.fn(),
      reportError: vi.fn(),
      bridge: { projects: { touch: vi.fn() } },
    } as unknown as WorkspaceActionsDeps))

    await actions.selectProject(project)

    expect(setView).toHaveBeenCalledWith('session')
    expect(activateWorkspace).not.toHaveBeenCalled()
  })

  it('still activates a different project', async () => {
    const activateWorkspace = vi.fn(() => 2)
    const reconcileRuntime = vi.fn()
    const setProjects = vi.fn()
    const actions = createWorkspaceActions(() => ({
      layout: { compactLayout: false, setSmallestSidebarAllowed: vi.fn() },
      settingsState: { setSidebarOpen: vi.fn() },
      sessions: [],
      workspace: {
        workspaceRef: { current: { project, session: undefined, generation: 1 } },
        activateWorkspace,
        reconcileRuntime,
      },
      setView: vi.fn(),
      setProjects,
      setSessions: vi.fn(),
      clearSessionAttention: vi.fn(),
      reportError: vi.fn(),
      bridge: { projects: { touch: vi.fn() } },
    } as unknown as WorkspaceActionsDeps))

    await actions.selectProject(other)

    expect(activateWorkspace).toHaveBeenCalledWith(other, undefined)
    expect(reconcileRuntime).toHaveBeenCalledWith(2)
    expect(setProjects).toHaveBeenCalledOnce()
  })

  it('clears an unsent project draft when explicitly starting a new session', () => {
    saveComposerDraft('project:new', { text: '/plan ' })
    const activateWorkspace = vi.fn()
    let catalog = [project]
    const actions = createWorkspaceActions(() => ({
      bridge: null,
      initialized: true,
      activeProject: project,
      layout: { compactLayout: false, setSmallestSidebarAllowed: vi.fn() },
      settingsState: { setSidebarOpen: vi.fn() },
      workspace: {
        workspaceRef: { current: { project, session: undefined, generation: 1 } },
        activateWorkspace,
        setMessages: vi.fn(),
      },
      setView: vi.fn(),
      setPaletteOpen: vi.fn(),
      setProjects: (update: React.SetStateAction<ProjectRecord[]>) => { catalog = typeof update === 'function' ? update(catalog) : update },
      reportError: vi.fn(),
    } as unknown as WorkspaceActionsDeps))

    actions.newSession(project)

    expect(readComposerDraft('project:new')).toBeNull()
    expect(activateWorkspace).toHaveBeenCalledWith(project)
    expect(Date.parse(catalog[0].lastOpenedAt)).toBeGreaterThan(Date.parse(project.lastOpenedAt))
  })

  it('claims the displayed activeProject via activateWorkspace when sendPrompt runs before startup sessions resolve', async () => {
    const startedRuntime = { runtimeId: 'started-runtime', harness: 'pi' as const, cwd: project.primaryFolder, isStreaming: false }
    const command = vi.fn(async (_runtimeId: string, payload: { type: string }) => {
      if (payload.type === 'get_commands') {
        return { type: 'response', success: true, data: { commands: [{ name: 'mode', source: 'extension' }] } }
      }
      return { type: 'response', success: true }
    })
    const start = vi.fn(async () => startedRuntime)
    const stop = vi.fn(async () => true)
    const bridge = {
      agent: { list: vi.fn(async () => [startedRuntime]), start, stop, command },
      projects: { grantInferred: vi.fn(async () => project) },
    }
    const workspaceRef = { current: { generation: 0 } as { generation: number; project?: ProjectRecord; session?: SessionRecord; cwd?: string; sessionFile?: string } }
    const runtimeIdRef = { current: null as string | null }
    const runtimeOwnerRef = { current: null as { runtimeId: string; generation: number } | null }
    const activateWorkspace = vi.fn((nextProject?: ProjectRecord, nextSession?: SessionRecord) => {
      const generation = workspaceRef.current.generation + 1
      workspaceRef.current = { generation, project: nextProject, session: nextSession, cwd: nextProject?.primaryFolder, sessionFile: nextSession?.filePath }
      return generation
    })
    const attachRuntime = vi.fn((nextRuntime: typeof startedRuntime | undefined, generation: number) => {
      runtimeIdRef.current = nextRuntime?.runtimeId ?? null
      runtimeOwnerRef.current = nextRuntime ? { runtimeId: nextRuntime.runtimeId, generation } : null
    })
    const reportError = vi.fn()
    const actions = createWorkspaceActions(() => ({
      bridge,
      initialized: true,
      projects: [project],
      sessions: [],
      activeProject: project,
      workspace: {
        runtime: null,
        runtimeIdRef,
        runtimeOwnerRef,
        workspaceRef,
        activateWorkspace,
        attachRuntime,
        prepareForPrompt: (generation: number) => workspaceRef.current.generation === generation,
        setMessages: vi.fn(),
      },
      settingsState: { settings: { activeHarness: 'pi' } },
      provider: { model: 'openai-codex/gpt-5.6', effort: 'medium', fast: false, flushPendingMutations: vi.fn() },
      agentTurn: createAgentTurnHandle(),
      demoTimerRef: { current: [] },
      setSessions: vi.fn(),
      setSubmitting: vi.fn(),
      setToast: vi.fn(),
      reportError,
    } as unknown as WorkspaceActionsDeps))

    await actions.sendPrompt('/mode apex')

    expect(reportError).not.toHaveBeenCalled()
    expect(activateWorkspace).toHaveBeenCalledWith(project, undefined)
    expect(workspaceRef.current.generation).toBe(1)
    expect(start).toHaveBeenCalledOnce()
    expect(stop).not.toHaveBeenCalled()
    expect(command).toHaveBeenCalledWith('started-runtime', { type: 'prompt', message: '/mode apex' })
  })
})
