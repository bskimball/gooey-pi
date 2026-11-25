import * as stylex from '@stylexjs/stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { AnimatePresence, motion } from 'motion/react'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { MorphInline, useInstantMotion } from '../ContentMotion'
import { CaretRight } from '../icons'
import { PlanStatusMark } from '../PlanStatusMark'
import type { SessionSummary } from './session-summary'

const styles = stylex.create({
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  heading: { marginBottom: 0, fontVariantNumeric: 'tabular-nums' },
  count: { position: 'relative', display: 'inline-grid' },
  toggle: { width: 'auto', flexShrink: 0, minHeight: 24, marginLeft: 0, marginRight: 0, paddingInline: 4, fontSize: 11 },
  track: { height: 2, marginTop: 5, borderRadius: 2, overflow: 'hidden', backgroundColor: 'var(--border-subtle)' },
  fill: { height: '100%', transformOrigin: 'left', backgroundColor: 'var(--apex)' },
  complete: { backgroundColor: 'var(--success)' },
  viewport: { overflow: 'clip', marginTop: 6, transition: 'height 180ms var(--ease-out)' },
  instant: { transitionProperty: 'none' },
  list: { position: 'relative', maxHeight: 240, overflowY: 'auto', overflowX: 'hidden', outlineOffset: -2 },
  row: { flexShrink: 0, transition: 'color var(--fast)' },
  expandedCaret: { transform: 'rotate(90deg)' },
  text: { minWidth: 0, overflowWrap: 'anywhere' },
})

const transition = { duration: 0.18, ease: [0.23, 1, 0.32, 1] } as const

export function SummaryPlan({ todos }: { todos: SessionSummary['todos'] }) {
  const [expanded, setExpanded] = useState(false)
  const [keyboardSnapshot, setKeyboardSnapshot] = useState<typeof todos | null>(null)
  const instant = useInstantMotion() || keyboardSnapshot === todos
  const listId = useId()
  const list = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  const current = [...todos.filter((todo) => todo.status === 'in_progress'), ...todos.filter((todo) => todo.status === 'blocked')]
  const compact = current.length ? current.slice(0, 3) : todos.filter((todo) => todo.status === 'pending').slice(0, 1)
  const visible = expanded ? todos : compact
  const done = todos.filter((todo) => todo.status === 'completed').length
  const total = todos.filter((todo) => todo.status !== 'cancelled').length

  // Animate the viewport around natural-height rows. Wrapped text keeps its full height at every frame.
  useLayoutEffect(() => {
    const node = list.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const measure = () => setHeight(node.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const rows = visible.map((todo) => {
    return (
      <motion.div
        key={todo.id}
        role="listitem"
        layout={instant ? false : 'position'}
        className={[`is-${todo.status === 'in_progress' ? 'current' : todo.status === 'cancelled' ? 'stale' : todo.status}`, stylex.props(styles.row).className].join(' ')}
        aria-label={`${todo.content}, ${todo.status.replace('_', ' ')}${todo.note ? `, ${todo.note}` : ''}`}
        title={todo.status === 'blocked' || todo.status === 'cancelled' ? todo.status : undefined}
        initial={instant ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={instant ? { duration: 0 } : transition}
      >
        <PlanStatusMark status={todo.status} instant={instant} />
        <span {...stylex.props(styles.text)}>
          {todo.content}
          {todo.note ? ` — ${todo.note}` : ''}
        </span>
      </motion.div>
    )
  })
  return (
    <section className={`summary-section summary-plan ${stylex.props(inspectorStyles.summarySection).className ?? ''}`}>
      <div {...stylex.props(styles.header)}>
        <h3 {...stylex.props(styles.heading)}>
          Plan{' '}
          <span {...stylex.props(styles.count)}>
            <MorphInline morphKey={`${done}/${total}`} instant={instant}>
              ({done}/{total})
            </MorphInline>
          </span>
        </h3>
        {expanded || todos.length > compact.length ? (
          <button
            type="button"
            {...stylex.props(inspectorStyles.runConfigToggle, styles.toggle)}
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={(event) => {
              setKeyboardSnapshot(event.detail === 0 ? todos : null)
              setExpanded((value) => !value)
            }}
          >
            <CaretRight size={12} aria-hidden="true" {...stylex.props(expanded && styles.expandedCaret)} />
            {expanded ? 'Show current' : `Show all ${todos.length} tasks`}
          </button>
        ) : null}
      </div>
      <div {...stylex.props(styles.track)} aria-hidden="true">
        <motion.div
          {...stylex.props(styles.fill, total > 0 && done === total && styles.complete)}
          initial={false}
          animate={{ scaleX: total ? done / total : 0 }}
          transition={instant ? { duration: 0 } : transition}
        />
      </div>
      <div {...stylex.props(styles.viewport, instant && styles.instant)} style={{ height: instant ? undefined : height }}>
        <motion.div
          ref={list}
          layoutScroll
          id={listId}
          role="list"
          aria-label="Plan tasks"
          tabIndex={expanded ? 0 : undefined}
          className={`progress-list ${stylex.props(inspectorStyles.progressList, styles.list).className ?? ''}`}
        >
          {instant ? (
            rows
          ) : (
            <AnimatePresence initial={false} mode="popLayout">
              {rows}
            </AnimatePresence>
          )}
        </motion.div>
      </div>
    </section>
  )
}
