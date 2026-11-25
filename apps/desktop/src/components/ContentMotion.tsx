import * as stylex from '@stylexjs/stylex'
import { AnimatePresence, motion, useIsPresent, useReducedMotionConfig } from 'motion/react'
import type { ReactNode, Ref } from 'react'

const EASE_OUT = [0.23, 1, 0.32, 1] as const
const EASE_EXIT = [0.2, 0, 0, 1] as const

const styles = stylex.create({
  stage: { position: 'relative', minWidth: 0 },
  inline: { display: 'inline-flex', alignItems: 'center', gap: 'inherit' },
})

function Pane({ children, instant, ref }: { children: ReactNode; instant: boolean; ref?: Ref<HTMLDivElement> }) {
  const present = useIsPresent()
  return (
    <motion.div
      ref={ref}
      inert={!present}
      aria-hidden={!present || undefined}
      initial={instant ? false : { opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={instant ? undefined : { opacity: 0, y: -2, transition: { duration: 0.1 } }}
      transition={{ duration: instant ? 0 : 0.16, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  )
}

export function SurfaceSwap({ contentKey, children, instant }: { contentKey: string; children: ReactNode; instant: boolean }) {
  return (
    <div {...stylex.props(styles.stage)}>
      <AnimatePresence initial={false} mode="popLayout">
        <Pane key={contentKey} instant={instant}>
          {children}
        </Pane>
      </AnimatePresence>
    </div>
  )
}

export function prefersInstantMotion(): boolean {
  return (
    (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) ||
    Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)
  )
}

export function useInstantMotion(): boolean {
  return Boolean(useReducedMotionConfig()) || prefersInstantMotion()
}

export function collapseMotionProps(instant: boolean) {
  return {
    initial: instant ? (false as const) : { height: 0, opacity: 0 },
    animate: { height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' as const } },
    exit: instant ? undefined : { height: 0, opacity: 0, overflow: 'hidden' as const, transition: { duration: 0.125, ease: EASE_EXIT } },
    transition: instant ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT },
    style: { overflow: 'hidden' as const },
  }
}

export function arrivalMotionProps(instant: boolean, animateArrival: boolean) {
  return {
    initial: instant || !animateArrival ? (false as const) : { opacity: 0 },
    animate: { opacity: 1 },
    transition: instant ? { duration: 0 } : { duration: 0.15, ease: EASE_OUT },
  }
}

function InlineValue({ children, ref }: { children: ReactNode; ref?: Ref<HTMLSpanElement> }) {
  const present = useIsPresent()
  return (
    <motion.span
      ref={ref}
      aria-hidden={!present || undefined}
      {...stylex.props(typeof children !== 'string' && styles.inline)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.08, ease: EASE_EXIT } }}
      transition={{ duration: 0.15, ease: EASE_OUT }}
    >
      {children}
    </motion.span>
  )
}

export function MorphInline({ morphKey, instant, children }: { morphKey: string; instant: boolean; children: ReactNode }) {
  if (instant) return <>{children}</>
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <InlineValue key={morphKey}>{children}</InlineValue>
    </AnimatePresence>
  )
}
