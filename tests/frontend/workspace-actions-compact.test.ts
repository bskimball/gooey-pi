import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceActions, type WorkspaceActionsDeps } from '../../src/hooks/useWorkspaceActions'
import type { PrimeWorkApi, RuntimeInfo, SessionRecord, TranscriptMessage } from '../../src/types/api'

const baseProject = {
  id: 'compact-project',
  harness: 'pi' as const,
  name: 'Compact project',
  path: '/compact-project',
  folders: ['/compact-project'],
  primaryFolder: '/compact-project',
  pinned: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
  sessionCount: 1,
}

const session = (status: SessionRecord['status'] = 'idle'): SessionRecord => ({
  id: 'compact-session',
  harness: 'pi',
  filePath: '/compact-project/session.jsonl',
  projectPath: '/compact-project',
  title: 'Compact session',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  status,
  depth: 0,
})

const runtime = (runtimeId = 'idle-runtime', isStreaming = false): RuntimeInfo => ({
  runtimeId,
  harness: 'pi',
  cwd: baseProject.primaryFolder,
  sessionFile: session().filePath,
  isStreaming,
})

interface FixtureOptions {
  runtime?: RuntimeInfo | null
  sessionStatus?: SessionRecord['status']
  ownsStreaming?: boolean
  withSession?: boolean
  harness?: 'pi'
  /** Pi `get_commands` listing; omitted means the runtime reports none. */
  commands?: Array<{ name: string; source: string }>
  startError?: Error
  flushPendingMutations?(runtime?: RuntimeInfo): Promise<void>
}

function fixture({ runtime: configuredRuntime = null, sessionStatus = 'idle', ownsStreaming = false, withSession = true, harness = 'pi', commands = [], startError, flushPendingMutations }: FixtureOptions = {}) {
  const project = { ...baseProject, harness }
  if (configuredRuntime) configuredRuntime = { ...configuredRuntime, harness }
  let currentRuntime = configuredRuntime
  let messages: TranscriptMessage[] = []
  const currentSession = withSession ? { ...session(sessionStatus), harness } : undefined
  const workspaceRef: { current: { generation: number; project: typeof project; session: SessionRecord | undefined; cwd: string; sessionFile: string | undefined } } = {
    current: {
      generation: 1,
      project,
      session: currentSession,
      cwd: project.primaryFolder,
      sessionFile: currentSession?.filePath,
    },
  }
  const runtimeIdRef = { current: ownsStreaming && configuredRuntime ? configuredRuntime.runtimeId : null as string | null }
  const runtimeOwnerRef = {
    current: ownsStreaming && configuredRuntime
      ? { runtimeId: configuredRuntime.runtimeId, generation: 1 }
      : null as { runtimeId: string; generation: number } | null,
  }
  const command = vi.fn(async (_runtimeId: string, request: Record<string, unknown>): Promise<Record<string, unknown>> => request.type === 'get_commands' ? { data: { commands } } : {})
  const start = vi.fn(async (): Promise<RuntimeInfo> => {
    if (startError) throw startError
    return { ...runtime('started-runtime'), harness }
  })
  const followUp = vi.fn(async () => true)
  const queuePrompt = vi.fn()
  const setToast = vi.fn()
  const reportError = vi.fn()
  const workspace = {
    runtime: currentRuntime,
    workspaceRef,
    runtimeIdRef,
    runtimeOwnerRef,
    prepareForPrompt: () => true,
    activateWorkspace: (nextProject: typeof project) => {
      workspaceRef.current = { generation: workspaceRef.current.generation + 1, project: nextProject, cwd: nextProject.primaryFolder, session: undefined, sessionFile: undefined }
      messages = []
      return workspaceRef.current.generation
    },
    adoptCreatedSession: (created: SessionRecord, generation: number) => {
      if (workspaceRef.current.generation === generation) workspaceRef.current = { ...workspaceRef.current, session: created, sessionFile: created.filePath }
    },
    attachRuntime: (next: RuntimeInfo | undefined, generation = workspaceRef.current.generation) => {
      if (workspaceRef.current.generation !== generation) return
      currentRuntime = next ?? null
      runtimeIdRef.current = next?.runtimeId ?? null
      runtimeOwnerRef.current = next ? { runtimeId: next.runtimeId, generation } : null
    },
    setRuntime: (next: RuntimeInfo | ((current: RuntimeInfo | null) => RuntimeInfo | null)) => {
      currentRuntime = typeof next === 'function' ? next(currentRuntime) : next
    },
    setMessages: (next: TranscriptMessage[] | ((current: TranscriptMessage[]) => TranscriptMessage[])) => {
      messages = typeof next === 'function' ? next(messages) : next
    },
    queuePrompt,
    removeQueuedPrompt: vi.fn(),
    markQueuedPromptFlushFailed: vi.fn(),
  }
  const agentList = vi.fn(async () => configuredRuntime ? [configuredRuntime] : [])
  const bridge = {
    projects: { touch: vi.fn(async () => true) },
    agent: { list: agentList, command, start, stop: vi.fn(async () => false) },
    sessions: { create: vi.fn(async () => session()), followUp, list: vi.fn(async () => []) },
  } as unknown as PrimeWorkApi
  let workspaceSessions = currentSession ? [currentSession] : []
  const actions = createWorkspaceActions(() => ({
    bridge,
    projects: [project],
    sessions: workspaceSessions,
    activeProject: project,
    workspace,
    settingsState: { settings: { activeHarness: harness } },
    provider: { model: 'auto', effort: 'medium', fast: false, flushPendingMutations },
    submissionAdmissionRef: { current: { active: false, run: async (task: () => Promise<void>) => { await task(); return true } } },
    initialized: true,
    layout: {},
    pluginSkills: {},
    gitRequestRef: { current: 0 },
    demoTimerRef: { current: [] },
    setProjects: vi.fn(),
    setSessions: (update: React.SetStateAction<SessionRecord[]>) => { workspaceSessions = typeof update === 'function' ? update(workspaceSessions) : update },
    setGitSnapshot: vi.fn(),
    setView: vi.fn(),
    setPaletteOpen: vi.fn(),
    setToast,
    setSubmitting: vi.fn(),
    refreshSchedules: vi.fn(),
    resetBrowserView: vi.fn(),
    closeTerminalForSession: vi.fn(),
    clearSessionAttention: vi.fn(),
    reportError,
  } as unknown as WorkspaceActionsDeps))

  return { actions, bridge, command, agentList, workspace, sessions: () => workspaceSessions, currentRuntime: () => currentRuntime, start, followUp, queuePrompt, setToast, reportError, messages: () => messages }
}

describe('optimistic session creation', () => {
  it('publishes a selectable session without starting Pi and sends the first prompt to its file', async () => {
    const state = fixture({ withSession: false })
    state.actions.newSession()
    await vi.waitFor(() => expect(state.sessions()).toHaveLength(1))
    expect(state.start).not.toHaveBeenCalled()
    expect(state.workspace.workspaceRef.current.sessionFile).toBe(session().filePath)
    await state.actions.sendPrompt('First prompt')
    expect(state.start).toHaveBeenCalledWith(expect.objectContaining({ sessionPath: session().filePath }))
    expect(state.command).toHaveBeenCalledWith('started-runtime', expect.objectContaining({ type: 'prompt', message: 'First prompt' }))
  })

  it('waits for file creation before sending and retains the session after startup failure', async () => {
    const state = fixture({ withSession: false, startError: new Error('Pi unavailable') })
    state.followUp.mockResolvedValue(false)
    let finish!: (created: SessionRecord) => void
    vi.mocked(state.bridge.sessions.create).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    state.actions.newSession()
    const sending = state.actions.sendPrompt('Keep this prompt')
    await vi.waitFor(() => expect(state.bridge.sessions.create).toHaveBeenCalled())
    expect(state.start).not.toHaveBeenCalled()
    finish(session())
    await expect(sending).rejects.toThrow('Pi unavailable')
    expect(state.sessions()).toHaveLength(1)
    expect(state.workspace.workspaceRef.current.sessionFile).toBe(session().filePath)
  })

  it('delivers an already-submitted first prompt after navigation during file creation', async () => {
    const state = fixture({ withSession: false })
    let finish!: (created: SessionRecord) => void
    vi.mocked(state.bridge.sessions.create).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    state.actions.newSession()
    const sending = state.actions.sendPrompt('Deliver to the original project')
    await vi.waitFor(() => expect(state.bridge.sessions.create).toHaveBeenCalled())
    state.workspace.activateWorkspace({ ...baseProject, id: 'other', path: '/other', primaryFolder: '/other', folders: ['/other'] })
    finish(session())
    await sending
    expect(state.start).toHaveBeenCalledWith(expect.objectContaining({ cwd: baseProject.path, sessionPath: session().filePath }))
    expect(state.command).toHaveBeenCalledOnce()
    expect(state.command).toHaveBeenCalledWith('started-runtime', expect.objectContaining({ type: 'prompt', message: 'Deliver to the original project' }))
    expect(state.workspace.workspaceRef.current.project.id).toBe('other')
    expect(state.workspace.workspaceRef.current.sessionFile).toBeUndefined()
    expect(state.currentRuntime()).toBeNull()
    expect(state.messages()).toEqual([])
  })

  it('does not steal navigation when creation finishes in the background', async () => {
    const state = fixture({ withSession: false })
    let finish!: (created: SessionRecord) => void
    vi.mocked(state.bridge.sessions.create).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    state.actions.newSession()
    await vi.waitFor(() => expect(state.bridge.sessions.create).toHaveBeenCalled())
    state.workspace.activateWorkspace(baseProject)
    finish(session())
    await vi.waitFor(() => expect(state.sessions()).toHaveLength(1))
    expect(state.workspace.workspaceRef.current.sessionFile).toBeUndefined()
    expect(state.start).not.toHaveBeenCalled()
  })
})

describe('first prompt navigation', () => {
  it('delivers from an unsaved existing runtime after navigation during its model flush', async () => {
    let resolveFlush!: () => void
    const flushPendingMutations = vi.fn(async (active?: RuntimeInfo) => {
      if (active) await new Promise<void>((resolve) => { resolveFlush = resolve })
    })
    const state = fixture({ withSession: false, runtime: runtime(), ownsStreaming: true, flushPendingMutations })
    const sending = state.actions.sendPrompt('First ordinary prompt after a mode command')
    await vi.waitFor(() => expect(flushPendingMutations).toHaveBeenCalledTimes(2))
    state.workspace.workspaceRef.current.generation += 1
    state.workspace.setMessages([])
    resolveFlush()
    await sending
    expect(state.command).toHaveBeenCalledWith('idle-runtime', expect.objectContaining({
      type: 'prompt', message: 'First ordinary prompt after a mode command',
    }))
    expect(state.start).not.toHaveBeenCalled()
    expect(state.messages()).toEqual([])
  })

  it('delivers a submitted prompt once even when navigation wins the startup race', async () => {
    const state = fixture({ withSession: false })
    let resolveStart!: (value: RuntimeInfo) => void
    state.start.mockImplementationOnce(() => new Promise((resolve) => { resolveStart = resolve }))
    const sending = state.actions.sendPrompt('Keep this long first prompt before any assistant response')
    await vi.waitFor(() => expect(state.start).toHaveBeenCalledOnce())
    state.workspace.workspaceRef.current.generation += 1
    state.workspace.setMessages([])
    resolveStart(runtime('started-runtime'))
    await sending
    expect(state.command).toHaveBeenCalledWith('started-runtime', expect.objectContaining({
      type: 'prompt', message: 'Keep this long first prompt before any assistant response',
    }))
    expect(state.bridge.agent.stop).not.toHaveBeenCalled()
    expect(state.currentRuntime()).toBeNull()
    expect(state.messages()).toEqual([])
  })
})

describe('/compact dispatch', () => {
  it('sends compact to an idle runtime without a prompt command or user message', async () => {
    const fixtureState = fixture({ runtime: runtime() })

    await fixtureState.actions.sendPrompt('/compact')

    expect(fixtureState.command).toHaveBeenCalledOnce()
    expect(fixtureState.command).toHaveBeenCalledWith('idle-runtime', { type: 'compact' })
    expect(fixtureState.command).not.toHaveBeenCalledWith('idle-runtime', expect.objectContaining({ type: 'prompt' }))
    expect(fixtureState.messages().filter((message) => message.role === 'user')).toHaveLength(0)
  })

  it('passes custom instructions to compact', async () => {
    const fixtureState = fixture({ runtime: runtime() })

    await fixtureState.actions.sendPrompt('/compact focus on auth')

    expect(fixtureState.command).toHaveBeenCalledWith('idle-runtime', { type: 'compact', customInstructions: 'focus on auth' })
  })

  it('queues compact for an owned streaming runtime', async () => {
    const fixtureState = fixture({ runtime: runtime('streaming-runtime', true), ownsStreaming: true })

    await fixtureState.actions.sendPrompt('/compact', [], 'steer')

    expect(fixtureState.command).not.toHaveBeenCalled()
    expect(fixtureState.queuePrompt).toHaveBeenCalledWith('/compact', 'queue')
    expect(fixtureState.setToast).toHaveBeenCalledWith('Compaction will run when the current turn finishes.')
  })

  it('does not start a runtime when there is nothing to compact', async () => {
    const fixtureState = fixture({ withSession: false })

    await fixtureState.actions.sendPrompt('/compact')

    expect(fixtureState.start).not.toHaveBeenCalled()
    expect(fixtureState.command).not.toHaveBeenCalled()
    expect(fixtureState.setToast).toHaveBeenCalledWith('Nothing to compact yet.')
  })

  it('does not follow up an externally running session', async () => {
    const fixtureState = fixture({ sessionStatus: 'running' })

    await fixtureState.actions.sendPrompt('/compact')

    expect(fixtureState.followUp).not.toHaveBeenCalled()
    expect(fixtureState.start).not.toHaveBeenCalled()
    expect(fixtureState.setToast).toHaveBeenCalledWith('Compaction is unavailable while this session is running outside Apex.')
  })

  it('rejects image attachments', async () => {
    const fixtureState = fixture({ runtime: runtime() })

    await fixtureState.actions.sendPrompt('/compact', [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }])

    expect(fixtureState.reportError).toHaveBeenCalledWith('/compact does not accept attachments. Remove the attachment and try again.')
    expect(fixtureState.command).not.toHaveBeenCalled()
    expect(fixtureState.start).not.toHaveBeenCalled()
  })

  it('queues compact for a non-owned streaming runtime instead of steering it', async () => {
    const fixtureState = fixture({ runtime: runtime('external-streaming-runtime', true) })

    await fixtureState.actions.sendPrompt('/compact', [], 'steer')

    expect(fixtureState.command).not.toHaveBeenCalled()
    expect(fixtureState.followUp).not.toHaveBeenCalled()
    expect(fixtureState.queuePrompt).toHaveBeenCalledWith('/compact', 'queue')
    expect(fixtureState.setToast).toHaveBeenCalledWith('Compaction will run when the current turn finishes.')
  })
})

describe('Pi /mode dispatch', () => {
  const modes = [{ name: 'mode', source: 'extension' }, { name: 'orchestrate', source: 'extension' }]

  it('sends /mode configure as a prompt only after Pi lists the extension command', async () => {
    const fixtureState = fixture({ harness: 'pi', runtime: runtime(), commands: modes })

    await fixtureState.actions.sendPrompt('/mode configure')

    expect(fixtureState.command.mock.calls.map(([, request]) => request)).toEqual([
      { type: 'get_commands' },
      { type: 'prompt', message: '/mode configure' },
      { type: 'get_state' },
    ])
  })

  it('refreshes Fusion A/high to restored Apex B/low after the mode command completes', async () => {
    const fusionRuntime: RuntimeInfo = { ...runtime(), harness: 'pi', model: { provider: 'provider', id: 'A' }, thinkingLevel: 'high' }
    const apexRuntime: RuntimeInfo = { ...fusionRuntime, model: { provider: 'provider', id: 'B' }, thinkingLevel: 'low' }
    const state = fixture({ harness: 'pi', runtime: fusionRuntime, commands: modes })
    let runtimeState = fusionRuntime
    let listedState = fusionRuntime
    state.agentList.mockImplementation(async () => [listedState])
    state.command.mockImplementation(async (_runtimeId, request) => {
      if (request.type === 'get_commands') return { data: { commands: modes } }
      if (request.type === 'prompt') {
        expect(request.message).toBe('/mode apex')
        // The extension restores Apex's selection, but the desktop's cached
        // RuntimeInfo still contains the pre-command Fusion lead selection.
        runtimeState = apexRuntime
      }
      if (request.type === 'get_state') listedState = runtimeState
      return {}
    })

    await state.actions.sendPrompt('/mode apex', [], 'queue')

    expect(state.currentRuntime()).toMatchObject({ model: { provider: 'provider', id: 'B' }, thinkingLevel: 'low' })
    expect(state.command.mock.calls.map(([, request]) => request)).toEqual([
      { type: 'get_commands' },
      { type: 'prompt', message: '/mode apex' },
      { type: 'get_state' },
    ])
    expect(state.agentList).toHaveBeenCalledTimes(2)
    expect(state.messages()).toEqual([])
  })

  it.each([
    ['prompt', 'workspace'], ['get_state', 'workspace'], ['list', 'workspace'],
    ['prompt', 'runtime'], ['get_state', 'runtime'], ['list', 'runtime'],
  ])('ignores a stale mode refresh suspended at %s after a %s switch', async (stage, switchKind) => {
    const original: RuntimeInfo = { ...runtime(), harness: 'pi', model: { provider: 'provider', id: 'A' }, thinkingLevel: 'high' }
    const restored: RuntimeInfo = { ...original, model: { provider: 'provider', id: 'B' }, thinkingLevel: 'low' }
    const replacement: RuntimeInfo = { ...original, runtimeId: 'replacement', model: { provider: 'provider', id: 'C' }, thinkingLevel: 'medium' }
    const state = fixture({ harness: 'pi', runtime: original, commands: modes })
    let release!: () => void
    let reached!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const suspended = new Promise<void>((resolve) => { reached = resolve })
    state.command.mockImplementation(async (_runtimeId, request) => {
      if (request.type === 'get_commands') return { data: { commands: modes } }
      if (request.type === stage) { reached(); await pending }
      return {}
    })
    state.agentList.mockResolvedValueOnce([original]).mockImplementation(async () => {
      if (stage === 'list') { reached(); await pending }
      return [restored]
    })
    const sending = state.actions.sendPrompt('/mode apex')
    await suspended
    if (switchKind === 'workspace') state.workspace.workspaceRef.current.generation += 1
    state.workspace.attachRuntime(replacement)
    release()
    await sending

    expect(state.currentRuntime()).toEqual(replacement)
    expect(state.workspace.runtimeIdRef.current).toBe('replacement')
    if (stage === 'prompt') expect(state.command).not.toHaveBeenCalledWith(original.runtimeId, { type: 'get_state' })
    if (stage !== 'list') expect(state.agentList).toHaveBeenCalledTimes(1)
  })

  it('sends no prompt and explains how to recover when the modes extension is absent', async () => {
    // A prompt template or skill with the same name is not the modes extension.
    const fixtureState = fixture({ harness: 'pi', runtime: runtime(), commands: [{ name: 'mode', source: 'prompt' }] })

    await expect(fixtureState.actions.sendPrompt('/mode configure')).rejects.toThrow('Pi has no /mode command in this session')

    expect(fixtureState.command).toHaveBeenCalledOnce()
    expect(fixtureState.command).toHaveBeenCalledWith('idle-runtime', { type: 'get_commands' })
    expect(fixtureState.messages().filter((message) => message.role === 'user')).toHaveLength(0)
    expect(fixtureState.messages().at(-1)?.parts).toEqual([{ type: 'text', text: expect.stringContaining('restart the session') }])
  })

  it('gates a freshly started runtime the same way', async () => {
    const fixtureState = fixture({ harness: 'pi', withSession: false })

    await expect(fixtureState.actions.sendPrompt('/orchestrate on')).rejects.toThrow('Pi has no /orchestrate command')

    expect(fixtureState.start).toHaveBeenCalledOnce()
    expect(fixtureState.command).toHaveBeenCalledWith('started-runtime', { type: 'get_commands' })
    expect(fixtureState.command).not.toHaveBeenCalledWith('started-runtime', expect.objectContaining({ type: 'prompt' }))
  })

  it('never follows up a mode command as session text when the runtime fails to start', async () => {
    const fixtureState = fixture({ harness: 'pi', startError: new Error('Pi failed to start') })

    await expect(fixtureState.actions.sendPrompt('/mode configure')).rejects.toThrow('Pi failed to start')

    expect(fixtureState.followUp).not.toHaveBeenCalled()
    expect(fixtureState.command).not.toHaveBeenCalled()
  })

  it('still follows up an ordinary prompt when the runtime fails to start', async () => {
    const fixtureState = fixture({ harness: 'pi', startError: new Error('Pi failed to start') })

    await fixtureState.actions.sendPrompt('hello')

    expect(fixtureState.followUp).toHaveBeenCalledWith('/compact-project/session.jsonl', 'hello', 'queue')
  })

  it('prompts ordinary text without a command lookup', async () => {
    const fixtureState = fixture({ harness: 'pi', runtime: runtime() })

    await fixtureState.actions.sendPrompt('hello')

    expect(fixtureState.command).toHaveBeenCalledOnce()
    expect(fixtureState.command).toHaveBeenCalledWith('idle-runtime', expect.objectContaining({ type: 'prompt', message: 'hello' }))
  })
})
