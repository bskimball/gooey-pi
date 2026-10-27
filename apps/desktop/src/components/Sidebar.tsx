import {
  Archive,
  Bell,
  CalendarDots,
  CaretDown,
  CaretRight,
  ChatCircleDots,
  Check,
  CheckCircle,
  CircleNotch,
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
  Trash,
} from './icons'
import { memo, useEffect, useMemo, useState } from 'react'
import { PROJECT_SORT_MODES, type HarnessId, type ProjectRecord, type ProjectSortMode, type SessionRecord, type WorkspaceView } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { HARNESS_PRODUCT_NAMES } from '@/lib/harness'
import { sortProjects } from '@/lib/project-order'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { sessionAttentionSignature, signatureCleared } from '@/app/session-attention'
import { IconButton, Modal, PiMark, useFocusTrap } from './ui'

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
  overlay?: boolean
  platform?: NodeJS.Platform
}

const statusLabel: Record<SessionRecord['status'], string> = {
  idle: 'Idle', running: 'Running', waiting: 'Waiting for input', complete: 'Finished', failed: 'Failed', unknown: 'Unknown',
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

export function boundedSidebarSessions(sessions: SessionRecord[]): SessionRecord[] {
  return sessions.slice(0, SIDEBAR_SESSION_LIMIT)
}


function SessionStatusMark({ status, attention }: { status: SessionRecord['status']; attention: boolean }) {
  const title = status === 'failed' && !attention ? 'Failed — notification cleared' : statusLabel[status]
  if (status === 'running') return <span className="session-status-mark session-status-mark--running" title={statusLabel[status]}><CircleNotch className="spin" size={13} /></span>
  if (status === 'waiting') return <span className="session-status-mark session-status-mark--waiting" title={statusLabel[status]}><ChatCircleDots size={12} /></span>
  if (status === 'complete') return <span className="session-status-mark session-status-mark--complete" title={statusLabel[status]}><CheckCircle size={12} /></span>
  return <span className={`session-status-mark session-status-mark--${status}`} title={title}><span /></span>
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

function SidebarView({ projects, sessions, loading = false, activeProjectId, activeSessionId, activeView, activeHarness = 'pi', clearedAttention = {}, onSelectProject, onSelectSession, onNavigate, onNewSession, onAddProject, onRemoveProject, projectSortMode = 'recent', onSetProjectSortMode = () => undefined, onTogglePinProject = () => undefined, onClose, onRenameSession, onArchiveSession, overlay = false, platform = 'darwin' }: SidebarProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [searchLimits, setSearchLimits] = useState<Record<string, number>>({})
  const [collapsed, setCollapsed] = useState(readCollapsedProjects)
  useEffect(() => {
    try { window.localStorage.setItem(COLLAPSED_PROJECTS_STORAGE_KEY, JSON.stringify(collapsed)) } catch { /* Keep navigation usable when storage is unavailable. */ }
  }, [collapsed])
  const sidebarRef = useFocusTrap<HTMLElement>(overlay, onClose)
  const [projectMenu, setProjectMenu] = useState<string | null>(null)
  const [projectSortMenuOpen, setProjectSortMenuOpen] = useState(false)
  const [sessionMenu, setSessionMenu] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<SessionRecord | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [archiveTarget, setArchiveTarget] = useState<SessionRecord | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ProjectRecord | null>(null)
  const { activeSessions, sessionsByProject } = useMemo(() => indexSidebarSessions(projects, sessions), [projects, sessions])
  const needsAttention = (session: SessionRecord) => {
    const signature = sessionAttentionSignature(session)
    return Boolean(signature && !signatureCleared(signature, clearedAttention[session.id], session.unread))
  }
  const unreadCount = activeSessions.reduce((count, session) => count + Number(needsAttention(session)), 0)
  const newSessionShortcut = shortcutLabel(platform, ['Primary', 'N'])
  const sidebarShortcut = shortcutLabel(platform, ['Primary', 'B'])
  const settingsShortcut = shortcutLabel(platform, ['Primary', ','])
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
    return {
      projectSections: [
        { id: 'pinned', label: 'Pinned', projects: sortProjects(projects.filter((project) => project.pinned), projectSortMode) },
        { id: 'recent', label: 'Recent', projects: sortProjects(recent, projectSortMode) },
      ],
      matchingSessions: new Map<string, SessionRecord[]>(),
    }
  }, [projects, sessionsByProject, normalized, projectSortMode, activeProjectId])
  const visibleProjects = projectSections.flatMap((section) => section.projects)
  const visiblePaths = new Set(visibleProjects.flatMap((project) => [project.path, ...project.folders]))
  const otherSessions = activeSessions.filter((session) => !visiblePaths.has(session.projectPath))
  const otherRunning = otherSessions.filter((session) => session.status === 'running').length
  const otherAttention = otherSessions.filter(needsAttention).length
  const otherActivity = [otherRunning ? `${otherRunning} working` : '', otherAttention ? `${otherAttention} to review` : ''].filter(Boolean).join(' · ')

  return (
    <aside ref={sidebarRef} className="sidebar" aria-label="Project and session navigation" tabIndex={overlay ? -1 : undefined}>
      <div className="sidebar__titlebar drag-region">
        <div className="traffic-light-clearance" aria-hidden="true" />
        {/* Same screen position as the toolbar's Show sidebar button, so one spot toggles both ways. */}
        <IconButton className="sidebar__toggle no-drag" label={`Hide sidebar (${sidebarShortcut})`} onClick={onClose}><SidebarLeft size={16} /></IconButton>
        <div className="sidebar__brand no-drag" aria-label={HARNESS_PRODUCT_NAMES.pi}>
          <PiMark size={24} />
        </div>
        <div className="sidebar__title-actions no-drag">
          <IconButton label={`New session (${newSessionShortcut})`} onClick={() => onNewSession()}><NotePencil size={16} /></IconButton>
        </div>
      </div>

      <nav className="sidebar__primary" aria-label="Primary">
        <div className="sidebar-search">
          <MagnifyingGlass size={13} />
          <input id="session-search" value={query} onChange={(event) => { setQuery(event.target.value); setSearchLimits({}) }} onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.stopPropagation(); setQuery('') } }} placeholder="Search projects, chats" aria-label="Search projects and sessions" />
          {query ? <button type="button" title="Clear search" aria-label="Clear search" onClick={() => setQuery('')}>×</button> : null}
        </div>
        <div className="sidebar__destinations">
          <button type="button" title={t('nav.projects')} className={activeView === 'projects' ? 'is-active' : ''} onClick={() => onNavigate('projects')}><Folder size={16} /><span className="sr-only">{t('nav.projects')}</span></button>
          <button type="button" title={t('nav.activity')} className={activeView === 'activity' ? 'is-active' : ''} onClick={() => onNavigate('activity')}><Bell size={16} /><span className="sr-only">{t('nav.activity')}</span>{unreadCount ? <span className="nav-count">{unreadCount}</span> : null}</button>
          <button type="button" title={t('nav.scheduled')} className={activeView === 'scheduled' ? 'is-active' : ''} onClick={() => onNavigate('scheduled')}><CalendarDots size={16} /><span className="sr-only">{t('nav.scheduled')}</span></button>
          <button type="button" title={t('nav.capabilities')} className={activeView === 'plugins' ? 'is-active' : ''} onClick={() => onNavigate('plugins')}><Package size={16} /><span className="sr-only">{t('nav.capabilities')}</span></button>
        </div>
      </nav>

      <div className="sidebar__scroll scroll-area">
        <div className="sidebar__section-heading"><span>{normalized ? 'Search results' : 'Projects'}</span><span className="sidebar__section-heading-actions">{!normalized ? <IconButton size="small" label="Collapse all projects" onClick={() => { setProjectMenu(null); setCollapsed(Object.fromEntries(projects.map((project) => [project.id, true]))) }}><CaretRight size={13} /></IconButton> : null}<IconButton size="small" className={`sidebar__sort-toggle ${projectSortMode !== 'recent' ? 'is-sorted' : ''}`} aria-haspopup="menu" aria-expanded={projectSortMenuOpen} label={t('projects.sort')} onClick={() => setProjectSortMenuOpen((open) => !open)}><FunnelSimple size={13} /></IconButton><IconButton size="small" label="Add project" onClick={onAddProject}><FolderPlus size={13} /></IconButton>{projectSortMenuOpen ? <div className="sidebar__sort-menu" role="menu" aria-label={t('projects.sort.menu')}><div className="sidebar-menu__label" aria-hidden="true">{t('projects.sort.menu')}</div>{PROJECT_SORT_MODES.map((mode) => <button key={mode} type="button" role="menuitemradio" aria-checked={projectSortMode === mode} className={projectSortMode === mode ? 'is-active' : ''} onClick={() => { setProjectSortMenuOpen(false); onSetProjectSortMode(mode) }}>{t(PROJECT_SORT_LABEL_KEYS[mode])}{projectSortMode === mode ? <Check size={12} aria-hidden="true" /> : null}</button>)}</div> : null}</span></div>
        {loading ? <p className="sidebar__empty" role="status">Loading sessions…</p> : null}
      {!loading && visibleProjects.length === 0 ? <p className="sidebar__empty">{normalized ? 'No matching projects or sessions' : 'No projects yet'}</p> : null}
        {projectSections.filter((section) => section.projects.length > 0).map((section) => (
          <section key={section.id} className="sidebar__project-section" aria-label={section.label}>
            <h2 className="sidebar__group-heading">{section.label}</h2>
            {section.projects.map((project) => {
              const allSessions = sessionsByProject.get(project.id) ?? []
              const projectSessions = normalized ? matchingSessions.get(project.id) ?? [] : allSessions
              const isCollapsed = normalized ? section.id === 'project-matches' : collapsed[project.id] ?? project.id !== activeProjectId
              const running = allSessions.some((session) => session.status === 'running')
              const attentionCount = allSessions.filter(needsAttention).length
              const rowId = `${section.id}:${project.id}`
              return (
                <div className="project-group" key={project.id}>
                  <div
                    className={`project-row ${normalized ? 'project-row--search' : ''} ${activeProjectId === project.id && activeView === 'session' ? 'is-selected' : ''} ${projectMenu === rowId ? 'is-menu-open' : ''}`}
                    onContextMenu={(event) => { event.preventDefault(); setProjectMenu(rowId) }}
                  >
                    {!normalized ? <button className="project-row__collapse" type="button" aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.name}`} title={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.name}`} onClick={() => { setProjectMenu(null); setCollapsed((value) => ({ ...value, [project.id]: !isCollapsed })) }}>
                      {isCollapsed ? <CaretRight size={13} /> : <CaretDown size={13} />}
                    </button> : null}
                    <button className="project-row__main" type="button" onClick={() => { setProjectMenu(null); setQuery(''); onSelectProject(project) }} title={project.path}>
                      <span>{project.name}</span>
                      {project.pinned ? <PushPin className="project-row__pin" size={11} /> : null}
                    </button>
                    <IconButton size="small" className="project-row__new-session row-action" label={`New session in ${project.name}`} onClick={() => { setProjectMenu(null); onNewSession(project) }}><NotePencil size={13} /></IconButton>
                    {running ? <span className="project-working" role="img" aria-label="Agent working" title="Agent working"><CircleNotch className="spin" size={13} /></span> : null}
                    {attentionCount ? <span className="project-attention" role="img" aria-label={`${attentionCount} sessions need attention`} title={`${attentionCount} sessions need attention`}>{attentionCount}</span> : null}
                    {projectMenu === rowId ? <div className="project-row__menu" role="menu" aria-label={`Project options for ${project.name}`}>{!project.inferred ? <button type="button" role="menuitem" onClick={() => { setProjectMenu(null); onTogglePinProject(project) }}><PushPin size={12} /> {t(project.pinned ? 'projects.unpin' : 'projects.pin')}</button> : null}<button type="button" role="menuitem" className="is-danger" onClick={() => { setProjectMenu(null); setRemoveTarget(project) }}><Trash size={12} /> Remove project</button></div> : null}
                  </div>
                  {!isCollapsed ? (
                    <div className="session-list">
                      {(normalized ? projectSessions.slice(0, searchLimits[project.id] ?? SIDEBAR_SESSION_LIMIT) : boundedSidebarSessions(projectSessions)).map((session) => (
                        <div key={session.id} className={`session-row-wrap session-row-wrap--${session.status} ${needsAttention(session) ? 'has-attention' : ''} ${activeSessionId === session.id && activeView === 'session' ? 'is-selected' : ''} ${sessionMenu === session.id ? 'is-menu-open' : ''}`}>
                          <button type="button" title={session.title} className="session-row" onClick={() => { setSessionMenu(null); setQuery(''); onSelectSession(session) }} onContextMenu={(event) => { event.preventDefault(); setSessionMenu(session.id) }}>
                            <SessionStatusMark status={session.status} attention={needsAttention(session)} />
                            <span className="session-row__text"><span className="session-row__title">{session.title}</span><span className="session-row__meta">{session.status === 'running' ? 'Working' : session.status === 'waiting' ? 'Needs attention' : session.status === 'complete' ? 'Finished' : formatRelative(session.updatedAt)}</span></span>
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
                          {sessionMenu === session.id ? <div className="session-row__menu" aria-label="Session options"><button type="button" onClick={() => { void copySessionUuid(session.id); setSessionMenu(null) }}><Copy size={12}/> Copy session UUID</button><button type="button" onClick={() => { setRenameTarget(session); setRenameValue(session.title); setSessionMenu(null) }}><NotePencil size={12}/> Rename</button></div> : null}
                        </div>
                      ))}
                      {normalized && projectSessions.length > (searchLimits[project.id] ?? SIDEBAR_SESSION_LIMIT) ? <button type="button" className="session-row session-row--empty" onClick={() => setSearchLimits((limits) => ({ ...limits, [project.id]: (limits[project.id] ?? SIDEBAR_SESSION_LIMIT) + SIDEBAR_SESSION_LIMIT }))}>Show more matches ({projectSessions.length - (searchLimits[project.id] ?? SIDEBAR_SESSION_LIMIT)} remaining)</button> : null}
                      {projectSessions.length === 0 ? <button type="button" title={`New session in ${project.name}`} className="session-row session-row--empty" onClick={() => { setProjectMenu(null); onNewSession(project) }}><NotePencil size={12} /> New session</button> : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </section>
        ))}
      </div>
      {!normalized && otherActivity ? <div className="sidebar__library">
        <button type="button" className="sidebar__other-activity" onClick={() => onNavigate('activity')} title="View activity across all projects"><Bell size={13} /><span>Elsewhere: {otherActivity}</span></button>
      </div> : null}

      <div className="sidebar__footer">
        <button type="button" title={t('nav.settings')} className={activeView === 'settings' ? 'is-active' : ''} onClick={() => onNavigate('settings')}><Gear size={15} /><span>{t('nav.settings')}</span><kbd>{settingsShortcut}</kbd></button>
      </div>
      {renameTarget ? <Modal title="Rename session" onClose={() => setRenameTarget(null)} footer={<><button type="button" className="button" onClick={() => setRenameTarget(null)}>Cancel</button><button type="button" className="button button--primary" disabled={!renameValue.trim()} onClick={() => { const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) }}>Rename</button></>}><label className="field"><span>Session name</span><input autoFocus value={renameValue} maxLength={200} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && renameValue.trim()) { event.preventDefault(); const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) } }}/></label></Modal> : null}
      {removeTarget ? <Modal title="Remove project" onClose={() => setRemoveTarget(null)} footer={<><button type="button" className="button" onClick={() => setRemoveTarget(null)}>Cancel</button><button type="button" className="button button--danger" onClick={() => { const target = removeTarget; setRemoveTarget(null); onRemoveProject(target) }}>Remove</button></>}><p>Remove “{removeTarget.name}” from {HARNESS_PRODUCT_NAMES[activeHarness]}? The folder and saved sessions will not be deleted.</p></Modal> : null}
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
    && previous.overlay === next.overlay
    && previous.platform === next.platform
}

export const Sidebar = memo(SidebarView, areSidebarPropsEqual)
