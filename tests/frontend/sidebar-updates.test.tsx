// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../apps/desktop/src/components/Sidebar'
import { AppRail } from '../../apps/desktop/src/components/AppRail'
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
  it('keeps one Windows menu in the rail with the sidebar open or closed', async () => {
    const toolbar = (sidebarOpen: boolean) => <AppRail onNavigate={noop} view="session" platform="win32" sidebarOpen={sidebarOpen} onToggleSidebar={noop} voiceOpen={false} onToggleVoice={noop} />
    await act(async () => root.render(toolbar(true)))
    await vi.waitFor(() => expect(container.querySelectorAll('[aria-label="Application menu"]')).toHaveLength(1))
    await act(async () => root.render(toolbar(false)))
    await vi.waitFor(() => {
      const buttons = [...container.querySelectorAll<HTMLButtonElement>('.app-rail__top button')]
      expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Application menu', 'Show sidebar (Ctrl+B)'])
    })
    expect(container.querySelector('.app-rail__bottom button:last-child')?.getAttribute('aria-label')).toBe('Settings (Ctrl+,)')
  })

  it('routes global actions through the rail and keeps identity in the toolbar', async () => {
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
        />
        <TitleToolbar project={project} view="session" platform="linux" onToggleInspector={noop} />
        <AppRail onNavigate={onNavigate} vscodeProject={project} terminalOpen onToggleTerminal={onToggleTerminal} onOpenInVsCode={onOpenInVsCode} view="session" sidebarOpen platform="linux" onToggleSidebar={onToggleSidebar} voiceOpen={false} onToggleVoice={onToggleVoice} />
      </>)
    })

    const sidebar = container.querySelector('.sidebar')!
    expect(sidebar.querySelector('.sidebar__footer')).toBeNull()
    expect(sidebar.querySelector('.sidebar__toggle')).toBeNull()
    expect(container.querySelector('.sidebar-update')).toBeNull()
    expect([...container.querySelectorAll('.title-toolbar button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Toggle inspector'])
    expect(container.querySelector('.sidebar__brand')).toBeNull()
    const toolbar = container.querySelector('.app-rail')!
    const settings = toolbar.querySelector<HTMLButtonElement>('[aria-label="Settings (Ctrl+,)"]')!
    expect(settings).not.toBeNull()
    expect(settings.previousElementSibling?.getAttribute('aria-label')).toBe('Open realtime voice')
    expect(settings.nextElementSibling).toBeNull()
    expect(toolbar.querySelector('[aria-label*="realtime voice"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(toolbar.querySelector('[aria-label^="Toggle terminal"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(toolbar.querySelector('[aria-label*="in VS Code"]')).not.toBeNull()
    await act(async () => settings.click())
    await act(async () => toolbar.querySelector<HTMLButtonElement>('[aria-label="Open realtime voice"]')!.click())
    await act(async () => toolbar.querySelector<HTMLButtonElement>('[aria-label^="Toggle terminal"]')!.click())
    await act(async () => toolbar.querySelector<HTMLButtonElement>('[aria-label*="in VS Code"]')!.click())
    await act(async () => toolbar.querySelector<HTMLButtonElement>('[aria-label="Hide sidebar (Ctrl+B)"]')!.click())
    expect(onNavigate).toHaveBeenCalledWith('settings')
    expect(onToggleVoice).toHaveBeenCalledOnce()
    expect(onToggleTerminal).toHaveBeenCalledOnce()
    expect(onOpenInVsCode).toHaveBeenCalledWith('/project')
    expect(onToggleSidebar).toHaveBeenCalledOnce()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
})
