import {
  Archive,
  Bell,
  CalendarDots,
  CaretDown,
  CaretRight,
  Check,
  Code,
  Copy,
  DotsThree,
  Folder,
  FolderPlus,
  FunnelSimple,
  Gear,
  MagnifyingGlass,
  NotePencil,
  Package,
  PushPin,
  SidebarLeft,
  Terminal,
  Trash,
  Waveform,
} from './icons'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { PROJECT_SORT_MODES, type HarnessId, type ProjectRecord, type ProjectSortMode, type RuntimeOwnerView, type SessionRecord, type WorkspaceView } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { HARNESS_PRODUCT_NAMES } from '@/lib/harness'
import { sortProjects } from '@/lib/project-order'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { isSessionRunning, isSessionWaiting, sessionAttentionSignature, signatureCleared } from '@/app/session-attention'
import type { SessionLiveMap } from '@/app/session-live'
import type { SessionLive } from '@/app/sessionLiveMachine'
import { Badge } from '@astryxdesign/core/Badge'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ApexButton, EmptyState, IconButton, Modal, PiMark, useFocusTrap } from './ui'
import { StatusMark } from './activity/StatusMark'
import { SessionStatusGlyph, SidebarAttentionGroups } from './SidebarAttention'
import { useTaskWorkflowContext } from '@/lib/task-context'

const PROJECT_SORT_LABEL_KEYS = { recent: 'projects.sort.recent', alphabetical: 'projects.sort.alphabetical' } as const satisfies Record<ProjectSortMode, MessageKey>

export interface SidebarProps {
  projects: ProjectRecord[]
  sessions: SessionRecord[]
  loading?: boolean
  activeProjectId?: string
  activeSessionId?: string
  activeView: WorkspaceView
  activeHarness?: HarnessId
  clearedAttention?: Record<string, string>
  /** Live phase and pending questions keyed by session file path; running means live or stored status. */
  liveBySession?: SessionLiveMap
  onSelectProject(project: ProjectRecord): void
  onSelectSession(session: SessionRecord): void
  onNavigate(view: WorkspaceView): void
  onNewSession(project?: ProjectRecord): void
  onAddProject(): void
  onRemoveProject(project: ProjectRecord): void
  projectSortMode?: ProjectSortMode
  onSetProjectSortMode?(mode: ProjectSortMode): void
  onTogglePinProject?(project: ProjectRecord): void
  onClose(): void
  onOpenPalette(): void
  onRenameSession(session: SessionRecord, title: string): Promise<void>
  onArchiveSession(session: SessionRecord): Promise<void>
  /** Sessions held by another live Apex app, keyed by session file path. */
  runtimeOwners?: ReadonlyMap<string, RuntimeOwnerView>
  onContinueInVsCode?(session: SessionRecord): void
  terminalOpen?: boolean
  voiceOpen?: boolean
  onToggleTerminal?(): void
  onToggleVoice?(): void
  onOpenInVsCode?(path: string): void
  overlay?: boolean
  platform?: NodeJS.Platform
}

const statusLabel: Record<SessionRecord['status'], string> = {
  idle: 'Idle', running: 'Running', waiting: 'Waiting for input', complete: 'Finished', failed: 'Failed', unknown: 'Unknown',
}

const NO_LIVE: SessionLiveMap = {}

/** Concise meta text for a session row: live owner when idle/complete, otherwise narrow recency. */
function sessionRowMeta(session: SessionRecord, owner?: RuntimeOwnerView, live?: SessionLive): string {
  if (owner && !isSessionRunning(session, live) && !isSessionWaiting(session)) {
    return owner.app === 'vscode' ? 'In VS Code' : 'In Apex'
  }
  return formatRelative(session.updatedAt, 'narrow')
}

function sessionNeedsAttention(session: SessionRecord, clearedAttention: Record<string, string>): boolean {
  const signature = sessionAttentionSignature(session)
  return Boolean(signature && !signatureCleared(signature, clearedAttention[session.id], session.unread))
}

export const SIDEBAR_SESSION_LIMIT = 7
const RECENT_PROJECT_LIMIT = 5
const COLLAPSED_PROJECTS_STORAGE_KEY = 'prime-work.sidebar-collapsed-projects'

function readCollapsedProjects(): Record<string, boolean> {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_PROJECTS_STORAGE_KEY) ?? '{}')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
    return Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'boolean'))
  } catch { return {} }
}

function saveCollapsedProjects(collapsed: Record<string, boolean>): void {
  try { window.localStorage.setItem(COLLAPSED_PROJECTS_STORAGE_KEY, JSON.stringify(collapsed)) } catch { /* Keep navigation usable when storage is unavailable. */ }
}

export interface SidebarIndexStats {
  projectPaths: number
  sessionScans: number
}

export function indexSidebarSessions(
  projects: ProjectRecord[],
  sessions: SessionRecord[],
  stats?: SidebarIndexStats,
): { activeSessions: SessionRecord[]; sessionsByProject: Map<string, SessionRecord[]> } {
  const activeSessions: SessionRecord[] = []
  const owners = new Map<string, string[]>()
  const sessionsByProject = new Map(projects.map((project) => [project.id, [] as SessionRecord[]]))
  for (const project of projects) for (const path of new Set([project.path, ...project.folders])) {
    if (stats) stats.projectPaths += 1
    const entries = owners.get(path) ?? []
    entries.push(project.id)
    owners.set(path, entries)
  }
  for (const session of sessions) {
    if (stats) stats.sessionScans += 1
    if (session.archived) continue
    activeSessions.push(session)
    for (const projectId of owners.get(session.projectPath) ?? []) sessionsByProject.get(projectId)?.push(session)
  }
  const compareByLastUserMessage = (left: SessionRecord, right: SessionRecord) => {
    const difference = Date.parse(right.lastUserMessageAt ?? right.createdAt) - Date.parse(left.lastUserMessageAt ?? left.createdAt)
    return difference || right.createdAt.localeCompare(left.createdAt) || left.filePath.localeCompare(right.filePath)
  }
  activeSessions.sort(compareByLastUserMessage)
  for (const projectSessions of sessionsByProject.values()) projectSessions.sort(compareByLastUserMessage)
  return { activeSessions, sessionsByProject }
}

export function boundedSidebarSessions(sessions: SessionRecord[], { limit = SIDEBAR_SESSION_LIMIT, include = () => false }: { limit?: number; include?(session: SessionRecord): boolean } = {}): SessionRecord[] {
  return sessions.filter((session, index) => index < limit || include(session))
}


async function copySessionUuid(id: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(id)
      return
    } catch {
      // Fall back to the document copy command when clipboard permission is unavailable.
    }
  }
  const input = document.createElement('textarea')
  input.value = id
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('Copy is unavailable')
}

function SidebarView({ projects, sessions, loading = false, activeProjectId, activeSessionId, activeView, activeHarness = 'pi', clearedAttention = {}, liveBySession = NO_LIVE, onSelectProject, onSelectSession, onNavigate, onNewSession, onAddProject, onRemoveProject, projectSortMode = 'recent', onSetProjectSortMode = () => undefined, onTogglePinProject = () => undefined, onClose, onRenameSession, onArchiveSession, runtimeOwners, onContinueInVsCode, terminalOpen = false, voiceOpen = false, onToggleTerminal, onToggleVoice, onOpenInVsCode, overlay = false, platform = 'darwin' }: SidebarProps) {
  const { t } = useI18n()
  const workflow = useTaskWorkflowContext()
  const [query, setQuery] = useState('')
  const [searchLimits, setSearchLimits] = useState<Record<string, number>>({})
  const [sessionLimits, setSessionLimits] = useState<Record<string, number>>({})
  const [collapsed, setCollapsed] = useState(readCollapsedProjects)
  const previousSelection = useRef({ activeProjectId, activeSessionId })
  useEffect(() => {
    const previous = previousSelection.current
    previousSelection.current = { activeProjectId, activeSessionId }
    if (activeView === 'session' && activeProjectId && (previous.activeProjectId !== activeProjectId || previous.activeSessionId !== activeSessionId)) {
      setCollapsed((value) => ({ ...value, [activeProjectId]: false }))
    }
  }, [activeProjectId, activeSessionId, activeView])
  useEffect(() => saveCollapsedProjects(collapsed), [collapsed])
  const revealProject = (projectId: string) => {
    const next = { ...collapsed, [projectId]: false }
    // Compact-layout selection unmounts the drawer before a state effect can persist this.
    saveCollapsedProjects(next)
    setCollapsed(next)
  }
  const sidebarRef = useFocusTrap<HTMLElement>(overlay, onClose)
  const [projectMenu, setProjectMenu] = useState<string | null>(null)
  const [projectSortMenuOpen, setProjectSortMenuOpen] = useState(false)
  const [sessionMenu, setSessionMenu] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<SessionRecord | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [archiveTarget, setArchiveTarget] = useState<SessionRecord | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ProjectRecord | null>(null)
  const { activeSessions, sessionsByProject } = useMemo(() => indexSidebarSessions(projects, sessions), [projects, sessions])
  const isRunning = (session: SessionRecord) => isSessionRunning(session, liveBySession[session.filePath])
  const needsAttention = (session: SessionRecord) => sessionNeedsAttention(session, clearedAttention)
  const attentionSessions = useMemo(
    () => activeSessions.filter((session) => !isRunning(session) && (isSessionWaiting(session) || sessionNeedsAttention(session, clearedAttention))),
    [activeSessions, clearedAttention, liveBySession],
  )
  const runningSessions = useMemo(
    () => activeSessions.filter((session) => isRunning(session)),
    [activeSessions, liveBySession],
  )
  const openSession = (session: SessionRecord, projectId?: string) => {
    setSessionMenu(null)
    setQuery('')
    if (projectId) revealProject(projectId)
    onSelectSession(session)
  }
  const unreadCount = activeSessions.reduce((count, session) => count + Number(needsAttention(session)), 0)
  const activeProject = useMemo(() => projects.find((project) => project.id === activeProjectId), [projects, activeProjectId])
  const newSessionShortcut = shortcutLabel(platform, ['Primary', 'N'])
  const sidebarShortcut = shortcutLabel(platform, ['Primary', 'B'])
  const settingsShortcut = shortcutLabel(platform, ['Primary', ','])
  const terminalShortcut = shortcutLabel(platform, ['Primary', 'J'])
  useEffect(() => {
    if (!projectMenu) return
    const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.project-group')) setProjectMenu(null) }
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setProjectMenu(null) } }
    document.addEventListener('pointerdown', dismiss, true); document.addEventListener('keydown', dismissOnEscape, true)
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', dismissOnEscape, true) }
  }, [projectMenu])
  useEffect(() => {
    if (!projectSortMenuOpen) return
    const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.sidebar__sort-menu, .sidebar__sort-toggle')) setProjectSortMenuOpen(false) }
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setProjectSortMenuOpen(false) } }
    document.addEventListener('pointerdown', dismiss, true); document.addEventListener('keydown', dismissOnEscape, true)
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', dismissOnEscape, true) }
  }, [projectSortMenuOpen])
  useEffect(() => {
    if (!sessionMenu) return
    const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.session-row-wrap')) setSessionMenu(null) }
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setSessionMenu(null) } }
    document.addEventListener('pointerdown', dismiss, true); document.addEventListener('keydown', dismissOnEscape, true)
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', dismissOnEscape, true) }
  }, [sessionMenu])
  useEffect(() => {
    if (!archiveTarget) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-archive-confirming="true"]')) setArchiveTarget(null)
    }
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setArchiveTarget(null) } }
    document.addEventListener('pointerdown', dismiss, true); document.addEventListener('keydown', dismissOnEscape, true)
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', dismissOnEscape, true) }
  }, [archiveTarget])
  const normalized = query.trim().toLowerCase()
  const { projectSections, matchingSessions } = useMemo(() => {
    if (normalized) {
      const matchingSessions = new Map([...sessionsByProject].map(([id, items]) => [
        id, items.filter((session) => `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized)),
      ]))
      return {
        projectSections: [
          { id: 'project-matches', label: 'Project matches', projects: sortProjects(projects.filter((project) => `${project.name} ${project.path} ${project.folders.join(' ')}`.toLowerCase().includes(normalized)), projectSortMode) },
          { id: 'session-matches', label: 'Session matches', projects: sortProjects(projects.filter((project) => matchingSessions.get(project.id)?.length), projectSortMode) },
        ],
        matchingSessions,
      }
    }
    const unpinned = sortProjects(projects.filter((project) => !project.pinned), 'recent')
    const recent = unpinned.slice(0, RECENT_PROJECT_LIMIT)
    const current = unpinned.find((project) => project.id === activeProjectId)
    if (current && !recent.includes(current)) recent.splice(RECENT_PROJECT_LIMIT - 1, 1, current)
    const sortedPinned = sortProjects(projects.filter((project) => project.pinned), projectSortMode)
    const sortedRecent = sortProjects(recent, projectSortMode)
    return {
      projectSections: [
        { id: 'projects', label: 'Projects', projects: [...sortedPinned, ...sortedRecent] },
      ],
      matchingSessions: new Map<string, SessionRecord[]>(),
    }
  }, [projects, sessionsByProject, normalized, projectSortMode, activeProjectId])
  const visibleProjects = projectSections.flatMap((section) => section.projects)

  return (
    <aside ref={sidebarRef} className="sidebar" aria-label="Project and session navigation" tabIndex={overlay ? -1 : undefined}>
      <div className="sidebar__titlebar drag-region">
        <div className="traffic-light-clearance" aria-hidden="true" />
        {/* The toolbar owns the toggle; an overlay sidebar covers the toolbar, so it carries its own. */}
        {overlay ? <IconButton className="sidebar__toggle no-drag" label={`Hide sidebar (${sidebarShortcut})`} onClick={onClose}><SidebarLeft size={16} /></IconButton> : null}
        <div className="sidebar__brand no-drag" aria-label={HARNESS_PRODUCT_NAMES.pi}>
          <PiMark size={24} />
        </div>
        <div className="sidebar__title-actions no-drag">
          <IconButton className="sidebar__new-session" label={`New session (${newSessionShortcut})`} onClick={() => onNewSession()}><NotePencil size={16} /></IconButton>
        </div>
      </div>

      <nav className="sidebar__primary" aria-label="Primary">
        <div className="sidebar-search">
          <MagnifyingGlass size={13} />
          <input id="session-search" value={query} onChange={(event) => { setQuery(event.target.value); setSearchLimits({}) }} onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.stopPropagation(); setQuery('') } }} placeholder="Search projects and sessions" aria-label="Search projects and sessions" />
          {query ? <IconButton size="small" label="Clear search" onClick={() => setQuery('')}>×</IconButton> : null}
        </div>
        <div className="sidebar__destinations">
          <ApexButton variant="quiet" title={t('nav.projects')} className={activeView === 'projects' ? 'is-active' : ''} onClick={() => onNavigate('projects')}><Folder size={16} /><span className="sr-only">{t('nav.projects')}</span></ApexButton>
          <ApexButton variant="quiet" title={t('nav.activity')} className={activeView === 'activity' ? 'is-active' : ''} onClick={() => onNavigate('activity')}><Bell size={16} /><span className="sr-only">{t('nav.activity')}</span>{unreadCount ? <Badge variant="orange" label={String(unreadCount)} className="nav-count" /> : null}</ApexButton>
          <ApexButton variant="quiet" title={t('nav.scheduled')} className={activeView === 'scheduled' ? 'is-active' : ''} onClick={() => onNavigate('scheduled')}><CalendarDots size={16} /><span className="sr-only">{t('nav.scheduled')}</span></ApexButton>
          <ApexButton variant="quiet" title={t('nav.capabilities')} className={activeView === 'plugins' ? 'is-active' : ''} onClick={() => onNavigate('plugins')}><Package size={16} /><span className="sr-only">{t('nav.capabilities')}</span></ApexButton>
        </div>
      </nav>

      <div className="sidebar__scroll scroll-area">
        {normalized ? null : (
          <SidebarAttentionGroups
            attention={attentionSessions}
            running={runningSessions}
            liveBySession={liveBySession}
            projects={projects}
            activeSessionId={activeSessionId}
            activeView={activeView}
            onOpenSession={openSession}
          />
        )}
        <div className="sidebar__section-heading"><span>{normalized ? 'Search results' : 'Projects'}</span><span className="sidebar__section-heading-actions">{!normalized ? <IconButton size="small" label="Collapse all projects" onClick={() => { setProjectMenu(null); setCollapsed(Object.fromEntries(projects.map((project) => [project.id, true]))) }}><CaretRight size={13} /></IconButton> : null}<IconButton size="small" className={`sidebar__sort-toggle ${projectSortMode !== 'recent' ? 'is-sorted' : ''}`} aria-haspopup="menu" aria-expanded={projectSortMenuOpen} label={t('projects.sort')} onClick={() => setProjectSortMenuOpen((open) => !open)}><FunnelSimple size={13} /></IconButton><IconButton size="small" label="Add project" onClick={onAddProject}><FolderPlus size={13} /></IconButton>{projectSortMenuOpen ? <div className="sidebar__sort-menu" role="menu" aria-label={t('projects.sort.menu')}><div className="sidebar-menu__label" aria-hidden="true">{t('projects.sort.menu')}</div>{PROJECT_SORT_MODES.map((mode) => <button key={mode} type="button" role="menuitemradio" aria-checked={projectSortMode === mode} className={projectSortMode === mode ? 'is-active' : ''} onClick={() => { setProjectSortMenuOpen(false); onSetProjectSortMode(mode) }}>{t(PROJECT_SORT_LABEL_KEYS[mode])}{projectSortMode === mode ? <Check size={12} aria-hidden="true" /> : null}</button>)}</div> : null}</span></div>
        {loading ? <div className="compact-state" role="status"><EmptyState title="Loading sessions…">{null}</EmptyState></div> : null}
      {!loading && visibleProjects.length === 0 ? <div className="compact-state"><EmptyState title={normalized ? 'No matching projects or sessions' : 'No projects yet'}>{null}</EmptyState></div> : null}
        {projectSections.filter((section) => section.projects.length > 0).map((section) => (
          <section key={section.id} className="sidebar__project-section" aria-label={section.label}>
            {normalized ? <h2 className="sidebar__group-heading">{section.label}</h2> : null}
            {section.projects.map((project) => {
              const allSessions = sessionsByProject.get(project.id) ?? []
              const projectSessions = normalized ? matchingSessions.get(project.id) ?? [] : allSessions
              const isCollapsed = normalized ? section.id === 'project-matches' : collapsed[project.id] ?? project.id !== activeProjectId
              const limit = (normalized ? searchLimits : sessionLimits)[project.id] ?? SIDEBAR_SESSION_LIMIT
              const visibleSessions = normalized ? projectSessions.slice(0, limit) : boundedSidebarSessions(projectSessions, {
                limit,
                include: (session) => session.id === activeSessionId || isRunning(session) || needsAttention(session),
              })
              const remaining = projectSessions.length - visibleSessions.length
              const running = allSessions.some((session) => isRunning(session))
              const attentionCount = allSessions.filter(needsAttention).length
              const rowId = `${section.id}:${project.id}`
              return (
                <div className="project-group" key={project.id}>
                  <div
                    className={`project-row ${activeProjectId === project.id && activeView === 'session' ? 'is-selected' : ''} ${projectMenu === rowId ? 'is-menu-open' : ''}`}
                    onContextMenu={(event) => { event.preventDefault(); setProjectMenu(rowId) }}
                  >
                    {!normalized ? <button className="project-row__collapse" type="button" aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.name}`} title={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.name}`} onClick={() => { setProjectMenu(null); setCollapsed((value) => ({ ...value, [project.id]: !isCollapsed })) }}>
                      <CaretDown size={12} />
                    </button> : null}
                    <button className="project-row__main" type="button" onClick={() => { setProjectMenu(null); setQuery(''); revealProject(project.id); onSelectProject(project) }} title={project.path}>
                      <span>{project.name}</span>
                    </button>
                    <IconButton size="small" className="project-row__new-session row-action" label={`New session in ${project.name}`} onClick={() => { setProjectMenu(null); onNewSession(project) }}><NotePencil size={13} /></IconButton>
                    {running ? <span className="project-working" role="img" aria-label="Agent working" title="Agent working"><StatusMark state="running" size={14} /></span> : null}
                    {attentionCount ? <span className="project-attention" role="img" aria-label={`${attentionCount} sessions need attention`} title={`${attentionCount} sessions need attention`}>{attentionCount}</span> : null}
                    {project.pinned ? <PushPin className="project-row__pin" size={11} /> : null}
                    {projectMenu === rowId ? <div className="project-row__menu" role="menu" aria-label={`Project options for ${project.name}`}>{!project.inferred ? <button type="button" role="menuitem" onClick={() => { setProjectMenu(null); onTogglePinProject(project) }}><PushPin size={12} /> {t(project.pinned ? 'projects.unpin' : 'projects.pin')}</button> : null}<button type="button" role="menuitem" className="is-danger" onClick={() => { setProjectMenu(null); setRemoveTarget(project) }}><Trash size={12} /> Remove project</button></div> : null}
                  </div>
                  {!isCollapsed ? (
                    <div className="session-list">
                      {visibleSessions.map((session) => {
                        const isSelected = activeSessionId === session.id && activeView === 'session'
                        const hasAttn = needsAttention(session)
                        return (
                          <div key={session.id} className={`session-row-wrap session-row-wrap--${session.status} ${hasAttn ? 'has-attention' : ''} ${isSelected ? 'is-selected' : ''} ${sessionMenu === session.id ? 'is-menu-open' : ''}`}>
                            <button type="button" title={session.title} aria-current={isSelected ? 'page' : undefined} className="session-row" onClick={() => openSession(session, project.id)} onContextMenu={(event) => { event.preventDefault(); setSessionMenu(session.id) }}>
                              <span className="sr-only">{statusLabel[session.status]}: </span>
                              <span className="session-row__text"><span className="session-row__title">{session.title}{workflow?.finished.has(session.filePath) ? <span className="task-finished-badge">Finished</span> : null}</span><span className="session-row__meta" title={formatRelative(session.updatedAt)}>{sessionRowMeta(session, runtimeOwners?.get(session.filePath), liveBySession[session.filePath])}</span></span>
                              <SessionStatusGlyph session={session} attention={hasAttn} live={liveBySession[session.filePath]} />
                            </button>
                            <IconButton
                              size="small"
                              className={`session-row__archive ${archiveTarget?.id === session.id ? 'is-confirming' : ''}`}
                              label={archiveTarget?.id === session.id ? `Confirm archive ${session.title}` : `Archive ${session.title}`}
                              data-archive-confirming={archiveTarget?.id === session.id}
                              onClick={() => {
                                setSessionMenu(null)
                                if (archiveTarget?.id !== session.id) { setArchiveTarget(session); return }
                                setArchiveTarget(null)
                                void onArchiveSession(session)
                              }}
                            >{archiveTarget?.id === session.id ? <Check size={13} /> : <Archive size={13}/>}</IconButton>
                            <IconButton size="small" className="session-row__more" aria-expanded={sessionMenu === session.id} label={`Session options for ${session.title}`} onClick={() => setSessionMenu((current) => current === session.id ? null : session.id)}><DotsThree size={13}/></IconButton>
                            {sessionMenu === session.id ? <div className="session-row__menu" aria-label="Session options">
                              <button type="button" onClick={() => { void copySessionUuid(session.id); setSessionMenu(null) }}><Copy size={12}/> Copy session UUID</button>
                              <button type="button" onClick={() => { setRenameTarget(session); setRenameValue(session.title); setSessionMenu(null) }}><NotePencil size={12}/> Rename</button>
                              {onContinueInVsCode && !runtimeOwners?.has(session.filePath) ? <button
                                type="button"
                                disabled={isRunning(session) || isSessionWaiting(session)}
                                title={isRunning(session) || isSessionWaiting(session) ? 'Stop the current run before continuing in VS Code.' : 'Move this session to VS Code. You can close Desktop afterward.'}
                                onClick={() => { setSessionMenu(null); onContinueInVsCode(session) }}
                              ><Code size={12}/> Continue in VS Code</button> : null}
                            </div> : null}
                          </div>
                        )
                      })}
                      {remaining > 0 ? <button type="button" className="session-row session-row--empty" onClick={() => (normalized ? setSearchLimits : setSessionLimits)((limits) => ({ ...limits, [project.id]: limit + SIDEBAR_SESSION_LIMIT }))}>{normalized ? `Show more matches (${remaining} remaining)` : `Show older sessions (${remaining})`}</button> : null}
                      {projectSessions.length === 0 ? <button type="button" title={`New session in ${project.name}`} className="session-row session-row--empty" onClick={() => { setProjectMenu(null); onNewSession(project) }}><NotePencil size={12} /> New session</button> : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </section>
        ))}
      </div>

      <div className="sidebar__footer" role="toolbar" aria-label="Workspace tools">
        <IconButton className={activeView === 'settings' ? 'is-active' : ''} label={`${t('nav.settings')} (${settingsShortcut})`} onClick={() => onNavigate('settings')}><Gear size={16} /></IconButton>
        {onToggleVoice ? <IconButton className={voiceOpen ? 'is-active voice-toggle--active' : ''} label={voiceOpen ? 'Close realtime voice' : 'Open realtime voice'} onClick={onToggleVoice}><Waveform size={16} /></IconButton> : null}
        {onToggleTerminal ? <IconButton className={terminalOpen && activeView === 'session' ? 'is-active' : ''} label={`Toggle terminal (${terminalShortcut})`} onClick={onToggleTerminal}><Terminal size={16} /></IconButton> : null}
        {onOpenInVsCode ? <IconButton label={activeProject ? `Open ${activeProject.name} in VS Code` : 'Open in VS Code'} disabled={!activeProject} onClick={() => { if (activeProject) onOpenInVsCode(activeProject.path) }}><Code size={16} /></IconButton> : null}
      </div>

      {renameTarget ? <Modal title="Rename session" onClose={() => setRenameTarget(null)} footer={<><ApexButton onClick={() => setRenameTarget(null)}>Cancel</ApexButton><ApexButton variant="primary" disabled={!renameValue.trim()} onClick={() => { const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) }}>Rename</ApexButton></>}><TextInput label="Session name" hasAutoFocus value={renameValue} containerClassName="field" onChange={(nextValue) => setRenameValue(nextValue.slice(0, 200))} onKeyDown={(event) => { if (event.key === 'Enter' && renameValue.trim()) { event.preventDefault(); const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) } }} /></Modal> : null}
      {removeTarget ? <Modal title="Remove project" onClose={() => setRemoveTarget(null)} footer={<><ApexButton onClick={() => setRemoveTarget(null)}>Cancel</ApexButton><ApexButton variant="danger" onClick={() => { const target = removeTarget; setRemoveTarget(null); onRemoveProject(target) }}>Remove</ApexButton></>}><p>Remove “{removeTarget.name}” from {HARNESS_PRODUCT_NAMES[activeHarness]}? The folder and saved sessions will not be deleted.</p></Modal> : null}
    </aside>
  )
}

export function areSidebarPropsEqual(previous: SidebarProps, next: SidebarProps): boolean {
  return previous.projects === next.projects
    && previous.sessions === next.sessions
    && previous.activeProjectId === next.activeProjectId
    && previous.activeSessionId === next.activeSessionId
    && previous.activeView === next.activeView
    && previous.activeHarness === next.activeHarness
    && previous.clearedAttention === next.clearedAttention
    && previous.liveBySession === next.liveBySession
    && previous.onSelectProject === next.onSelectProject
    && previous.onSelectSession === next.onSelectSession
    && previous.onNavigate === next.onNavigate
    && previous.onNewSession === next.onNewSession
    && previous.onAddProject === next.onAddProject
    && previous.onRemoveProject === next.onRemoveProject
    && previous.projectSortMode === next.projectSortMode
    && previous.onSetProjectSortMode === next.onSetProjectSortMode
    && previous.onTogglePinProject === next.onTogglePinProject
    && previous.onClose === next.onClose
    && previous.onOpenPalette === next.onOpenPalette
    && previous.onRenameSession === next.onRenameSession
    && previous.onArchiveSession === next.onArchiveSession
    && previous.runtimeOwners === next.runtimeOwners
    && previous.onContinueInVsCode === next.onContinueInVsCode
    && previous.terminalOpen === next.terminalOpen
    && previous.voiceOpen === next.voiceOpen
    && previous.onToggleTerminal === next.onToggleTerminal
    && previous.onToggleVoice === next.onToggleVoice
    && previous.onOpenInVsCode === next.onOpenInVsCode
    && previous.overlay === next.overlay
    && previous.platform === next.platform
}

export const Sidebar = memo(SidebarView, areSidebarPropsEqual)
