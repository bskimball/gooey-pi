// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../apps/desktop/src/components/Sidebar'
import { TitleToolbar } from '../../apps/desktop/src/components/TitleToolbar'
import type { ProjectRecord, SessionRecord } from '../../apps/desktop/src/types/api'

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
  vi.restoreAllMocks()
})

const noop = () => undefined

describe('sidebar chrome', () => {
  it('renders settings, voice, terminal, and VS Code controls in the sidebar footer while keeping the sidebar toggle on the toolbar', async () => {
    const onNavigate = vi.fn()
    const onToggleVoice = vi.fn()
    const onToggleTerminal = vi.fn()
    const onOpenInVsCode = vi.fn()
    const onToggleSidebar = vi.fn()
    await act(async () => {
      root.render(<>
        <Sidebar
          projects={[project]} sessions={[session]} activeProjectId={project.id} activeView="session" platform="linux"
          onSelectProject={noop} onSelectSession={noop} onNavigate={onNavigate} onNewSession={noop} onAddProject={noop} onRemoveProject={noop}
          onClose={noop} onOpenPalette={noop} onRenameSession={async () => undefined} onArchiveSession={async () => undefined}
          onToggleVoice={onToggleVoice} onToggleTerminal={onToggleTerminal} onOpenInVsCode={onOpenInVsCode}
        />
        <TitleToolbar view="session" sidebarOpen inspectorOpen={false} platform="linux" onToggleSidebar={onToggleSidebar} onToggleInspector={noop} onOpenBrowser={noop} />
      </>)
    })

    const sidebar = container.querySelector('.sidebar')!
    const footerButtons = [...sidebar.querySelectorAll<HTMLButtonElement>('.sidebar__footer button')]
    expect(footerButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Settings (Ctrl+,)',
      'Open realtime voice',
      'Toggle terminal (Ctrl+J)',
      'Open Project in VS Code',
    ])
    expect(sidebar.querySelector('.sidebar__toggle')).toBeNull()
    expect(container.querySelector('.sidebar-update')).toBeNull()
    const toolbar = container.querySelector('.title-toolbar')!
    expect(toolbar.querySelector('[aria-label^="Settings"]')).toBeNull()
    expect(toolbar.querySelector('[aria-label*="realtime voice"]')).toBeNull()
    expect(toolbar.querySelector('[aria-label^="Toggle terminal"]')).toBeNull()
    expect(toolbar.querySelector('[aria-label*="in VS Code"]')).toBeNull()
    await act(async () => footerButtons[0].click())
    await act(async () => footerButtons[1].click())
    await act(async () => footerButtons[2].click())
    await act(async () => footerButtons[3].click())
    await act(async () => toolbar.querySelector<HTMLButtonElement>('[aria-label="Hide sidebar (Ctrl+B)"]')!.click())
    expect(onNavigate).toHaveBeenCalledWith('settings')
    expect(onToggleVoice).toHaveBeenCalledOnce()
    expect(onToggleTerminal).toHaveBeenCalledOnce()
    expect(onOpenInVsCode).toHaveBeenCalledWith('/project')
    expect(onToggleSidebar).toHaveBeenCalledOnce()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
})
