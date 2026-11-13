import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ApexApi, FinishedTask, FinishReview, RewindPreview, RunReceipt, RuntimeInfo, SessionRecord, SideConversation } from '@/types/api'
import { errorMessage } from '@/lib/errors'
import { startWorkspaceRuntime } from '@/lib/runtime-start'
import { EXCERPT_LIMIT, type TaskExcerpt, type TaskWorkflowContextValue } from '@/lib/task-context'

export type TaskDialog = { kind: 'rewind'; preview: RewindPreview; runtimeId: string; sessionFile: string } | { kind: 'finish'; review: FinishReview; runtimeId: string; sessionFile: string } | { kind: 'history'; receipt: RunReceipt; sessionFile: string }

export function useTaskWorkflows({ bridge, session, runtime, busy, setSessions, selectSession, reportError }: {
  bridge: ApexApi | null; session?: SessionRecord; runtime: RuntimeInfo | null; busy: boolean
  setSessions: Dispatch<SetStateAction<SessionRecord[]>>
  selectSession(session: SessionRecord): Promise<void>
  reportError(error: unknown): void
}) {
  const sessionFile = session?.filePath
  const [receipts, setReceipts] = useState<RunReceipt[]>([])
  const [persistedUserIds, setPersistedUserIds] = useState<ReadonlySet<string>>(new Set())
  const [finishedTasks, setFinishedTasks] = useState<FinishedTask[]>([])
  const [side, setSide] = useState<SideConversation | null>(null)
  const [children, setChildren] = useState<SideConversation[]>([])
  const [contexts, setContexts] = useState<Record<string, TaskExcerpt[]>>({})
  const [draft, setDraft] = useState<{ sessionFile: string; id: number; text: string }>()
  const [dialog, setDialog] = useState<TaskDialog | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<{ sessionFile?: string; message: string }>()
  const error = failure?.sessionFile === sessionFile ? failure?.message ?? '' : ''
  const setError = useCallback((message: string) => setFailure({ sessionFile, message }), [sessionFile])
  const active = useRef(sessionFile)
  active.current = sessionFile
  // Saved sessions can be resumed for review without admitting a prompt.
  const idle = Boolean(bridge && sessionFile && session?.harness === 'pi' && !busy
    && !(runtime?.sessionFile === sessionFile && (runtime?.isStreaming || runtime?.isCompacting)))
  const selection = useRef({ file: sessionFile, revision: 0, idle })
  if (selection.current.file !== sessionFile) selection.current.revision += 1
  selection.current.file = sessionFile
  selection.current.idle = idle
  const lock = useRef(false)
  const refreshSequence = useRef(0)
  const refresh = useCallback(async () => {
    if (!bridge) return
    const sequence = ++refreshSequence.current
    try {
      const markers = await bridge.sessions.listFinishedTasks()
      if (sequence !== refreshSequence.current) return
      setFinishedTasks(markers)
      if (!sessionFile) return
      const [runs, saved, relation, descendants] = await Promise.all([
        bridge.sessions.listRunReceipts(sessionFile), bridge.sessions.read(sessionFile),
        bridge.sessions.getSideConversation(sessionFile), bridge.sessions.listSideConversations(sessionFile),
      ])
      if (sequence !== refreshSequence.current || active.current !== sessionFile) return
      setReceipts(runs)
      setPersistedUserIds(new Set(saved.filter((message) => message.role === 'user' && !message.id.startsWith('desktop-user-')).map((message) => message.id)))
      setSide(relation); setChildren(descendants)
    } catch (reason) { if (sequence === refreshSequence.current) setError(errorMessage(reason)) }
  }, [bridge, sessionFile, setError])
  useEffect(() => {
    setReceipts([]); setPersistedUserIds(new Set()); setSide(null); setChildren([]); setDialog(null)
    setFailure((current) => current?.sessionFile === sessionFile ? current : undefined)
    void refresh()
    return () => { refreshSequence.current += 1 }
  }, [refresh, sessionFile])
  useEffect(() => { void refresh() }, [busy, runtime?.runtimeId, refresh])
  useEffect(() => {
    if (!bridge) return
    const offSession = bridge.sessions.onChanged(() => { void refresh() })
    const offAgent = bridge.agent.onEvent(({ event }) => {
      if (event.type === 'agent_end' || event.type === 'agent_start' || event.type === 'message_end' || event.type === 'session_action_update' || event.type === 'runtime_exit') void refresh()
    })
    return () => { offSession(); offAgent() }
  }, [bridge, refresh])
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return
    const revision = selection.current.revision
    lock.current = true; setPending(true); setError('')
    try { await action() } catch (reason) {
      if (selection.current.revision === revision) { setError(errorMessage(reason)); reportError(reason) }
    }
    finally { lock.current = false; setPending(false) }
  }
  const guardSelection = (requireIdle: boolean) => {
    const revision = selection.current.revision
    return () => {
      if (selection.current.revision !== revision) throw new Error('The selected conversation changed. Retry from the intended conversation.')
      if (requireIdle && !selection.current.idle) throw new Error('This session is busy. Retry when it is idle.')
    }
  }
  const ensureRuntime = async (filePath: string, guard: () => void, parent = false): Promise<RuntimeInfo> => {
    if (!bridge) throw new Error('Task review is available in the desktop app.')
    guard()
    let resumed = (await bridge.agent.list()).find((item) => item.harness === 'pi' && item.sessionFile === filePath)
    guard()
    if (!resumed) {
      const catalog = await bridge.sessions.list(undefined, true, 'pi', true)
      guard()
      const saved = catalog.find((item) => item.harness === 'pi' && item.filePath === filePath)
      if (!saved) throw new Error('The saved Pi session is no longer in the catalog.')
      // The shared helper joins a concurrent prewarm. Saved-session model and
      // policy are loaded by agent.start; no prompt or new session is created.
      const started = await startWorkspaceRuntime(bridge, { cwd: saved.projectPath, sessionPath: saved.filePath, harness: 'pi' }, selection.current.revision)
      guard()
      resumed = (await bridge.agent.list()).find((item) => item.runtimeId === started.runtimeId && item.harness === 'pi' && item.sessionFile === filePath)
      guard()
      if (!resumed) throw new Error('The resumed session is no longer available. Retry the action.')
    }
    if (resumed.isStreaming || resumed.isCompacting) throw new Error(parent
      ? 'Parent is busy. Bring back is unavailable until it is idle. Retry when the parent finishes.'
      : 'This session is busy. Retry when it is idle.')
    return resumed
  }
  const navigate = async (filePath: string, guard?: () => void) => {
    if (!bridge) return
    const catalog = await bridge.sessions.list(undefined, true, 'pi', true)
    guard?.()
    const target = catalog.find((item) => item.filePath === filePath)
    if (!target) throw new Error(`The saved session is not in the catalog yet: ${filePath}. Refresh and open it from the session list.`)
    setSessions(catalog)
    // Existing navigation only detaches the view. It never stops the parent runtime.
    await selectSession(target)
  }
  const attachTo = (target: string, excerpt: Omit<TaskExcerpt, 'id'>) => {
    if (!excerpt.text.trim()) return
    if (excerpt.text.length > EXCERPT_LIMIT) throw new Error('Select at most 32,768 characters.')
    setContexts((current) => ({ ...current, [target]: [...(current[target] ?? []), { ...excerpt, id: crypto.randomUUID() }] }))
  }
  const createSide = (excerpt?: string) => { void run(async () => {
    if (!bridge || !sessionFile) return
    const created = await bridge.sessions.createSideConversation(sessionFile, { excerpt, harness: 'pi' })
    if (created.initialContext) attachTo(created.sessionFile, { source: 'Parent conversation', sessionFile, text: created.initialContext })
    await navigate(created.sessionFile)
  }) }
  const bringBack = (text: string) => { void run(async () => {
    if (!bridge || !side) return
    const guard = guardSelection(false)
    const parent = await ensureRuntime(side.parentSession, guard, true)
    guard()
    const result = await bridge.sessions.prepareSideReturn(parent.runtimeId, side.sessionFile, text)
    guard()
    attachTo(side.parentSession, { source: 'Side conversation reply', sessionFile: result.sourceSession, text: result.text })
    await navigate(side.parentSession, guard)
  }) }
  const context: TaskWorkflowContextValue = {
    sessionFile, excerpts: sessionFile ? contexts[sessionFile] ?? [] : [], receipts, persistedUserIds, idle, pending,
    attach: (excerpt) => { if (sessionFile) { try { attachTo(sessionFile, excerpt) } catch (reason) { setError(errorMessage(reason)) } } },
    remove: (ids) => { if (sessionFile) setContexts((current) => ({ ...current, [sessionFile]: (current[sessionFile] ?? []).filter((excerpt) => !ids.includes(excerpt.id)) })) },
    edit: (userEntryId) => { void run(async () => {
      if (!idle || !bridge || !sessionFile || !persistedUserIds.has(userEntryId)) return
      const guard = guardSelection(true)
      const owner = await ensureRuntime(sessionFile, guard)
      guard()
      const preview = await bridge.sessions.previewRewind(owner.runtimeId, sessionFile, userEntryId)
      guard()
      setDialog({ kind: 'rewind', preview, runtimeId: owner.runtimeId, sessionFile })
    }) },
    review: (receipt) => { if (sessionFile) setDialog({ kind: 'history', receipt, sessionFile }) },
    createSide, bringBack, isSide: Boolean(side), finished: new Set(finishedTasks.map((task) => task.sessionFile)),
  }
  const reviewFinish = () => { void run(async () => {
    if (!idle || !bridge || !sessionFile) return
    const guard = guardSelection(true)
    const owner = await ensureRuntime(sessionFile, guard)
    guard()
    const review = await bridge.sessions.reviewFinish(owner.runtimeId, sessionFile)
    guard()
    setDialog({ kind: 'finish', review, runtimeId: owner.runtimeId, sessionFile })
  }) }
  const confirm = (restoreFiles: boolean) => { void run(async () => {
    if (!bridge || !dialog || dialog.kind === 'history' || !idle || dialog.sessionFile !== sessionFile) return
    const guard = guardSelection(true)
    const owner = (await bridge.agent.list()).find((item) => item.runtimeId === dialog.runtimeId && item.harness === 'pi' && item.sessionFile === dialog.sessionFile)
    guard()
    if (!owner) throw new Error('The session runtime changed. Close this dialog and review again.')
    if (owner.isStreaming || owner.isCompacting) throw new Error('This session is busy. Retry when it is idle.')
    if (dialog.kind === 'finish') {
      const finished = await bridge.sessions.finishTask(dialog.runtimeId, dialog.sessionFile, dialog.review.token, 'finish')
      guard()
      setFinishedTasks((current) => [...current.filter((item) => item.sessionFile !== finished.sessionFile), finished])
      setDialog(null)
      return
    }
    const { preview } = dialog
    if (restoreFiles && (!preview.restore.available || !preview.restore.fingerprint)) throw new Error('File restore is unavailable. Preview again.')
    const result = await bridge.sessions.rewind(dialog.runtimeId, dialog.sessionFile, preview.token, restoreFiles && preview.restore.fingerprint
      ? { restoreFiles: true, confirmation: 'restore', fingerprint: preview.restore.fingerprint } : { restoreFiles: false })
    guard()
    if (result.kind === 'cancelled') { setDialog(null); return }
    setDraft({ sessionFile: result.sessionFile, id: Date.now(), text: result.prompt })
    setDialog(null)
    await navigate(result.sessionFile, guard)
    if (result.kind === 'restore-failed') {
      const message = `Conversation forked, but file restore failed: ${result.error}. ${result.filesMayBePartial ? 'Files may be partially restored. Inspect the checkout before continuing.' : 'Files were not restored.'} The recovered prompt has not been sent.`
      setFailure({ sessionFile: result.sessionFile, message }); reportError(message)
    }
  }) }
  return { context, side, children, dialog, pending, error, idle, createSide, reviewFinish, confirm,
    navigate: (file: string) => { void run(() => navigate(file)) },
    close: () => { if (!pending) setDialog(null) },
    insertDraft: draft?.sessionFile === sessionFile ? draft : undefined,
    draftInserted: (id: number) => setDraft((current) => current?.id === id ? undefined : current),
  }
}
