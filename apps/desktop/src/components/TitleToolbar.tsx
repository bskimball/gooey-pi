import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex';
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { styles as workbenchStyles } from 'apex-ui/styles/workbench.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { Badge } from '@astryxdesign/core/Badge'
import * as stylex from '@stylexjs/stylex'
import { GitBranch, SidebarRight } from './icons'
import { IconButton } from './ui'
import type { ProjectRecord, WorkspaceView } from '@/types/api'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { ProjectRunControl, type ProjectScriptKind } from './ProjectRunControl'
import type { ReactNode } from 'react'

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
  activeProjectScriptKind?: ProjectScriptKind
  projectSetupError?: string
  onRunProjectScript?(kind: ProjectScriptKind): Promise<void> | void
  onStopProjectScript?(): void
  onSaveProjectScripts?(scripts: { setup: string; run: string }): Promise<void>
  /** Subtle session status shown beside project controls. */
  sessionActions?: ReactNode
  inspectorOpen?: boolean
  onToggleInspector?(): void
  platform?: NodeJS.Platform
}

export function TitleToolbar({ project, gitBranch, view, productName = 'Apex', activeProjectScriptKind, projectSetupError, sessionActions, onRunProjectScript, onStopProjectScript, onSaveProjectScripts, inspectorOpen = false, onToggleInspector, platform = 'darwin' }: TitleToolbarProps) {
  const { t } = useI18n()
  const branch = gitBranch ?? project?.gitBranch
  return (
    <header className={`title-toolbar drag-region ${stylex.props(baseStyles.dragRegion, workbenchStyles.titleToolbar, responsiveStyles.titleToolbar, (platform === 'win32' || platform === 'linux') && workbenchStyles.titleToolbarWindowControls).className ?? ""}`}>
      <div className={`title-toolbar__identity ${stylex.props(workbenchStyles.titleToolbarIdentity, [responsiveStyles.titleToolbarIdentity, responsiveLayoutStyles.titleToolbarIdentity]).className ?? ""}`}>
        <strong>{project?.name ?? (view === 'session' ? productName : t(viewTitles[view]))}</strong>
        {branch && view === 'session' ? <Badge icon={<GitBranch size={12} />} label={branch} className="branch-pill" xstyle={[workbenchStyles.branchPill, styles.branchBadge, responsiveStyles.branchPill]} /> : null}
      </div>
      <div className={`title-toolbar__actions no-drag ${stylex.props(baseStyles.noDrag, workbenchStyles.titleToolbarActions).className ?? ""}`}>
        {view === 'session' && project && onRunProjectScript && onStopProjectScript && onSaveProjectScripts
          ? <ProjectRunControl project={project} activeKind={activeProjectScriptKind} setupError={projectSetupError} onRun={onRunProjectScript} onStop={onStopProjectScript} onSave={onSaveProjectScripts} />
          : null}
        {view === 'session' ? sessionActions : null}
        {onToggleInspector && (view === 'session' || view === 'activity') ? <IconButton className={inspectorOpen ? 'is-active' : ''} label="Toggle inspector" aria-pressed={inspectorOpen} onClick={onToggleInspector}><SidebarRight size={16} /></IconButton> : null}
      </div>
    </header>
  )
}
