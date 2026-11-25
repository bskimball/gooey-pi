import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { styles as settingsStyles } from 'apex-ui/styles/settings.stylex'
import * as stylex from '@stylexjs/stylex'

const styles = stylex.create({
  checkbox: {
    flex: '0 0 auto',
  },
})

interface SettingsToggleProps {
  checked: boolean
  onChange(value: boolean): void
  label: string
  description?: string
}

export function SettingsToggle({ checked, onChange, label, description }: SettingsToggleProps) {
  return (
    <div className={`settings-row settings-toggle ${stylex.props(settingsStyles.settingsRow).className ?? ''}`}>
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <CheckboxInput
        label=""
        aria-label={label}
        value={checked}
        onChange={(next) => onChange(next)}
        xstyle={styles.checkbox}
      />
    </div>
  )
}
