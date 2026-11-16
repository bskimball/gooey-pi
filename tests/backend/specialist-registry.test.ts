import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TRACKED_SESSIONS, MAX_WATCHED_WORKERS, SpecialistRegistry, rosterFromMessages, type SpecialistPush, type SpecialistWatchFactory } from '../../apps/desktop/electron/main/specialists'
import type { MessagePart, SessionChangeEvent, TranscriptMessage } from '../../apps/desktop/src/types/api'

const started = (id: string, agent: string, prompt: string, model?: string): MessagePart[] => [
  { type: 'toolCall', id: `start-${id}`, name: 'task_start', args: { agent, prompt, ...(model ? { model } : {}) } },
  { type: 'toolResult', name: 'task_start', text: `started ${id}`, details: { worker: { id, ...(model ? { model } : {}) } } },
]
const settled = (id: string): MessagePart[] => [
  { type: 'toolCall', name: 'task_wait', args: { id } },
  { type: 'toolResult', name: 'task_wait', text: 'lifecycle: settled\n--- result ---\nDone' },
]
const transcript = (parts: MessagePart[]): TranscriptMessage[] => [{ id: 'm', role: 'assistant', parts }]

function harness(initial: Record<string, MessagePart[]>) {
  const files = new Map(Object.entries(initial))
  const watchers: Array<{ path: string; fire(): void; closed: boolean }> = []
  const watchDirectory: SpecialistWatchFactory = (path, onChange) => {
    const entry = { path, fire: onChange, closed: false }
    watchers.push(entry)
    const watcher = { close: () => { entry.closed = true }, on: () => watcher }
    return watcher
  }
  const registry = new SpecialistRegistry({
    read: vi.fn(async (path: string) => transcript(files.get(path) ?? [])),
    requireSessionPath: async (path: string) => {
      if (!path.startsWith('/sessions/')) throw new TypeError('outside')
      return path
    },
    watchDirectory,
  })
  const pushes: SpecialistPush[] = []
  const send = (push: SpecialistPush) => { pushes.push(push) }
  return { registry, files, pushes, send, watchers, change: (filePath?: string) => registry.notifySessionChange({ filePath, harness: 'pi' } satisfies SessionChangeEvent) }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('specialist rosters', () => {
  it('summarizes the parent receipts without the worker transcripts', () => {
    const roster = rosterFromMessages(transcript([...started('task_1', 'scout', 'Map the repo'), ...started('task_2', 'oracle', 'Review the plan'), ...settled('task_2')]))
    expect(roster).toEqual([
      expect.objectContaining({ id: 'task_1', agent: 'scout', mission: 'Map the repo', status: 'running' }),
      expect.objectContaining({ id: 'task_2', agent: 'oracle', mission: 'Review the plan', status: 'done' }),
    ])
    expect(roster[0]).not.toHaveProperty('messages')
  })

  it('returns tracked rosters keyed by the requested path and skips unauthorized paths', async () => {
    const { registry, send } = harness({ '/sessions/a.jsonl': started('task_1', 'scout', 'Map') })
    const rosters = await registry.track(1, send, ['/sessions/a.jsonl', '/elsewhere/b.jsonl'])
    expect(Object.keys(rosters)).toEqual(['/sessions/a.jsonl'])
    expect(rosters['/sessions/a.jsonl']).toEqual([expect.objectContaining({ id: 'task_1', status: 'running' })])
  })

  it('pushes a tracked session only when its roster actually changes', async () => {
    const { registry, files, pushes, send, change } = harness({ '/sessions/a.jsonl': started('task_1', 'scout', 'Map') })
    await registry.track(1, send, ['/sessions/a.jsonl'])

    change('/sessions/a.jsonl')
    await vi.runAllTimersAsync()
    expect(pushes).toEqual([])

    files.set('/sessions/a.jsonl', [...started('task_1', 'scout', 'Map'), ...settled('task_1')])
    change('/sessions/a.jsonl')
    change('/sessions/a.jsonl')
    await vi.runAllTimersAsync()
    expect(pushes).toEqual([{ channel: 'specialists:changed', payload: { filePath: '/sessions/a.jsonl', specialists: [expect.objectContaining({ id: 'task_1', status: 'done' })] } }])
  })

  it('ignores untracked sessions and rechecks every tracked session on catalog-wide changes', async () => {
    const { registry, files, pushes, send, change } = harness({ '/sessions/a.jsonl': [], '/sessions/b.jsonl': [] })
    await registry.track(1, send, ['/sessions/a.jsonl'])
    files.set('/sessions/b.jsonl', started('task_9', 'scout', 'Elsewhere'))
    change('/sessions/b.jsonl')
    await vi.runAllTimersAsync()
    expect(pushes).toEqual([])

    files.set('/sessions/a.jsonl', started('task_1', 'scout', 'Map'))
    change(undefined)
    await vi.runAllTimersAsync()
    expect(pushes.map((push) => push.payload)).toEqual([{ filePath: '/sessions/a.jsonl', specialists: [expect.objectContaining({ id: 'task_1' })] }])
  })

  it('bounds tracked sessions and watched workers', async () => {
    const { registry, send } = harness({})
    await expect(registry.track(1, send, Array.from({ length: MAX_TRACKED_SESSIONS + 1 }, (_, index) => `/sessions/${index}.jsonl`))).rejects.toThrow(RangeError)
    await expect(registry.watchWorkers(1, send, Array.from({ length: MAX_WATCHED_WORKERS + 1 }, (_, index) => `/sessions/rpc-workers/${index}/worker.jsonl`))).rejects.toThrow(RangeError)
    await expect(registry.track(1, send, 'not-a-list')).rejects.toThrow(TypeError)
  })
})

describe('worker transcript watching', () => {
  it('watches the worker directory, debounces bursts, and stops when the window lets go', async () => {
    const { registry, pushes, send, watchers } = harness({})
    const worker = '/sessions/rpc-workers/abc/worker.jsonl'
    await registry.watchWorkers(1, send, [worker])
    expect(watchers.map((watcher) => watcher.path)).toEqual(['/sessions/rpc-workers/abc'])

    watchers[0]!.fire()
    watchers[0]!.fire()
    await vi.runAllTimersAsync()
    expect(pushes).toEqual([{ channel: 'specialists:worker-changed', payload: { workerFile: worker } }])

    await registry.watchWorkers(1, send, [])
    expect(watchers[0]!.closed).toBe(true)
    watchers[0]!.fire()
    await vi.runAllTimersAsync()
    expect(pushes).toHaveLength(1)
  })

  it('lets the newest replace call win when an older one resolves later', async () => {
    const { registry, send, watchers } = harness({})
    const first = registry.watchWorkers(1, send, ['/sessions/rpc-workers/one/worker.jsonl'])
    const second = registry.watchWorkers(1, send, [])
    await Promise.all([first, second])
    expect(watchers.filter((watcher) => !watcher.closed)).toEqual([])
  })

  it('releases a closed window and closes every watcher on dispose', async () => {
    const { registry, send, watchers } = harness({})
    await registry.watchWorkers(7, send, ['/sessions/rpc-workers/abc/worker.jsonl'])
    registry.release(7)
    expect(watchers[0]!.closed).toBe(true)
    await registry.watchWorkers(8, send, ['/sessions/rpc-workers/def/worker.jsonl'])
    registry.dispose()
    expect(watchers[1]!.closed).toBe(true)
  })
})
