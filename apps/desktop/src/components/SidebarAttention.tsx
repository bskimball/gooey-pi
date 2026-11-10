import type { ProjectRecord, SessionRecord, WorkspaceView } from '@/types/api'
import { StatusMark } from './activity/StatusMark'

/**
 * Trailing status for a session row: a crest while running, a crossed crest for a failure that still needs review,
 * and an amber dot for anything waiting on the user. The wrapper always takes its slot so titles never shift.
 */
export function SessionStatusGlyph({ session, attention }: { session: SessionRecord; attention: boolean }) {
  const mark = session.status === 'running' ? <StatusMark state="running" size={14} />
    : session.status === 'failed' && attention ? <StatusMark state="failed" size={14} />
      : attention || session.status === 'waiting' ? <span className="session-row__dot" />
        : null
  return <span className="session-row__trail" aria-hidden="true">{mark}</span>
}

interface SidebarAttentionGroupsProps {
  attention: SessionRecord[]
  running: SessionRecord[]
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

function AttentionGroup({ label, sessions, attention, projects, activeSessionId, activeView, onOpenSession }: AttentionGroupProps) {
  return (
    <section className="sidebar-attention" aria-label={label}>
      <h2 className="sidebar__label">{label} <span className="n">{sessions.length}</span></h2>
      {sessions.map((session) => {
        const project = projects.find((candidate) => candidate.path === session.projectPath || candidate.folders.includes(session.projectPath))
        const selected = activeSessionId === session.id && activeView === 'session'
        return (
          <button key={session.id} type="button" title={session.title} className={`sidebar-attention__row ${selected ? 'is-selected' : ''}`} onClick={() => onOpenSession(session, project?.id)}>
            <span className="sidebar-attention__title">{session.title}</span>
            <span className="sidebar-attention__project">{project?.name ?? session.projectPath.split(/[\\/]/).pop()}</span>
            <SessionStatusGlyph session={session} attention={attention} />
          </button>
        )
      })}
    </section>
  )
}
