import { Banner } from '@astryxdesign/core/Banner'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { ArrowsClockwise, Keyboard, Robot, ShieldCheck } from '@/components/icons'
import { ApexButton } from '@/components/ui'
import { useState } from 'react'
import { HARNESS_IDS, type HarnessId } from '@/types/api'
import { errorMessage } from '@/lib/errors'
import { HARNESS_AGENT_NAMES } from '@/lib/harness'
import { detectRendererPlatform, shortcutLabel } from '@/lib/platform-shortcuts'
import type { SettingsMetaSectionProps } from './contracts'
import { DraftSettingField } from './DraftSettingField'
import { SettingsToggle } from './SettingsToggle'

export function AgentSettings({ settings, meta, onUpdate, onRefreshHarnesses }: SettingsMetaSectionProps) {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const platform = meta?.platform ?? detectRendererPlatform()
  const oppositeActionShortcut = shortcutLabel(platform, ['Primary', 'Enter'])
  const newLineShortcut = shortcutLabel(platform, ['Shift', 'Enter'])
  const refreshHarnesses = async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshError('')
    try { await onRefreshHarnesses() } catch (error) { setRefreshError(errorMessage(error)) }
    finally { setRefreshing(false) }
  }
  const runtimePathValidation = (value: string, harness: HarnessId): string => {
    if (!value) return ''
    const absolute = meta?.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') : value.startsWith('/')
    return absolute ? '' : `${HARNESS_AGENT_NAMES[harness]} path must be absolute (or blank for automatic discovery)`
  }
  return (
    <>
      <header><h1>Pi</h1><p>Runtime discovery, model providers, and workspace permissions.</p></header>
      <section className="settings-group">
        <div className="settings-group__heading">
          <h2>Runtime</h2>
          <ApexButton compact disabled={refreshing} icon={<ArrowsClockwise className={refreshing ? 'spin' : ''} size={13} />} onClick={() => { void refreshHarnesses() }}>
            {refreshing ? 'Refreshing…' : 'Refresh harnesses'}
          </ApexButton>
        </div>
        {refreshError ? <Banner status="error" role="alert" className="settings-error" title={refreshError} /> : null}
        {HARNESS_IDS.map((harness) => {
          const name = HARNESS_AGENT_NAMES[harness]
          const status = meta?.harnesses[harness]
          return (
            <div className="runtime-card" key={harness}>
              <span className={status?.path ? 'is-online' : ''}><Robot size={17} /></span>
              <div>
                <strong>{status?.path ? `${name} is ready` : `${name} not detected`}</strong>
                <small title={status?.problem ? `${status.problem.path}: ${status.problem.reason}` : undefined}>{status?.path ?? (status?.problem ? `${status.problem.path}: ${status.problem.reason}` : `Install ${name}, then refresh harnesses.`)}</small>
              </div>
              {status?.version ? <code>v{status.version}</code> : null}
            </div>
          )
        })}
        <p className="settings-group__description">Discovery checks a saved override first, then the harness environment variable, bundled files, PATH, and standard install directories. Refreshing updates future sessions without restarting Apex.</p>
        {HARNESS_IDS.map((harness) => <DraftSettingField
          key={harness}
          id={`runtime-path-${harness}`}
          label={`${HARNESS_AGENT_NAMES[harness]} executable override`}
          description="Optional absolute path. Leave blank to keep automatic discovery."
          committedValue={settings.runtimePaths[harness]}
          validate={(value) => runtimePathValidation(value.trim(), harness)}
          normalize={(value) => value.trim()}
          onCommit={async (value) => {
            await onUpdate({ runtimePaths: { ...settings.runtimePaths, [harness]: value } })
            await refreshHarnesses()
          }}
        />)}
      </section>
      <section className="settings-group">
        <h2>Transcript</h2>
        <SettingsToggle checked={settings.showReasoningSummaries} onChange={(showReasoningSummaries) => { void onUpdate({ showReasoningSummaries }) }} label="Show reasoning summaries" description="Display reasoning summaries and traces, during and after a turn. Each Thought can be folded." />
        <SettingsToggle checked={settings.showToolCalls} onChange={(showToolCalls) => { void onUpdate({ showToolCalls }) }} label="Show tool calls" description="Display compact tool activity, arguments, and expandable results." />
      </section>
      <section className="settings-group">
        <h2>Message shortcuts</h2>
        <div className="settings-row">
          <span><strong>Primary Enter action while an agent is working</strong><small>{oppositeActionShortcut} always uses the opposite action. {newLineShortcut} adds a new line.</small></span>
          <SegmentedControl
            label="Primary Enter action"
            size="sm"
            value={settings.messageEnterAction}
            onChange={(next) => {
              if (next === 'queue' || next === 'steer') void onUpdate({ messageEnterAction: next })
            }}
            className="shortcut-choice"
          >
            {(['queue', 'steer'] as const).map((action) => (
              <SegmentedControlItem
                key={action}
                value={action}
                label={action === 'queue' ? 'Queue' : 'Steer'}
                className={settings.messageEnterAction === action ? 'is-active' : ''}
              />
            ))}
          </SegmentedControl>
        </div>
        <div className="shortcut-row"><span><Keyboard size={14} />{settings.messageEnterAction === 'queue' ? 'Queue message' : 'Steer current turn'}</span><kbd>Enter</kbd></div>
        <div className="shortcut-row"><span><Keyboard size={14} />{settings.messageEnterAction === 'queue' ? 'Steer current turn' : 'Queue message'}</span><kbd>{oppositeActionShortcut}</kbd></div>
      </section>
      <section className="settings-group">
        <h2>Permissions</h2>
        <div className="info-row"><ShieldCheck size={15} /><div><strong>Workspace access</strong><small>The active agent only receives the project folders attached to a session.</small></div></div>
      </section>
    </>
  )
}
