import { Bell, MagnifyingGlass } from '@/components/icons'
import * as stylex from '@stylexjs/stylex'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ActivityPeek } from '@/components/activity/ActivityPeek'
import { ActivityCoordinator } from '@/components/activity/ActivityCoordinator'
import { ActivityQuestionCard } from '@/components/activity/ActivityQuestionCard'
import { ActivityReplyBox } from '@/components/activity/ActivityReplyBox'
import { ActivityRow, type ActivitySectionKind } from '@/components/activity/ActivityRow'
import { buildActivitySections, type ActivityRowItem, type SessionLiveMap } from '@/app/session-live'
import { activityNotificationSignature, isSessionRunning, signatureCleared } from '@/app/session-attention'
import { ApexButton, EmptyState } from '@/components/ui'
import type { ActivityControls } from '@/hooks/useActivityControls'
import type { ApexApi, ProjectRecord, SessionRecord } from '@/types/api'

const filterControlStyles = stylex.create({
  control: {
    minWidth: 0,
    flexGrow: 1,
    backgroundColor: 'transparent',
    borderWidth: 0,
    outlineWidth: 0,
    fontSize: 'var(--fs-ui)',
  },
})

export type ActivityFilter = 'all' | 'attention' | 'running'
export const ACTIVITY_BATCH = 250
export const RECENT_INITIAL_LIMIT = 10

export interface ActivityViewState {
  filter: ActivityFilter
  query: string
  visibleLimit: number
}

export function updateActivityCriteria(
  state: ActivityViewState,
  criteria: Partial<Pick<ActivityViewState, 'filter' | 'query'>>,
  initialLimit = ACTIVITY_BATCH,
): ActivityViewState {
  return { ...state, ...criteria, visibleLimit: initialLimit }
}

export function growActivityBatch(state: ActivityViewState, total: number): ActivityViewState {
  return { ...state, visibleLimit: Math.min(total, state.visibleLimit + ACTIVITY_BATCH) }
}

export interface ActivityPageProps {
  bridge?: ApexApi | null
  sessions: SessionRecord[]
  projects: ProjectRecord[]
  clearedActivity: Record<string, string>
  liveBySession?: SessionLiveMap
  selectedSessionId?: string
  controls?: ActivityControls
  showReasoning?: boolean
  showTools?: boolean
  onOpen(session: SessionRecord): void
  onClear(sessions: SessionRecord[]): void
  onStop?(session: SessionRecord, runtimeId?: string): void
}

const EMPTY_LIVE: SessionLiveMap = {}

interface SectionDescriptor {
  id: ActivitySectionKind
  label: string
  totalCount: number
  items: ActivityRowItem[]
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function ActivityPage({
  bridge = null,
  sessions,
  projects,
  clearedActivity,
  liveBySession = EMPTY_LIVE,
  selectedSessionId,
  controls,
  showReasoning,
  showTools,
  onOpen,
  onClear,
  onStop,
}: ActivityPageProps) {
  const [viewState, setViewState] = useState<ActivityViewState>({
    filter: 'all',
    query: '',
    visibleLimit: RECENT_INITIAL_LIMIT,
  })
  const { query, visibleLimit } = viewState
  const [selectedId, setSelectedId] = useState<string | undefined>(selectedSessionId)
  const [stopConfirmSignal, setStopConfirmSignal] = useState(0)
  const [cancelConfirmSignal, setCancelConfirmSignal] = useState(0)
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [projectId, setProjectId] = useState('all')
  const [detailMode, setDetailMode] = useState<'peek' | 'coordinator'>('coordinator')
  const detailId = useId()
  const [focusReply, setFocusReply] = useState(false)
  const selectedProject = projects.find((project) => project.id === projectId)
  const scopedSessions = useMemo(() => sessions.filter((session) => session.role !== 'coordinator'
    && (!selectedProject || [selectedProject.path, selectedProject.primaryFolder, ...selectedProject.folders].includes(session.projectPath))), [sessions, selectedProject])

  useEffect(() => {
    if (projectId !== 'all' && !selectedProject) setProjectId('all')
  }, [projectId, selectedProject])

  useEffect(() => {
    if (focusReply && detailMode === 'peek') {
      replyTextareaRef.current?.focus()
      setFocusReply(false)
    }
  }, [detailMode, focusReply])

  useEffect(() => {
    if (selectedSessionId !== undefined) {
      setSelectedId(selectedSessionId)
    }
  }, [selectedSessionId])

  const projectNames = useMemo(
    () => new Map(projects.flatMap((project) => [...new Set([project.path, ...project.folders])].map((path) => [path, project.name] as const))),
    [projects],
  )
  const projectName = (path: string) => projectNames.get(path) ?? path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

  const clearable = useMemo(() => scopedSessions.filter((session) => {
    if (session.archived) return false
    const live = liveBySession[session.filePath]
    if (isSessionRunning(session, live)) return false
    const signature = activityNotificationSignature(session)
    return Boolean(signature && !signatureCleared(signature, clearedActivity[session.id], session.unread))
  }), [clearedActivity, liveBySession, scopedSessions])

  const sections = useMemo(
    () => buildActivitySections(scopedSessions, liveBySession, clearedActivity, query),
    [clearedActivity, liveBySession, query, scopedSessions],
  )

  const hasTickingRows = useMemo(
    () => sections.running.length > 0 || sections.needsYou.some((item) => item.attention?.kind === 'question' && item.attention.deadline !== undefined),
    [sections.needsYou, sections.running.length],
  )

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!hasTickingRows) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [hasTickingRows])

  const displayedRecent = useMemo(
    () => sections.recent.slice(0, visibleLimit),
    [sections.recent, visibleLimit],
  )

  const visibleSections = useMemo<SectionDescriptor[]>(() => {
    const list: SectionDescriptor[] = [
      { id: 'needs-you', label: 'NEEDS YOU', totalCount: sections.needsYou.length, items: sections.needsYou },
      { id: 'running', label: 'RUNNING', totalCount: sections.running.length, items: sections.running },
      { id: 'review', label: 'READY TO REVIEW', totalCount: sections.readyToReview.length, items: sections.readyToReview },
      { id: 'recent', label: 'RECENT', totalCount: sections.recent.length, items: displayedRecent },
    ]
    return list.filter((section) => section.totalCount > 0)
  }, [displayedRecent, sections.needsYou, sections.readyToReview, sections.recent.length, sections.running])

  const allVisibleEntries = useMemo(
    () => visibleSections.flatMap((section) => section.items.map((item) => ({ item, section: section.id }))),
    [visibleSections],
  )

  const defaultSessionId = useMemo(
    () => (sections.needsYou[0] ?? sections.running[0] ?? sections.readyToReview[0])?.session.id,
    [sections.needsYou, sections.readyToReview, sections.running],
  )

  const resolvedSelectedId = useMemo(() => {
    if (selectedId && allVisibleEntries.some((entry) => entry.item.session.id === selectedId)) {
      return selectedId
    }
    return defaultSessionId
  }, [allVisibleEntries, defaultSessionId, selectedId])

  useEffect(() => {
    if (resolvedSelectedId !== selectedId) {
      setSelectedId(resolvedSelectedId)
    }
  }, [resolvedSelectedId, selectedId])

  const selectedEntry = useMemo(
    () => (resolvedSelectedId ? allVisibleEntries.find((entry) => entry.item.session.id === resolvedSelectedId) ?? null : null),
    [allVisibleEntries, resolvedSelectedId],
  )

  const compactLayout = Boolean(controls?.compactLayout)
  const remainingRecent = sections.recent.length - displayedRecent.length

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (document.querySelector('[role="dialog"], .modal-backdrop')) return

      if (event.key === 'Escape') {
        if (isEditableElement(event.target)) {
          ;(event.target as HTMLElement).blur()
          event.preventDefault()
          return
        }
        setCancelConfirmSignal((value) => value + 1)
        return
      }

      if (isEditableElement(event.target)) return

      if (event.key === 'j' || event.key === 'ArrowDown') {
        if (allVisibleEntries.length === 0) return
        event.preventDefault()
        const currentIndex = resolvedSelectedId
          ? allVisibleEntries.findIndex((entry) => entry.item.session.id === resolvedSelectedId)
          : -1
        const nextIndex = currentIndex < 0 ? 0 : Math.min(allVisibleEntries.length - 1, currentIndex + 1)
        setSelectedId(allVisibleEntries[nextIndex].item.session.id)
        return
      }

      if (event.key === 'k' || event.key === 'ArrowUp') {
        if (allVisibleEntries.length === 0) return
        event.preventDefault()
        const currentIndex = resolvedSelectedId
          ? allVisibleEntries.findIndex((entry) => entry.item.session.id === resolvedSelectedId)
          : allVisibleEntries.length
        const prevIndex = currentIndex <= 0 ? 0 : currentIndex - 1
        setSelectedId(allVisibleEntries[prevIndex].item.session.id)
        return
      }

      if (event.key === 'Enter') {
        if (!selectedEntry) return
        const target = event.target instanceof HTMLElement ? event.target : null
        const buttonTarget = target?.closest('button, a')
        if (buttonTarget && !buttonTarget.classList.contains('activity-row__main')) return
        event.preventDefault()
        onOpen(selectedEntry.item.session)
        return
      }

      if (event.key === 'c') {
        event.preventDefault()
        setDetailMode('coordinator')
        window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.activity-coordinator .composer textarea')?.focus())
        return
      }

      if (event.key === 'r') {
        if (!selectedEntry) return
        if (detailMode !== 'peek') {
          event.preventDefault()
          setDetailMode('peek')
          setFocusReply(true)
          return
        }
        const textarea = replyTextareaRef.current
        if (textarea && !textarea.disabled) {
          event.preventDefault()
          textarea.focus()
        }
        return
      }

      if (event.key === 'x') {
        if (!selectedEntry || selectedEntry.section !== 'running') return
        event.preventDefault()
        setDetailMode('peek')
        setStopConfirmSignal((value) => value + 1)
        return
      }

      if (event.key === 'e') {
        if (!selectedEntry) return
        const { session, attention } = selectedEntry.item
        const isRunning = isSessionRunning(session, selectedEntry.item.live)
        const isQuestion = attention?.kind === 'question'
        if (!isRunning && !isQuestion && activityNotificationSignature(session)) {
          event.preventDefault()
          onClear([session])
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [allVisibleEntries, compactLayout, detailMode, onClear, onOpen, resolvedSelectedId, selectedEntry])

  return (
    <div className="page page--activity">
      <div className="activity-view-tools">
        <label className="activity-project-filter">Project
          <select aria-label="Activity project" value={projectId} onChange={(event) => { setProjectId(event.target.value); setViewState((current) => ({ ...current, visibleLimit: RECENT_INITIAL_LIMIT })) }}>
            <option value="all">All projects</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.inferred || project.readOnly ? ' (read-only)' : ''}</option>)}
          </select>
        </label>
        <TabList value={detailMode} onChange={(value) => { if (value === 'peek' || value === 'coordinator') setDetailMode(value) }} role="tablist" aria-label="Activity detail view" size="sm" className="activity-detail-tabs">
          <Tab value="peek" label="Peek" id={`${detailId}-peek-tab`} panelId={`${detailId}-peek-panel`} />
          <Tab value="coordinator" label="Chief of Staff" id={`${detailId}-coordinator-tab`} panelId={`${detailId}-coordinator-panel`} />
        </TabList>
      </div>
      <div className={`page-container activity-page ${compactLayout ? 'activity-page--compact' : ''} ${detailMode === 'coordinator' ? 'activity-page--coordinator' : ''}`}>
        <div className="activity-feed">
          <div className="activity-feed__top">
            <header className="page-header activity-header">
              <div>
                <h1>Activity</h1>
                <p>Triage questions, monitor active runs, and review finished sessions.</p>
              </div>
            </header>

            <div className="page-tools page-tools--activity">
              <div className="activity-tools__right">
                <TextInput
                  label="Filter activity"
                  isLabelHidden
                  placeholder="Filter activity"
                  startIcon={<MagnifyingGlass size={13} />}
                  value={query}
                  onChange={(value) => setViewState((current) => updateActivityCriteria(current, { query: value }, RECENT_INITIAL_LIMIT))}
                  containerClassName="page-search page-search--small"
                  controlXstyle={filterControlStyles.control}
                />
                <ApexButton
                  type="button"
                  compact
                  className="activity-clear-all"
                  disabled={!clearable.length}
                  onClick={() => onClear(clearable)}
                >
                  Mark all reviewed
                </ApexButton>
              </div>
            </div>
          </div>

          <div className="activity-feed__scroll scroll-area">
            {visibleSections.length > 0 ? (
              <div className="activity-sections">
                {visibleSections.map((section) => (
                  <section
                    key={section.id}
                    className={`activity-section activity-section--${section.id}`}
                    aria-label={section.label}
                  >
                    <header className="activity-section__header">
                      <h2 className="activity-section__heading">
                        <span>{section.label}</span>
                        <span className="activity-section__sep" aria-hidden="true">·</span>
                        <span className="activity-section__count tabular">{section.totalCount}</span>
                      </h2>
                    </header>
                    <div className="activity-list">
                      {section.items.map((item) => (
                        <ActivityRow
                          key={item.session.id}
                          item={item}
                          section={section.id}
                          projectName={projectName(item.session.projectPath)}
                          now={now}
                          selected={resolvedSelectedId === item.session.id}
                          stopConfirmSignal={compactLayout ? stopConfirmSignal : 0}
                          cancelConfirmSignal={cancelConfirmSignal}
                          onSelect={(session) => setSelectedId(session.id)}
                          onOpen={onOpen}
                          onClear={onClear}
                          onStop={onStop}
                        />
                      ))}
                    </div>
                    {section.id === 'recent' && remainingRecent > 0 ? (
                      <ApexButton
                        type="button"
                        variant="quiet"
                        className="page-show-more activity-show-more"
                        onClick={() => setViewState((current) => growActivityBatch(current, sections.recent.length))}
                      >
                        Show {Math.min(ACTIVITY_BATCH, remainingRecent)} more sessions
                      </ApexButton>
                    ) : null}
                  </section>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Bell size={24} />} title="You’re all caught up">
                Running sessions and new results will appear here.
              </EmptyState>
            )}
          </div>

          <footer className="activity-feed__hint" aria-label="Activity keyboard shortcuts">
            <span><kbd>j</kbd>/<kbd>k</kbd> select</span>
            <span aria-hidden="true">·</span>
            <span><kbd>Enter</kbd> open</span>
            <span aria-hidden="true">·</span>
            <span><kbd>r</kbd> reply</span>
            <span aria-hidden="true">·</span>
            <span><kbd>c</kbd> coordinate</span>
            <span aria-hidden="true">·</span>
            <span><kbd>x</kbd> stop</span>
            <span aria-hidden="true">·</span>
            <span><kbd>e</kbd> mark reviewed</span>
            <span aria-hidden="true">·</span>
            <span><kbd>Esc</kbd> cancel</span>
          </footer>
        </div>

        <div className="activity-chief-slot" role="tabpanel" id={`${detailId}-coordinator-panel`} aria-labelledby={`${detailId}-coordinator-tab`} hidden={detailMode !== 'coordinator'}><ActivityCoordinator bridge={bridge} controls={controls} showReasoning={showReasoning} showTools={showTools} /></div>
        <div className="activity-peek-slot" role="tabpanel" id={`${detailId}-peek-panel`} aria-labelledby={`${detailId}-peek-tab`} hidden={detailMode !== 'peek'}>
        {detailMode === 'peek' ? (
          <ActivityPeek
            item={selectedEntry?.item ?? null}
            section={selectedEntry?.section ?? null}
            projectName={selectedEntry ? projectName(selectedEntry.item.session.projectPath) : ''}
            now={now}
            stopConfirmSignal={stopConfirmSignal}
            cancelConfirmSignal={cancelConfirmSignal}
            readTranscript={controls?.readTranscript}
            onOpen={onOpen}
            onClear={onClear}
            onStop={onStop}
            questionSlot={
              selectedEntry?.item.live?.pendingQuestion ? (
                <ActivityQuestionCard
                  question={selectedEntry.item.live.pendingQuestion}
                  pendingUi={controls?.pendingByRuntime?.get(selectedEntry.item.live.pendingQuestion.runtimeId)}
                  now={now}
                  onRespond={controls?.onRespondQuestion}
                  onOpenModal={controls?.onOpenQuestionModal}
                />
              ) : null
            }
            replySlot={
              selectedEntry ? (
                <ActivityReplyBox
                  session={selectedEntry.item.session}
                  runtimeId={selectedEntry.item.live?.runtimeId}
                  isRunning={isSessionRunning(selectedEntry.item.session, selectedEntry.item.live)}
                  canFollowUp={Boolean(controls?.canFollowUpSession?.(selectedEntry.item.session))}
                  textareaRef={replyTextareaRef}
                  onSend={controls?.onSendReply}
                />
              ) : null
            }
          />
        ) : null}
        </div>
      </div>
    </div>
  )
}
