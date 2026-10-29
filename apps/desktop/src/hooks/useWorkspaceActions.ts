import { useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { requestFailureMessage } from '@/app/workspace'
import { clearComposerDraft } from '@/lib/composer-draft'
import { errorMessage } from '@/lib/errors'
import { startWorkspaceRuntime } from '@/lib/runtime-start'
import { HARNESS_AGENT_NAMES, hasPiExtensionCommand, parsePiModeCommand, piModeFromCommand, savePiBehaviorMode } from '@/lib/harness'
import { parseBashCommand, parseCompactCommand, parseMcpCommand } from '@/lib/composer-commands'
import { runBashCommand, runExtensionCommandNow } from '@/lib/runtime-commands'
import { parseSessionActionSnapshot, streamingBehaviorForIntent } from '@/lib/session-actions'
import type { DEFAULT_SETTINGS } from '@/lib/data'
import { type createSingleFlightAdmission, findProjectForSession, findRuntimeForWorkspace, newSessionProject, projectContainsPath, workspaceCwd } from '@/lib/workspace'
import type { CapabilityMutationInput, ExtensionInstallInput, GitStatus, InspectorTab, McpConnectionInput, McpStateInput, PrimeWorkApi, ProjectRecord, ProjectSortMode, PromptDeliveryIntent, PromptImage, ScheduleInput, SchedulePatch, SessionRecord, TranscriptMessage, WorkspaceView } from '@/types/api'
import type { useAppSettings } from '@/hooks/useAppSettings'
import type { usePanelLayout } from '@/hooks/usePanelLayout'
import type { usePluginSkills } from '@/hooks/usePluginSkills'
import type { useProviderCatalog } from '@/hooks/useProviderCatalog'
import type { useWorkspaceRuntime } from '@/hooks/useWorkspaceRuntime'
import { mergeSessionCatalog } from '@/hooks/useBootstrap'
import { resolveRuntimeIdForSession } from '@/hooks/useSessionLive'

export interface WorkspaceActionsDeps {
  bridge: PrimeWorkApi | null
  initialized: boolean
  projects: ProjectRecord[]
  sessions: SessionRecord[]
  activeProject: ProjectRecord | undefined
  workspace: ReturnType<typeof useWorkspaceRuntime>
  settingsState: ReturnType<typeof useAppSettings>
  layout: ReturnType<typeof usePanelLayout>
  provider: ReturnType<typeof useProviderCatalog>
  pluginSkills: ReturnType<typeof usePluginSkills>
  submissionAdmissionRef: MutableRefObject<ReturnType<typeof createSingleFlightAdmission>>
  gitRequestRef: MutableRefObject<number>
  demoTimerRef: MutableRefObject<number[]>
  setProjects: Dispatch<SetStateAction<ProjectRecord[]>>
  setSessions: Dispatch<SetStateAction<SessionRecord[]>>
  setGitSnapshot: Dispatch<SetStateAction<{ cwd: string | undefined; status: GitStatus }>>
  setView: Dispatch<SetStateAction<WorkspaceView>>
  setPaletteOpen: Dispatch<SetStateAction<boolean>>
  setToast: Dispatch<SetStateAction<string | null>>
  setSubmitting: Dispatch<SetStateAction<boolean>>
  refreshSchedules(): Promise<void>
  resetBrowserView(): void
  closeTerminalForSession(sessionPath: string): void
  clearSessionAttention(session: SessionRecord): void
  reportError(error: unknown): void
}

interface StartedSessionIndexInput {
  bridge: PrimeWorkApi
  harness: ProjectRecord['harness']
  sessionFile: string | undefined
  setSessions: Dispatch<SetStateAction<SessionRecord[]>>
  isCurrent?(): boolean
}

export async function indexStartedSession({ bridge, harness, sessionFile, setSessions, isCurrent }: StartedSessionIndexInput): Promise<SessionRecord | undefined> {
  if (!sessionFile) return
  // Publish only this session, so a delayed scan cannot replace newer catalog
  // entries belonging to other submissions.
  const catalog = await bridge.sessions.list(undefined, true, harness, true)
  const indexedSession = catalog.find((session) => session.filePath === sessionFile)
  if (isCurrent && !isCurrent()) return indexedSession
  if (indexedSession) {
    setSessions((current) => {
      const previous = current.find((session) => session.filePath === sessionFile)
      if (!previous) return [...current, indexedSession]
      if (Date.parse(previous.updatedAt) > Date.parse(indexedSession.updatedAt)) return current
      const [merged] = mergeSessionCatalog([previous], [indexedSession], undefined, new Map(), 0)
      return current.map((session) => session.filePath === sessionFile ? merged : session)
    })
  }
  return indexedSession
}

/**
 * The workspace mutation handlers, extracted from App. Every callback has a
 * stable identity (created once) and dispatches against the latest render's
 * dependencies, mirroring useStableCallback/useSidebarActions semantics.
 */
export function createWorkspaceActions(getDeps: () => WorkspaceActionsDeps) {
  let pendingCreation: { generation: number; promise: Promise<SessionRecord> } | undefined
  const createdSessionFiles = new Set<string>()
  const grantProject = async (project: ProjectRecord): Promise<ProjectRecord> => {
    const { bridge, workspace, setProjects, gitRequestRef, setGitSnapshot } = getDeps()
    if (!bridge || !project.inferred) return project
    const granted = await bridge.projects.grantInferred(project.primaryFolder, project.harness)
    setProjects((items) => items.map((item) => item.id === project.id ? granted : item))
    const selected = workspace.workspaceRef.current
    if (selected.project?.id !== project.id) return granted
    workspace.workspaceRef.current = { ...selected, project: granted, cwd: workspaceCwd(granted, selected.session) }
    const requestId = ++gitRequestRef.current
    const cwd = workspaceCwd(granted, selected.session)
    if (!cwd) return granted
    const nextGit = await bridge.git.status(cwd)
    if (gitRequestRef.current === requestId && workspace.workspaceRef.current.generation === selected.generation && workspace.workspaceRef.current.cwd === cwd) setGitSnapshot({ cwd, status: nextGit })
    return granted
  }
  const touchProject = async (project: ProjectRecord) => {
    const { bridge, setProjects } = getDeps()
    const lastOpenedAt = new Date().toISOString()
    setProjects((items) => items.map((item) => item.id === project.id ? { ...item, lastOpenedAt } : item))
    // Inferred projects stay display-only until an action needs a filesystem grant.
    if (bridge && !project.inferred) await bridge.projects.touch(project.id, project.harness)
  }
  const persistPanel = (patch: Partial<typeof DEFAULT_SETTINGS>) => { void getDeps().settingsState.updateSettings(patch) }
  const toggleSidebar = () => {
    const { settingsState, layout } = getDeps()
    const next = !(settingsState.sidebarOpen && !layout.sidebarSuppressed)
    layout.setSmallestSidebarAllowed(next)
    layout.compactRestoreRef.current = null
    if (layout.compactLayout && next && settingsState.inspectorOpen) {
      layout.setSmallestInspectorAllowed(false)
      settingsState.setInspectorOpen(false)
    }
    persistPanel({ sidebarOpen: next })
  }
  const toggleInspector = () => {
    const { settingsState, layout } = getDeps()
    const next = !(settingsState.inspectorOpen && !layout.inspectorSuppressed)
    layout.setSmallestInspectorAllowed(next)
    layout.compactRestoreRef.current = null
    if (layout.compactLayout && next && settingsState.sidebarOpen) {
      layout.setSmallestSidebarAllowed(false)
      settingsState.setSidebarOpen(false)
    }
    persistPanel({ inspectorOpen: next })
  }
  const toggleTerminal = async () => {
    const { settingsState, activeProject, reportError } = getDeps()
    if (!settingsState.terminalOpen && activeProject?.inferred) {
      try { await grantProject(activeProject) } catch (error) { reportError(error); return }
    }
    persistPanel({ terminalOpen: !settingsState.terminalOpen })
  }
  const selectProject = async (project: ProjectRecord) => {
    const { layout, settingsState, sessions, workspace, setSessions, setView, clearSessionAttention, reportError } = getDeps()
    if (layout.compactLayout) { layout.setSmallestSidebarAllowed(false); settingsState.setSidebarOpen(false) }
    if (workspace.workspaceRef.current.project?.id === project.id) {
      setView('session')
      return
    }
    const session = sessions.find((candidate) => !candidate.archived && projectContainsPath(project, candidate.projectPath))
    if (session) {
      clearSessionAttention(session)
      setSessions((items) => items.map((item) => item.id === session.id ? { ...item, unread: false } : item))
    }
    const generation = workspace.activateWorkspace(project, session)
    setView('session')
    try {
      await touchProject(project)
      await workspace.reconcileRuntime(generation)
    } catch (error) { if (workspace.workspaceRef.current.generation === generation) reportError(error) }
  }
  const selectSession = async (session: SessionRecord) => {
    const { layout, settingsState, projects, workspace, setSessions, setView, clearSessionAttention, reportError } = getDeps()
    if (layout.compactLayout) { layout.setSmallestSidebarAllowed(false); settingsState.setSidebarOpen(false) }
    clearSessionAttention(session)
    setSessions((items) => items.map((item) => item.id === session.id ? { ...item, unread: false } : item))
    const project = findProjectForSession(projects, session)
    if (!project) { reportError('This session is not contained by an available project.'); return }
    const generation = workspace.activateWorkspace(project, session)
    setView('session')
    try { await touchProject(project); await workspace.reconcileRuntime(generation) }
    catch (error) { if (workspace.workspaceRef.current.generation === generation) reportError(error) }
  }
  const newSession = (requestedProject?: ProjectRecord) => {
    const { bridge, initialized, layout, settingsState, activeProject, workspace, setSessions, setView, setPaletteOpen, reportError } = getDeps()
    if (!initialized) return
    const project = newSessionProject(requestedProject, workspace.workspaceRef.current.project, activeProject)
    if (!project) return
    if (layout.compactLayout) { layout.setSmallestSidebarAllowed(false); settingsState.setSidebarOpen(false) }
    clearComposerDraft(`${project.id}:new`)
    const generation = workspace.activateWorkspace(project)
    if (!bridge) workspace.setMessages([])
    setView('session'); setPaletteOpen(false)
    void touchProject(project).catch(reportError)
    if (!bridge) return
    const promise = (async () => {
      const granted = await grantProject(project)
      const session = await bridge.sessions.create(granted.primaryFolder, granted.harness)
      createdSessionFiles.add(session.filePath)
      setSessions((items) => items.some((item) => item.filePath === session.filePath) ? items : [...items, session])
      workspace.adoptCreatedSession(session, generation)
      return session
    })()
    pendingCreation = { generation, promise }
    void promise.catch(reportError).finally(() => {
      if (pendingCreation?.promise === promise) pendingCreation = undefined
    })
  }
  const navigate = (nextView: WorkspaceView) => {
    const { layout, settingsState, setView, setPaletteOpen } = getDeps()
    if (layout.compactLayout) { layout.setSmallestSidebarAllowed(false); settingsState.setSidebarOpen(false) }
    setView(nextView); setPaletteOpen(false)
  }
  const renameSession = async (session: SessionRecord, title: string) => {
    const { bridge, settingsState, setSessions, setToast, reportError } = getDeps()
    if (!bridge) return
    try {
      if (!await bridge.sessions.rename(session.filePath, title)) throw new Error(`${HARNESS_AGENT_NAMES[settingsState.settings.activeHarness]} could not rename this session.`)
      setSessions((items) => items.map((item) => item.id === session.id ? { ...item, title } : item)); setToast('Session renamed.')
    } catch (error) { reportError(error) }
  }
  const setSessionArchived = async (session: SessionRecord, archived: boolean) => {
    const { bridge, workspace, setSessions, setToast, resetBrowserView, closeTerminalForSession, clearSessionAttention, reportError } = getDeps()
    if (!bridge) return
    try {
      await bridge.sessions.archive(session.filePath, archived)
      if (archived) {
        clearSessionAttention(session)
        closeTerminalForSession(session.filePath)
      }
      setSessions((items) => items.map((item) => item.id === session.id ? { ...item, archived, unread: archived ? false : item.unread } : item))
      if (archived && workspace.workspaceRef.current.session?.id === session.id) {
        resetBrowserView()
        newSession()
      }
      setToast(archived ? 'Session archived.' : 'Session restored.')
    } catch (error) { reportError(error) }
  }
  const addProject = async () => {
    const { bridge, workspace, setProjects, setView, setToast, settingsState, reportError } = getDeps()
    if (!bridge) { setToast('Project picker is available in the desktop app.'); return }
    try {
      const project = await bridge.projects.add(settingsState.settings.activeHarness)
      if (project) { setProjects((items) => [project, ...items.filter((item) => item.id !== project.id)]); workspace.activateWorkspace(project); setView('session') }
    } catch (error) { reportError(error) }
  }
  const removeProject = async (project: ProjectRecord) => {
    const { bridge, projects, sessions, workspace, setProjects, setToast, reportError } = getDeps()
    try {
      if (bridge && !await bridge.projects.remove(project.id, project.harness)) throw new Error('This project could not be removed.')
      setProjects((items) => items.filter((item) => item.id !== project.id))
      if (workspace.workspaceRef.current.project?.id === project.id) {
        const fallback = projects.find((item) => item.id !== project.id)
        const session = fallback ? sessions.find((candidate) => !candidate.archived && projectContainsPath(fallback, candidate.projectPath)) : undefined
        workspace.activateWorkspace(fallback, session)
      }
      setToast('Project removed. Files and saved sessions were kept.')
    } catch (error) { reportError(error) }
  }
  const togglePinProject = async (project: ProjectRecord) => {
    const { bridge, setProjects, setToast, reportError } = getDeps()
    if (project.inferred) { setToast('Add this project before pinning it.'); return }
    if (!bridge) { setToast('Project pinning is available in the desktop app.'); return }
    try {
      if (!await bridge.projects.setPinned(project.id, !project.pinned, project.harness)) throw new Error('This project could not be pinned.')
      setProjects((items) => items.map((item) => item.id === project.id ? { ...item, pinned: !project.pinned } : item))
    } catch (error) { reportError(error) }
  }
  const setProjectSortMode = (mode: ProjectSortMode) => {
    void getDeps().settingsState.updateSettings({ projectSortMode: mode })
  }

  const sendPrompt = async (
    prompt: string,
    images: PromptImage[] = [],
    intent: PromptDeliveryIntent = 'queue',
    queuedFlushPromptId?: string,
  ) => {
    const creation = pendingCreation
    const { bridge, sessions, workspace, provider, settingsState, submissionAdmissionRef, demoTimerRef, setSessions, setSubmitting, setToast, reportError } = getDeps()
    const commandHarness = workspace.workspaceRef?.current?.project?.harness ?? settingsState.settings.activeHarness
    const compactCommand = parseCompactCommand(prompt)
    const modeCommand = parsePiModeCommand(prompt, commandHarness)
    const mcpCommand = parseMcpCommand(prompt, commandHarness)
    const bashCommand = parseBashCommand(prompt)
    if (mcpCommand?.type === 'authenticate') {
      const target = mcpCommand.server ? ` to sign in to ${mcpCommand.server}` : ' to authenticate network MCP servers'
      setToast(`Network MCP authentication is managed outside Apex. Use ${HARNESS_AGENT_NAMES[commandHarness]} directly${target}.`)
      return
    }
    if (compactCommand && images.length > 0) {
      reportError('/compact does not accept attachments. Remove the attachment and try again.')
      return
    }
    if ((modeCommand || bashCommand) && images.length > 0) {
      reportError(`${modeCommand ? '/mode' : '! commands'} ${modeCommand ? 'does' : 'do'} not accept attachments. Remove the attachment and try again.`)
      return
    }
    const currentWorkspace = workspace.workspaceRef.current
    const currentRuntime = workspace.runtime
    const currentOwner = workspace.runtimeOwnerRef.current
    const ownsCurrentRuntime = () => Boolean(
      currentRuntime && workspace.workspaceRef.current.generation === currentWorkspace.generation
      && workspace.runtimeIdRef.current === currentRuntime.runtimeId && workspace.runtimeOwnerRef.current?.runtimeId === currentRuntime.runtimeId
      && workspace.runtimeOwnerRef.current.generation === currentWorkspace.generation,
    )
    const ownsStreamingRuntime = Boolean(
      bridge && currentRuntime && (currentRuntime.isStreaming || submissionAdmissionRef.current.active)
      && currentOwner?.runtimeId === currentRuntime.runtimeId && ownsCurrentRuntime(),
    )
    const completeQueuedFlush = () => {
      if (queuedFlushPromptId) workspace.removeQueuedPrompt(queuedFlushPromptId)
    }
    if (ownsStreamingRuntime && currentRuntime && bridge) {
      if (modeCommand) {
        setToast('Stop active agent work before switching modes.')
        return
      }
      if (compactCommand) {
        // Compacting mid-turn would abort the running turn, so it waits for the
        // idle flush like any queued prompt.
        if (!queuedFlushPromptId) workspace.queuePrompt(prompt, 'queue')
        if (intent === 'steer') setToast('Compaction will run when the current turn finishes.')
        return
      }
      // Like the TUI, `!` commands and extension commands run now instead of waiting for the turn.
      try {
        if (bashCommand) {
          await runBashCommand({ bridge, runtimeId: currentRuntime.runtimeId, bash: bashCommand, setMessages: workspace.setMessages, isCurrent: () => workspace.workspaceRef.current.generation === currentWorkspace.generation })
          completeQueuedFlush()
          return
        }
        if (images.length === 0 && await runExtensionCommandNow(bridge, currentRuntime.runtimeId, prompt, ownsCurrentRuntime)) { completeQueuedFlush(); return }
      } catch (error) { reportError(error); throw error }
      if (intent === 'queue' && images.length === 0) {
        if (!queuedFlushPromptId) workspace.queuePrompt(prompt, intent)
        return
      }
      if (intent === 'steer') {
        const sentAt = Date.now()
        const pendingSteerId = workspace.queuePrompt(prompt, intent, [{ type: 'text', text: prompt }, ...images], sentAt)
        if (currentWorkspace.sessionFile) {
          const sentAtIso = new Date(sentAt).toISOString()
          setSessions((items) => items.map((session) => session.filePath === currentWorkspace.sessionFile ? { ...session, lastUserMessageAt: sentAtIso } : session))
        }
        try {
          const response = await bridge.agent.command(currentRuntime.runtimeId, { type: 'steer', message: prompt, ...(images.length ? { images } : {}) })
          workspace.acceptSteer(pendingSteerId)
          const actions = parseSessionActionSnapshot(response.sessionActions)
          if (actions) workspace.acknowledgeSteer(pendingSteerId, actions)
          return
        } catch (error) {
          workspace.removeQueuedPrompt(pendingSteerId)
          if (workspace.workspaceRef.current.generation === currentWorkspace.generation) {
            // Keep a durable failure row: a toast alone is easy to miss, and a
            // silently vanishing steer reads as "sent but ignored".
            workspace.setMessages((items) => [
              ...items,
              { id: `error-${Date.now()}`, role: 'system', timestamp: Date.now(), parts: [{ type: 'text', text: `Steer was not delivered: ${requestFailureMessage(error)} Your draft was restored.` }] },
            ])
          }
          reportError(error)
          throw error
        }
      }
    }
    const admittedSubmission = await submissionAdmissionRef.current.run(async () => {
      setSubmitting(true)
      let admitted = workspace.workspaceRef.current
      const generation = admitted.generation
      let startedPrompt = false
      let queuedPromptId: string | undefined
      const sentAt = Date.now()
      const sentAtIso = new Date(sentAt).toISOString()
      const userMessage: TranscriptMessage = { id: `user-${sentAt}`, role: 'user', timestamp: sentAt, parts: [{ type: 'text', text: prompt }, ...images] }
      let userMessageAppended = false
      const followUpExternalSession = async (sessionFile: string): Promise<boolean> => {
        if (!bridge) return false
        // The daemon owns the message once accepted; queuing it locally as
        // well would deliver it a second time via the idle flush.
        return bridge.sessions.followUp(sessionFile, prompt, intent)
      }
      try {
        if (!admitted.project || !admitted.cwd) { reportError('Add a project before starting a session.'); return }
        // The harness comes from the workspace's own project, never global
        // settings: a prompt landing between a harness switch and the
        // bootstrap effect's workspace reset would otherwise start the new
        // harness against the old workspace's cwd and session.
        const project = admitted.project
        const activeHarness = project.harness
        if (images.length > 0 && !provider.selectedModel?.input.includes('image')) {
          reportError('This model does not accept images. Remove the attachment or choose a vision model.')
          return
        }
        if (!workspace.prepareForPrompt(generation)) return
        if (creation?.generation === generation) {
          const session = await creation.promise
          admitted = { ...admitted, session, sessionFile: session.filePath }
        }
        const appendUserMessage = () => {
          if (userMessageAppended) return
          // The workspace may have switched while a command was in flight;
          // an optimistic append would land in the wrong transcript.
          if (workspace.workspaceRef.current.generation !== generation) return
          userMessageAppended = true
          workspace.setMessages((items) => [...items, userMessage])
          if (admitted.sessionFile) setSessions((items) => items.map((session) => session.filePath === admitted.sessionFile ? { ...session, lastUserMessageAt: sentAtIso } : session))
        }
        if (!bridge) {
          if (modeCommand) {
            const nextMode = piModeFromCommand(modeCommand)
            if (nextMode) savePiBehaviorMode(nextMode)
            completeQueuedFlush()
            return
          }
          appendUserMessage()
          const assistantId = `assistant-${Date.now()}`
          workspace.setMessages((items) => [...items, { id: assistantId, role: 'assistant', timestamp: Date.now(), startedAt: Date.now(), streaming: true, parts: [{ type: 'thinking', text: 'Reviewing the request and current workspace context.' }] }])
          demoTimerRef.current.push(window.setTimeout(() => workspace.setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, parts: [...item.parts, { type: 'toolCall', id: 'demo-tool', name: 'Inspect project', args: { cwd: admitted.cwd } }] } : item)), 450))
          demoTimerRef.current.push(window.setTimeout(() => workspace.setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, streaming: false, completedAt: Date.now(), parts: [...item.parts, { type: 'toolResult', name: 'Inspect project', text: 'Project context loaded' }, { type: 'text', text: 'I’ve reviewed the project context and prepared the workspace. Connect the desktop bridge to run this request with Pi.' }] } : item)), 1_250))
          return
        }
        const continueInBackground = (!admitted.sessionFile || createdSessionFiles.has(admitted.sessionFile)) && !compactCommand && !modeCommand && !bashCommand
        const submissionIsCurrent = () => workspace.workspaceRef.current.generation === generation
        const model = provider.model
        const thinking = provider.effort
        const fast = provider.fast
        await grantProject(project)
        if (!submissionIsCurrent() && !continueInBackground) return
        if (submissionIsCurrent()) await provider.flushPendingMutations?.()
        if (!submissionIsCurrent() && !continueInBackground) return
        const selected = admitted
        if (!selected.cwd) throw new Error('The selected workspace has no working directory.')
        const liveRuntimes = (await bridge.agent.list()).filter((candidate) => candidate.harness === activeHarness)
        if (!submissionIsCurrent() && !continueInBackground) return
        const owner = submissionIsCurrent() ? workspace.runtimeOwnerRef.current : null
        const tracked = workspace.runtimeIdRef.current ? liveRuntimes.find((item) => item.runtimeId === workspace.runtimeIdRef.current) : undefined
        const belongsHere = Boolean(tracked && owner?.runtimeId === tracked.runtimeId && owner.generation === generation && tracked.cwd === selected.cwd && (!selected.sessionFile || tracked.sessionFile === selected.sessionFile))
        let activeRuntime = belongsHere ? tracked : findRuntimeForWorkspace(liveRuntimes, selected.cwd, selected.sessionFile)
        const selectedSession = selected.sessionFile ? sessions.find((session) => session.filePath === selected.sessionFile) : undefined
        if (compactCommand && !activeRuntime) {
          if (!selected.sessionFile) { setToast('Nothing to compact yet.'); return }
          if (selectedSession?.status === 'running') {
            setToast('Compaction is unavailable while this session is running outside Apex.')
            return
          }
        }
        if (modeCommand && (activeRuntime?.isStreaming || selectedSession?.status === 'running')) {
          setToast('Stop active agent work before switching modes.')
          return
        }
        if (bashCommand && !activeRuntime && selectedSession?.status === 'running') {
          setToast('! commands are unavailable while this session is running outside Apex.')
          return
        }
        if (!bashCommand && (intent === 'queue' || compactCommand) && images.length === 0 && (activeRuntime?.isStreaming || selectedSession?.status === 'running')) {
          if (!queuedFlushPromptId) queuedPromptId = workspace.queuePrompt(prompt, compactCommand ? 'queue' : intent)
          if (compactCommand && intent === 'steer') setToast('Compaction will run when the current turn finishes.')
          return
        }
        let startedRuntime = false
        const assistantId = `assistant-${sentAt}`
        const beginOptimisticPrompt = () => {
          if (startedPrompt || workspace.workspaceRef.current.generation !== generation) return
          startedPrompt = true
          appendUserMessage()
          workspace.setMessages((items) => [...items, { id: assistantId, role: 'assistant', timestamp: sentAt, startedAt: sentAt, streaming: true, parts: [] }])
        }
        if (!activeRuntime) {
          workspace.attachRuntime(undefined, generation)
          if (images.length > 0 && selected.sessionFile && selectedSession?.status === 'running') {
            throw new Error('Image attachments cannot be queued while this session is active outside Apex. Wait for it to finish, then try again.')
          }
          if (images.length === 0 && selected.sessionFile && selectedSession?.status === 'running') {
            if (await followUpExternalSession(selected.sessionFile)) {
              if (intent === 'steer') appendUserMessage()
              completeQueuedFlush()
              return
            }
            if (workspace.workspaceRef.current.generation !== generation) return
          }
          try {
            if (!model) throw new Error(`No model is available for ${HARNESS_AGENT_NAMES[activeHarness]}. Enable or connect a provider, then try again.`)
            if (!compactCommand && !modeCommand && !bashCommand) beginOptimisticPrompt()
            activeRuntime = await startWorkspaceRuntime(bridge, { cwd: selected.cwd, sessionPath: selected.sessionFile, model, thinking, fast, harness: activeHarness }, generation)
          } catch (startError) {
            // A mode command must reach the modes extension; as a follow-up it would be chat text.
            if (!modeCommand && !bashCommand && images.length === 0 && selected.sessionFile && await followUpExternalSession(selected.sessionFile)) {
              startedPrompt = false
              if (workspace.workspaceRef.current.generation === generation) {
                workspace.setMessages((items) => items.filter((item) => item.id !== assistantId && (intent === 'steer' || item.id !== userMessage.id)))
              }
              if (intent === 'steer') appendUserMessage()
              completeQueuedFlush()
              return
            }
            throw startError
          }
          startedRuntime = true
          if (!submissionIsCurrent() && !continueInBackground) { await bridge.agent.stop(activeRuntime.runtimeId).catch(() => false); return }
        }
        if (activeRuntime.cwd !== selected.cwd || (selected.sessionFile && activeRuntime.sessionFile !== selected.sessionFile)) {
          if (startedRuntime) await bridge.agent.stop(activeRuntime.runtimeId).catch(() => false)
          throw new Error(`${HARNESS_AGENT_NAMES[activeHarness]} returned a runtime for a different workspace or session.`)
        }
        workspace.attachRuntime(activeRuntime, generation)
        if (!activeRuntime.isStreaming && !modeCommand) {
          await provider.flushPendingMutations?.(activeRuntime)
          if (!submissionIsCurrent() && !continueInBackground) return
        }
        if (compactCommand) {
          await bridge.agent.command(activeRuntime.runtimeId, {
            type: 'compact',
            ...(compactCommand.customInstructions ? { customInstructions: compactCommand.customInstructions } : {}),
          })
          completeQueuedFlush()
        } else if (bashCommand) {
          await runBashCommand({ bridge, runtimeId: activeRuntime.runtimeId, bash: bashCommand, setMessages: workspace.setMessages, isCurrent: submissionIsCurrent })
          completeQueuedFlush()
        } else if (modeCommand) {
          const runtimeId = activeRuntime.runtimeId
          const ownsModeRuntime = () => workspace.workspaceRef.current.generation === generation
            && workspace.runtimeIdRef.current === runtimeId
            && workspace.runtimeOwnerRef.current?.runtimeId === runtimeId
            && workspace.runtimeOwnerRef.current.generation === generation
          // Without the modes extension Pi treats the slash command as a chat prompt.
          const commandName = modeCommand.slice(1).split(/\s/, 1)[0].toLowerCase()
          const listed = await bridge.agent.command(runtimeId, { type: 'get_commands' })
          if (!ownsModeRuntime()) return
          if (!hasPiExtensionCommand(listed, commandName)) {
            throw new Error(`Pi has no /${commandName} command in this session, so it was not sent. Make sure the Pi modes extension (prompt-commands) is installed and enabled, then restart the session.`)
          }
          await bridge.agent.command(runtimeId, {
            type: 'prompt',
            message: modeCommand,
          })
          if (!ownsModeRuntime()) return
          // Modes can restore a different model/thinking pair without an agent
          // turn. Refresh the runtime cache before publishing it to the composer.
          await bridge.agent.command(runtimeId, { type: 'get_state' })
          if (!ownsModeRuntime()) return
          const refreshed = (await bridge.agent.list()).find((candidate) => candidate.runtimeId === runtimeId)
          if (!ownsModeRuntime()) return
          if (refreshed) workspace.attachRuntime(refreshed, generation)
          completeQueuedFlush()
        } else if (activeRuntime.isStreaming && images.length === 0 && await runExtensionCommandNow(bridge, activeRuntime.runtimeId, prompt, () => submissionIsCurrent() || continueInBackground)) {
          completeQueuedFlush()
        } else if (activeRuntime.isStreaming) {
          // Follow-ups are daemon-owned. Steers get a renderer-only pending
          // row so pickup can move them into history without redelivery.
          if (intent === 'steer') queuedPromptId = workspace.queuePrompt(prompt, intent, userMessage.parts, sentAt)
          const response = await bridge.agent.command(activeRuntime.runtimeId, { type: intent === 'steer' ? 'steer' : 'follow_up', message: prompt, ...(images.length ? { images } : {}) })
          const actions = parseSessionActionSnapshot(response.sessionActions)
          if (actions) {
            workspace.setRuntime((current) => current?.runtimeId === activeRuntime.runtimeId
              ? { ...current, sessionActions: actions }
              : current)
          }
          if (intent === 'steer' && queuedPromptId) {
            workspace.acceptSteer(queuedPromptId)
            if (actions) workspace.acknowledgeSteer(queuedPromptId, actions)
          }
          completeQueuedFlush()
        } else {
          beginOptimisticPrompt()
          if (submissionIsCurrent()) workspace.setRuntime((current) => current?.runtimeId === activeRuntime.runtimeId
            ? { ...current, isStreaming: true }
            : { ...activeRuntime, isStreaming: true })
          const response = await bridge.agent.command(activeRuntime.runtimeId, {
            type: 'prompt',
            message: prompt,
            streamingBehavior: streamingBehaviorForIntent(intent),
            ...(images.length ? { images } : {}),
          })
          if (selected.sessionFile) createdSessionFiles.delete(selected.sessionFile)
          const disposition = (response.data as { disposition?: unknown } | undefined)?.disposition
          if (disposition === 'handled' && submissionIsCurrent()) {
            workspace.setRuntime((current) => current?.runtimeId === activeRuntime.runtimeId ? { ...current, isStreaming: false } : current)
            workspace.setMessages((items) => items.filter((item) => item.id !== assistantId || item.parts.length > 0))
          }
          completeQueuedFlush()
        }
      } catch (error) {
        if (queuedFlushPromptId) {
          workspace.markQueuedPromptFlushFailed(queuedFlushPromptId)
          if (userMessageAppended) {
            workspace.setMessages((items) => items.filter((item) => item.id !== userMessage.id))
          }
        }
        if (queuedPromptId) workspace.removeQueuedPrompt(queuedPromptId)
        if (workspace.workspaceRef.current.generation !== generation) { reportError(error); throw error }
        const failure = requestFailureMessage(error)
        if (startedPrompt) workspace.setRuntime((current) => current ? { ...current, isStreaming: false } : current)
        workspace.setMessages((items) => {
          const finalized = startedPrompt
            ? items.flatMap((item) => item.streaming && item.role === 'assistant' && item.parts.length === 0 ? [] : [{ ...item, streaming: false }])
            : items
          return finalized.at(-1)?.role === 'system' ? finalized : [...finalized, { id: `error-${Date.now()}`, role: 'system', timestamp: Date.now(), parts: [{ type: 'text', text: failure }] }]
        })
        throw error
      } finally { setSubmitting(false) }
    })
    if (!admittedSubmission) {
      const error = new Error('Another message is still being admitted. Try steering again.')
      reportError(error)
      throw error
    }
  }
  const stopRuntime = async (requestedRuntimeId?: string, sessionFile?: string) => {
    const { bridge, workspace, setSessions, reportError } = getDeps()
    if (!bridge) {
      if (sessionFile) setSessions((items) => items.map((item) => item.filePath === sessionFile ? { ...item, status: 'complete', unread: true } : item))
      if (!sessionFile || workspace.workspaceRef.current.sessionFile === sessionFile) {
        workspace.setMessages((items) => items.map((item) => item.streaming ? { ...item, streaming: false } : item))
        workspace.setRuntime(null)
      }
      return
    }
    const stoppedGeneration = workspace.workspaceRef.current.generation
    const stoppedOwner = workspace.runtimeOwnerRef.current
    try {
      const stoppedRuntimeId = requestedRuntimeId || (!sessionFile ? workspace.runtime?.runtimeId : await resolveRuntimeIdForSession(bridge, workspace.runtimeSessionsRef?.current ?? new Map(), workspace.runtime, sessionFile, requestedRuntimeId))
      if (!stoppedRuntimeId) return
      // A running `!` command is separate from the agent turn; aborting with no command running is a no-op.
      void bridge.agent.command(stoppedRuntimeId, { type: 'abort_bash' }).catch(() => undefined)
      await bridge.agent.command(stoppedRuntimeId, { type: 'abort' })
      if (workspace.runtime?.runtimeId !== stoppedRuntimeId) return
      const currentOwner = workspace.runtimeOwnerRef.current
      if (workspace.workspaceRef.current.generation !== stoppedGeneration || workspace.runtimeIdRef.current !== stoppedRuntimeId
        || stoppedOwner?.runtimeId !== stoppedRuntimeId || stoppedOwner.generation !== stoppedGeneration
        || currentOwner?.runtimeId !== stoppedOwner.runtimeId || currentOwner.generation !== stoppedOwner.generation) return
      workspace.setRuntime((current) => current?.runtimeId === stoppedRuntimeId ? { ...current, isStreaming: false } : current)
      workspace.setMessages((items) => items.map((item) => item.streaming ? { ...item, streaming: false } : item))
    } catch (error) { reportError(error) }
  }

  const installSkill = async (source: string) => {
    const { bridge, reportError, settingsState } = getDeps()
    if (!bridge) return { ok: false as const, reason: 'blocked' as const, output: 'Package installation is available in the desktop app.' }
    try { return await bridge.plugins.install(source, settingsState.settings.activeHarness) } catch (error) { reportError(error); return { ok: false, output: errorMessage(error) } }
  }
  const installExtension = async (input: ExtensionInstallInput) => {
    const { activeProject, bridge, pluginSkills, reportError, settingsState } = getDeps()
    if (!bridge) return { ok: false as const, reason: 'blocked' as const, output: 'Extension installation is available in the desktop app.' }
    try {
      let installation = input
      if (input.scope === 'project') {
        if (!activeProject) return { ok: false as const, reason: 'blocked' as const, output: 'Open a project before adding a project extension.' }
        const project = await grantProject(activeProject)
        installation = { ...input, projectPath: project.primaryFolder }
      }
      const response = await bridge.plugins.installExtension(installation, settingsState.settings.activeHarness)
      if (response.ok) await pluginSkills.refresh()
      return response
    } catch (error) { reportError(error); return { ok: false, output: errorMessage(error) } }
  }
  const setMcpSupport = async (enabled: boolean) => {
    const { bridge, pluginSkills, reportError, settingsState } = getDeps()
    if (!bridge) return { ok: false as const, reason: 'blocked' as const, output: 'MCP support can only be changed in the desktop app.' }
    try {
      const response = await bridge.plugins.setMcpSupport(enabled, settingsState.settings.activeHarness)
      if (response.ok) await pluginSkills.refresh()
      return response
    } catch (error) { reportError(error); return { ok: false, output: errorMessage(error) } }
  }
  const connectMcp = async (input: McpConnectionInput) => {
    const { bridge, activeProject, pluginSkills, reportError, settingsState } = getDeps()
    if (!bridge) return { ok: false as const, reason: 'blocked' as const, output: 'MCP connections are available in the desktop app.' }
    try {
      let connection = input
      if (input.scope === 'project') {
        if (!activeProject) return { ok: false as const, reason: 'blocked' as const, output: 'Open a project before adding a project MCP server.' }
        const project = await grantProject(activeProject); connection = { ...input, projectPath: project.primaryFolder }
      }
      const response = await bridge.plugins.connectMcp(connection, settingsState.settings.activeHarness)
      if (response.ok) await pluginSkills.refresh()
      return response
    } catch (error) { reportError(error); return { ok: false, output: errorMessage(error) } }
  }
  const setMcpEnabled = async (input: McpStateInput) => {
    const { bridge, activeProject, pluginSkills, reportError, settingsState } = getDeps()
    if (!bridge) return { ok: false as const, reason: 'blocked' as const, output: 'MCP connections are available in the desktop app.' }
    try {
      let update = input
      if (input.scope === 'project') {
        if (!activeProject) return { ok: false as const, reason: 'blocked' as const, output: 'Open a project before changing a project MCP server.' }
        const project = await grantProject(activeProject); update = { ...input, projectPath: project.primaryFolder }
      }
      const response = await bridge.plugins.setMcpEnabled(update, settingsState.settings.activeHarness)
      if (response.ok) await pluginSkills.refresh()
      return response
    } catch (error) { reportError(error); return { ok: false, output: errorMessage(error) } }
  }
  const mutateCapability = async (input: CapabilityMutationInput) => {
    const { bridge, activeProject, pluginSkills, reportError, settingsState } = getDeps()
    if (!bridge) return { ok: false as const, reason: 'blocked' as const, output: 'Capabilities can only be changed in the desktop app.' }
    try {
      let update = input
      if (input.scope === 'project') {
        if (!activeProject) return { ok: false as const, reason: 'blocked' as const, output: 'Open a project before changing a project capability.' }
        const project = await grantProject(activeProject); update = { ...input, projectPath: project.primaryFolder }
      }
      const response = await bridge.plugins.mutateCapability(update, settingsState.settings.activeHarness)
      if (response.ok) await pluginSkills.refresh()
      return response
    } catch (error) { reportError(error); return { ok: false, output: errorMessage(error) } }
  }
  const createSchedule = async (input: ScheduleInput) => {
    const { bridge, refreshSchedules, reportError, settingsState } = getDeps()
    if (!bridge) throw new Error('Scheduled tasks are available in the desktop app.')
    try { await bridge.schedules.create(input, settingsState.settings.activeHarness); await refreshSchedules() } catch (error) { reportError(error); throw error }
  }
  const updateSchedule = async (id: string, patch: SchedulePatch) => {
    const { bridge, refreshSchedules, reportError } = getDeps()
    if (!bridge) throw new Error('Scheduled tasks are available in the desktop app.')
    try { await bridge.schedules.update(id, patch); await refreshSchedules() } catch (error) { reportError(error); throw error }
  }
  const mutateSchedule = async (operation: () => Promise<unknown>) => {
    const { bridge, refreshSchedules, reportError } = getDeps()
    if (!bridge) throw new Error('Scheduled tasks are available in the desktop app.')
    try { await operation(); await refreshSchedules() } catch (error) { reportError(error); throw error }
  }
  const openScheduledSession = (sessionFile: string) => {
    const { bridge, sessions, settingsState, setSessions, reportError } = getDeps()
    const known = sessions.find((session) => session.filePath === sessionFile)
    if (known) { void selectSession(known); return }
    if (!bridge) return
    void bridge.sessions.list(undefined, true, settingsState.settings.activeHarness).then((catalog) => {
      setSessions(catalog)
      const found = catalog.find((session) => session.filePath === sessionFile)
      if (found) void selectSession(found)
    }).catch(reportError)
  }
  const openBrowser = () => {
    const { layout, settingsState, setView } = getDeps()
    if (layout.compactLayout && settingsState.sidebarOpen) { layout.setSmallestSidebarAllowed(false); settingsState.setSidebarOpen(false) }
    setView('session')
    settingsState.selectInspectorTab('browser')
    if (!settingsState.inspectorOpen) persistPanel({ inspectorOpen: true })
  }
  const openInspectorTab = (tab: InspectorTab) => {
    const { layout, settingsState } = getDeps()
    if (layout.compactLayout && settingsState.sidebarOpen) { layout.setSmallestSidebarAllowed(false); settingsState.setSidebarOpen(false) }
    settingsState.selectInspectorTab(tab)
    if (!settingsState.inspectorOpen) persistPanel({ inspectorOpen: true })
  }
  const openChanges = () => openInspectorTab('changes')

  return {
    grantProject, persistPanel, toggleSidebar, toggleInspector, toggleTerminal,
    selectProject, selectSession, newSession, navigate, renameSession, setSessionArchived,
    addProject, removeProject, togglePinProject, setProjectSortMode, sendPrompt, stopRuntime, installSkill, installExtension, setMcpSupport, connectMcp, setMcpEnabled, mutateCapability,
    createSchedule, updateSchedule, mutateSchedule, openScheduledSession,
    openBrowser, openChanges, openInspectorTab,
  }
}

export type WorkspaceActions = ReturnType<typeof createWorkspaceActions>

/** Memoized workspace mutation handlers: one stable object for the app's lifetime. */
export function useWorkspaceActions(deps: WorkspaceActionsDeps): WorkspaceActions {
  const depsRef = useRef(deps)
  depsRef.current = deps
  const [actions] = useState(() => createWorkspaceActions(() => depsRef.current))
  return actions
}
