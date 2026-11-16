// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../apps/desktop/src/components/Sidebar'
import { sidebarSubagentRows } from '../../apps/desktop/src/components/SidebarSubagents'
import { orderSpecialistTabs } from '../../apps/desktop/src/components/inspector/SpecialistsPanel'
import { MAX_SIDEBAR_ROSTERS, nextLiveSpecialistId, sidebarRosterTargets, useOpenSessionSpecialist } from '../../apps/desktop/src/hooks/useSpecialistRosters'
import { shortModelName } from '../../apps/desktop/src/lib/specialist-status'
import type { ProjectRecord, SessionRecord, SpecialistRosterEntry } from '../../apps/desktop/src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project: ProjectRecord = {
  id: 'project', harness: 'pi', name: 'Project', path: '/project', folders: ['/project'], primaryFolder: '/project',
  pinned: false, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', sessionCount: 2,
}
const session = (id: string, patch: Partial<SessionRecord> = {}): SessionRecord => ({
  id, harness: 'pi', filePath: `/sessions/${id}.jsonl`, projectPath: '/project', title: `Session ${id}`,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'idle', depth: 0, ...patch,
})
const agent = (id: string, status: SpecialistRosterEntry['status'], patch: Partial<SpecialistRosterEntry> = {}): SpecialistRosterEntry => ({
  id, agent: `agent-${id}`, mission: `Mission ${id}`, status, ...patch,
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const noop = () => undefined

describe('sidebar sub-agent rows', () => {
  it('lists only live work for other sessions and live-then-recent work for the open one', () => {
    const roster = [agent('1', 'done'), agent('2', 'running'), agent('3', 'error'), agent('4', 'waiting'), agent('5', 'done')]
    expect(sidebarSubagentRows(roster, false)).toEqual({ shown: [roster[1], roster[3]], hidden: [] })
    const selected = sidebarSubagentRows(roster, true)
    expect(selected.shown.map((entry) => entry.id)).toEqual(['2', '4', '5', '3'])
    expect(selected.hidden.map((entry) => entry.id)).toEqual(['1'])
  })

  it('counts overflowing live work for other sessions', () => {
    const roster = Array.from({ length: 6 }, (_, index) => agent(String(index), 'running'))
    const rows = sidebarSubagentRows(roster, false)
    expect(rows.shown).toHaveLength(4)
    expect(rows.hidden.map((entry) => entry.id)).toEqual(['4', '5'])
  })

  it('trims provider prefixes from model ids', () => {
    expect(shortModelName('anthropic/claude-haiku-5-5')).toBe('claude-haiku-5-5')
    expect(shortModelName('gpt-6.1')).toBe('gpt-6.1')
    expect(shortModelName('  ')).toBeUndefined()
    expect(shortModelName(undefined)).toBeUndefined()
  })

  it('renders sub-agents under their session and opens the clicked one', async () => {
    const lead = session('lead', { status: 'running' })
    const onOpenSpecialist = vi.fn()
    await act(async () => root.render(
      <Sidebar
        projects={[project]} sessions={[lead, session('other')]} activeProjectId="project" activeSessionId="lead" activeView="session"
        specialistRosters={{ [lead.filePath]: [agent('task_1', 'running', { model: 'anthropic/claude-haiku-5-5' }), agent('task_2', 'done')] }}
        openSpecialistId="task_2" onOpenSpecialist={onOpenSpecialist}
        onSelectProject={noop} onSelectSession={noop} onNavigate={noop} onNewSession={noop} onAddProject={noop} onRemoveProject={noop}
        onClose={noop} onOpenPalette={noop} onRenameSession={async () => undefined} onArchiveSession={async () => undefined}
      />,
    ))
    const list = container.querySelector('.session-list [aria-label="Sub-agents of Session lead"]')
    expect(list).not.toBeNull()
    const rows = [...list!.querySelectorAll<HTMLButtonElement>('.session-subagent')]
    expect(rows.map((row) => row.querySelector('.session-subagent__agent')?.textContent)).toEqual(['agent-task_1', 'agent-task_2'])
    expect(rows[0]!.querySelector('.session-subagent__model')?.textContent).toBe('claude-haiku-5-5')
    expect(rows[1]!.getAttribute('aria-current')).toBe('true')
    await act(async () => rows[0]!.click())
    expect(onOpenSpecialist).toHaveBeenCalledWith(lead, 'task_1')
    expect(container.querySelectorAll('[aria-label^="Sub-agents of"]')).toHaveLength(1)
  })
})

describe('roster targets and agent navigation', () => {
  it('tracks the open session first, then sessions with live work, never archived ones', () => {
    const sessions = [session('a', { status: 'running' }), session('b'), session('c', { status: 'waiting' }), session('d', { status: 'running', archived: true })]
    expect(sidebarRosterTargets(sessions, 'b', {})).toEqual(['/sessions/b.jsonl', '/sessions/a.jsonl', '/sessions/c.jsonl'])
    const many = Array.from({ length: MAX_SIDEBAR_ROSTERS + 4 }, (_, index) => session(String(index), { status: 'running' }))
    expect(sidebarRosterTargets(many, undefined, {})).toHaveLength(MAX_SIDEBAR_ROSTERS)
  })

  it('steps through live agents and wraps', () => {
    const roster = [agent('1', 'running'), agent('2', 'done'), agent('3', 'waiting'), agent('4', 'running')]
    expect(nextLiveSpecialistId(roster, null)).toBe('3')
    expect(nextLiveSpecialistId(roster, '3')).toBe('4')
    expect(nextLiveSpecialistId(roster, '4')).toBe('1')
    expect(nextLiveSpecialistId(roster, '2')).toBe('1')
    expect(nextLiveSpecialistId([agent('1', 'done')], null)).toBeUndefined()
  })

  it('orders panel tabs live first, then finished most recent first', () => {
    const roster = [agent('1', 'done'), agent('2', 'running'), agent('3', 'error'), agent('4', 'waiting')]
    expect(orderSpecialistTabs(roster).map((entry) => entry.id)).toEqual(['2', '4', '3', '1'])
  })

  it('switches sessions before opening another session\'s agent', async () => {
    const target = session('target')
    const selectSession = vi.fn()
    const openSpecialist = vi.fn()
    let open: ((session: SessionRecord, id: string) => void) | undefined
    function Probe({ activeSessionId, loadingSession }: { activeSessionId: string; loadingSession: boolean }) {
      open = useOpenSessionSpecialist({ activeSessionId, loadingSession, isSessionView: true, selectSession, openSpecialist })
      return null
    }
    await act(async () => root.render(<Probe activeSessionId="current" loadingSession={false} />))
    await act(async () => open!(target, 'task_7'))
    expect(selectSession).toHaveBeenCalledWith(target)
    expect(openSpecialist).not.toHaveBeenCalled()
    await act(async () => root.render(<Probe activeSessionId="target" loadingSession />))
    expect(openSpecialist).not.toHaveBeenCalled()
    await act(async () => root.render(<Probe activeSessionId="target" loadingSession={false} />))
    expect(openSpecialist).toHaveBeenCalledWith('task_7')

    await act(async () => open!(target, 'task_8'))
    expect(openSpecialist).toHaveBeenLastCalledWith('task_8')
    expect(selectSession).toHaveBeenCalledTimes(1)
  })
})
