// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar, type SidebarProps } from '../../src/components/Sidebar'
import { sessionAttentionSignature } from '../../src/app/session-attention'
import type { ProjectRecord, SessionRecord } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project: ProjectRecord = {
  id: 'project', harness: 'pi', name: 'Project', path: '/project', folders: ['/project'], primaryFolder: '/project',
  pinned: false, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', sessionCount: 1,
}
const session: SessionRecord = {
  id: 'session', harness: 'pi', filePath: '/sessions/session.jsonl', projectPath: '/project', title: 'Session',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'idle', depth: 0,
}

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
  window.localStorage.clear()
  vi.restoreAllMocks()
})

const noop = () => undefined

async function press(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}
async function rightClick(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
  })
}

async function renderSidebar(overrides: Partial<SidebarProps> = {}) {
  await act(async () => root.render(<Sidebar
    projects={[project]} sessions={[session]} activeView="session"
    onSelectProject={noop} onSelectSession={noop} onNavigate={noop} onNewSession={noop}
    onAddProject={noop} onRemoveProject={noop} onClose={noop} onOpenPalette={noop}
    onRenameSession={async () => undefined} onArchiveSession={async () => undefined}
    {...overrides}
  />))
}

async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>('[aria-label="Search projects and sessions"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const library = Array.from({ length: 8 }, (_, index): ProjectRecord => ({
  ...project, id: `project-${index}`, name: `Project ${index}`, path: `/project-${index}`,
  folders: [`/project-${index}`], primaryFolder: `/project-${index}`,
  lastOpenedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
}))

const projectNames = (selector = '.project-row__main') => [...container.querySelectorAll(selector)].map((button) => button.textContent)

describe('sidebar project working set', () => {
  it('keeps all pinned projects and five recent projects, including the current project', async () => {
    const projects = [...library, { ...project, pinned: true, name: 'Pinned' }]
    await renderSidebar({ projects, activeProjectId: 'project-0' })
    expect(projectNames('[aria-label="Pinned"] .project-row__main')).toEqual(['Pinned'])
    expect(projectNames('[aria-label="Recent"] .project-row__main')).toEqual(['Project 7', 'Project 6', 'Project 5', 'Project 4', 'Project 0'])
    expect(container.querySelector('[aria-label="Collapse Project 0"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('[aria-expanded="false"].project-row__collapse')).toHaveLength(5)
    expect(container.querySelector('.sidebar__project-count')?.textContent).toBe('9')

    await renderSidebar({ projects, activeProjectId: 'project-0', projectSortMode: 'alphabetical' })
    expect(projectNames('[aria-label="Recent"] .project-row__main')).toEqual(['Project 0', 'Project 4', 'Project 5', 'Project 6', 'Project 7'])
  })

  it('remembers explicit expansion and collapse across remounts, including collapse all', async () => {
    const second = { ...project, id: 'second', name: 'Second' }
    const props = { projects: [project, second], activeProjectId: project.id }
    await renderSidebar(props)
    await press(container.querySelector('[aria-label="Collapse Project"]')!)
    await press(container.querySelector('[aria-label="Expand Second"]')!)
    await act(async () => root.render(null))
    await renderSidebar(props)
    expect(container.querySelector('[aria-label="Expand Project"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[aria-label="Collapse Second"]')?.getAttribute('aria-expanded')).toBe('true')

    await press(container.querySelector('[aria-label="Collapse all projects"]')!)
    await act(async () => root.render(null))
    await renderSidebar(props)
    expect(container.querySelectorAll('.session-list')).toHaveLength(0)
    expect(container.querySelectorAll('.project-row__collapse[aria-expanded="false"]')).toHaveLength(2)
  })

  it('searches the entire library without expanding sessions for a project name or folder match', async () => {
    const onSelectProject = vi.fn()
    await renderSidebar({ projects: library, sessions: [{ ...session, projectPath: '/project-0' }], onSelectProject })
    expect(projectNames()).not.toContain('Project 0')
    await search('Project 0')
    expect(projectNames()).toEqual(['Project 0'])
    expect(container.querySelector('.session-list')).toBeNull()
    expect(container.querySelector('[aria-label="Project matches"]')).not.toBeNull()
    await search('/project-0')
    expect(projectNames()).toEqual(['Project 0'])
    await press(container.querySelector('.project-row__main')!)
    expect(onSelectProject).toHaveBeenCalledWith(library[0])
    expect(container.querySelector<HTMLInputElement>('#session-search')?.value).toBe('')
  })

  it('reveals matching sessions without changing saved collapse state and pages through all matches', async () => {
    const matches = Array.from({ length: 9 }, (_, index) => ({ ...session, id: `match-${index}`, title: `Needle ${index}` }))
    const onSelectSession = vi.fn()
    await renderSidebar({ sessions: [...matches, { ...session, id: 'unrelated', title: 'Unrelated' }, { ...session, id: 'archived', title: 'Needle archived', archived: true }], onSelectSession })
    await press(container.querySelector('[aria-label="Collapse all projects"]')!)
    await search('needle')
    expect(container.querySelector('[aria-label="Project matches"]')).toBeNull()
    expect(container.querySelector('[aria-label="Session matches"]')).not.toBeNull()
    expect(container.querySelectorAll('.session-row-wrap')).toHaveLength(7)
    expect(container.textContent).not.toContain('Unrelated')
    expect(container.textContent).not.toContain('Needle archived')
    await press(container.querySelector('.session-row--empty')!)
    expect(container.querySelectorAll('.session-row-wrap')).toHaveLength(9)
    await press(container.querySelector('[title="Needle 0"]')!)
    expect(onSelectSession).toHaveBeenCalledWith(matches[0])
    expect(container.querySelector('.session-list')).toBeNull()
    await search('unmatched')
    expect(container.textContent).toContain('No matching projects or sessions')
    await press(container.querySelector('[aria-label="Clear search"]')!)
    expect(container.querySelector('[aria-label="Expand Project"]')).not.toBeNull()
  })

  it('keeps activity indicators visible while collapsed and links to work outside the recent list', async () => {
    const sessions: SessionRecord[] = [
      { ...session, id: 'running', projectPath: '/project-7', status: 'running' },
      { ...session, id: 'waiting', projectPath: '/project-7', status: 'waiting' },
      { ...session, id: 'other-running', projectPath: '/project-0', status: 'running' },
      { ...session, id: 'other-failed', projectPath: '/project-0', status: 'failed' },
    ]
    const onNavigate = vi.fn()
    await renderSidebar({ projects: library, sessions, onNavigate })
    const before = projectNames()
    expect(container.querySelector('.session-list')).toBeNull()
    expect(container.querySelector('.project-working')).not.toBeNull()
    expect(container.querySelector('.project-attention')?.textContent).toBe('1')
    expect(container.querySelector('.sidebar__other-activity')?.textContent).toBe('Elsewhere: 1 working · 1 to review')
    await press(container.querySelector('.sidebar__other-activity')!)
    expect(onNavigate).toHaveBeenCalledWith('activity')
    await press(container.querySelector('.sidebar__library > button')!)
    expect(onNavigate).toHaveBeenCalledWith('projects')

    await renderSidebar({ projects: library, sessions, clearedAttention: { waiting: sessionAttentionSignature(sessions[1])! } })
    expect(container.querySelector('.project-attention')).toBeNull()
    expect(projectNames()).toEqual(before)
    expect(container.querySelector('.session-list')).toBeNull()
  })

  it('ignores invalid stored collapse data and stays usable when storage is unavailable', async () => {
    window.localStorage.setItem('prime-work.sidebar-collapsed-projects', '{broken')
    await renderSidebar({ activeProjectId: project.id })
    expect(container.querySelector('[aria-label="Collapse Project"]')).not.toBeNull()
    await act(async () => root.render(null))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
    await renderSidebar()
    await press(container.querySelector('[aria-label="Expand Project"]')!)
    expect(container.querySelector('.session-list')).not.toBeNull()
  })
})

describe('sidebar project context menu', () => {
  it('sorts projects from the section menu and toggles pinning from project options', async () => {
    const projects = [
      { ...project, id: 'zeta', name: 'Zeta', lastOpenedAt: '2026-01-01T00:00:00.000Z' },
      { ...project, id: 'alpha', name: 'Alpha', lastOpenedAt: '2026-02-01T00:00:00.000Z' },
    ]
    const onSetProjectSortMode = vi.fn()
    const onTogglePinProject = vi.fn()
    await act(async () => {
      root.render(
        <Sidebar
          projects={projects} sessions={[session]} activeView="session" projectSortMode="recent"
          onSetProjectSortMode={onSetProjectSortMode} onTogglePinProject={onTogglePinProject}
          onSelectProject={noop} onSelectSession={noop} onNavigate={noop} onNewSession={noop} onAddProject={noop} onRemoveProject={noop}
          onClose={noop} onOpenPalette={noop} onRenameSession={async () => undefined} onArchiveSession={async () => undefined}
        />,
      )
    })

    expect([...container.querySelectorAll('.project-row__main')].map((button) => button.textContent)).toEqual(['Alpha', 'Zeta'])
    await press(container.querySelector('[aria-label="Sort projects"]')!)
    const alphabetical = [...container.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent?.includes('Alphabetical'))
    expect(alphabetical).toBeDefined()
    await press(alphabetical!)
    expect(onSetProjectSortMode).toHaveBeenCalledWith('alphabetical')

    await rightClick(container.querySelector('.project-row')!)
    const pin = [...container.querySelectorAll('[aria-label^="Project options"] button')].find((button) => button.textContent?.includes('Pin project'))
    expect(pin).toBeDefined()
    await press(pin!)
    expect(onTogglePinProject).toHaveBeenCalledWith(projects[1])
  })

  it('dismisses the sort menu when adding a project', async () => {
    await act(async () => {
      root.render(
        <Sidebar
          projects={[project]} sessions={[session]} activeView="session" projectSortMode="recent"
          onSelectProject={noop} onSelectSession={noop} onNavigate={noop} onNewSession={noop} onAddProject={noop} onRemoveProject={noop}
          onClose={noop} onOpenPalette={noop} onRenameSession={async () => undefined} onArchiveSession={async () => undefined}
        />,
      )
    })

    await press(container.querySelector('[aria-label="Sort projects"]')!)
    expect(container.querySelector('[role="menuitemradio"]')).not.toBeNull()
    await act(async () => {
      container.querySelector('[aria-label="Add project"]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(container.querySelector('[role="menuitemradio"]')).toBeNull()
  })

  it('omits pinning for inferred projects', async () => {
    await act(async () => {
      root.render(
        <Sidebar
          projects={[{ ...project, inferred: true }]} sessions={[session]} activeView="session"
          onSelectProject={noop} onSelectSession={noop} onNavigate={noop} onNewSession={noop} onAddProject={noop} onRemoveProject={noop}
          onClose={noop} onOpenPalette={noop} onRenameSession={async () => undefined} onArchiveSession={async () => undefined}
        />,
      )
    })
    await rightClick(container.querySelector('.project-row')!)
    expect([...container.querySelectorAll('[aria-label^="Project options"] button')].some((button) => button.textContent?.includes('Pin project'))).toBe(false)
  })

  it('copies the exact session UUID from the session context menu', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await act(async () => {
      root.render(
        <Sidebar
          projects={[project]} sessions={[session]} activeView="session"
          onSelectProject={noop} onSelectSession={noop} onNavigate={noop} onNewSession={noop} onAddProject={noop} onRemoveProject={noop}
          onClose={noop} onOpenPalette={noop} onRenameSession={async () => undefined} onArchiveSession={async () => undefined}
        />,
      )
    })

    await press(container.querySelector('[aria-label="Expand Project"]')!)
    await rightClick(container.querySelector('.session-row')!)
    const copy = [...container.querySelectorAll('[aria-label="Session options"] button')].find((button) => button.textContent?.includes('Copy session UUID'))
    expect(copy).toBeDefined()
    await press(copy!)
    expect(writeText).toHaveBeenCalledWith(session.id)
  })

  it('offers a confirmed remove action without deleting the project folder', async () => {
    const onRemoveProject = vi.fn()
    await act(async () => {
      root.render(
        <Sidebar
          projects={[project]}
          sessions={[session]}
          activeView="session"
          onSelectProject={noop}
          onSelectSession={noop}
          onNavigate={noop}
          onNewSession={noop}
          onAddProject={noop}
          onRemoveProject={onRemoveProject}
          onClose={noop}
          onOpenPalette={noop}
          onRenameSession={async () => undefined}
          onArchiveSession={async () => undefined}
        />,
      )
    })

    await rightClick(container.querySelector('.project-row')!)
    const menu = container.querySelector('[aria-label="Project options for Project"]')
    expect(menu).not.toBeNull()
    const remove = [...menu!.querySelectorAll('button')].find((button) => button.textContent?.includes('Remove project'))
    expect(remove).toBeDefined()
    await press(remove!)

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('The folder and saved sessions will not be deleted.')
    await press(document.body.querySelector('.modal .button--danger')!)
    expect(onRemoveProject).toHaveBeenCalledOnce()
    expect(onRemoveProject).toHaveBeenCalledWith(project)
  })

  it('uses notebook icons for new sessions and a folder-plus icon for projects', async () => {
    await act(async () => {
      root.render(
        <Sidebar
          projects={[project]}
          sessions={[session]}
          activeView="session"
          onSelectProject={noop}
          onSelectSession={noop}
          onNavigate={noop}
          onNewSession={noop}
          onAddProject={noop}
          onRemoveProject={noop}
          onClose={noop}
          onOpenPalette={noop}
          onRenameSession={async () => undefined}
          onArchiveSession={async () => undefined}
        />,
      )
    })

    expect(container.querySelector('.sidebar__title-actions .ph-note-pencil')).not.toBeNull()
    expect(container.querySelector('.project-row__new-session .ph-note-pencil')).not.toBeNull()
    expect(container.querySelector('.sidebar__section-heading .ph-folder-plus')).not.toBeNull()
    expect(container.querySelector('.sidebar__title-actions button[title="New session (⌘N)"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="New session in Project"][title="New session in Project"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Add project"][title="Add project"]')).not.toBeNull()
  })

  it('shows Linux shortcut names on Linux', async () => {
    await act(async () => {
      root.render(
        <Sidebar
          platform="linux"
          projects={[project]}
          sessions={[session]}
          activeView="session"
          onSelectProject={noop}
          onSelectSession={noop}
          onNavigate={noop}
          onNewSession={noop}
          onAddProject={noop}
          onRemoveProject={noop}
          onClose={noop}
          onOpenPalette={noop}
          onRenameSession={async () => undefined}
          onArchiveSession={async () => undefined}
        />,
      )
    })

    expect(container.querySelector('.sidebar__title-actions button[title="New session (Ctrl+N)"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Hide sidebar (Ctrl+B)"]')).not.toBeNull()
    expect(container.textContent).not.toContain('⌘')
  })
})

describe('sidebar archive confirmation', () => {
  it('requires a second click and cancels when clicking elsewhere', async () => {
    const onArchiveSession = vi.fn(async () => undefined)
    await act(async () => {
      root.render(
        <Sidebar
          projects={[project]}
          sessions={[session]}
          activeView="session"
          onSelectProject={noop}
          onSelectSession={noop}
          onNavigate={noop}
          onNewSession={noop}
          onAddProject={noop}
          onRemoveProject={noop}
          onClose={noop}
          onOpenPalette={noop}
          onRenameSession={async () => undefined}
          onArchiveSession={onArchiveSession}
        />,
      )
    })

    await press(container.querySelector('[aria-label="Expand Project"]')!)
    const archive = container.querySelector('[aria-label="Archive Session"]')
    expect(archive).not.toBeNull()
    expect(archive?.getAttribute('title')).toBe('Archive Session')
    await press(archive!)
    expect(onArchiveSession).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="Confirm archive Session"]')).not.toBeNull()

    await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(container.querySelector('[aria-label="Confirm archive Session"]')).toBeNull()
    expect(container.querySelector('[aria-label="Archive Session"]')).not.toBeNull()

    const restarted = container.querySelector('[aria-label="Archive Session"]')
    await press(restarted!)
    const confirm = container.querySelector('[aria-label="Confirm archive Session"]')
    await press(confirm!)
    expect(onArchiveSession).toHaveBeenCalledOnce()
    expect(onArchiveSession).toHaveBeenCalledWith(session)
  })
})

describe('sidebar session notifications', () => {
  it('mutes an acknowledged failed session without changing its failed status', async () => {
    const failedSession = { ...session, status: 'failed' as const }
    const props = {
      projects: [project],
      sessions: [failedSession],
      activeProjectId: project.id,
      activeView: 'session' as const,
      onSelectProject: noop,
      onSelectSession: noop,
      onNavigate: noop,
      onNewSession: noop,
      onAddProject: noop,
      onRemoveProject: noop,
      onClose: noop,
      onOpenPalette: noop,
      onRenameSession: async () => undefined,
      onArchiveSession: async () => undefined,
    }
    await act(async () => { root.render(<Sidebar {...props} />) })

    expect(container.querySelector('.session-row-wrap')?.classList.contains('has-attention')).toBe(true)

    const signature = sessionAttentionSignature(failedSession)!
    await act(async () => { root.render(<Sidebar {...props} clearedAttention={{ [failedSession.id]: signature }} />) })
    expect(container.querySelector('.session-row-wrap')?.classList.contains('has-attention')).toBe(false)
    expect(container.querySelector('.session-status-mark--failed')?.getAttribute('title')).toBe('Failed — notification cleared')
  })
})
