import * as stylex from '@stylexjs/stylex'
import { motion, useIsPresent } from 'motion/react'
import { styles as sidebarStyles } from 'apex-ui/styles/sidebar.stylex'
import type { ReactNode } from 'react'
import { collapseMotionProps } from './ContentMotion'

const ROW_ENTER_EASE = [0.23, 1, 0.32, 1] as const
const ROW_EXIT_EASE = [0.23, 1, 0.32, 1] as const
export const SIDEBAR_SELECTION_TRANSITION = { duration: 0.2, ease: [0.32, 0.72, 0, 1] } as const

/** Keep exiting controls inert until their visual exit finishes. */
export function SidebarPresenceRow({ skipMotion, index, menuOpen = false, children }: { skipMotion: boolean; index?: number; menuOpen?: boolean; children: ReactNode }) {
  const isPresent = useIsPresent()
  return (
    <motion.div
      inert={!isPresent}
      layout={skipMotion || index === undefined ? false : 'position'}
      layoutDependency={index}
      initial={skipMotion ? false : { height: 0, opacity: 0, x: -8, overflow: 'hidden' }}
      animate={skipMotion ? undefined : {
        height: 'auto',
        opacity: 1,
        x: 0,
        overflow: menuOpen ? 'visible' : 'hidden',
        transitionEnd: { overflow: 'visible' },
      }}
      exit={skipMotion ? undefined : {
        height: 0,
        opacity: 0,
        x: -12,
        overflow: 'hidden',
        pointerEvents: 'none',
        transition: {
          x: { duration: 0.15, ease: ROW_EXIT_EASE },
          opacity: { duration: 0.14, ease: ROW_EXIT_EASE },
          height: { duration: 0.14, delay: 0.03, ease: [0.2, 0, 0, 1] },
        },
      }}
      transition={skipMotion ? { duration: 0 } : {
        layout: SIDEBAR_SELECTION_TRANSITION,
        height: { duration: 0.17, ease: ROW_ENTER_EASE },
        opacity: { duration: 0.18, delay: 0.02, ease: ROW_ENTER_EASE },
        x: { duration: 0.19, ease: ROW_ENTER_EASE },
      }}
    >
      {children}
    </motion.div>
  )
}

export function SidebarSelectionMark({ scope, instant }: { scope: string; instant: boolean }) {
  return (
    <motion.span
      aria-hidden="true"
      layoutId={scope}
      transition={{ layout: instant ? { duration: 0 } : SIDEBAR_SELECTION_TRANSITION }}
      {...stylex.props(sidebarStyles.sessionSelectionMark)}
    />
  )
}

export function ProjectSessionList({ children, instant }: { children: ReactNode; instant: boolean }) {
  const present = useIsPresent()
  return (
    <motion.div
      inert={!present}
      className={`session-list ${stylex.props(sidebarStyles.sessionList).className ?? ''}`}
      {...collapseMotionProps(instant)}
    >
      {children}
    </motion.div>
  )
}
