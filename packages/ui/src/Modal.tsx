import { styles as overlaysStyles } from './styles/overlays.stylex'
import { Dialog } from '@astryxdesign/core/Dialog'
import * as stylex from '@stylexjs/stylex'
import { usePresence, useReducedMotion } from 'motion/react'
import { X } from './icons'
import { IconButton, focusableSelector, useAppShellOverlay } from './ui'
import { createContext, useCallback, useContext, useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const modalIn = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(4px) scale(0.985)' },
  to: { opacity: 1, transform: 'translateY(0) scale(1)' },
})

const modalOut = stylex.keyframes({
  from: { opacity: 1, transform: 'translateY(0) scale(1)' },
  to: { opacity: 0, transform: 'translateY(2px) scale(0.985)' },
})

const backdropOut = stylex.keyframes({
  from: { opacity: 1 },
  to: { opacity: 0 },
})

const MODAL_EXIT_MS = 130

const styles = stylex.create({
  modalDialog: {
    padding: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border-strong)',
    borderRadius: 14,
    color: 'var(--text)',
    backgroundColor: 'var(--surface-raised)',
    boxShadow: 'var(--shadow-popover)',
    overflow: 'hidden',
    transformOrigin: 'center',
    animationName: {
      default: modalIn,
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    animationDuration: {
      default: '160ms',
      '@media (prefers-reduced-motion: reduce)': '0ms',
    },
    animationTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
    '::backdrop': {
      backgroundColor: 'rgba(6, 11, 18, 0.46)',
      backdropFilter: 'blur(4px)',
    },
  },
  modalDialogExiting: {
    pointerEvents: 'none',
    animationName: {
      default: modalOut,
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    animationDuration: {
      default: '130ms',
      '@media (prefers-reduced-motion: reduce)': '0ms',
    },
    animationTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
    animationFillMode: 'forwards',
    '::backdrop': {
      pointerEvents: 'none',
      animationName: backdropOut,
      animationDuration: '130ms',
      animationTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
      animationFillMode: 'forwards',
    },
  },
  modalDialogInstant: {
    animationName: 'none',
    animationDuration: '0ms',
  },
  modalHeader: {
    flexShrink: 0,
    height: 48,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 0,
    paddingRight: 12,
    paddingBottom: 0,
    paddingLeft: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--border)',
  },
  modalTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 550,
    color: 'var(--text)',
  },
  modalBody: {
    flex: '1 1 auto',
    minHeight: 0,
    padding: 16,
    color: 'var(--text-secondary)',
    fontSize: 'var(--fs-ui)',
    overflowY: 'auto',
  },
  modalFooter: {
    flexShrink: 0,
    minHeight: 53,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 7,
    paddingBlock: 9,
    paddingInline: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: 'var(--border)',
    backgroundColor: 'var(--surface-subtle)',
  },
})

function ensureDialogModalMethods(dialog: HTMLDialogElement | null): void {
  if (!dialog) return
  if (typeof dialog.showModal !== 'function') {
    dialog.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '')
      const target = this.querySelector<HTMLElement>('[data-autofocus], [autofocus]') ?? this.querySelector<HTMLElement>(focusableSelector)
      target?.focus()
    }
  }
  if (typeof dialog.close !== 'function') {
    dialog.close = function close(this: HTMLDialogElement, returnValue?: string) {
      if (returnValue !== undefined) this.returnValue = returnValue
      this.removeAttribute('open')
    }
  }
}

export const ModalContainerContext = createContext<HTMLElement | null>(null)

export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose(): void; footer?: ReactNode }) {
  const container = useContext(ModalContainerContext)
  const titleId = useId()
  const [isPresent, safeToRemove] = usePresence()
  const instant = Boolean(useReducedMotion())
    || (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion'))
    || Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)
  useAppShellOverlay(isPresent && !container)
  useEffect(() => {
    if (isPresent) return
    if (instant) {
      safeToRemove?.()
      return
    }
    const timer = window.setTimeout(() => {
      safeToRemove?.()
    }, MODAL_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [isPresent, instant, safeToRemove])
  const attachDialog = useCallback((node: HTMLDialogElement | null) => {
    ensureDialogModalMethods(node)
  }, [])
  const headerStylex = stylex.props(styles.modalHeader)
  const titleStylex = stylex.props(styles.modalTitle)
  const bodyStylex = stylex.props(styles.modalBody)
  const footerStylex = stylex.props(styles.modalFooter)

  return createPortal(
    <Dialog
      ref={attachDialog}
      isOpen
      inert={!isPresent || undefined}
      onOpenChange={(open) => {
        if (!open && isPresent) onClose()
      }}
      purpose="info"
      width={500}
      padding={0}
      role="dialog"
      aria-labelledby={titleId}
      className="modal"
      xstyle={[overlaysStyles.modal, styles.modalDialog, !isPresent && styles.modalDialogExiting, instant && styles.modalDialogInstant]}
    >
      <div className={`modal__header ${stylex.props(overlaysStyles.modalHeader, styles.modalHeader).className ?? ""}`} style={headerStylex.style}>
        <h2 id={titleId} className={titleStylex.className} style={titleStylex.style}>{title}</h2>
        <IconButton label="Close" onClick={onClose}><X size={16} /></IconButton>
      </div>
      <div className={`modal__body ${stylex.props(overlaysStyles.modalBody, styles.modalBody).className ?? ""}`} style={bodyStylex.style}>{children}</div>
      {footer ? <div className={`modal__footer ${stylex.props(overlaysStyles.modalFooter, styles.modalFooter).className ?? ""}`} style={footerStylex.style}>{footer}</div> : null}
    </Dialog>,
    container ?? document.body,
  )
}
