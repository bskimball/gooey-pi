import { Dialog } from '@astryxdesign/core/Dialog'
import * as stylex from '@stylexjs/stylex'
import { X } from './icons'
import { IconButton, focusableSelector, useAppShellOverlay } from './ui'
import { useCallback, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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
    '::backdrop': {
      backgroundColor: 'rgba(6, 11, 18, 0.46)',
      backdropFilter: 'blur(4px)',
    },
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

export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose(): void; footer?: ReactNode }) {
  const titleId = useId()
  useAppShellOverlay(true)
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
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      purpose="info"
      width={500}
      padding={0}
      role="dialog"
      aria-labelledby={titleId}
      className="modal"
      xstyle={styles.modalDialog}
    >
      <div className={`modal__header ${headerStylex.className ?? ''}`.trim()} style={headerStylex.style}>
        <h2 id={titleId} className={titleStylex.className} style={titleStylex.style}>{title}</h2>
        <IconButton label="Close" onClick={onClose}><X size={16} /></IconButton>
      </div>
      <div className={`modal__body ${bodyStylex.className ?? ''}`.trim()} style={bodyStylex.style}>{children}</div>
      {footer ? <div className={`modal__footer ${footerStylex.className ?? ''}`.trim()} style={footerStylex.style}>{footer}</div> : null}
    </Dialog>,
    document.body,
  )
}
