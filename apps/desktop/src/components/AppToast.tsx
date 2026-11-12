import * as stylex from '@stylexjs/stylex'
import { X } from './icons'
import { IconButton } from './ui'

const styles = stylex.create({
  toast: {
    position: 'fixed',
    zIndex: 300,
    left: '50%',
    bottom: 18,
    maxWidth: 'min(520px, calc(100% - 32px))',
    minHeight: 36,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingTop: 7,
    paddingRight: 8,
    paddingBottom: 7,
    paddingLeft: 12,
    transform: 'translateX(-50%)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border-strong)',
    borderRadius: 'var(--radius-lg)',
    color: 'var(--text)',
    backgroundColor: 'var(--surface-raised)',
    boxShadow: 'var(--shadow-popover)',
    fontSize: 'var(--fs-ui)',
  },
  dismiss: {
    width: 22,
    height: 22,
  },
})

export function AppToast({ message, onDismiss }: { message: string; onDismiss(): void }) {
  const toastStylex = stylex.props(styles.toast)
  const dismissStylex = stylex.props(styles.dismiss)
  return (
    <div className={`toast ${toastStylex.className ?? ''}`.trim()} style={toastStylex.style} role="status">
      <span>{message}</span>
      <IconButton size="small" label="Dismiss" className={dismissStylex.className} style={dismissStylex.style} onClick={onDismiss}>
        <X size={13} />
      </IconButton>
    </div>
  )
}
