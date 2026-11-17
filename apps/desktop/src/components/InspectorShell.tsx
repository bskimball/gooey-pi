import * as stylex from '@stylexjs/stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex'
import { motion, useAnimationControls, useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { useFocusTrap } from './ui'

const INSPECTOR_WIDTH = 'var(--inspector-width, clamp(340px, 42vw, 410px))'
const SPRING_TRANSITION = { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 } as const
const INSTANT_TRANSITION = { duration: 0 } as const

const FRAME_VARIANTS = {
  open: { width: INSPECTOR_WIDTH },
  closed: { width: 0 },
}

const ASIDE_VARIANTS = {
  open: { x: 0, opacity: 1 },
  closed: { x: 16, opacity: 0 },
}

type MotionDriver = 'docked' | 'overlay'

function prefersInstantMotion(): boolean {
  return (
    (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) ||
    Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)
  )
}

export interface InspectorShellProps {
  visible: boolean
  overlay: boolean
  onClose(): void
  label: string
  children: ReactNode
  instant?: boolean
  onMotionStart?(): void
  onMotionComplete?(): void
  viewportRef?: Ref<HTMLDivElement>
}

export function InspectorShell({
  visible,
  overlay,
  onClose,
  label,
  children,
  instant,
  onMotionStart,
  onMotionComplete,
  viewportRef,
}: InspectorShellProps) {
  const inspectorRef = useFocusTrap<HTMLElement>(overlay && visible, onClose)
  const frameControls = useAnimationControls()
  const asideControls = useAnimationControls()
  const initialState = useRef(visible ? 'open' : 'closed')
  const prefersReducedMotion = useReducedMotion()
  const skipMotion = Boolean(instant) || Boolean(prefersReducedMotion) || prefersInstantMotion()

  const [prevVisible, setPrevVisible] = useState(visible)
  const [settledOpen, setSettledOpen] = useState(visible)
  const [settledClosed, setSettledClosed] = useState(!visible)

  if (visible !== prevVisible) {
    setPrevVisible(visible)
    setSettledOpen(false)
    setSettledClosed(false)
  }

  const visibleRef = useRef(visible)
  const skipMotionRef = useRef(skipMotion)
  const onMotionStartRef = useRef(onMotionStart)
  const onMotionCompleteRef = useRef(onMotionComplete)
  visibleRef.current = visible
  skipMotionRef.current = skipMotion
  onMotionStartRef.current = onMotionStart
  onMotionCompleteRef.current = onMotionComplete

  const lastLayoutVisibleRef = useRef(visible)
  const lastEffectMotionRef = useRef({ visible, skipMotion })
  const activeDriverRef = useRef<MotionDriver | null>(null)
  const startedDriverRef = useRef<MotionDriver | null>(null)

  useLayoutEffect(() => {
    if (lastLayoutVisibleRef.current !== visible) {
      lastLayoutVisibleRef.current = visible
      if (skipMotion) {
        activeDriverRef.current = null
        startedDriverRef.current = null
      } else {
        activeDriverRef.current = overlay ? 'overlay' : 'docked'
        startedDriverRef.current = null
      }
      return
    }
    if (!skipMotion && activeDriverRef.current === 'docked' && overlay) {
      activeDriverRef.current = 'overlay'
    }
  }, [visible, overlay, skipMotion])

  useEffect(() => {
    const previous = lastEffectMotionRef.current
    lastEffectMotionRef.current = { visible, skipMotion }
    const changedVisibility = previous.visible !== visible
    const interrupted = skipMotion && !previous.skipMotion && activeDriverRef.current !== null
    if (!skipMotion || (!changedVisibility && !interrupted)) return
    activeDriverRef.current = null
    startedDriverRef.current = null
    setSettledOpen(visible)
    setSettledClosed(!visible)
    if (changedVisibility) onMotionStartRef.current?.()
    onMotionCompleteRef.current?.()
  }, [visible, skipMotion])

  useEffect(() => {
    const target = visible ? 'open' : 'closed'
    if (skipMotion) {
      frameControls.stop()
      asideControls.stop()
      frameControls.set(target)
      asideControls.set(target)
      return
    }
    void frameControls.start(target, overlay ? INSTANT_TRANSITION : SPRING_TRANSITION)
    void asideControls.start(target, SPRING_TRANSITION)
  }, [visible, overlay, skipMotion, frameControls, asideControls])

  const handleAnimationStart = (driver: MotionDriver, definition: unknown) => {
    if (skipMotionRef.current) return
    if (activeDriverRef.current !== driver) return
    const expected = visibleRef.current ? 'open' : 'closed'
    if (definition !== expected) return
    if (startedDriverRef.current === driver) return
    startedDriverRef.current = driver
    onMotionStartRef.current?.()
  }

  const handleAnimationComplete = (driver: MotionDriver, definition: unknown) => {
    if (skipMotionRef.current) return
    if (activeDriverRef.current !== driver) return
    const expected = visibleRef.current ? 'open' : 'closed'
    if (definition !== expected) return
    activeDriverRef.current = null
    startedDriverRef.current = null
    if (visibleRef.current) {
      setSettledOpen(true)
    } else {
      setSettledClosed(true)
    }
    onMotionCompleteRef.current?.()
  }

  const isHidden = !visible && (skipMotion || settledClosed)
  const isSettledOpen = visible && (skipMotion || settledOpen)

  return (
    <motion.div
      ref={viewportRef}
      initial={initialState.current}
      variants={FRAME_VARIANTS}
      animate={frameControls}
      transition={overlay || skipMotion ? INSTANT_TRANSITION : SPRING_TRANSITION}
      style={{
        display: overlay ? 'contents' : 'block',
        flexShrink: 0,
        minWidth: 0,
        height: '100%',
        overflow: overlay ? undefined : isSettledOpen ? 'visible' : 'hidden',
      }}
      onAnimationStart={(definition) => handleAnimationStart('docked', definition)}
      onAnimationComplete={(definition) => handleAnimationComplete('docked', definition)}
    >
      <motion.aside
        ref={inspectorRef}
        className={`inspector ${stylex.props(inspectorStyles.inspector, [responsiveStyles.inspector, responsiveLayoutStyles.inspector], isHidden && inspectorStyles.inspectorHidden).className ?? ''}`}
        hidden={isHidden}
        inert={!visible}
        aria-hidden={!visible || undefined}
        aria-label={label}
        tabIndex={overlay ? -1 : undefined}
        initial={initialState.current}
        variants={ASIDE_VARIANTS}
        animate={asideControls}
        transition={skipMotion ? INSTANT_TRANSITION : SPRING_TRANSITION}
        style={{ height: overlay ? undefined : '100%' }}
        onAnimationStart={(definition) => handleAnimationStart('overlay', definition)}
        onAnimationComplete={(definition) => handleAnimationComplete('overlay', definition)}
      >
        {children}
      </motion.aside>
    </motion.div>
  )
}
