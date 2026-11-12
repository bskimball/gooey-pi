import { Badge } from '@astryxdesign/core/Badge'
import * as stylex from '@stylexjs/stylex'
import {
  GitBranch,
  SidebarLeft,
  SidebarRight,
} from './icons'
import type { ProjectRecord, SessionRecord, WorkspaceView } from '@/types/api'
import type { SessionLiveMap } from '@/app/session-live'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { BrowserGlobe, IconButton } from './ui'
import { ActivityStatusPill } from './activity/ActivityStatusPill'
import { ProjectRunControl, type ProjectScriptKind } from './ProjectRunControl'
import { lazy, Suspense } from 'react'

const WindowsAppMenu = lazy(() => import('./WindowsAppMenu'))

const styles = stylex.create({
  branchBadge: {
    height: 22,
    paddingInline: 7,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: 999,
    color: 'var(--text-secondary)',
    backgroundColor: 'var(--surface-subtle)',
    fontSize: 'var(--fs-micro)',
    fontWeight: 500,
  },
})

const viewTitles: Record<Exclude<WorkspaceView, 'session'>, MessageKey> = {
  projects: 'nav.projects', activity: 'nav.activity', scheduled: 'nav.scheduled', plugins: 'nav.capabilities', settings: 'nav.settings',
}

interface TitleToolbarProps {
  project?: ProjectRecord
  gitBranch?: string
  view: WorkspaceView
  /** Active harness product name; the session view's fallback title. */
  productName?: string
  sidebarOpen: boolean
  inspectorOpen: boolean
  onToggleSidebar(): void
  onToggleInspector(): void
  onOpenBrowser(): void
  activeProjectScriptKind?: ProjectScriptKind
  projectSetupError?: string
  onRunProjectScript?(kind: ProjectScriptKind): Promise<void> | void
  onStopProjectScript?(): void
  onSaveProjectScripts?(scripts: { setup: string; run: string }): Promise<void>
  sessions?: readonly SessionRecord[]
  liveBySession?: SessionLiveMap
  clearedActivity?: Readonly<Record<string, string>>
  onOpenActivity?(): void
  platform?: NodeJS.Platform
}

export function TitleToolbar({ project, gitBranch, view, productName = 'Apex', sidebarOpen, inspectorOpen, activeProjectScriptKind, projectSetupError, sessions, liveBySession, clearedActivity, onOpenActivity, onToggleSidebar, onToggleInspector, onOpenBrowser, onRunProjectScript, onStopProjectScript, onSaveProjectScripts, platform = 'darwin' }: TitleToolbarProps) {
  const { t } = useI18n()
  const sidebarShortcut = shortcutLabel(platform, ['Primary', 'B'])
  const browserShortcut = shortcutLabel(platform, ['Primary', 'Shift', 'B'])
  const branch = gitBranch ?? project?.gitBranch
  return (
    <header className="title-toolbar drag-region">
      {!sidebarOpen && platform === 'darwin' ? <div className="traffic-light-clearance traffic-light-clearance--toolbar" aria-hidden="true" /> : null}
      <div className="title-toolbar__nav no-drag">
        <IconButton className={sidebarOpen ? 'is-active' : ''} label={`${sidebarOpen ? 'Hide' : 'Show'} sidebar (${sidebarShortcut})`} onClick={onToggleSidebar}><SidebarLeft size={16} /></IconButton>
        {platform === 'win32' ? <Suspense fallback={null}><WindowsAppMenu /></Suspense> : null}
      </div>
      <div className="title-toolbar__identity">
        <strong>{project?.name ?? (view === 'session' ? productName : t(viewTitles[view]))}</strong>
        {branch && view === 'session' ? <Badge icon={<GitBranch size={12} />} label={branch} className="branch-pill" xstyle={styles.branchBadge} /> : null}
      </div>
      <div className="title-toolbar__actions no-drag">
        {sessions ? <ActivityStatusPill sessions={sessions} liveBySession={liveBySession} clearedActivity={clearedActivity} active={view === 'activity'} onOpen={onOpenActivity} /> : null}
        {view === 'session' && project && onRunProjectScript && onStopProjectScript && onSaveProjectScripts
          ? <ProjectRunControl project={project} activeKind={activeProjectScriptKind} setupError={projectSetupError} onRun={onRunProjectScript} onStop={onStopProjectScript} onSave={onSaveProjectScripts} />
          : null}
        {view === 'session' ? <IconButton className="title-toolbar__optional" label={`Open browser (${browserShortcut})`} onClick={onOpenBrowser}><BrowserGlobe size={18} /></IconButton> : null}
        {view === 'session' ? <IconButton className={inspectorOpen ? 'is-active' : ''} label="Toggle inspector" onClick={onToggleInspector}><SidebarRight size={16} /></IconButton> : null}
      </div>
    </header>
  )
}
