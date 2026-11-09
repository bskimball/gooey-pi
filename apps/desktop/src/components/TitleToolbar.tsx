import {
  Code,
  DotsThree,
  GitBranch,
  SidebarLeft,
  SidebarRight,
  Terminal,
  Waveform,
} from './icons'
import type { ApplicationMenuName, ProjectRecord, SessionRecord, WorkspaceView } from '@/types/api'
import type { SessionLiveMap } from '@/app/session-live'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { BrowserGlobe, IconButton } from './ui'
import { ActivityStatusPill } from './activity/ActivityStatusPill'
import { ProjectRunControl, type ProjectScriptKind } from './ProjectRunControl'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'

const viewTitles: Record<Exclude<WorkspaceView, 'session'>, MessageKey> = {
  projects: 'nav.projects', activity: 'nav.activity', scheduled: 'nav.scheduled', plugins: 'nav.capabilities', settings: 'nav.settings',
}

const windowsMenus: ReadonlyArray<{ name: ApplicationMenuName; label: string }> = [
  { name: 'file', label: 'File' },
  { name: 'edit', label: 'Edit' },
  { name: 'view', label: 'View' },
  { name: 'window', label: 'Window' },
  { name: 'help', label: 'Help' },
]

function openApplicationMenu(menu: ApplicationMenuName, event: MouseEvent<HTMLButtonElement>): void {
  const rect = event.currentTarget.getBoundingClientRect()
  void window.prime?.app.popupMenu?.(menu, rect.right + 4, rect.top).catch(() => undefined)
}

/** Windows keeps File/Edit/View behind one quiet button instead of a permanent menu row. */
function WindowsAppMenu() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const close = (restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) rootRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus()
  }
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside)
    return () => window.removeEventListener('pointerdown', closeOutside)
  }, [open])
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const target = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key]
    if (target !== undefined) {
      event.preventDefault()
      items[(target + items.length) % items.length]?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Tab') {
      close(false)
    }
  }
  return (
    <div ref={rootRef} className="windows-app-menu no-drag">
      <IconButton className={open ? 'is-active' : ''} label="Application menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><DotsThree size={18} /></IconButton>
      {open ? <div ref={listRef} className="windows-app-menu__list" role="menu" aria-label="Application menu" onKeyDown={onMenuKeyDown}>
        {windowsMenus.map(({ name, label }) => <button key={name} type="button" role="menuitem" tabIndex={-1} className="windows-app-menu__button" onClick={(event) => { openApplicationMenu(name, event); close(true) }}>{label}</button>)}
      </div> : null}
    </div>
  )
}

interface TitleToolbarProps {
  project?: ProjectRecord
  gitBranch?: string
  view: WorkspaceView
  /** Active harness product name; the session view's fallback title. */
  productName?: string
  sidebarOpen: boolean
  inspectorOpen: boolean
  terminalOpen: boolean
  onToggleSidebar(): void
  onToggleInspector(): void
  onToggleTerminal(): void
  onOpenBrowser(): void
  onOpenInVsCode?(path: string): void
  voiceOpen?: boolean
  onToggleVoice?(): void
  activeProjectScriptKind?: ProjectScriptKind
  onRunProjectScript?(kind: ProjectScriptKind): Promise<void> | void
  onStopProjectScript?(): void
  onSaveProjectScripts?(scripts: { setup: string; run: string }): Promise<void>
  sessions?: readonly SessionRecord[]
  liveBySession?: SessionLiveMap
  clearedActivity?: Readonly<Record<string, string>>
  onOpenActivity?(): void
  platform?: NodeJS.Platform
}

export function TitleToolbar({ project, gitBranch, view, productName = 'Prime Work', sidebarOpen, inspectorOpen, terminalOpen, voiceOpen = false, activeProjectScriptKind, sessions, liveBySession, clearedActivity, onOpenActivity, onToggleSidebar, onToggleInspector, onToggleTerminal, onOpenBrowser, onOpenInVsCode, onToggleVoice, onRunProjectScript, onStopProjectScript, onSaveProjectScripts, platform = 'darwin' }: TitleToolbarProps) {
  const { t } = useI18n()
  const sidebarShortcut = shortcutLabel(platform, ['Primary', 'B'])
  const terminalShortcut = shortcutLabel(platform, ['Primary', 'J'])
  const browserShortcut = shortcutLabel(platform, ['Primary', 'Shift', 'B'])
  return (
    <header className="title-toolbar drag-region">
      {!sidebarOpen && platform === 'darwin' ? <div className="traffic-light-clearance traffic-light-clearance--toolbar" aria-hidden="true" /> : null}
      <div className="title-toolbar__nav no-drag">
        {!sidebarOpen ? <IconButton label={`Show sidebar (${sidebarShortcut})`} onClick={onToggleSidebar}><SidebarLeft size={16} /></IconButton> : null}
        {platform === 'win32' ? <WindowsAppMenu /> : null}
      </div>
      <div className="title-toolbar__identity">
        <strong>{project?.name ?? (view === 'session' ? productName : t(viewTitles[view]))}</strong>
        {(gitBranch ?? project?.gitBranch) && view === 'session' ? <span className="branch-pill"><GitBranch size={12} />{gitBranch ?? project?.gitBranch}</span> : null}
      </div>
      <div className="title-toolbar__actions no-drag">
        {sessions ? <ActivityStatusPill sessions={sessions} liveBySession={liveBySession} clearedActivity={clearedActivity} active={view === 'activity'} onOpen={onOpenActivity} /> : null}
        {view === 'session' && project && onRunProjectScript && onStopProjectScript && onSaveProjectScripts
          ? <ProjectRunControl project={project} activeKind={activeProjectScriptKind} onRun={onRunProjectScript} onStop={onStopProjectScript} onSave={onSaveProjectScripts} />
          : null}
        {view === 'session' && onToggleVoice ? <IconButton className={`title-toolbar__optional ${voiceOpen ? 'is-active voice-toggle--active' : ''}`} label={voiceOpen ? 'Close realtime voice' : 'Open realtime voice'} onClick={onToggleVoice}><Waveform size={17} /></IconButton> : null}
        {view === 'session' && project && onOpenInVsCode ? <IconButton className="title-toolbar__optional" label={`Open ${project.name} in VS Code`} onClick={() => onOpenInVsCode(project.path)}><Code size={17} /></IconButton> : null}
        {view === 'session' ? <IconButton className={terminalOpen ? 'is-active' : ''} label={`Toggle terminal (${terminalShortcut})`} onClick={onToggleTerminal}><Terminal size={17} /></IconButton> : null}
        {view === 'session' ? <IconButton className="title-toolbar__optional" label={`Open browser (${browserShortcut})`} onClick={onOpenBrowser}><BrowserGlobe size={18} /></IconButton> : null}
        {view === 'session' ? <IconButton className={inspectorOpen ? 'is-active' : ''} label="Toggle inspector" onClick={onToggleInspector}><SidebarRight size={16} /></IconButton> : null}
      </div>
    </header>
  )
}
