import { ArrowClockwise, Question } from '@/components/icons'
import { GooeyPiMark } from '@/components/ui'
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
      <section className="about-card"><GooeyPiMark size={48} /><div><h2>Apex</h2><p>Pi workspace · Version {version}</p></div></section>
      <section className="settings-group">
        <div className="settings-row"><span><strong>Software updates</strong><small role="status">{updateStatusCopy(updateState, version)}</small></span><button className="button" type="button" disabled={checking || updateState.phase === 'downloading' || updateState.phase === 'unsupported'} onClick={() => { void onCheckForUpdates() }}><ArrowClockwise className={checking ? 'spin' : undefined} size={13} /> {checking ? 'Checking…' : 'Check for updates'}</button></div>
        <div className="settings-row"><span><strong>Platform</strong><small>{meta?.platform ?? 'macOS'}</small></span></div>
        <div className="settings-row"><span><strong>Home directory</strong><small className="mono">{meta?.homeDir ?? '—'}</small></span></div>
        <div className="settings-row"><span><strong>Help and documentation</strong></span><button className="button" type="button" onClick={onOpenDocs}><Question size={13} /> Open docs</button></div>
      </section>
    </>
  )
}
