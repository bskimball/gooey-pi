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
  it('leaves settings and the sidebar toggle to the toolbar, without a release download control', async () => {
    const onOpenSettings = vi.fn()
    const onToggleSidebar = vi.fn()
    await act(async () => {
      root.render(<>
        <Sidebar
          projects={[project]} sessions={[session]} activeView="session"
          onSelectProject={noop} onSelectSession={noop} onNavigate={noop} onNewSession={noop} onAddProject={noop} onRemoveProject={noop}
          onClose={noop} onOpenPalette={noop} onRenameSession={async () => undefined} onArchiveSession={async () => undefined}
        />
        <TitleToolbar view="session" sidebarOpen inspectorOpen={false} terminalOpen={false} platform="linux" onToggleSidebar={onToggleSidebar} onToggleInspector={noop} onToggleTerminal={noop} onOpenBrowser={noop} onOpenSettings={onOpenSettings} />
      </>)
    })

    const sidebar = container.querySelector('.sidebar')!
    expect(sidebar.querySelector('.sidebar__footer')).toBeNull()
    expect(sidebar.querySelector('.sidebar__toggle')).toBeNull()
    expect(container.querySelector('.sidebar-update')).toBeNull()
    const toolbar = container.querySelector('.title-toolbar')!
    await act(async () => toolbar.querySelector<HTMLButtonElement>('[aria-label="Settings (Ctrl+,)"]')!.click())
    await act(async () => toolbar.querySelector<HTMLButtonElement>('[aria-label="Hide sidebar (Ctrl+B)"]')!.click())
    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(onToggleSidebar).toHaveBeenCalledOnce()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
})
