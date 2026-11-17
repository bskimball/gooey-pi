import * as stylex from '@stylexjs/stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { AnimatePresence, animate, motion, useInstantLayoutTransition, useMotionValue, useReducedMotion, type AnimationPlaybackControls, type Transition } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CaretRight } from '../icons'
import { StatusMark } from '../activity/StatusMark'
import type { PiSpecialistSummary } from './session-summary'
import { isLiveSpecialist, specialistMarkState, specialistStatusLabel } from '@/lib/specialist-status'

/** Finished agents listed before the rest collapse into a "+N" entry; the Agents tab holds them all. */
const FINISHED_LIMIT = 8
const EASE_OUT: Transition['ease'] = [0.23, 1, 0.32, 1]
const EASE_IN: Transition['ease'] = [0.2, 0, 0, 1]
const DISCLOSURE_SPRING = { type: 'spring', stiffness: 380, damping: 27, mass: 0.8 } as const
const styles = stylex.create({ instantTransition: { transitionProperty: 'none' } })

/** Live (not render-sampled) instant-motion check: app reduce-motion class, OS preference, or test act env. */
function prefersInstantMotion(): boolean {
  return (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion'))
    || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
    || Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)
}

function useSkipMotion(): boolean {
  return Boolean(useReducedMotion()) || prefersInstantMotion()
}

interface FinishedItem {
  key: string
  index: number
  className: string
  avatar: string
  label: string
  title: string
  onClick(): void
  details: ReactNode
  rowClassName?: string
}

interface SummaryAgentsSectionProps {
  specialists: readonly PiSpecialistSummary[]
  onOpenSpecialist(id: string): void
}

/** Overview Agents section: live workers stay on top; finished ones collapse into a horizontal strip of chips. */
export function SummaryAgentsSection({ specialists, onOpenSpecialist }: SummaryAgentsSectionProps) {
  const skipMotion = useSkipMotion()
  const startInstantLayoutTransition = useInstantLayoutTransition()
  const [finishedCollapsed, setFinishedCollapsed] = useState(true)
  // Decided at click time from live preferences, so a stale render-time sample cannot snap a pointer toggle.
  const [instantToggle, setInstantToggle] = useState(true)
  const finishedListId = useId()
  // The finished block's height animates to its measured natural height so content below glides, not jumps.
  // An explicit motion value pins the pixel height from the first measure, so even the first toggle has a
  // starting height to tween from (a declarative `animate` from unset `auto` writes nothing until it changes).
  const finishedGridRef = useRef<HTMLDivElement>(null)
  const finishedHeight = useMotionValue<number | 'auto'>('auto')
  const instantRef = useRef(instantToggle)
  instantRef.current = instantToggle
  const tweenRef = useRef<AnimationPlaybackControls | undefined>(undefined)
  const targetHeightRef = useRef<number | null>(null)
  const measureRef = useRef<(() => void) | undefined>(undefined)
  // While avatars travel between layouts, the strip's scroll clip is lifted so it cannot crop them.
  const [transitioning, setTransitioning] = useState(false)
  const hasFinished = specialists.some((specialist) => !isLiveSpecialist(specialist.status))
  useLayoutEffect(() => {
    const node = finishedGridRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const next = node.offsetHeight
      const current = finishedHeight.get()
      if (tweenRef.current && targetHeightRef.current === next) return
      tweenRef.current?.stop()
      tweenRef.current = undefined
      targetHeightRef.current = next
      if (current === next) return setTransitioning(false)
      if (current === 'auto' || instantRef.current) {
        finishedHeight.set(next)
        if (node.parentElement) node.parentElement.style.height = `${next}px`
        return setTransitioning(false)
      }
      tweenRef.current = animate(finishedHeight, next, {
        ...DISCLOSURE_SPRING,
        onComplete: () => {
          tweenRef.current = undefined
          setTransitioning(false)
        },
      })
    }
    measureRef.current = measure
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      measureRef.current = undefined
      observer.disconnect()
      tweenRef.current?.stop()
      tweenRef.current = undefined
      targetHeightRef.current = null
      finishedHeight.set('auto')
    }
  }, [hasFinished, finishedHeight])
  useLayoutEffect(() => {
    measureRef.current?.()
  }, [finishedCollapsed, instantToggle])
  // Entry animations only for changes after the section first renders, not for opening the Overview tab.
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true }, [])
  const animateEntry = mounted.current && !skipMotion

  const live = specialists.filter((specialist) => isLiveSpecialist(specialist.status))
  const finished = specialists.filter((specialist) => !isLiveSpecialist(specialist.status)).reverse()
  const shownFinished = finished.slice(0, FINISHED_LIMIT)
  const hiddenFinished = finished.length - shownFinished.length
  if (!specialists.length) return null

  const enter = (index: number): Transition => (skipMotion ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT, delay: Math.min(index, 8) * 0.025 })
  const instant = instantToggle || skipMotion
  const disclosure: Transition = instant ? { duration: 0 } : DISCLOSURE_SPRING
  const exit = skipMotion ? undefined : { opacity: 0, transition: { duration: 0.1, ease: EASE_IN } }
  const row = (specialist: PiSpecialistSummary, index: number) => (
    <motion.button
      type="button"
      key={specialist.id}
      layout={skipMotion ? false : 'position'}
      className={`is-${specialist.status}`}
      title={specialistStatusLabel[specialist.status]}
      onClick={() => onOpenSpecialist(specialist.id)}
      initial={animateEntry ? { opacity: 0, y: -4 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={exit}
      transition={enter(index)}
    >
      <StatusMark state={specialistMarkState(specialist.status)} size={14} />
      <strong>{specialist.agent}</strong>
      <span>{specialist.activity || specialist.mission}</span>
      <CaretRight size={11} aria-hidden="true" />
    </motion.button>
  )
  const moreLabel = `${hiddenFinished} more finished ${hiddenFinished === 1 ? 'agent' : 'agents'}`
  const openFirstHidden = () => { const next = finished[FINISHED_LIMIT]; if (next) onOpenSpecialist(next.id) }
  // Newest token sits on top of the overlap; CSS raises a hovered or focused token above all of them.
  const stackOrder = (index: number) => ({ '--stack-z': FINISHED_LIMIT + 1 - index }) as CSSProperties
  // Position-only layout moves avatars without scaling text. Layout is always registered, even if the previous
  // render sampled reduced motion, so the pre-click snapshot exists; keyboard and reduced-motion toggles snap
  // through the zero-duration `disclosure` transition instead.
  const spatial = 'position' as const
  const revealDetails = { initial: instant ? false : { opacity: 0 }, animate: { opacity: 1 }, transition: instant ? { duration: 0 } : { duration: 0.16, ease: EASE_OUT, delay: 0.06 } } as const
  const finishedItem = (item: FinishedItem) => (
    <motion.button
      type="button"
      role="listitem"
      key={item.key}
      layout={spatial}
      className={finishedCollapsed
        ? `summary-agent-item ${stylex.props(inspectorStyles.summaryAgentStackItem, instant && styles.instantTransition).className ?? ''}`
        : `summary-agent-item ${item.rowClassName ?? ''}`}
      style={stackOrder(item.index)}
      aria-label={item.label}
      title={item.title}
      onClick={item.onClick}
      initial={animateEntry ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      exit={exit}
      transition={{ ...enter(item.index), layout: disclosure }}
    >
      <motion.span
        layout={spatial}
        transition={{ layout: disclosure }}
        aria-hidden="true"
        className={`summary-agent-token ${item.className} ${stylex.props(inspectorStyles.summaryAgentToken).className ?? ''}`}
      >
        {item.avatar}
      </motion.span>
      {finishedCollapsed ? null : item.details}
      {finishedCollapsed ? null : <CaretRight size={11} aria-hidden="true" />}
    </motion.button>
  )

  return (
    <section className={`summary-section summary-agents ${stylex.props(inspectorStyles.summarySection).className ?? ''}`}>
      <h3 className={`summary-agents__heading ${stylex.props(inspectorStyles.summaryAgentsHeading).className ?? ''}`}>
        <span>Agents</span>
        {live.length ? <span className="summary-agents__count">{live.length} running</span> : null}
      </h3>
      {live.length ? (
        <div className={`summary-agent-list ${stylex.props(inspectorStyles.summaryAgentList).className ?? ''}`} aria-label="Running agents">
          <AnimatePresence initial={false} mode="popLayout">
            {live.map((specialist, index) => row(specialist, index))}
          </AnimatePresence>
        </div>
      ) : null}
      {finished.length ? (
        <motion.div
          className={stylex.props(live.length > 0 && inspectorStyles.summaryAgentsFinishedAfterLive).className}
          style={{ height: finishedHeight }}
        >
        <div ref={finishedGridRef} className={`summary-agents__finished ${stylex.props(inspectorStyles.summaryAgentsFinished).className ?? ''}`}>
          <button
            type="button"
            className={`summary-agents__toggle ${stylex.props(inspectorStyles.runConfigToggle, inspectorStyles.summaryAgentsFinishedToggle).className ?? ''}`}
            aria-expanded={!finishedCollapsed}
            aria-controls={finishedListId}
            onClick={(event) => {
              // Keyboard activation (detail 0) toggles instantly; pointer disclosure animates.
              const snap = event.detail === 0 || prefersInstantMotion()
              const apply = () => {
                setInstantToggle(snap)
                setTransitioning(!snap)
                setFinishedCollapsed((value) => !value)
              }
              if (snap) {
                let applied = false
                startInstantLayoutTransition(() => {
                  applied = true
                  apply()
                })
                if (!applied) apply()
              } else {
                apply()
              }
            }}
          >
            <CaretRight size={12} className={`disclosure-caret ${stylex.props(transcriptStyles.disclosureCaret, instant && styles.instantTransition).className ?? ''}`} aria-hidden="true" />
            <span>Finished</span>
            <span className="summary-agents__count">{finished.length}</span>
          </button>
          {/* One keyed collection: the same avatars slide between the inline stack and the vertical rows. */}
          <div
            id={finishedListId}
            role="list"
            aria-label="Finished agents"
            className={`${finishedCollapsed ? 'summary-agent-stack' : 'summary-agent-list'} ${stylex.props(inspectorStyles.summaryAgentsFinishedItems, finishedCollapsed ? inspectorStyles.summaryAgentStack : inspectorStyles.summaryAgentRows, finishedCollapsed && !transitioning && inspectorStyles.summaryAgentStackScroll).className ?? ''}`}
          >
            <AnimatePresence initial={false}>
              {shownFinished.map((specialist, index) => finishedItem({
                key: specialist.id,
                index,
                className: `is-${specialist.status}`,
                avatar: specialist.agent.charAt(0).toUpperCase(),
                label: `${specialist.agent}: ${specialistStatusLabel[specialist.status]}. ${specialist.activity || specialist.mission}`,
                title: `${specialist.agent} · ${specialistStatusLabel[specialist.status]}\n${specialist.activity || specialist.mission}`,
                onClick: () => onOpenSpecialist(specialist.id),
                details: (
                  <>
                    <motion.strong {...revealDetails}>{specialist.agent}</motion.strong>
                    <motion.span {...revealDetails}>{specialist.activity || specialist.mission}</motion.span>
                  </>
                ),
              }))}
              {hiddenFinished > 0 ? finishedItem({
                key: 'more',
                index: shownFinished.length,
                className: 'summary-agent-token--more',
                avatar: `+${hiddenFinished}`,
                label: moreLabel,
                title: moreLabel,
                onClick: openFirstHidden,
                details: <motion.span {...revealDetails}>{moreLabel}</motion.span>,
                rowClassName: 'summary-agent-list__more',
              }) : null}
            </AnimatePresence>
          </div>
        </div>
        </motion.div>
      ) : null}
    </section>
  )
}
