// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../apps/desktop/src/components/Sidebar'
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

describe('sidebar footer', () => {
  it('offers settings only, without a commands row or release download control', async () => {
    const onNavigate = vi.fn()
    const onOpenPalette = vi.fn()
    await act(async () => {
      root.render(
        <Sidebar
          projects={[project]} sessions={[session]} activeView="session"
          onSelectProject={noop} onSelectSession={noop} onNavigate={onNavigate} onNewSession={noop} onAddProject={noop} onRemoveProject={noop}
          onClose={noop} onOpenPalette={onOpenPalette} onRenameSession={async () => undefined} onArchiveSession={async () => undefined}
        />,
      )
    })

    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.sidebar__footer button')]
    expect(buttons.map((button) => button.title)).toEqual(['Settings'])
    expect(container.querySelector('.sidebar-update')).toBeNull()
    await act(async () => buttons[0].click())
    expect(onNavigate).toHaveBeenCalledWith('settings')
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
})
