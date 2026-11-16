// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../apps/desktop/src/components/Sidebar'
import { sidebarSubagentRows } from '../../apps/desktop/src/components/SidebarSubagents'
import { orderSpecialistTabs, SpecialistsPanel } from '../../apps/desktop/src/components/inspector/SpecialistsPanel'
import { MAX_SIDEBAR_ROSTERS, nextLiveSpecialistId, sidebarRosterTargets, useOpenSessionSpecialist } from '../../apps/desktop/src/hooks/useSpecialistRosters'
import { shortModelName } from '../../apps/desktop/src/lib/specialist-status'
import type { ProjectRecord, SessionRecord, SpecialistRosterEntry, TranscriptMessage } from '../../apps/desktop/src/types/api'

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

  it('renders a sub-agent collapse toggle only for sessions with visible sub-agents and toggles without selecting', async () => {
    const lead = session('lead', { status: 'running' })
    const empty = session('other')
    const onSelectSession = vi.fn()
    await act(async () => root.render(
      <Sidebar
        projects={[project]} sessions={[lead, empty]} activeProjectId="project" activeSessionId="lead" activeView="session"
        specialistRosters={{
          [lead.filePath]: [agent('task_1', 'running'), agent('task_2', 'done')],
          [empty.filePath]: [agent('task_3', 'done')],
        }}
        onOpenSpecialist={noop}
        onSelectProject={noop} onSelectSession={onSelectSession} onNavigate={noop} onNewSession={noop} onAddProject={noop} onRemoveProject={noop}
        onClose={noop} onOpenPalette={noop} onRenameSession={async () => undefined} onArchiveSession={async () => undefined}
      />,
    ))

    const toggles = [...container.querySelectorAll<HTMLButtonElement>('.session-row__collapse')]
    expect(toggles).toHaveLength(1)
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('true')
    expect(toggles[0]!.getAttribute('aria-label')).toBe('Collapse sub-agents for Session lead')
    expect(container.querySelector('[aria-label="Sub-agents of Session lead"]')).not.toBeNull()

    await act(async () => toggles[0]!.click())
    expect(onSelectSession).not.toHaveBeenCalled()
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('false')
    expect(toggles[0]!.getAttribute('aria-label')).toBe('Expand sub-agents for Session lead')
    expect(container.querySelector('[aria-label="Sub-agents of Session lead"]')).toBeNull()

    await act(async () => toggles[0]!.click())
    expect(onSelectSession).not.toHaveBeenCalled()
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[aria-label="Sub-agents of Session lead"]')).not.toBeNull()
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

  it('orders panel tabs by status rank and within-status recency across all 6 statuses', () => {
    const roster = [
      agent('done_old', 'done'),
      agent('closed_old', 'closed'),
      agent('run_1', 'running'),
      agent('err_old', 'error'),
      agent('stop_old', 'stopped'),
      agent('wait_1', 'waiting'),
      agent('run_2', 'running'),
      agent('done_new', 'done'),
      agent('wait_2', 'waiting'),
      agent('err_new', 'error'),
      agent('stop_new', 'stopped'),
      agent('closed_new', 'closed'),
    ]
    expect(orderSpecialistTabs(roster).map((entry) => entry.id)).toEqual([
      'wait_1',
      'wait_2',
      'run_1',
      'run_2',
      'err_new',
      'err_old',
      'done_new',
      'done_old',
      'stop_new',
      'stop_old',
      'closed_new',
      'closed_old',
    ])
  })

  it('renders SpecialistsPanel tabs in status order with overlap stacking, divider, and keyboard navigation', async () => {
    const messages: TranscriptMessage[] = [{
      id: 'parent',
      role: 'assistant',
      parts: [
        { type: 'toolCall', name: 'task_start', args: { agent: 'done-worker', prompt: 'Finish' } },
        { type: 'toolResult', name: 'task_start', text: 'started task_1', details: { worker: { lifecycle: 'running' } } },
        { type: 'toolCall', name: 'task_wait', args: { id: 'task_1' } },
        { type: 'toolResult', name: 'task_wait', text: 'lifecycle: settled\n--- result ---\nDone' },
        { type: 'toolCall', name: 'task_start', args: { agent: 'run-worker', prompt: 'Run' } },
        { type: 'toolResult', name: 'task_start', text: 'started task_2', details: { worker: { lifecycle: 'running' } } },
        { type: 'toolCall', name: 'task_start', args: { agent: 'err-worker', prompt: 'Fail' } },
        { type: 'toolResult', name: 'task_start', text: 'started task_3', isError: true, details: { worker: { lifecycle: 'failed' } } },
        { type: 'toolCall', name: 'task_start', args: { agent: 'wait-worker', prompt: 'Ask' } },
        { type: 'toolResult', name: 'task_start', text: 'started task_4', details: { worker: { lifecycle: 'running', waiting_ui_requests: [{ id: 'q1' }] } } },
      ],
    }]
    const onSelect = vi.fn()
    await act(async () => root.render(
      <SpecialistsPanel messages={messages} selectedId="task_2" onSelect={onSelect} />,
    ))

    const tablist = container.querySelector<HTMLElement>('[role="tablist"]')!
    expect(tablist).not.toBeNull()
    expect(tablist.style.getPropertyValue('--tab-z-front')).toBe('8')

    const tabs = [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs.map((tab) => tab.querySelector('strong')?.textContent)).toEqual([
      'wait-worker',
      'run-worker',
      'err-worker',
      'done-worker',
    ])
    expect(tabs.map((tab) => tab.style.getPropertyValue('--tab-z'))).toEqual(['4', '6', '2', '1'])
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs[1]!.tabIndex).toBe(0)
    expect(tabs[0]!.tabIndex).toBe(-1)

    const children = [...tablist.children]
    const dividerIndex = children.findIndex((el) => el.classList.contains('specialist-tabstrip__divider'))
    expect(dividerIndex).toBe(2)

    await act(async () => tabs[2]!.click())
    expect(onSelect).toHaveBeenCalledWith('task_3')

    tabs[1]!.focus()
    await act(async () => {
      tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(onSelect).toHaveBeenLastCalledWith('task_3')
    expect(document.activeElement).toBe(tabs[2])

    await act(async () => {
      tabs[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(onSelect).toHaveBeenLastCalledWith('task_4')
    expect(document.activeElement).toBe(tabs[0])

    await act(async () => {
      tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    expect(onSelect).toHaveBeenLastCalledWith('task_1')
    expect(document.activeElement).toBe(tabs[3])
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
