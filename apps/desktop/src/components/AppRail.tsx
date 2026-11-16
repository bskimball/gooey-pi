import { lazy, Suspense } from 'react'
import * as stylex from '@stylexjs/stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { styles as railStyles } from 'apex-ui/styles/rail.stylex'
import { styles as voiceStyles } from 'apex-ui/styles/voice.stylex'
import type { ProjectRecord, WorkspaceView } from '@/types/api'
import { useI18n } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { Code, Gear, Terminal, SidebarLeft, Waveform } from './icons'
import { IconButton } from './ui'

const WindowsAppMenu = lazy(() => import('./WindowsAppMenu'))

interface AppRailProps {
  view: WorkspaceView
  vscodeProject?: ProjectRecord
  terminalOpen?: boolean
  onToggleTerminal?(): void
  onOpenInVsCode?(path: string): void
  sidebarOpen: boolean
  onToggleSidebar(): void
  voiceOpen: boolean
  onToggleVoice(): void
  onNavigate(view: WorkspaceView): void
  platform?: NodeJS.Platform
}

export function AppRail({ view, vscodeProject, terminalOpen = false, onToggleTerminal, onOpenInVsCode, sidebarOpen, onToggleSidebar, voiceOpen, onToggleVoice, onNavigate, platform = 'darwin' }: AppRailProps) {
  const { t } = useI18n()
  const sidebarShortcut = shortcutLabel(platform, ['Primary', 'B'])
  const terminalShortcut = shortcutLabel(platform, ['Primary', 'J'])
  const settingsShortcut = shortcutLabel(platform, ['Primary', ','])
  return (
    <nav aria-label="App controls" className={`app-rail drag-region ${stylex.props(baseStyles.dragRegion, railStyles.rail, platform === 'darwin' && railStyles.macRail).className ?? ''}`}>
      <div className={`app-rail__top no-drag ${stylex.props(baseStyles.noDrag, railStyles.group).className ?? ''}`}>
        {platform === 'win32' ? <Suspense fallback={null}><WindowsAppMenu /></Suspense> : null}
        <IconButton xstyle={[railStyles.button, sidebarOpen && railStyles.active]} className={sidebarOpen ? 'is-active' : ''} label={`${sidebarOpen ? 'Hide' : 'Show'} sidebar (${sidebarShortcut})`} aria-pressed={sidebarOpen} onClick={onToggleSidebar}><SidebarLeft size={16} /></IconButton>
      </div>
      <div className={`app-rail__bottom no-drag ${stylex.props(baseStyles.noDrag, railStyles.group, railStyles.bottom).className ?? ''}`}>
        {onOpenInVsCode ? <IconButton xstyle={railStyles.button} label={vscodeProject ? `Open ${vscodeProject.name} in VS Code` : 'Open in VS Code'} disabled={!vscodeProject} onClick={() => { if (vscodeProject) onOpenInVsCode(vscodeProject.path) }}><Code size={16} /></IconButton> : null}
        {onToggleTerminal ? <IconButton xstyle={[railStyles.button, terminalOpen && railStyles.active]} className={terminalOpen ? 'is-active' : ''} label={`Toggle terminal (${terminalShortcut})`} aria-pressed={terminalOpen} onClick={onToggleTerminal}><Terminal size={16} /></IconButton> : null}
        <IconButton xstyle={[railStyles.button, voiceOpen && railStyles.active]} className={voiceOpen ? `is-active voice-toggle--active ${stylex.props(voiceStyles.voiceToggleActive).className}` : ''} label={voiceOpen ? 'Close realtime voice' : 'Open realtime voice'} aria-pressed={voiceOpen} onClick={onToggleVoice}><Waveform size={16} /></IconButton>
        <IconButton xstyle={[railStyles.button, view === 'settings' && railStyles.active]} className={view === 'settings' ? 'is-active' : ''} label={`${t('nav.settings')} (${settingsShortcut})`} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => onNavigate('settings')}><Gear size={16} /></IconButton>
      </div>
    </nav>
  )
}
