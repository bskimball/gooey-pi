import * as stylex from '@stylexjs/stylex'
import { styles as settingsStyles } from 'apex-ui/styles/settings.stylex'
import { styles as activityStyles } from 'apex-ui/styles/activity.stylex'
import { styles as overlaysStyles } from 'apex-ui/styles/overlays.stylex'
import { ArrowClockwise, Question } from '@/components/icons'
import { ApexButton, GooeyPiMark } from '@/components/ui'
import type { AppMeta, AppUpdateState } from '@/types/api'

interface AboutSettingsProps {
  meta?: AppMeta | null
  updateState: AppUpdateState
  onCheckForUpdates(): Promise<void> | void
  onOpenDocs(): void
}

export function updateStatusCopy(state: AppUpdateState, currentVersion: string): string {
  const version = state.version ? ` ${state.version}` : ''
  switch (state.phase) {
    case 'checking': return 'Checking GitHub Releases…'
    case 'available': return `Apex${version} is available.`
    case 'downloading': return state.percent === undefined ? `Downloading Apex${version}…` : `Downloading Apex${version} · ${state.percent}%`
    case 'downloaded': return `Apex${version} is ready to install.`
    case 'not-available': return `Apex ${currentVersion} is up to date.`
    case 'error': return state.message ?? 'The update check failed.'
    case 'unsupported': return state.message ?? 'Update checks are available in installed builds.'
    case 'idle': return 'Check GitHub Releases for a newer Apex version.'
  }
}

export function AboutSettings({ meta, updateState, onCheckForUpdates, onOpenDocs }: AboutSettingsProps) {
  const version = meta?.version ?? '0.1.0'
  const checking = updateState.phase === 'checking'
  return (
    <>
      <header><h1>About Apex</h1><p>A desktop workspace for Pi.</p></header>
      <section className={`about-card ${stylex.props(settingsStyles.aboutCard).className ?? ""}`}><GooeyPiMark size={48} /><div><h2>Apex</h2><p>Pi workspace · Version {version}</p></div></section>
      <section className={`settings-group ${stylex.props(settingsStyles.settingsGroup).className ?? ""}`}>
        <div className={`settings-row ${stylex.props(settingsStyles.settingsRow).className ?? ""}`}><span><strong>Software updates</strong><small role="status">{updateStatusCopy(updateState, version)}</small></span><ApexButton disabled={checking || updateState.phase === 'downloading' || updateState.phase === 'unsupported'} icon={<ArrowClockwise className={[checking ? 'spin' : undefined, stylex.props((checking) && activityStyles.spin, (checking) && overlaysStyles.spin).className].filter(Boolean).join(' ')} size={13} />} onClick={() => { void onCheckForUpdates() }}>{checking ? 'Checking…' : 'Check for updates'}</ApexButton></div>
        <div className={`settings-row ${stylex.props(settingsStyles.settingsRow).className ?? ""}`}><span><strong>Platform</strong><small>{meta?.platform ?? 'macOS'}</small></span></div>
        <div className={`settings-row ${stylex.props(settingsStyles.settingsRow).className ?? ""}`}><span><strong>Home directory</strong><small className={`mono ${stylex.props(activityStyles.mono).className ?? ""}`}>{meta?.homeDir ?? '—'}</small></span></div>
        <div className={`settings-row ${stylex.props(settingsStyles.settingsRow).className ?? ""}`}><span><strong>Help and documentation</strong></span><ApexButton icon={<Question size={13} />} onClick={onOpenDocs}>Open docs</ApexButton></div>
      </section>
    </>
  )
}
