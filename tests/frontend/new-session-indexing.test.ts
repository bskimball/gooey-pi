import { describe, expect, it, vi } from 'vitest'
import { applySessionLifecycleEvent } from '../../apps/desktop/src/app/session-attention'
import { indexStartedSession } from '../../apps/desktop/src/hooks/useWorkspaceActions'
import type { PrimeWorkApi, SessionRecord } from '../../apps/desktop/src/types/api'

const existing: SessionRecord = {
  id: 'existing', harness: 'pi', filePath: '/sessions/existing.jsonl', projectPath: '/project', title: 'Existing chat',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'idle', depth: 0, unread: false,
}
const created: SessionRecord = { ...existing, id: 'created', filePath: '/sessions/created.jsonl', title: 'First prompt', status: 'running' }

describe('new session indexing', () => {
  it('force-indexes only the persisted session without replacing newer catalog entries', async () => {
    let resolveList!: (sessions: SessionRecord[]) => void
    const list = vi.fn(() => new Promise<SessionRecord[]>((resolve) => { resolveList = resolve }))
    let sessions = [existing]
    const setSessions: React.Dispatch<React.SetStateAction<SessionRecord[]>> = (update) => {
      sessions = typeof update === 'function' ? update(sessions) : update
    }
    const indexing = indexStartedSession({
      bridge: { sessions: { list } } as unknown as PrimeWorkApi,
      harness: 'pi', sessionFile: created.filePath, setSessions,
    })
    sessions = [{ ...existing, title: 'Renamed during scan' }]
    resolveList([existing, created])
    expect(await indexing).toEqual(created)
    expect(list).toHaveBeenCalledWith(undefined, true, 'pi', true)
    expect(sessions).toEqual([{ ...existing, title: 'Renamed during scan' }, created])
  })

  it('preserves completion attention delivered while the target scan is pending', async () => {
    let resolveList!: (sessions: SessionRecord[]) => void
    const list = vi.fn(() => new Promise<SessionRecord[]>((resolve) => { resolveList = resolve }))
    let sessions = [created]
    const indexing = indexStartedSession({
      bridge: { sessions: { list } } as unknown as PrimeWorkApi,
      harness: 'pi', sessionFile: created.filePath,
      setSessions: (update) => { sessions = typeof update === 'function' ? update(sessions) : update },
    })
    const completed = applySessionLifecycleEvent(created, { type: 'agent_end' }, false)
    sessions = [completed]
    resolveList([created])
    await indexing
    expect(sessions).toEqual([completed])
    expect(sessions[0]).toMatchObject({ status: 'complete', unread: true, eventRevision: 1, statusEventRevision: 1 })
  })

  it('does not merge a stale catalog after workspace ownership changes', async () => {
    let resolveList!: (sessions: SessionRecord[]) => void
    const list = vi.fn(() => new Promise<SessionRecord[]>((resolve) => { resolveList = resolve }))
    let current = true
    let sessions = [existing]
    const setSessions: React.Dispatch<React.SetStateAction<SessionRecord[]>> = (update) => {
      sessions = typeof update === 'function' ? update(sessions) : update
    }
    const indexing = indexStartedSession({
      bridge: { sessions: { list } } as unknown as PrimeWorkApi,
      harness: 'pi', sessionFile: created.filePath, setSessions, isCurrent: () => current,
    })
    current = false
    resolveList([existing, created])
    await indexing
    expect(sessions).toEqual([existing])
  })
})
