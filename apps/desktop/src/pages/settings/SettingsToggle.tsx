import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import * as stylex from '@stylexjs/stylex'

const styles = stylex.create({
  row: {
    minHeight: 64,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--border)',
  },
  copy: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  title: {
    fontSize: 'var(--fs-ui)',
    fontWeight: 550,
    color: 'var(--text)',
  },
  description: {
    marginTop: 2,
    color: 'var(--text-tertiary)',
    fontSize: 'var(--fs-meta)',
  },
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
  const rowStylex = stylex.props(styles.row)
  const copyStylex = stylex.props(styles.copy)
  const titleStylex = stylex.props(styles.title)
  const descStylex = stylex.props(styles.description)

  return (
    <div className={`settings-toggle ${rowStylex.className ?? ''}`.trim()} style={rowStylex.style}>
      <span className={copyStylex.className} style={copyStylex.style}>
        <strong className={titleStylex.className} style={titleStylex.style}>{label}</strong>
        {description ? <small className={descStylex.className} style={descStylex.style}>{description}</small> : null}
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
