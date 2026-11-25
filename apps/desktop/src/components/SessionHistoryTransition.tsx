import * as stylex from '@stylexjs/stylex'
import { AnimatePresence, motion, useAnimationControls, usePresence, usePresenceData } from 'motion/react'
import { useEffect, useEffectEvent, type ReactNode } from 'react'

const styles = stylex.create({
  stage: { display: 'grid', gridTemplate: 'minmax(0, 1fr) / minmax(0, 1fr)', flexGrow: 1, flexBasis: 0, minHeight: 0, minWidth: 0 },
  layer: { gridArea: '1 / 1', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 },
  hidden: { visibility: 'hidden' },
})

const enter = { opacity: 0, transform: 'translateY(4px)' }
const current = { opacity: 1, transform: 'none' }
const leave = { opacity: 0, transform: 'translateY(-3px)' }

function HistoryLayer({ instant, children }: { instant: boolean; children: ReactNode }) {
  const [present, remove] = usePresence()
  const instantExit = usePresenceData() === true
  const snap = present ? instant : instantExit
  const controls = useAnimationControls()
  const finishExit = useEffectEvent(() => remove?.())
  useEffect(() => {
    if (snap || document.hidden) {
      controls.set(present ? current : leave)
      if (!present) finishExit()
      return
    }
    // Give the new scroller a paint after measuring and pinning its initial messages.
    let cancelled = false
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const animation = present
          ? controls.start(current, { duration: 0.18, ease: [0.23, 1, 0.32, 1] })
          : controls.start(leave, { duration: 0.11, ease: 'easeOut' })
        void animation.then(() => { if (!cancelled && !present) finishExit() })
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      controls.stop()
    }
  }, [controls, present, snap])
  return (
    <motion.div
      {...stylex.props(styles.layer, !present && snap && styles.hidden)}
      inert={!present}
      aria-hidden={!present || undefined}
      initial={instant ? false : enter}
      animate={controls}
    >
      {children}
    </motion.div>
  )
}

export function SessionHistoryTransition({ sessionKey, instant, children }: { sessionKey: string; instant: boolean; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.stage)} data-session-motion={instant ? undefined : 'full'}>
      <AnimatePresence initial={false} custom={instant} presenceAffectsLayout={false}>
        <HistoryLayer key={sessionKey} instant={instant}>{children}</HistoryLayer>
      </AnimatePresence>
    </div>
  )
}
