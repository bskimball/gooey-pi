import { lazy, Suspense, useState, useEffect, useRef, useMemo, useId } from 'react'
import * as stylex from '@stylexjs/stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { styles as railStyles } from 'apex-ui/styles/rail.stylex'
import { styles as voiceStyles } from 'apex-ui/styles/voice.stylex'
import type { DiscoveredProjectScript, ProjectRecord, WorkspaceView } from '@/types/api'
import { useI18n } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { availableProjectScripts } from '@/lib/project-scripts'
import { Code, Gear, Terminal, SidebarLeft, Waveform, Play, Square } from './icons'
import { IconButton } from './ui'

const WindowsAppMenu = lazy(() => import('./WindowsAppMenu'))

interface AppRailProps {
  view: WorkspaceView
  vscodeProject?: ProjectRecord
  activeProjectScriptKind?: 'setup' | 'run'
  onRunProjectScript?(target: { command: string; label?: string }): Promise<void> | void
  onStopProjectScript?(): void
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

export function AppRail({ view, vscodeProject, activeProjectScriptKind, onRunProjectScript, onStopProjectScript, terminalOpen = false, onToggleTerminal, onOpenInVsCode, sidebarOpen, onToggleSidebar, voiceOpen, onToggleVoice, onNavigate, platform = 'darwin' }: AppRailProps) {
  const { t } = useI18n()
  const sidebarShortcut = shortcutLabel(platform, ['Primary', 'B'])
  const terminalShortcut = shortcutLabel(platform, ['Primary', 'J'])
  const settingsShortcut = shortcutLabel(platform, ['Primary', ','])

  const availableScripts = useMemo(() => {
    if (!vscodeProject) return []
    return availableProjectScripts(vscodeProject)
  }, [vscodeProject])

  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', dismissOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', dismissOnEscape, true)
    }
  }, [menuOpen])

  return (
    <nav aria-label="App controls" className={`app-rail drag-region ${stylex.props(baseStyles.dragRegion, railStyles.rail, platform === 'darwin' && railStyles.macRail).className ?? ''}`}>
      <div className={`app-rail__top no-drag ${stylex.props(baseStyles.noDrag, railStyles.group).className ?? ''}`}>
        {platform === 'win32' ? <Suspense fallback={null}><WindowsAppMenu /></Suspense> : null}
        <IconButton xstyle={[railStyles.button, sidebarOpen && railStyles.active]} className={sidebarOpen ? 'is-active' : ''} label={`${sidebarOpen ? 'Hide' : 'Show'} sidebar (${sidebarShortcut})`} aria-pressed={sidebarOpen} onClick={onToggleSidebar}><SidebarLeft size={16} /></IconButton>
      </div>
      <div className={`app-rail__bottom no-drag ${stylex.props(baseStyles.noDrag, railStyles.group, railStyles.bottom).className ?? ''}`}>
        {onRunProjectScript && onStopProjectScript && vscodeProject ? (
          <div ref={menuRef} style={{ position: 'relative' }}>
            <IconButton
              xstyle={[railStyles.button, activeProjectScriptKind && railStyles.active]}
              label={activeProjectScriptKind ? 'Stop project' : 'Run project'}
              onClick={() => {
                if (activeProjectScriptKind) onStopProjectScript()
                else if (availableScripts.length > 1) setMenuOpen(!menuOpen)
                else onRunProjectScript({ command: availableScripts[0]?.command ?? 'run', label: availableScripts[0]?.name })
              }}
            >
              {activeProjectScriptKind ? <Square size={16} fill="currentColor" /> : <Play size={16} />}
            </IconButton>
            {menuOpen && availableScripts.length > 0 ? (
              <div
                id={menuId}
                role="menu"
                className={`project-run-menu ${stylex.props(railStyles.menu).className ?? ''}`}
                style={{ position: 'absolute', bottom: '100%', left: '100%', zIndex: 1000 }}
              >
                {availableScripts.map((script: DiscoveredProjectScript) => (
                  <button
                    key={script.name}
                    type="button"
                    role="menuitem"
                    className={`project-run-menu__item ${stylex.props(railStyles.menuItem).className ?? ''}`}
                    onClick={() => {
                      setMenuOpen(false)
                      onRunProjectScript({ command: script.command, label: script.name })
                    }}
                  >
                    {script.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {onOpenInVsCode ? <IconButton xstyle={railStyles.button} label={vscodeProject ? `Open ${vscodeProject.name} in VS Code` : 'Open in VS Code'} disabled={!vscodeProject} onClick={() => { if (vscodeProject) onOpenInVsCode(vscodeProject.path) }}><Code size={16} /></IconButton> : null}
        {onToggleTerminal ? <IconButton xstyle={[railStyles.button, terminalOpen && railStyles.active]} className={terminalOpen ? 'is-active' : ''} label={`Toggle terminal (${terminalShortcut})`} aria-pressed={terminalOpen} onClick={onToggleTerminal}><Terminal size={16} /></IconButton> : null}
        <IconButton xstyle={[railStyles.button, voiceOpen && railStyles.active]} className={voiceOpen ? `is-active voice-toggle--active ${stylex.props(voiceStyles.voiceToggleActive).className}` : ''} label={voiceOpen ? 'Close realtime voice' : 'Open realtime voice'} aria-pressed={voiceOpen} onClick={onToggleVoice}><Waveform size={16} /></IconButton>
        <IconButton xstyle={[railStyles.button, view === 'settings' && railStyles.active]} className={view === 'settings' ? 'is-active' : ''} label={`${t('nav.settings')} (${settingsShortcut})`} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => onNavigate('settings')}><Gear size={16} /></IconButton>
      </div>
    </nav>
  )
}
