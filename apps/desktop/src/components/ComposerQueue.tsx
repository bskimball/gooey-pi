import { useId, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import * as stylex from '@stylexjs/stylex'
import type { QueuedPrompt } from '@/types/api'
import { ArrowUp, CaretDown, Clock, PencilSimpleLine, Trash } from './icons'
import { IconButton } from './ui'
import { rowMarker, styles } from './composer-queue.stylex'

interface ComposerQueueProps {
  queuedMessages: QueuedPrompt[]
  onSendNow(message: QueuedPrompt): void
  onEdit(message: QueuedPrompt): void
  onDelete?(message: QueuedPrompt): void
}

/** Messages waiting for a turn boundary, shown above the composer. */
export function ComposerQueue({ queuedMessages, onSendNow, onEdit, onDelete }: ComposerQueueProps) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const instant = Boolean(useReducedMotion()) || (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) || Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)
  const collapsible = queuedMessages.length > 1
  const open = !collapsible || expanded
  return (
    <motion.section
      className={`composer-queue ${stylex.props(styles.root, !open && styles.collapsed).className}`}
      aria-label="Queued messages"
      aria-live="polite"
      initial={instant ? false : { height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1, transition: instant ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] } }}
      exit={instant ? undefined : { height: 0, opacity: 0, transition: { duration: 0.13, ease: [0.2, 0, 0, 1] } }}
      style={{ overflow: 'hidden' }}
    >
      {collapsible ? (
        <button type="button" {...stylex.props(styles.header, styles.toggle)} aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setExpanded((value) => !value)}>
          <span {...stylex.props(styles.heading)}>
            <Clock size={13} />
            {queuedMessages.length} queued messages
          </span>
          <CaretDown size={12} {...stylex.props(styles.caret, open && styles.openCaret)} />
        </button>
      ) : (
        <div {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.heading)}>
            <Clock size={13} />
            Queued message
          </span>
        </div>
      )}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            {...stylex.props(styles.list)}
            id={listId}
            initial={instant ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: instant ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] } }}
            exit={instant ? undefined : { height: 0, opacity: 0, transition: { duration: 0.13, ease: [0.2, 0, 0, 1] } }}
            style={{ overflow: 'hidden' }}
          >
            <AnimatePresence initial={false}>
              {queuedMessages.map((queued) => (
                <motion.div
                  className={`composer-queue__item ${stylex.props(rowMarker, styles.item).className}`}
                  key={queued.id}
                  initial={instant ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1, transition: instant ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] } }}
                  exit={instant ? undefined : { height: 0, opacity: 0, transition: { duration: 0.13, ease: [0.2, 0, 0, 1] } }}
                  style={{ overflow: 'hidden' }}
                >
                  <span {...stylex.props(styles.text)}>{queued.text}</span>
                  <span className={`composer-queue__actions ${stylex.props(styles.actions).className}`}>
                    <IconButton
                      size="small"
                      label={`Send queued message immediately: ${queued.text}`}
                      className="composer-queue__action"
                      xstyle={styles.action}
                      title="Send queued message immediately"
                      onClick={() => onSendNow(queued)}
                    >
                      <ArrowUp size={13} />
                    </IconButton>
                    <IconButton
                      size="small"
                      label={`Edit queued message: ${queued.text}`}
                      className="composer-queue__action"
                      xstyle={styles.action}
                      title="Edit queued message"
                      onClick={() => onEdit(queued)}
                    >
                      <PencilSimpleLine size={13} />
                    </IconButton>
                    <IconButton
                      size="small"
                      label={`Delete queued message: ${queued.text}`}
                      className="composer-queue__action"
                      xstyle={[styles.action, styles.deleteAction]}
                      title="Delete queued message"
                      onClick={() => onDelete?.(queued)}
                    >
                      <Trash size={13} />
                    </IconButton>
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  )
}
