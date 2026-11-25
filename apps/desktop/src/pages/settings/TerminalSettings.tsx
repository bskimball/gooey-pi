import * as stylex from '@stylexjs/stylex'
import { styles as settingsStyles } from 'apex-ui/styles/settings.stylex'
import { styles as activityStyles } from 'apex-ui/styles/activity.stylex'
import { Keyboard } from '@/components/icons'
import type { SettingsSectionProps } from './contracts'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { terminalShellValidation } from './draft-state'
import { DraftSettingField } from './DraftSettingField'

export function TerminalSettings({ settings, onUpdate, platform = 'darwin' }: SettingsSectionProps & { platform?: NodeJS.Platform }) {
  return (
    <>
      <header><h1>Terminal</h1><p>Configure the interactive shell used for local projects.</p></header>
      <section className={`settings-group ${stylex.props(settingsStyles.settingsGroup).className ?? ""}`}>
        <h2>Shell</h2>
        <DraftSettingField
          id="terminal-shell"
          label="Shell executable"
          description="Restart open terminals after changing this value."
          committedValue={settings.terminalShell}
          validate={terminalShellValidation}
          onCommit={(terminalShell) => onUpdate({ terminalShell })}
          className={`mono ${stylex.props(activityStyles.mono).className ?? ""}`}
        />
      </section>
      <section className={`settings-group ${stylex.props(settingsStyles.settingsGroup).className ?? ""}`}>
        <h2>Keyboard shortcut</h2>
        <div className={`shortcut-row ${stylex.props(settingsStyles.shortcutRow).className ?? ""}`}><span><Keyboard size={14} />Toggle terminal</span><kbd>{shortcutLabel(platform, ['Primary', 'J'])}</kbd></div>
      </section>
    </>
  )
}
