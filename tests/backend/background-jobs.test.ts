import { afterEach, describe, expect, it } from 'vitest'
import { BackgroundJobBridge } from '../../apps/desktop/electron/main/background-jobs'
import type { BackgroundJobEvent } from '../../apps/desktop/src/types/api'

const bridges: BackgroundJobBridge[] = []
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
})

async function fixture(sessionPath: string | null = '/sessions/one.jsonl') {
  const events: BackgroundJobEvent[] = []
  const bridge = new BackgroundJobBridge((event) => events.push(event))
  bridges.push(bridge)
  await bridge.start()
  const env = bridge.environmentFor({ cwd: '/project', sessionPath: sessionPath ?? undefined })
  const sync = async (body: unknown, token = env.APEX_BACKGROUND_JOBS_TOKEN) => {
    const response = await fetch(env.APEX_BACKGROUND_JOBS_URL!, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() as { ok: boolean; result?: { stop: string[] }; error?: string } }
  }
  const send = (...list: unknown[]) => sync({ method: 'sync', params: { events: list } })
  return { bridge, env, events, sync, send }
}

const job = (id = 'bg_1', patch: Record<string, unknown> = {}) => ({ id, title: 'dev server', command: 'npm run dev', cwd: '/project', persistent: false, startedAt: 1_000, ...patch })

describe('BackgroundJobBridge', () => {
  it('advertises its loopback endpoint to agent runtimes', async () => {
    const { env } = await fixture()
    expect(env.APEX_BACKGROUND_JOBS_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/call$/)
    expect(env.APEX_BACKGROUND_JOBS_TOKEN).toBeTruthy()
  })

  it('mirrors a job lifecycle and keeps a bounded output buffer', async () => {
    const { bridge, events, send } = await fixture()
    await send({ type: 'started', job: job() }, { type: 'output', id: 'bg_1', data: 'ready\0 on :3000\n' })
    const [listed] = bridge.list()
    expect(listed).toMatchObject({ id: 'bg_1', title: 'dev server', status: 'running', connected: true, stopping: false, output: 'ready on :3000\n', sessionFile: '/sessions/one.jsonl' })
    expect(events.map((event) => event.type)).toEqual(['started', 'output'])

    await send({ type: 'output', id: 'bg_1', data: 'x'.repeat(300_000) })
    expect(bridge.list()[0].output).toHaveLength(256_000)

    await send({ type: 'settled', id: 'bg_1', status: 'failed', exitCode: 2, signal: null })
    expect(bridge.list()[0]).toMatchObject({ status: 'failed', exitCode: 2, signal: null })
    expect(bridge.list()[0].endedAt).toBeTypeOf('number')
  })

  it('delivers a UI stop request on the next sync, once, only while running', async () => {
    const { bridge, send } = await fixture()
    await send({ type: 'started', job: job() })
    const key = bridge.list()[0].key
    expect(bridge.stopJob(key)).toBe(true)
    expect(bridge.list()[0].stopping).toBe(true)
    expect((await send()).body.result).toEqual({ stop: ['bg_1'] })
    expect((await send()).body.result).toEqual({ stop: [] })

    await send({ type: 'settled', id: 'bg_1', status: 'killed', exitCode: null, signal: 'SIGTERM' })
    expect(bridge.list()[0]).toMatchObject({ status: 'killed', stopping: false })
    expect(bridge.stopJob(key)).toBe(false)
    expect(bridge.stopJob('job:unknown')).toBe(false)
  })

  it('replaces output on a replayed start but keeps the view on a metadata refresh', async () => {
    const { bridge, events, send } = await fixture()
    await send({ type: 'started', job: job('bg_p', { persistent: true }), output: 'first\n' })
    await send({ type: 'output', id: 'bg_p', data: 'more\n' })
    await send({ type: 'started', job: job('bg_p', { persistent: true, pid: 99 }) })
    expect(bridge.list()[0]).toMatchObject({ pid: 99, output: 'first\nmore\n' })
    expect(events.at(-1)?.type).toBe('updated')

    await send({ type: 'started', job: job('bg_p', { persistent: true, pid: 99 }), output: 'replayed\n' })
    expect(bridge.list()[0].output).toBe('replayed\n')
    expect(events.at(-1)).toMatchObject({ type: 'started', output: 'replayed\n' })
  })

  it('binds runtimes that learn their session at handshake', async () => {
    const { bridge, env, send } = await fixture(null)
    const early = await send({ type: 'started', job: job() })
    expect(early.status).toBe(409)
    bridge.bindSession(env.APEX_BACKGROUND_JOBS_TOKEN, '/sessions/late.jsonl')
    await send({ type: 'started', job: job() })
    expect(bridge.list()[0].sessionFile).toBe('/sessions/late.jsonl')
  })

  it('marks jobs when their runtime detaches or ends', async () => {
    const { bridge, env, send } = await fixture()
    await send(
      { type: 'started', job: job('bg_1') },
      { type: 'started', job: job('bg_p', { persistent: true }) },
      { type: 'started', job: job('bg_q', { persistent: true }) },
    )
    await send({ type: 'detached', id: 'bg_q' })
    const byId = () => Object.fromEntries(bridge.list().map((entry) => [entry.id, entry]))
    expect(byId().bg_q).toMatchObject({ status: 'running', connected: false })
    expect(bridge.stopJob(byId().bg_q.key)).toBe(false)

    bridge.revoke(env.APEX_BACKGROUND_JOBS_TOKEN)
    expect(byId().bg_1).toMatchObject({ status: 'killed', connected: false })
    expect(byId().bg_p).toMatchObject({ status: 'running', connected: false })
    expect((await send()).status).toBe(401)
  })

  it('ignores events for jobs owned by another runtime', async () => {
    const { bridge, send } = await fixture()
    const other = bridge.environmentFor({ cwd: '/project', sessionPath: '/sessions/one.jsonl' })
    await send({ type: 'started', job: job() })
    const response = await fetch(other.APEX_BACKGROUND_JOBS_URL!, {
      method: 'POST',
      headers: { Authorization: `Bearer ${other.APEX_BACKGROUND_JOBS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'sync', params: { events: [{ type: 'output', id: 'bg_1', data: 'spoofed' }] } }),
    })
    expect(response.status).toBe(200)
    expect(bridge.list()[0].output).toBe('')
  })

  it('dismisses only settled jobs and evicts the oldest settled jobs past the cap', async () => {
    const { bridge, events, send } = await fixture()
    await send({ type: 'started', job: job('bg_run') })
    expect(bridge.dismissJob(bridge.list()[0].key)).toBe(false)
    for (let index = 0; index < 64; index += 1) {
      await send({ type: 'started', job: job(`bg_${index}`) }, { type: 'settled', id: `bg_${index}`, status: 'completed', exitCode: 0, signal: null })
    }
    expect(bridge.list()).toHaveLength(64)
    expect(bridge.list().some((entry) => entry.id === 'bg_run')).toBe(true)
    expect(events.filter((event) => event.type === 'removed')).toHaveLength(1)
    const settled = bridge.list().find((entry) => entry.status === 'completed')!
    expect(bridge.dismissJob(settled.key)).toBe(true)
    expect(bridge.list()).toHaveLength(63)
  })

  it('rejects malformed calls without changing state', async () => {
    const { bridge, sync, send } = await fixture()
    expect((await sync({ method: 'other' })).status).toBe(400)
    expect((await sync({ method: 'sync', params: { events: 'nope' } })).status).toBe(400)
    expect((await send({ type: 'started', job: job('bg_1', { title: '' }) })).status).toBe(400)
    expect((await send({ type: 'output', id: 'bg_unknown', data: 'ignored' })).status).toBe(200)
    await send({ type: 'started', job: job() })
    expect((await send({ type: 'mystery', id: 'bg_1' })).status).toBe(400)
    expect((await send({ type: 'settled', id: 'bg_1', status: 'running', exitCode: 0, signal: null })).status).toBe(400)
    expect((await send({ type: 'output', id: 'bg_1', data: 5 })).status).toBe(400)
    expect(bridge.list()).toHaveLength(1)
    expect(bridge.list()[0].status).toBe('running')
  })
})
