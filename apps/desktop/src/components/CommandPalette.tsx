import { Button as AstryxButton } from '@astryxdesign/core/Button'
import { Dialog } from '@astryxdesign/core/Dialog'
import * as stylex from '@stylexjs/stylex'
import { Bell, CalendarDots, ChatCircleText, ClockCounterClockwise, File, Folder, Gear, GitDiff, Info, MagnifyingGlass, NotePencil, Package, Robot, SidebarLeft, Terminal } from './icons'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { HarnessId, InspectorTab, ProjectRecord, SessionRecord, WorkspaceView } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { isSessionRunning, isSessionWaiting } from '@/app/session-attention'
import type { SessionLiveMap } from '@/app/session-live'
import type { SessionLive } from '@/app/sessionLiveMachine'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { useProjectFileIndex } from '@/hooks/useProjectFileIndex'
import { BrowserGlobe, useAppShellOverlay } from './ui'

const styles = stylex.create({
  dialog: {
    marginInline: 'auto',
    marginTop: 'min(14vh, 110px)',
    marginBottom: 'auto',
    padding: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border-strong)',
    borderRadius: 14,
    color: 'var(--text)',
    backgroundColor: 'var(--surface-raised)',
    boxShadow: 'var(--shadow-popover)',
    animationName: 'none',
    transitionDuration: '0ms',
    '::backdrop': {
      backgroundColor: 'rgba(6, 11, 18, 0.46)',
      backdropFilter: 'blur(4px)',
      animationName: 'none',
    },
  },
  closeButton: {
    minHeight: 0,
    height: 'auto',
    padding: 0,
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    boxShadow: 'none',
  },
})

type PaletteGroup = 'Recent sessions' | 'Sessions' | 'Projects' | 'Commands' | 'Files'
interface PaletteItem { key: string; group: PaletteGroup; label: string; detail: string; shortcut?: string; icon: ReactNode; run(): void }

export interface CommandPaletteProps {
  open: boolean
  platform?: NodeJS.Platform
  harness: HarnessId
  projects: readonly ProjectRecord[]
  sessions: readonly SessionRecord[]
  activeProject?: ProjectRecord
  activeSessionId?: string
  /** Live phase and pending questions keyed by session file path; running means live or stored status. */
  liveBySession?: SessionLiveMap
  onClose(): void
  onNavigate(view: WorkspaceView): void
  onNewSession(): void
  onPreviousSession(): void
  onToggleSidebar(): void
  onToggleTerminal(): void
  onOpenBrowser(): void
  onOpenInspectorTab(tab: InspectorTab): void
  onSelectSession(session: SessionRecord): void
  onSelectProject(project: ProjectRecord): void
  /** Opens a project file in the user's editor; file results are hidden without it. */
  onOpenFile?(path: string): void
}

const RECENT_SESSION_LIMIT = 5
const NO_LIVE: SessionLiveMap = {}
const SESSION_MATCH_LIMIT = 8
const PROJECT_MATCH_LIMIT = 5
const FILE_MATCH_LIMIT = 8

const sessionRecency = (session: SessionRecord) => Date.parse(session.lastUserMessageAt ?? session.updatedAt) || 0

function matchesTerms(text: string, terms: readonly string[]): boolean {
  const haystack = text.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

function sessionState(session: SessionRecord, live?: SessionLive): string {
  if (isSessionRunning(session, live)) return 'Working'
  if (isSessionWaiting(session)) return 'Needs input'
  if (session.status === 'failed') return 'Failed'
  return formatRelative(session.lastUserMessageAt ?? session.updatedAt)
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function ensurePaletteDialogMethods(dialog: HTMLDialogElement | null): void {
  if (!dialog) return
  if (typeof dialog.showModal !== 'function') {
    dialog.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '')
      this.querySelector<HTMLElement>('input[role="combobox"]')?.focus()
    }
  }
  if (typeof dialog.close !== 'function') {
    dialog.close = function close(this: HTMLDialogElement, returnValue?: string) {
      if (returnValue !== undefined) this.returnValue = returnValue
      this.removeAttribute('open')
    }
  }
}

/** Command palette over commands, sessions, projects, and the active project's files. */
export function CommandPalette({ open, platform = 'darwin', harness, projects, sessions, activeProject, activeSessionId, liveBySession = NO_LIVE, onClose, onNavigate, onNewSession, onPreviousSession, onToggleSidebar, onToggleTerminal, onOpenBrowser, onOpenInspectorTab, onSelectSession, onSelectProject, onOpenFile }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const attachDialog = useCallback((node: HTMLDialogElement | null) => {
    ensurePaletteDialogMethods(node)
  }, [])
  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query])
  const fileRoot = onOpenFile && activeProject && !activeProject.inferred ? activeProject.primaryFolder : undefined
  const files = useProjectFileIndex(fileRoot, harness, open && terms.length > 0)

  const items = useMemo<PaletteItem[]>(() => {
    const key = (keys: Parameters<typeof shortcutLabel>[1]) => shortcutLabel(platform, keys)
    const command = (item: Omit<PaletteItem, 'group'>): PaletteItem => ({ ...item, key: `command:${item.key}`, group: 'Commands' })
    const commands = [
      { key: 'new', label: 'New session', detail: 'Start fresh in the current project', shortcut: key(['Primary', 'N']), icon: <NotePencil size={14} />, run: onNewSession },
      { key: 'previous', label: 'Previous session', detail: 'Return to the session you had open before', shortcut: key(['Control', 'Tab']), icon: <ClockCounterClockwise size={14} />, run: onPreviousSession },
      { key: 'projects', label: 'Open Projects', detail: 'Browse local workspaces', icon: <Folder size={14} />, run: () => onNavigate('projects') },
      { key: 'activity', label: 'Open Activity', detail: 'See work that needs attention', icon: <Bell size={14} />, run: () => onNavigate('activity') },
      { key: 'scheduled', label: 'Open Scheduled', detail: 'Manage recurring work', icon: <CalendarDots size={14} />, run: () => onNavigate('scheduled') },
      { key: 'plugins', label: 'Open Capabilities', detail: 'Extend the active harness', icon: <Package size={14} />, run: () => onNavigate('plugins') },
      { key: 'changes', label: 'Show changes', detail: 'Review the diff for this workspace', shortcut: key(['Primary', '1']), icon: <GitDiff size={14} />, run: () => onOpenInspectorTab('changes') },
      { key: 'overview', label: 'Show overview', detail: 'Plan, agents, and progress for this session', shortcut: key(['Primary', '2']), icon: <Info size={14} />, run: () => onOpenInspectorTab('summary') },
      { key: 'agents', label: 'Show agents', detail: 'Specialists working in this session', shortcut: key(['Primary', '3']), icon: <Robot size={14} />, run: () => onOpenInspectorTab('specialists') },
      { key: 'files', label: 'Show files', detail: 'Browse project files', shortcut: key(['Primary', '4']), icon: <File size={14} />, run: () => onOpenInspectorTab('files') },
      { key: 'browser', label: 'Toggle browser', detail: 'Open the in-app browser', shortcut: key(['Primary', 'Shift', 'B']), icon: <BrowserGlobe size={14} />, run: onOpenBrowser },
      { key: 'terminal', label: 'Toggle terminal', detail: 'Open a project shell', shortcut: key(['Primary', 'J']), icon: <Terminal size={14} />, run: onToggleTerminal },
      { key: 'sidebar', label: 'Toggle sidebar', detail: 'Show or hide project navigation', shortcut: key(['Primary', 'B']), icon: <SidebarLeft size={14} />, run: onToggleSidebar },
      { key: 'settings', label: 'Open Settings', detail: 'Configure Apex', shortcut: key(['Primary', ',']), icon: <Gear size={14} />, run: () => onNavigate('settings') },
    ].map(command)

    const projectName = (session: SessionRecord) => projects.find((project) => project.path === session.projectPath || project.folders.includes(session.projectPath))?.name ?? ''
    const sessionItem = (group: PaletteGroup) => (session: SessionRecord): PaletteItem => ({
      key: `session:${session.id}`,
      group,
      label: session.title,
      detail: [projectName(session), sessionState(session, liveBySession[session.filePath])].filter(Boolean).join(' · '),
      icon: <ChatCircleText size={14} />,
      run: () => onSelectSession(session),
    })
    const candidates = sessions.filter((session) => !session.archived && session.depth === 0).sort((left, right) => sessionRecency(right) - sessionRecency(left))
    if (!terms.length) {
      const recent = candidates.filter((session) => session.id !== activeSessionId).slice(0, RECENT_SESSION_LIMIT).map(sessionItem('Recent sessions'))
      return [...recent, ...commands]
    }

    const matchedSessions = candidates
      .filter((session) => matchesTerms(`${session.title} ${session.preview ?? ''} ${projectName(session)}`, terms))
      .slice(0, SESSION_MATCH_LIMIT)
      .map(sessionItem('Sessions'))
    const matchedProjects = projects
      .filter((project) => matchesTerms(`${project.name} ${project.path}`, terms))
      .sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt))
      .slice(0, PROJECT_MATCH_LIMIT)
      .map((project): PaletteItem => ({ key: `project:${project.id}`, group: 'Projects', label: project.name, detail: project.path, icon: <Folder size={14} />, run: () => onSelectProject(project) }))
    const matchedCommands = commands.filter((item) => matchesTerms(`${item.label} ${item.detail}`, terms))
    const separator = platform === 'win32' ? '\\' : '/'
    const lastTerm = terms.at(-1) ?? ''
    const matchedFiles = fileRoot && onOpenFile ? (files ?? [])
      .filter((entry) => entry.type === 'file' && matchesTerms(entry.path, terms))
      .sort((left, right) => Number(fileName(right.path).toLowerCase().includes(lastTerm)) - Number(fileName(left.path).toLowerCase().includes(lastTerm)) || left.path.length - right.path.length)
      .slice(0, FILE_MATCH_LIMIT)
      .map((entry): PaletteItem => ({
        key: `file:${entry.path}`,
        group: 'Files',
        label: fileName(entry.path),
        detail: entry.path,
        icon: <File size={14} />,
        run: () => onOpenFile(`${fileRoot}${separator}${entry.path.split('/').join(separator)}`),
      })) : []
    return [...matchedSessions, ...matchedProjects, ...matchedCommands, ...matchedFiles]
  }, [activeSessionId, fileRoot, files, liveBySession, onNavigate, onNewSession, onOpenBrowser, onOpenFile, onOpenInspectorTab, onPreviousSession, onSelectProject, onSelectSession, onToggleSidebar, onToggleTerminal, platform, projects, sessions, terms])

  useEffect(() => { if (open) { setQuery(''); setActive(0); requestAnimationFrame(() => inputRef.current?.focus()) } }, [open])
  useEffect(() => setActive(0), [query])
  useEffect(() => { document.getElementById(`command-option-${active}`)?.scrollIntoView?.({ block: 'nearest' }) }, [active])
  useAppShellOverlay(open)
  if (!open) return null
  const activeIndex = Math.min(active, items.length - 1)
  const choose = (item?: PaletteItem) => { if (!item) return; item.run(); onClose() }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.max(0, Math.min(items.length - 1, activeIndex + 1))) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(0, activeIndex - 1)) }
    if (event.key === 'Enter') { event.preventDefault(); choose(items[activeIndex]) }
  }
  const placeholder = fileRoot ? 'Search sessions, projects, commands, and files' : 'Search sessions, projects, and commands'
  return createPortal(
    <Dialog
      ref={attachDialog}
      isOpen
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      purpose="info"
      width={580}
      padding={0}
      role="dialog"
      aria-label="Command palette"
      className="command-palette"
      xstyle={styles.dialog}
    >
      <div className="command-search">
        <MagnifyingGlass size={16} />
        <input ref={inputRef} data-autofocus="" value={query} role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={items[activeIndex] ? `command-option-${activeIndex}` : undefined} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} onKeyDown={onKeyDown} />
        <AstryxButton label="Close command palette" variant="ghost" size="sm" xstyle={styles.closeButton} onClick={onClose}><kbd>esc</kbd></AstryxButton>
      </div>
      <div id="command-results" className="command-results" role="listbox" aria-label="Results">
        {items.map((item, index) => <PaletteRow key={item.key} item={item} index={index} active={index === activeIndex} showGroup={index === 0 || items[index - 1].group !== item.group} onHover={setActive} onChoose={choose} />)}
        {items.length === 0 ? <p>No sessions, projects, or commands match “{query}”.</p> : null}
      </div>
      <footer><span>↑↓ Navigate</span><span>↵ Open</span><span>esc Close</span></footer>
    </Dialog>,
    document.body,
  )
}

function PaletteRow({ item, index, active, showGroup, onHover, onChoose }: { item: PaletteItem; index: number; active: boolean; showGroup: boolean; onHover(index: number): void; onChoose(item: PaletteItem): void }) {
  return <>
    {showGroup ? <div className="command-section-label" role="presentation">{item.group}</div> : null}
    <button id={`command-option-${index}`} type="button" role="option" aria-selected={active} data-group={item.group} className={active ? 'is-active' : ''} title={item.detail} onMouseEnter={() => onHover(index)} onClick={() => onChoose(item)}>
      <span>{item.icon}</span>
      <span><strong>{item.label}</strong><small>{item.detail}</small></span>
      {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
    </button>
  </>
}
