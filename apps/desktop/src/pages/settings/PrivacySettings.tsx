import * as stylex from '@stylexjs/stylex'
import { styles as settingsStyles } from 'apex-ui/styles/settings.stylex'
import type { SettingsSectionProps } from './contracts'

export function PrivacySettings(_props: SettingsSectionProps) {
  return (
    <>
      <header><h1>Privacy</h1><p>Understand how Apex stores settings and connects to agents.</p></header>
      <section className={`settings-group ${stylex.props(settingsStyles.settingsGroup).className ?? ""}`}>
        <h2>Local data</h2>
        <p {...stylex.props(settingsStyles.settingsGroupDescription)}>Project metadata and interface settings are stored locally on this device.</p>
      </section>
      <section className={`settings-group ${stylex.props(settingsStyles.settingsGroup).className ?? ""}`}>
        <h2>Agent requests</h2>
        <p {...stylex.props(settingsStyles.settingsGroupDescription)}>Session requests follow the selected agent and its provider configuration.</p>
      </section>
    </>
  )
}
