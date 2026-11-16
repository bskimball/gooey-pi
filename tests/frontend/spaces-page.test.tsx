// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { SpacesPage } from '../../apps/desktop/src/components/activity/SpacesPage'
import type { ApexApi, ProjectRecord, SessionRecord, SpaceRecord } from '../../apps/desktop/src/types/api'

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>()
  return {
    ...actual,
    SelectControl: ({ label, children, value, onChange }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) => (
      <select aria-label={label} value={value} onChange={onChange}>
        {children}
      </select>
    ),
  }
})

vi.mock('../../apps/desktop/src/components/activity/ActivityCoordinator', () => ({ ActivityCoordinator: ({ spaceId }: { spaceId?: string }) => <div data-testid="coordinator">Coordinator: {spaceId ?? 'global'}</div> }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const project: ProjectRecord = { id: 'p', harness: 'pi', name: 'Project', path: '/p', folders: ['/p'], primaryFolder: '/p', pinned: false, createdAt: '', lastOpenedAt: '', sessionCount: 0 }
const space: SpaceRecord = { id: 's', name: 'First', objective: 'Original', projectId: 'p', sessionIds: [], createdAt: '', updatedAt: '' }

it('switches scope and persists an edited objective', async () => {
  const update = vi.fn(async (_id, changes) => ({ ...space, ...changes }))
  const bridge = { spaces: { list: vi.fn().mockResolvedValue([space]), update } } as unknown as ApexApi
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<SpacesPage bridge={bridge} sessions={[]} projects={[project]} renderInspector={(content) => <aside aria-label="Space details">{content}</aside>} />))
    expect(container.textContent).toContain('Coordinator: s')
    const click = async (label: string) => {
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)
      expect(button).toBeDefined()
      await act(async () => button?.click())
    }
    await click('Global Chief')
    expect(container.textContent).toContain('Coordinator: global')
    await click('First')
    await click('Edit objective')
    const input = container.querySelector('aside textarea')!
    expect(container.querySelector('.activity-main')?.textContent).not.toContain('Original')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, 'Updated')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Save')
    expect(update).toHaveBeenCalledWith('s', { objective: 'Updated' })
    expect(container.textContent).toContain('Updated')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('shows a list error and retries before showing the Space list', async () => {
  window.localStorage.clear()
  const list = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([space])
  const bridge = { spaces: { list } } as unknown as ApexApi
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<SpacesPage bridge={bridge} sessions={[]} projects={[project]} contentInert renderInspector={(content) => <aside aria-label="Space details">{content}</aside>} />))
    expect(container.textContent).toContain('Could not load Spaces: offline')
    const retry = [...container.querySelectorAll<HTMLButtonElement>('aside button')].find((item) => item.textContent?.trim() === 'Retry')!
    expect(retry.closest('[inert]')).toBeNull()
    await act(async () => retry.click())
    expect(container.textContent).toContain('Coordinator: s')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    window.localStorage.clear()
  }
})

it('keeps the conversation mounted when a background refresh fails and offers retry in the inspector', async () => {
  window.localStorage.clear()
  let rejectRefresh: (reason: Error) => void = () => { throw new Error('Refresh has not started') }
  const refresh = new Promise<SpaceRecord[]>((_resolve, reject) => { rejectRefresh = reject })
  const list = vi.fn().mockResolvedValueOnce([space]).mockReturnValueOnce(refresh).mockResolvedValue([space])
  const bridge = { spaces: { list } } as unknown as ApexApi
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<SpacesPage bridge={bridge} sessions={[]} projects={[project]} contentInert renderInspector={(content) => <aside aria-label="Space details">{content}</aside>} />))
    const conversation = container.querySelector('[data-testid="coordinator"]')
    expect(conversation).not.toBeNull()
    await act(async () => rejectRefresh(new Error('offline')))
    expect(container.querySelector('[data-testid="coordinator"]')).toBe(conversation)
    expect(container.textContent).toContain('Spaces could not refresh: offline')
    const retry = [...container.querySelectorAll<HTMLButtonElement>('aside button')].find((item) => item.textContent?.trim() === 'Retry')!
    expect(retry.closest('[inert]')).toBeNull()
    await act(async () => retry.click())
    expect(container.textContent).not.toContain('offline')
    expect(container.querySelector('[data-testid="coordinator"]')).toBe(conversation)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    window.localStorage.clear()
  }
})

it('creates a Space with a selected project and opens it', async () => {
  window.localStorage.clear()
  const create = vi.fn().mockResolvedValue(space)
  const list = vi.fn().mockResolvedValue([])
  const bridge = { spaces: { list, create } } as unknown as ApexApi
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<SpacesPage bridge={bridge} sessions={[]} projects={[project]} />))
    await act(async () => [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'New space')!.click())
    const input = container.querySelector('input')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, 'First')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const select = container.querySelector('select')!
    await act(async () => {
      select.value = 'p'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(create).toHaveBeenCalledWith({ name: 'First', objective: '', projectId: 'p' })
    expect(container.textContent).toContain('Coordinator: s')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    window.localStorage.clear()
  }
})

it('keeps membership management out of the conversation and retains changes after reopening', async () => {
  window.localStorage.clear()
  const session: SessionRecord = { id: 'a', harness: 'pi', filePath: '/sessions/a.jsonl', projectPath: '/p', title: 'Linked work', status: 'idle', depth: 0, createdAt: '', updatedAt: '' }
  const sessions: SessionRecord[] = [session, { ...session, id: 'b', title: 'Available work' }, { ...session, id: 'child', title: 'Child work', depth: 1 }, { ...session, id: 'archive', title: 'Archived work', archived: true }, { ...session, id: 'other', title: 'Other project', projectPath: '/other' }]
  let current = { ...space, sessionIds: ['a'] }
  const update = vi.fn(async (_id: string, changes: { addSessionIds?: string[]; removeSessionIds?: string[] }) => {
    current = { ...current, sessionIds: [...new Set([...current.sessionIds, ...changes.addSessionIds ?? []])].filter((id) => !changes.removeSessionIds?.includes(id)) }
    return current
  }).mockRejectedValueOnce(new Error('Could not save membership'))
  const bridge = { spaces: { list: vi.fn(async () => [current]), update } } as unknown as ApexApi
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = (key: string) => root.render(<SpacesPage key={key} bridge={bridge} sessions={sessions} projects={[project]} renderInspector={(content) => <aside aria-label="Space details">{content}</aside>} />)
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)
    expect(button, label).toBeDefined()
    await act(async () => button?.click())
  }
  try {
    await act(async () => render('initial'))
    expect(container.textContent).not.toContain('Activity inbox')
    expect(container.textContent).not.toContain('Linked work')
    expect(container.textContent).toContain('1 linked thread')
    await click('Manage linked threads')
    expect(container.textContent).toContain('Linked work')
    expect(container.textContent).not.toContain('Child work')
    expect(container.textContent).not.toContain('Archived work')
    expect(container.textContent).not.toContain('Other project')
    await click('Link Available work')
    expect(container.querySelector('aside [role="alert"]')?.textContent).toBe('Could not save membership')
    expect(container.textContent).toContain('1 linked thread')
    await click('Link Available work')
    expect(container.textContent).toContain('2 linked threads')
    await click('Unlink Linked work')
    expect(update).toHaveBeenLastCalledWith('s', { removeSessionIds: ['a'] })
    await click('Done managing')
    expect(container.textContent).not.toContain('Available work')
    expect(container.querySelector('.activity-main')?.textContent).toContain('Coordinator: s')
    await act(async () => render('reopened'))
    expect(container.textContent).toContain('1 linked thread')
    expect(container.textContent).not.toContain('Available work')
    await click('Manage linked threads')
    expect(container.querySelector('button[aria-label="Unlink Available work"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    window.localStorage.clear()
  }
})
