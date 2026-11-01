import { Bell, CalendarDots, ChatCircleText, ClockCounterClockwise, File, Folder, Gear, GitDiff, Info, MagnifyingGlass, NotePencil, Package, Robot, SidebarLeft, Terminal } from './icons'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { HarnessId, InspectorTab, ProjectRecord, SessionRecord, WorkspaceView } from '@/types/api'
import { formatRelative } from '@/lib/data'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { useProjectFileIndex } from '@/hooks/useProjectFileIndex'
import { BrowserGlobe, useAppShellOverlay, useFocusTrap } from './ui'

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
const SESSION_MATCH_LIMIT = 8
const PROJECT_MATCH_LIMIT = 5
const FILE_MATCH_LIMIT = 8

const sessionRecency = (session: SessionRecord) => Date.parse(session.lastUserMessageAt ?? session.updatedAt) || 0

function matchesTerms(text: string, terms: readonly string[]): boolean {
  const haystack = text.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

function sessionState(session: SessionRecord): string {
  if (session.status === 'running') return 'Working'
  if (session.status === 'waiting') return 'Needs input'
  if (session.status === 'failed') return 'Failed'
  return formatRelative(session.lastUserMessageAt ?? session.updatedAt)
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Command palette over commands, sessions, projects, and the active project's files. */
export function CommandPalette({ open, platform = 'darwin', harness, projects, sessions, activeProject, activeSessionId, onClose, onNavigate, onNewSession, onPreviousSession, onToggleSidebar, onToggleTerminal, onOpenBrowser, onOpenInspectorTab, onSelectSession, onSelectProject, onOpenFile }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const paletteRef = useFocusTrap<HTMLDivElement>(open, onClose)
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
      detail: [projectName(session), sessionState(session)].filter(Boolean).join(' · '),
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
  }, [activeSessionId, fileRoot, files, onNavigate, onNewSession, onOpenBrowser, onOpenFile, onOpenInspectorTab, onPreviousSession, onSelectProject, onSelectSession, onToggleSidebar, onToggleTerminal, platform, projects, sessions, terms])

  useEffect(() => { if (open) { setQuery(''); setActive(0); requestAnimationFrame(() => inputRef.current?.focus()) } }, [open])
  useEffect(() => setActive(0), [query])
  useEffect(() => { document.getElementById(`command-option-${active}`)?.scrollIntoView?.({ block: 'nearest' }) }, [active])
  useAppShellOverlay(open)
  if (!open) return null
  // Results can arrive after the query (the file index loads lazily), so the stored index never goes negative.
  const activeIndex = Math.min(active, items.length - 1)
  const choose = (item?: PaletteItem) => { if (!item) return; item.run(); onClose() }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.max(0, Math.min(items.length - 1, activeIndex + 1))) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(0, activeIndex - 1)) }
    if (event.key === 'Enter') { event.preventDefault(); choose(items[activeIndex]) }
    if (event.key === 'Escape') onClose()
  }
  const placeholder = fileRoot ? 'Search sessions, projects, commands, and files' : 'Search sessions, projects, and commands'
  return createPortal(<div className="palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div ref={paletteRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" tabIndex={-1}>
      <div className="command-search">
        <MagnifyingGlass size={16} />
        <input ref={inputRef} value={query} role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={items[activeIndex] ? `command-option-${activeIndex}` : undefined} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} onKeyDown={onKeyDown} />
        <button type="button" onClick={onClose} aria-label="Close command palette"><kbd>esc</kbd></button>
      </div>
      <div id="command-results" className="command-results" role="listbox" aria-label="Results">
        {items.map((item, index) => <PaletteRow key={item.key} item={item} index={index} active={index === activeIndex} showGroup={index === 0 || items[index - 1].group !== item.group} onHover={setActive} onChoose={choose} />)}
        {items.length === 0 ? <p>No sessions, projects, or commands match “{query}”.</p> : null}
      </div>
      <footer><span>↑↓ Navigate</span><span>↵ Open</span><span>esc Close</span></footer>
    </div>
  </div>, document.body)
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
