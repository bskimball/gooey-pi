// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectRunControl } from '../../apps/desktop/src/components/ProjectRunControl'
import type { ProjectRecord } from '../../apps/desktop/src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const baseProject: ProjectRecord = {
  id: 'project-1',
  harness: 'pi',
  name: 'Apex',
  path: '/repo',
  folders: ['/repo'],
  primaryFolder: '/repo',
  pinned: false,
  createdAt: '2026-08-23T00:00:00.000Z',
  lastOpenedAt: '2026-08-23T00:00:00.000Z',
  sessionCount: 0,
}

describe('ProjectRunControl', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('hides completely when a project has no discovered or saved scripts', () => {
    act(() => root.render(<ProjectRunControl project={baseProject} onRun={vi.fn()} onStop={vi.fn()} />))
    expect(container.firstChild).toBeNull()
  })

  it('runs the primary discovered script on Play without rendering a chevron when only one script exists', () => {
    const onRun = vi.fn()
    const single: ProjectRecord = {
      ...baseProject,
      discoveredScripts: [{ name: 'dev', command: 'pnpm run dev' }],
    }
    act(() => root.render(<ProjectRunControl project={single} onRun={onRun} onStop={vi.fn()} />))

    expect(container.querySelector('[aria-label="Select project script"]')).toBeNull()
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Run dev"]')?.click())
    expect(onRun).toHaveBeenCalledWith({ command: 'pnpm run dev', label: 'dev' })
  })

  it('changes the primary action to Stop while active', () => {
    const onRun = vi.fn()
    const onStop = vi.fn()
    const configured: ProjectRecord = {
      ...baseProject,
      discoveredScripts: [{ name: 'dev', command: 'npm run dev' }],
    }
    act(() => root.render(<ProjectRunControl project={configured} activeKind="run" onRun={onRun} onStop={onStop} />))
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Stop project script"]')?.click())
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('opens the script menu when multiple scripts exist, switches selection, and runs the chosen script', () => {
    const onRun = vi.fn()
    const multi: ProjectRecord = {
      ...baseProject,
      discoveredScripts: [
        { name: 'dev', command: 'pnpm run dev' },
        { name: 'test', command: 'pnpm run test' },
      ],
    }
    act(() => root.render(<ProjectRunControl project={multi} onRun={onRun} onStop={vi.fn()} />))

    const menuTrigger = container.querySelector<HTMLButtonElement>('[aria-label="Select project script"]')
    expect(menuTrigger).not.toBeNull()
    act(() => menuTrigger?.click())

    const items = container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('dev')
    expect(items[0].textContent).toContain('pnpm run dev')
    expect(items[1].textContent).toContain('test')
    expect(items[1].textContent).toContain('pnpm run test')

    act(() => items[1].click())

    expect(onRun).toHaveBeenCalledWith({ command: 'pnpm run test', label: 'test' })
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(window.localStorage.getItem('apex.project-script:project-1')).toBe('test')
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Run test"]')).not.toBeNull()
  })

  it('includes a legacy saved run command when not already in discoveredScripts', () => {
    const onRun = vi.fn()
    const legacy: ProjectRecord = {
      ...baseProject,
      scripts: { setup: '', run: 'just dev' },
      discoveredScripts: [{ name: 'test', command: 'npm test' }],
    }
    act(() => root.render(<ProjectRunControl project={legacy} onRun={onRun} onStop={vi.fn()} />))
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Run run"]')?.click())
    expect(onRun).toHaveBeenCalledWith({ command: 'just dev', label: 'run' })
  })
})
