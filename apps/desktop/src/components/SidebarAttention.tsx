import * as stylex from '@stylexjs/stylex'
import { styles as sidebarStyles } from 'apex-ui/styles/sidebar.stylex'
import type { ProjectRecord, SessionRecord, WorkspaceView } from '@/types/api'
import { isSessionRunning } from '@/app/session-attention'
import type { SessionLiveMap } from '@/app/session-live'
import type { SessionLive } from '@/app/sessionLiveMachine'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useId } from 'react'
import { useInstantMotion } from './ContentMotion'
import { SidebarPresenceRow, SidebarSelectionMark } from './SidebarMotion'
import { StatusMark } from './activity/StatusMark'

const dotStyles = stylex.create({
  attentionGroup: { display: 'flow-root' },
  workingDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'var(--apex)',
  },
})

/** Small pulsing dot for live work; static under reduced motion. Decorative: callers carry the label. */
export function WorkingDot() {
  const skipMotion = useInstantMotion()
  return (
    <motion.span
      {...stylex.props(dotStyles.workingDot)}
      aria-hidden="true"
      animate={skipMotion ? undefined : { opacity: [1, 0.35, 1], scale: [1, 0.8, 1] }}
      transition={skipMotion ? undefined : { duration: 1.4, ease: 'easeInOut', repeat: Infinity }}
    />
  )
}

/**
 * Trailing status for a session row: a pulsing dot while running, a crossed crest for a failure that still needs review,
 * and an amber dot for anything waiting on the user. The wrapper always takes its slot so titles never shift.
 */
export function SessionStatusGlyph({ session, attention, live }: { session: SessionRecord; attention: boolean; live?: SessionLive }) {
  const mark = isSessionRunning(session, live) ? <WorkingDot />
    : session.status === 'failed' && attention ? <StatusMark state="failed" size={14} />
      : attention || session.status === 'waiting' ? <span className={`session-row__dot ${stylex.props(sidebarStyles.sessionRowDot).className ?? ""}`} />
        : null
  return <span className={`session-row__trail ${stylex.props(sidebarStyles.sessionRowTrail).className ?? ""}`} aria-hidden="true">{mark}</span>
}

interface SidebarAttentionGroupsProps {
  instant?: boolean
  attention: SessionRecord[]
  running: SessionRecord[]
  liveBySession?: SessionLiveMap
  projects: ProjectRecord[]
  activeSessionId?: string
  activeView: WorkspaceView
  onOpenSession(session: SessionRecord, projectId?: string): void
}

const ROW_ENTER_EASE = [0.23, 1, 0.32, 1] as const
const ROW_EXIT_EASE = [0.23, 1, 0.32, 1] as const
const HEIGHT_EXIT_EASE = [0.2, 0, 0, 1] as const

/** Cross-project groups shown above the project tree. Empty groups render nothing. */
export function SidebarAttentionGroups({ attention, running, ...shared }: SidebarAttentionGroupsProps) {
  const skipMotion = useInstantMotion()
  return (
    <AnimatePresence initial={false}>
      {attention.length ? <AttentionGroup key="needs-you" label="Needs you" sessions={attention} attention skipMotion={skipMotion} {...shared} /> : null}
      {running.length ? <AttentionGroup key="running" label="Running" sessions={running} attention={false} skipMotion={skipMotion} {...shared} /> : null}
    </AnimatePresence>
  )
}

/** Keep exiting rows inert until their slide, fade, and height collapse complete. */
function AttentionPresenceRow({ skipMotion, index, scope, instant, session, projectId, projectName, selected, attention, live, onOpenSession }: {
  skipMotion: boolean
  index: number
  scope: string
  instant: boolean
  session: SessionRecord
  projectId?: string
  projectName?: string
  selected: boolean
  attention: boolean
  live?: SessionLive
  onOpenSession(session: SessionRecord, projectId?: string): void
}) {
  const isPresent = useIsPresent()
  return (
    <SidebarPresenceRow skipMotion={skipMotion} index={index}>
      <button
        type="button"
        title={session.title}
        aria-current={selected ? 'page' : undefined}
        className={[`sidebar-attention__row ${selected ? 'is-selected' : ''}`, stylex.props(sidebarStyles.sidebarAttentionRow, (selected) && sidebarStyles.sidebarAttentionRowIsSelected).className].filter(Boolean).join(' ')}
        onClick={() => { if (isPresent) onOpenSession(session, projectId) }}
      >
        {selected ? <SidebarSelectionMark scope={scope} instant={instant} /> : null}
        <span className={`sidebar-attention__title ${stylex.props(sidebarStyles.sidebarAttentionTitle).className ?? ""}`}>{session.title}</span>
        <span className={`sidebar-attention__project ${stylex.props(sidebarStyles.sidebarAttentionProject).className ?? ""}`}>{projectName}</span>
        <SessionStatusGlyph session={session} attention={attention} live={live} />
      </button>
    </SidebarPresenceRow>
  )
}

type AttentionGroupProps = Omit<SidebarAttentionGroupsProps, 'attention' | 'running'> & {
  label: string
  sessions: SessionRecord[]
  attention: boolean
  skipMotion: boolean
}

function AttentionGroup({ label, sessions, attention, skipMotion, instant = false, liveBySession, projects, activeSessionId, activeView, onOpenSession }: AttentionGroupProps) {
  const scope = useId()
  const isPresent = useIsPresent()
  return (
    <motion.section
      className={`sidebar-attention ${stylex.props(dotStyles.attentionGroup).className ?? ''}`}
      aria-label={label}
      inert={!isPresent}
      initial={skipMotion ? false : { height: 0, opacity: 0, overflow: 'hidden' }}
      animate={skipMotion ? undefined : { height: 'auto', opacity: 1, x: 0, overflow: 'hidden', transitionEnd: { overflow: 'visible' } }}
      exit={skipMotion ? undefined : {
        height: 0,
        opacity: 0,
        x: -12,
        overflow: 'hidden',
        pointerEvents: 'none',
        transition: {
          x: { duration: 0.15, ease: ROW_EXIT_EASE },
          opacity: { duration: 0.14, ease: ROW_EXIT_EASE },
          height: { duration: 0.14, delay: 0.03, ease: HEIGHT_EXIT_EASE },
        },
      }}
      transition={skipMotion ? { duration: 0 } : {
        height: { duration: 0.17, ease: ROW_ENTER_EASE },
        opacity: { duration: 0.18, delay: 0.02, ease: ROW_ENTER_EASE },
        x: { duration: 0.19, ease: ROW_ENTER_EASE },
      }}
    >
      <h2 className={`sidebar__label ${stylex.props(sidebarStyles.sidebarLabel).className ?? ""}`}>{label} <span className="n">{sessions.length}</span></h2>
      <AnimatePresence initial={false}>
        {sessions.map((session, index) => {
          const project = projects.find((candidate) => candidate.path === session.projectPath || candidate.folders.includes(session.projectPath))
          const selected = activeSessionId === session.id && activeView === 'session'
          return (
            <AttentionPresenceRow
              key={session.id}
              index={index}
              scope={scope}
              instant={skipMotion || instant}
              skipMotion={skipMotion}
              session={session}
              projectId={project?.id}
              projectName={project?.name ?? session.projectPath.split(/[\\/]/).pop()}
              selected={selected}
              attention={attention}
              live={liveBySession?.[session.filePath]}
              onOpenSession={onOpenSession}
            />
          )
        })}
      </AnimatePresence>
    </motion.section>
  )
}
