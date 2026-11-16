import * as stylex from '@stylexjs/stylex'
import { motion, useReducedMotion } from 'motion/react'
import { X } from './icons'
import { IconButton } from './ui'

const styles = stylex.create({
  toastRegion: {
    position: 'fixed',
    zIndex: 300,
    left: 0,
    right: 0,
    bottom: 18,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  toast: {
    pointerEvents: 'auto',
    maxWidth: 'min(520px, calc(100% - 32px))',
    minHeight: 36,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingTop: 7,
    paddingRight: 8,
    paddingBottom: 7,
    paddingLeft: 12,
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
  const instant = Boolean(useReducedMotion())
    || (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion'))
    || Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)
  const regionStylex = stylex.props(styles.toastRegion)
  const toastStylex = stylex.props(styles.toast)
  const dismissStylex = stylex.props(styles.dismiss)
  return (
    <div className={regionStylex.className} style={regionStylex.style}>
      <motion.div
        className={`toast ${toastStylex.className ?? ''}`.trim()}
        style={toastStylex.style}
        role="status"
        initial={instant ? false : { opacity: 0, y: '100%', scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={instant ? undefined : { opacity: 0, y: '100%', scale: 0.97, transition: { duration: 0.14, ease: [0.2, 0, 0, 1] } }}
        transition={instant ? { duration: 0 } : { duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      >
        <span>{message}</span>
        <IconButton size="small" label="Dismiss" className={dismissStylex.className} style={dismissStylex.style} onClick={onDismiss}>
          <X size={13} />
        </IconButton>
      </motion.div>
    </div>
  )
}
