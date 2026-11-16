import * as stylex from '@stylexjs/stylex'
import { styles as sidebarStyles } from 'apex-ui/styles/sidebar.stylex'
import { memo } from 'react'
import type { SessionRecord, SpecialistRosterEntry } from '@/types/api'
import { isLiveSpecialist, shortModelName, specialistMarkState, specialistStatusLabel } from '@/lib/specialist-status'
import { StatusMark } from './activity/StatusMark'
import { Question } from './icons'

export const SIDEBAR_SUBAGENT_LIMIT = 4

/**
 * Which sub-agents a session row lists. Every tracked session shows its live workers; the
 * selected session also shows its most recent finished ones. The rest are counted, not listed.
 */
export function sidebarSubagentRows(specialists: readonly SpecialistRosterEntry[], selected: boolean, limit = SIDEBAR_SUBAGENT_LIMIT): { shown: SpecialistRosterEntry[]; hidden: SpecialistRosterEntry[] } {
  const live = specialists.filter((specialist) => isLiveSpecialist(specialist.status))
  const finished = selected ? specialists.filter((specialist) => !isLiveSpecialist(specialist.status)).reverse() : []
  const ordered = [...live, ...finished]
  const shown = ordered.slice(0, limit)
  const shownIds = new Set(shown.map((specialist) => specialist.id))
  // Other sessions only list live work, so only live overflow counts there.
  return { shown, hidden: (selected ? specialists : live).filter((specialist) => !shownIds.has(specialist.id)) }
}

interface SidebarSubagentsProps {
  session: SessionRecord
  specialists: readonly SpecialistRosterEntry[]
  /** The session is the one open in the conversation pane. */
  selected: boolean
  /** The sub-agent currently shown in the Agents panel, when this session is selected. */
  openSpecialistId?: string | null
  onOpen(session: SessionRecord, specialistId: string): void
}

export const SidebarSubagents = memo(function SidebarSubagents({ session, specialists, selected, openSpecialistId, onOpen }: SidebarSubagentsProps) {
  const { shown, hidden } = sidebarSubagentRows(specialists, selected)
  if (!shown.length) return null
  const firstHidden = hidden.find((specialist) => isLiveSpecialist(specialist.status)) ?? hidden.at(-1)
  return (
    <ul className={`session-subagents ${stylex.props(sidebarStyles.subagentList).className ?? ''}`} aria-label={`Sub-agents of ${session.title}`}>
      {shown.map((specialist) => {
        const status = specialistStatusLabel[specialist.status]
        const model = shortModelName(specialist.model)
        const isOpen = selected && openSpecialistId === specialist.id
        const mission = specialist.mission || 'No task recorded'
        return (
          <li key={specialist.id}>
            <button
              type="button"
              className={`session-subagent is-${specialist.status}${isOpen ? ' is-open' : ''} ${stylex.props(sidebarStyles.subagentRow, isOpen && sidebarStyles.subagentRowSelected).className ?? ''}`}
              aria-label={`${specialist.agent} ${specialist.id}: ${status}. ${mission}`}
              aria-current={isOpen ? 'true' : undefined}
              title={`${specialist.agent}${model ? ` · ${model}` : ''} · ${status}\n${mission}`}
              onClick={() => onOpen(session, specialist.id)}
            >
              <span className={stylex.props(sidebarStyles.subagentMark, specialist.status === 'waiting' && sidebarStyles.subagentMarkWaiting).className} aria-hidden="true">
                {specialist.status === 'waiting' ? <Question size={12} /> : <StatusMark state={specialistMarkState(specialist.status)} size={12} />}
              </span>
              <span className={`session-subagent__agent ${stylex.props(sidebarStyles.subagentAgent).className ?? ''}`}>{specialist.agent}</span>
              <span className={`session-subagent__mission ${stylex.props(sidebarStyles.subagentMission).className ?? ''}`}>{specialist.mission}</span>
              {model ? <span className={`session-subagent__model ${stylex.props(sidebarStyles.subagentModel).className ?? ''}`}>{model}</span> : null}
            </button>
          </li>
        )
      })}
      {firstHidden ? (
        <li>
          <button
            type="button"
            className={`session-subagent session-subagent--more ${stylex.props(sidebarStyles.subagentRow, sidebarStyles.subagentMore).className ?? ''}`}
            onClick={() => onOpen(session, firstHidden.id)}
          >
            {hidden.length} more {hidden.length === 1 ? 'agent' : 'agents'}
          </button>
        </li>
      ) : null}
    </ul>
  )
})
