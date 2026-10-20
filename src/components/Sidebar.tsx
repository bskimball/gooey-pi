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
  DownloadSimple,
  Folder,
  FolderOpen,
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
import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { PROJECT_SORT_MODES, type AppUpdateState, type HarnessId, type ProjectRecord, type ProjectSortMode, type SessionRecord, type WorkspaceView } from '@/types/api'
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
  activeProjectId?: string
  activeSessionId?: string
  activeView: WorkspaceView
  activeHarness?: HarnessId
  clearedAttention?: Record<string, string>
  updateState?: AppUpdateState
  onUpdateAction?(): void | Promise<void>
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

function updateControlCopy(state: AppUpdateState): { label: string; title: string } {
  const version = state.version ? ` ${state.version}` : ''
  switch (state.phase) {
    case 'checking': return { label: 'Checking for updates', title: 'Checking GitHub Releases for a new Apex version' }
    case 'available': return { label: `Download${version}`, title: `Download and restart Apex${version}` }
    case 'downloading': return {
      label: state.percent === undefined ? `Downloading${version}` : `Downloading${version} · ${state.percent}%`,
      title: `Downloading Apex${version}`,
    }
    case 'downloaded': return { label: `Restart for${version}`, title: `Restart Apex and install version${version}` }
    case 'not-available': return { label: 'Apex is up to date', title: 'Check again for a new Apex release' }
    case 'error': return { label: version ? `Retry update${version}` : 'Retry update', title: state.message ?? 'Update failed — try checking again' }
    case 'unsupported': return { label: 'Automatic updates', title: state.message ?? 'Automatic updates are available in installed builds' }
    default: return { label: 'Release updates', title: 'Check for a new Apex release' }
  }
}

/** Announced without the percentage so progress ticks do not spam assistive tech. */
function updateAnnouncement(state: AppUpdateState): string {
  const version = state.version ? ` ${state.version}` : ''
  switch (state.phase) {
    case 'available': return `Apex update${version} is available`
    case 'downloading': return `Downloading Apex update${version}`
    case 'downloaded': return `Apex update${version} is ready to install`
    case 'error': return `Apex update failed. ${state.message ?? 'Try again.'}`
    default: return ''
  }
}

function updateConfirmCopy(state: AppUpdateState): { title: string; body: string } {
  if (state.phase === 'downloaded') return {
    title: 'Restart Apex to install the update?',
    body: 'Apex will close and restart to finish installing the update.',
  }
  return {
    title: 'Download and Restart Apex?',
    body: 'Apex will download the update, close, and restart when it is ready.',
  }
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

function SidebarView({ projects, sessions, activeProjectId, activeSessionId, activeView, activeHarness = 'pi', clearedAttention = {}, updateState = { phase: 'unsupported' }, onUpdateAction, onSelectProject, onSelectSession, onNavigate, onNewSession, onAddProject, onRemoveProject, projectSortMode = 'recent', onSetProjectSortMode = () => undefined, onTogglePinProject = () => undefined, onClose, onOpenPalette, onRenameSession, onArchiveSession, overlay = false, platform = 'darwin' }: SidebarProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const sidebarRef = useFocusTrap<HTMLElement>(overlay, onClose)
  const [projectMenu, setProjectMenu] = useState<string | null>(null)
  const [projectSortMenuOpen, setProjectSortMenuOpen] = useState(false)
  const [sessionMenu, setSessionMenu] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<SessionRecord | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [archiveTarget, setArchiveTarget] = useState<SessionRecord | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ProjectRecord | null>(null)
  const [confirmUpdate, setConfirmUpdate] = useState(false)
  const { activeSessions, sessionsByProject } = useMemo(() => indexSidebarSessions(projects, sessions), [projects, sessions])
  const needsAttention = (session: SessionRecord) => {
    const signature = sessionAttentionSignature(session)
    return Boolean(signature && !signatureCleared(signature, clearedAttention[session.id], session.unread))
  }
  const unreadCount = activeSessions.reduce((count, session) => count + Number(needsAttention(session)), 0)
  const newSessionShortcut = shortcutLabel(platform, ['Primary', 'N'])
  const sidebarShortcut = shortcutLabel(platform, ['Primary', 'B'])
  const commandsShortcut = shortcutLabel(platform, ['Primary', 'K'])
  const settingsShortcut = shortcutLabel(platform, ['Primary', ','])
  const updateCopy = updateControlCopy(updateState)
  const updateConfirm = updateConfirmCopy(updateState)
  const updateBusy = updateState.phase === 'checking' || updateState.phase === 'downloading'
  const updateIndeterminate = updateState.phase === 'downloading' && updateState.percent === undefined
  const updateVisible = updateState.phase === 'available' || updateState.phase === 'downloading' || updateState.phase === 'downloaded' || updateState.phase === 'error'
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
  const visibleProjects = useMemo(() => sortProjects(projects.filter((project) => !normalized || project.name.toLowerCase().includes(normalized) || (sessionsByProject.get(project.id) ?? []).some((session) => `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized))), projectSortMode), [projects, sessionsByProject, normalized, projectSortMode])

  return (
    <aside ref={sidebarRef} className="sidebar" aria-label="Project and session navigation" tabIndex={overlay ? -1 : undefined}>
      <div className="sidebar__titlebar drag-region">
        <div className="traffic-light-clearance" aria-hidden="true" />
        <div className="sidebar__brand no-drag" aria-label={HARNESS_PRODUCT_NAMES.pi}>
          <PiMark size={24} />
        </div>
        <div className="sidebar__title-actions no-drag">
          <IconButton label={`New session (${newSessionShortcut})`} onClick={() => onNewSession()}><NotePencil size={16} /></IconButton>
          <IconButton label={`Hide sidebar (${sidebarShortcut})`} onClick={onClose}><SidebarLeft size={16} /></IconButton>
        </div>
      </div>

      <nav className="sidebar__primary" aria-label="Primary">
        <div className="sidebar-search">
          <MagnifyingGlass size={13} />
          <input id="session-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.stopPropagation(); setQuery('') } }} placeholder="Search projects, chats" aria-label="Search projects and sessions" />
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
        <div className="sidebar__section-heading"><span>Projects</span><span className="sidebar__section-heading-actions"><IconButton size="small" className={`sidebar__sort-toggle ${projectSortMode !== 'recent' ? 'is-sorted' : ''}`} aria-haspopup="menu" aria-expanded={projectSortMenuOpen} label={t('projects.sort')} onClick={() => setProjectSortMenuOpen((open) => !open)}><FunnelSimple size={13} /></IconButton><IconButton size="small" label="Add project" onClick={onAddProject}><FolderPlus size={13} /></IconButton>{projectSortMenuOpen ? <div className="sidebar__sort-menu" role="menu" aria-label={t('projects.sort.menu')}><div className="sidebar-menu__label" aria-hidden="true">{t('projects.sort.menu')}</div>{PROJECT_SORT_MODES.map((mode) => <button key={mode} type="button" role="menuitemradio" aria-checked={projectSortMode === mode} className={projectSortMode === mode ? 'is-active' : ''} onClick={() => { setProjectSortMenuOpen(false); onSetProjectSortMode(mode) }}>{t(PROJECT_SORT_LABEL_KEYS[mode])}{projectSortMode === mode ? <Check size={12} aria-hidden="true" /> : null}</button>)}</div> : null}</span></div>
        {visibleProjects.length === 0 ? <p className="sidebar__empty">No matching work</p> : null}
        {visibleProjects.map((project) => {
          const projectSessions = (sessionsByProject.get(project.id) ?? []).filter((session) => !normalized || `${session.title} ${session.preview ?? ''}`.toLowerCase().includes(normalized) || project.name.toLowerCase().includes(normalized))
          const isCollapsed = collapsed[project.id] ?? false
          const running = projectSessions.some((session) => session.status === 'running')
          return (
            <div className="project-group" key={project.id}>
              <div
                className={`project-row ${activeProjectId === project.id && activeView === 'session' ? 'is-selected' : ''} ${projectMenu === project.id ? 'is-menu-open' : ''}`}
                onContextMenu={(event) => { event.preventDefault(); setProjectMenu(project.id) }}
              >
                <button className="project-row__collapse" type="button" aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.name}`} title={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.name}`} onClick={() => { setProjectMenu(null); setCollapsed((value) => ({ ...value, [project.id]: !isCollapsed })) }}>
                  {isCollapsed ? <CaretRight size={13} /> : <CaretDown size={13} />}
                </button>
                <button className="project-row__main" type="button" onClick={() => { setProjectMenu(null); onSelectProject(project) }} title={project.path}>
                  {activeProjectId === project.id ? <FolderOpen size={14} /> : <Folder size={14} />}
                  <span>{project.name}</span>
                  {project.pinned ? <PushPin className="project-row__pin" size={11} /> : null}
                </button>
                <IconButton size="small" className="project-row__new-session row-action" label={`New session in ${project.name}`} onClick={() => { setProjectMenu(null); onNewSession(project) }}><NotePencil size={13} /></IconButton>
                {running ? <span className="project-working" title="Agent working"><CircleNotch className="spin" size={13} /></span> : null}
                {projectMenu === project.id ? <div className="project-row__menu" role="menu" aria-label={`Project options for ${project.name}`}>{!project.inferred ? <button type="button" role="menuitem" onClick={() => { setProjectMenu(null); onTogglePinProject(project) }}><PushPin size={12} /> {t(project.pinned ? 'projects.unpin' : 'projects.pin')}</button> : null}<button type="button" role="menuitem" className="is-danger" onClick={() => { setProjectMenu(null); setRemoveTarget(project) }}><Trash size={12} /> Remove project</button></div> : null}
              </div>
              {!isCollapsed ? (
                <div className="session-list">
                  {boundedSidebarSessions(projectSessions).map((session) => (
                    <div key={session.id} className={`session-row-wrap session-row-wrap--${session.status} ${needsAttention(session) ? 'has-attention' : ''} ${activeSessionId === session.id && activeView === 'session' ? 'is-selected' : ''} ${sessionMenu === session.id ? 'is-menu-open' : ''}`}>
                      <button type="button" title={session.title} className="session-row" onClick={() => { setSessionMenu(null); onSelectSession(session) }} onContextMenu={(event) => { event.preventDefault(); setSessionMenu(session.id) }}>
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
                  {projectSessions.length === 0 ? <button type="button" title={`New session in ${project.name}`} className="session-row session-row--empty" onClick={() => { setProjectMenu(null); onNewSession(project) }}><NotePencil size={12} /> New session</button> : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="sidebar__footer">
        <button type="button" title="Commands" onClick={onOpenPalette}><MagnifyingGlass size={15} /><span>Commands</span><kbd>{commandsShortcut}</kbd></button>
        {updateVisible ? (
          <>
            <span className="sr-only" role="status" aria-live="polite">{updateAnnouncement(updateState)}</span>
            <button
              type="button"
              className={`sidebar-update sidebar-update--${updateState.phase} ${updateIndeterminate ? 'sidebar-update--indeterminate' : ''}`}
              title={updateCopy.title}
              aria-label={updateCopy.title}
              disabled={updateBusy}
              onClick={() => { if (updateState.phase === 'error') void onUpdateAction?.(); else setConfirmUpdate(true) }}
            >
              <span className="sidebar-update__icon" style={{ '--update-progress': `${updateState.percent ?? 0}%` } as CSSProperties}><DownloadSimple size={12} /></span>
              <span>{updateCopy.label}</span>
            </button>
          </>
        ) : null}
        <button type="button" title={t('nav.settings')} className={activeView === 'settings' ? 'is-active' : ''} onClick={() => onNavigate('settings')}><Gear size={15} /><span>{t('nav.settings')}</span><kbd>{settingsShortcut}</kbd></button>
      </div>
      {renameTarget ? <Modal title="Rename session" onClose={() => setRenameTarget(null)} footer={<><button type="button" className="button" onClick={() => setRenameTarget(null)}>Cancel</button><button type="button" className="button button--primary" disabled={!renameValue.trim()} onClick={() => { const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) }}>Rename</button></>}><label className="field"><span>Session name</span><input autoFocus value={renameValue} maxLength={200} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && renameValue.trim()) { event.preventDefault(); const target = renameTarget; const title = renameValue.trim(); setRenameTarget(null); void onRenameSession(target, title) } }}/></label></Modal> : null}
      {removeTarget ? <Modal title="Remove project" onClose={() => setRemoveTarget(null)} footer={<><button type="button" className="button" onClick={() => setRemoveTarget(null)}>Cancel</button><button type="button" className="button button--danger" onClick={() => { const target = removeTarget; setRemoveTarget(null); onRemoveProject(target) }}>Remove</button></>}><p>Remove “{removeTarget.name}” from {HARNESS_PRODUCT_NAMES[activeHarness]}? The folder and saved sessions will not be deleted.</p></Modal> : null}
      {confirmUpdate ? <Modal title={updateConfirm.title} onClose={() => setConfirmUpdate(false)} footer={<><button type="button" className="button" onClick={() => setConfirmUpdate(false)}>No</button><button type="button" className="button button--primary" onClick={() => { setConfirmUpdate(false); void onUpdateAction?.() }}>Yes</button></>}><p>{updateConfirm.body}</p></Modal> : null}
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
    && previous.updateState === next.updateState
    && previous.onUpdateAction === next.onUpdateAction
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
