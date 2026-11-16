import * as stylex from '@stylexjs/stylex'
import { styles as sidebarStyles } from 'apex-ui/styles/sidebar.stylex'
import type { ProjectRecord, SessionRecord, WorkspaceView } from '@/types/api'
import { isSessionRunning } from '@/app/session-attention'
import type { SessionLiveMap } from '@/app/session-live'
import type { SessionLive } from '@/app/sessionLiveMachine'
import { motion, useReducedMotion } from 'motion/react'
import { StatusMark } from './activity/StatusMark'

const dotStyles = stylex.create({
  workingDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'var(--apex)',
  },
})

/** Small pulsing dot for live work; static under reduced motion. Decorative: callers carry the label. */
export function WorkingDot() {
  const reduceMotion = useReducedMotion()
  return (
    <motion.span
      {...stylex.props(dotStyles.workingDot)}
      aria-hidden="true"
      animate={reduceMotion ? undefined : { opacity: [1, 0.35, 1], scale: [1, 0.8, 1] }}
      transition={reduceMotion ? undefined : { duration: 1.4, ease: 'easeInOut', repeat: Infinity }}
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
  attention: SessionRecord[]
  running: SessionRecord[]
  liveBySession?: SessionLiveMap
  projects: ProjectRecord[]
  activeSessionId?: string
  activeView: WorkspaceView
  onOpenSession(session: SessionRecord, projectId?: string): void
}

/** Cross-project groups shown above the project tree. Empty groups render nothing. */
export function SidebarAttentionGroups({ attention, running, ...shared }: SidebarAttentionGroupsProps) {
  return (
    <>
      {attention.length ? <AttentionGroup label="Needs you" sessions={attention} attention {...shared} /> : null}
      {running.length ? <AttentionGroup label="Running" sessions={running} attention={false} {...shared} /> : null}
    </>
  )
}

type AttentionGroupProps = Omit<SidebarAttentionGroupsProps, 'attention' | 'running'> & { label: string; sessions: SessionRecord[]; attention: boolean }

function AttentionGroup({ label, sessions, attention, liveBySession, projects, activeSessionId, activeView, onOpenSession }: AttentionGroupProps) {
  return (
    <section className="sidebar-attention" aria-label={label}>
      <h2 className={`sidebar__label ${stylex.props(sidebarStyles.sidebarLabel).className ?? ""}`}>{label} <span className="n">{sessions.length}</span></h2>
      {sessions.map((session) => {
        const project = projects.find((candidate) => candidate.path === session.projectPath || candidate.folders.includes(session.projectPath))
        const selected = activeSessionId === session.id && activeView === 'session'
        return (
          <button key={session.id} type="button" title={session.title} className={[`sidebar-attention__row ${selected ? 'is-selected' : ''}`, stylex.props(sidebarStyles.sidebarAttentionRow, (selected) && sidebarStyles.sidebarAttentionRowIsSelected).className].filter(Boolean).join(' ')} onClick={() => onOpenSession(session, project?.id)}>
            <span className={`sidebar-attention__title ${stylex.props(sidebarStyles.sidebarAttentionTitle).className ?? ""}`}>{session.title}</span>
            <span className={`sidebar-attention__project ${stylex.props(sidebarStyles.sidebarAttentionProject).className ?? ""}`}>{project?.name ?? session.projectPath.split(/[\\/]/).pop()}</span>
            <SessionStatusGlyph session={session} attention={attention} live={liveBySession?.[session.filePath]} />
          </button>
        )
      })}
    </section>
  )
}
