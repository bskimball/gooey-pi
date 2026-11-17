import * as stylex from '@stylexjs/stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { CaretRight } from '../icons'
import { StatusMark } from '../activity/StatusMark'
import type { PiSpecialistSummary } from './session-summary'
import { isLiveSpecialist, specialistMarkState, specialistStatusLabel } from '@/lib/specialist-status'

/** Finished agents listed before the rest collapse into a "+N" entry; the Agents tab holds them all. */
const FINISHED_LIMIT = 8
const EASE_OUT: Transition['ease'] = [0.23, 1, 0.32, 1]
const EASE_IN: Transition['ease'] = [0.2, 0, 0, 1]

function useSkipMotion(): boolean {
  const prefersReducedMotion = useReducedMotion()
  return Boolean(prefersReducedMotion)
    || (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion'))
    || Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)
}

/** Tracks the rendered height of a node so a wrapper can animate between content of different sizes. */
function useContentHeight(): [(node: HTMLDivElement | null) => void, number | null] {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return
    setHeight(node.getBoundingClientRect().height)
    const observer = new ResizeObserver(([entry]) => setHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height))
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return [setNode, height]
}

interface SummaryAgentsSectionProps {
  specialists: readonly PiSpecialistSummary[]
  onOpenSpecialist(id: string): void
}

/** Overview Agents section: live workers stay on top; finished ones collapse into a horizontal strip of chips. */
export function SummaryAgentsSection({ specialists, onOpenSpecialist }: SummaryAgentsSectionProps) {
  const skipMotion = useSkipMotion()
  const [finishedCollapsed, setFinishedCollapsed] = useState(true)
  const [measureRef, finishedHeight] = useContentHeight()
  const finishedBodyId = useId()
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

  return (
    <section className={`summary-section summary-agents ${stylex.props(inspectorStyles.summarySection).className ?? ''}`}>
      <h3 className={`summary-agents__heading ${stylex.props(inspectorStyles.summaryAgentsHeading).className ?? ''}`}>
        <span>Agents</span>
        {live.length ? <span className="summary-agents__count">{live.length} running</span> : null}
      </h3>
      {live.length ? (
        <div className={`summary-agent-list ${stylex.props(inspectorStyles.summaryAgentList).className ?? ''}`} aria-label="Running agents">
          <AnimatePresence initial={false} mode="popLayout">
            {live.map(row)}
          </AnimatePresence>
        </div>
      ) : null}
      {finished.length ? (
        <motion.div
          layout={skipMotion ? false : 'position'}
          transition={skipMotion ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }}
          className={`summary-agents__finished ${stylex.props(inspectorStyles.summaryAgentsFinished, live.length > 0 && inspectorStyles.summaryAgentsFinishedAfterLive).className ?? ''}`}
        >
          <button
            type="button"
            className={`summary-agents__toggle ${stylex.props(inspectorStyles.runConfigToggle).className ?? ''}`}
            aria-expanded={!finishedCollapsed}
            aria-controls={finishedBodyId}
            onClick={() => setFinishedCollapsed((value) => !value)}
          >
            <CaretRight size={12} className={`disclosure-caret ${stylex.props(transcriptStyles.disclosureCaret).className ?? ''}`} aria-hidden="true" />
            <span>Finished</span>
            <span className="summary-agents__count">{finished.length}</span>
          </button>
          <motion.div
            id={finishedBodyId}
            className={stylex.props(inspectorStyles.summaryAgentsFinishedBody).className}
            initial={false}
            animate={{ height: finishedHeight ?? 'auto' }}
            transition={skipMotion ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }}
          >
            <div ref={measureRef} className={stylex.props(inspectorStyles.summaryAgentsFinishedMeasure).className}>
              <AnimatePresence initial={false} mode="popLayout">
                {finishedCollapsed ? (
                  <motion.div
                    key="stack"
                    role="list"
                    aria-label="Finished agents"
                    className={`summary-agent-stack ${stylex.props(inspectorStyles.summaryAgentStack).className ?? ''}`}
                    exit={exit}
                  >
                    <AnimatePresence initial={false}>
                      {shownFinished.map((specialist, index) => (
                        <motion.button
                          type="button"
                          role="listitem"
                          key={specialist.id}
                          layout={skipMotion ? false : 'position'}
                          className={`summary-agent-token is-${specialist.status} ${stylex.props(inspectorStyles.summaryAgentToken).className ?? ''}`}
                          style={stackOrder(index)}
                          aria-label={`${specialist.agent}: ${specialistStatusLabel[specialist.status]}. ${specialist.activity || specialist.mission}`}
                          title={`${specialist.agent} · ${specialistStatusLabel[specialist.status]}\n${specialist.activity || specialist.mission}`}
                          onClick={() => onOpenSpecialist(specialist.id)}
                          initial={animateEntry ? { opacity: 0, scale: 0.6, x: -6 } : false}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={skipMotion ? undefined : { opacity: 0, scale: 0.6, transition: { duration: 0.1, ease: EASE_IN } }}
                          whileHover={skipMotion ? undefined : { y: -2 }}
                          transition={enter(index)}
                        >
                          {specialist.agent.charAt(0).toUpperCase()}
                        </motion.button>
                      ))}
                      {hiddenFinished > 0 ? (
                        <motion.button
                          type="button"
                          role="listitem"
                          key="more"
                          layout={skipMotion ? false : 'position'}
                          className={`summary-agent-token summary-agent-token--more ${stylex.props(inspectorStyles.summaryAgentToken).className ?? ''}`}
                          style={stackOrder(shownFinished.length)}
                          aria-label={moreLabel}
                          title={moreLabel}
                          onClick={openFirstHidden}
                          initial={animateEntry ? { opacity: 0, scale: 0.6, x: -6 } : false}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          whileHover={skipMotion ? undefined : { y: -2 }}
                          transition={enter(shownFinished.length)}
                        >
                          +{hiddenFinished}
                        </motion.button>
                      ) : null}
                    </AnimatePresence>
                  </motion.div>
                ) : (
                  <motion.div
                    key="rows"
                    aria-label="Finished agents"
                    className={`summary-agent-list ${stylex.props(inspectorStyles.summaryAgentRows).className ?? ''}`}
                    exit={exit}
                  >
                    <AnimatePresence initial={false}>
                      {shownFinished.map(row)}
                      {hiddenFinished > 0 ? (
                        <motion.button
                          type="button"
                          key="more"
                          layout={skipMotion ? false : 'position'}
                          className="summary-agent-list__more"
                          onClick={openFirstHidden}
                          initial={animateEntry ? { opacity: 0, y: -4 } : false}
                          animate={{ opacity: 1, y: 0 }}
                          transition={enter(shownFinished.length)}
                        >
                          <span>{moreLabel}</span>
                          <CaretRight size={11} aria-hidden="true" />
                        </motion.button>
                      ) : null}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </section>
  )
}
