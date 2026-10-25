import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionBrowserBridge } from '../../electron/main/browser/extension-bridge'
import { callMethod, probeBroker } from '../../electron/main/browser/extension-bridge-client'

const bridges: ExtensionBrowserBridge[] = []
afterEach(async () => { await Promise.all(bridges.splice(0).map(bridge => bridge.stop())) })
async function fixture(kind: 'desktop' | 'vscode' = 'desktop') {
  const bridge = new ExtensionBrowserBridge({ port: 0, bridgeKind: kind })
  bridges.push(bridge)
  await bridge.start()
  const base = `http://127.0.0.1:${bridge.port}`
  const hello = await fetch(`${base}/v1/extension/hello`)
  const { token } = await hello.json() as { token: string }
  return { bridge, base, token }
}

async function stubExtension(base: string, token: string) {
  const controller = new AbortController()
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const stream = await fetch(`${base}/v1/extension/events`, { headers, signal: controller.signal })
  const reader = stream.body!.getReader()
  const commands: Array<{ id: string; method: string; params: Record<string, unknown> }> = []
  let nextId = 100
  const pump = (async () => {
    let buffer = ''
    const decoder = new TextDecoder()
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        buffer += decoder.decode(part.value, { stream: true })
        while (true) {
          const boundary = buffer.indexOf('\n\n')
          if (boundary < 0) break
          const message = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          if (!message.startsWith('data: ')) continue
          const command = JSON.parse(message.slice(6)) as typeof commands[number]
          commands.push(command)
          await fetch(`${base}/v1/extension/result`, { method: 'POST', headers, body: JSON.stringify({ id: command.id, result: command.method === 'create_tab' ? nextId++ : true }) })
        }
      }
    } catch { /* Explicitly aborted by the test. */ }
  })()
  return { commands, stop: async () => { controller.abort(); await pump } }
}

describe('extension broker HTTP contract', () => {
  it('connects a second transport without starting its server and attributes and merges both apps tabs', async () => {
    const { bridge, base, token } = await fixture('vscode')
    bridge.setContext(() => ({ activeSessionKey: 'broker-session', tabs: [] }))
    const extension = await stubExtension(base, token)
    const client = new ExtensionBrowserBridge()
    bridges.push(client)
    client.setContext(() => ({ activeSessionKey: 'client-session', tabs: [] }))
    try {
      await client.startOrConnect(undefined, base)
      expect(client.port).toBe(bridge.port)
      expect(client.isConnected()).toBe(true)
      const localId = await bridge.call('create_tab', { url: 'https://local.example' }, 'broker-session')
      const clientId = await client.call('create_tab', { url: 'https://client.example' }, 'client-session')
      await client.call('sync_tab_state', { activeSessionKey: 'client-session', tabs: [{ chromeTabId: clientId, sessionFile: 'client-session' }] })
      await bridge.call('sync_tab_state', { activeSessionKey: 'broker-session', tabs: [{ chromeTabId: localId, sessionFile: 'broker-session' }] })
      const sync = extension.commands.at(-1)!
      expect(sync.params.tabs).toEqual(expect.arrayContaining([
        expect.objectContaining({ chromeTabId: clientId, sessionKey: 'client-session' }),
        expect.objectContaining({ chromeTabId: localId, sessionKey: 'broker-session' }),
      ]))
      const state = await fetch(`${base}/v1/extension/tab-state`, { headers: { Authorization: `Bearer ${token}` } })
      expect(await state.json()).toMatchObject({ tabs: expect.arrayContaining([expect.objectContaining({ chromeTabId: clientId, sessionKey: 'client-session' })]) })
      expect((await fetch(`${base}/v1/extension/tab-state`)).status).toBe(401)
      const events: Record<string, unknown>[] = []
      bridge.onEvent(event => events.push(event))
      await fetch(`${base}/v1/extension/event`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'tab_updated', chromeTabId: clientId, title: 'Client' }) })
      expect(events[0].sessionKey).toBe('client-session')
    } finally { await extension.stop() }
  })

  it('polls only while a client session is active and stops on session end and disposal', async () => {
    const { base } = await fixture()
    const client = new ExtensionBrowserBridge()
    bridges.push(client)
    await client.startOrConnect(undefined, base)
    const refresh = vi.spyOn(client, 'refreshState').mockResolvedValue(undefined)
    vi.useFakeTimers()
    try {
      await vi.advanceTimersByTimeAsync(4000)
      expect(refresh).not.toHaveBeenCalled()
      await client.setActiveSession('session')
      expect(refresh).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2000)
      expect(refresh).toHaveBeenCalledTimes(2)
      await client.setActiveSession(null)
      await vi.advanceTimersByTimeAsync(4000)
      expect(refresh).toHaveBeenCalledTimes(2)
      await client.setActiveSession('session')
      await client.stop()
      await vi.advanceTimersByTimeAsync(4000)
      expect(refresh).toHaveBeenCalledTimes(3)
      const local = new ExtensionBrowserBridge({ port: 0 })
      const localRefresh = vi.spyOn(local, 'refreshState')
      await local.setActiveSession('session')
      await vi.advanceTimersByTimeAsync(4000)
      expect(localRefresh).not.toHaveBeenCalled()
    } finally { vi.useRealTimers(); refresh.mockRestore() }
  })
  it('exposes only unauthenticated identity and permits native loopback calls', async () => {
    const { base } = await fixture()
    const response = await fetch(`${base}/v1/extension/status`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, bridge: 'apex', version: 1, kind: 'desktop' })
    const loopback = await fetch(`${base}/v1/extension/status`, { headers: { Origin: 'http://127.0.0.1:1234' } })
    expect(loopback.status).toBe(403)
  })
  it('rejects loopback web Origins on every extension route', async () => {
    const { base, token } = await fixture()
    for (const route of ['status', 'hello', 'connect', 'events', 'event', 'result', 'tab-state', 'execute']) {
      expect((await fetch(`${base}/v1/extension/${route}`, { headers: { Origin: 'http://localhost:3000', Authorization: `Bearer ${token}` } })).status).toBe(403)
    }
  })

  it('keeps Chrome pause and unpair authoritative over stale snapshots', async () => {
    const { bridge, base, token } = await fixture()
    const extension = await stubExtension(base, token)
    const event = async (body: Record<string, unknown>) => fetch(`${base}/v1/extension/event`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    try {
      await event({ type: 'tab_paired', chromeTabId: 1, paused: true })
      await bridge.call('sync_tab_state', { tabs: [{ chromeTabId: 1, paused: false }] }, undefined, true)
      expect(extension.commands.at(-1)?.params.tabs).toMatchObject([{ chromeTabId: 1, paused: true }])
      await event({ type: 'tab_unpaired', chromeTabId: 1 })
      await bridge.call('sync_tab_state', { tabs: [{ chromeTabId: 1, paused: false }] }, undefined, true)
      expect(extension.commands.at(-1)?.params.tabs).toEqual([])
      await event({ type: 'tab_paired', chromeTabId: 1, paused: false })
      await bridge.call('sync_tab_state', { tabs: [] })
      expect(extension.commands.at(-1)?.params.tabs).toMatchObject([{ chromeTabId: 1 }])
    } finally { await extension.stop() }
  })

  it('releases shared tabs without forwarding close and prevents refresh resurrection', async () => {
    const { bridge, base, token } = await fixture()
    const extension = await stubExtension(base, token)
    bridge.setContext(() => ({ activeSessionKey: 'session', tabs: [{ chromeTabId: 1, sessionFile: 'session' }] }))
    try {
      await callMethod('release_tab', { chromeTabId: 1 }, token, base)
      for (const remote of [false, true]) await bridge.call('sync_tab_state', { tabs: [{ chromeTabId: 1, sessionFile: 'session' }] }, undefined, remote)
      const state = await fetch(`${base}/v1/extension/tab-state`, { headers: { Authorization: `Bearer ${token}` } })
      expect(await state.json()).toMatchObject({ tabs: [] })
      expect(extension.commands.every(command => command.method === 'sync_tab_state')).toBe(true)
      expect(extension.commands.at(-1)?.params.tabs).toEqual([])
    } finally { await extension.stop() }
  })

  it('re-probes after losing the fixed-port startup race', async () => {
    const { bridge: winner, base } = await fixture('vscode')
    const loser = new ExtensionBrowserBridge({ port: winner.port! })
    bridges.push(loser)
    const originalFetch = globalThis.fetch
    // First probe misses the broker, as when both apps probe before either binds.
    const probe = vi.spyOn(globalThis, 'fetch').mockImplementation(originalFetch)
      .mockImplementationOnce(async () => new Response('{}', { status: 404 }))
    const start = vi.spyOn(loser, 'start')
    await loser.startOrConnect('vscode', base)
    probe.mockRestore()
    expect(start).toHaveBeenCalledOnce()
    expect(loser.port).toBe(winner.port)
  })

  it('rejects a malicious status Origin', async () => {
    const { base } = await fixture()
    expect((await fetch(`${base}/v1/extension/status`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403)
  })
  it('probes the broker kind and handles unavailable brokers without throwing', async () => {
    const { base } = await fixture('vscode')
    expect(await probeBroker(base)).toEqual({ running: true, version: 1, kind: 'vscode' })
    expect(await probeBroker('http://127.0.0.1:0')).toEqual({ running: false })
  })
  it('requires an execute token and rejects browser Origins', async () => {
    const { base, token } = await fixture()
    const request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'create_tab', params: {} }) }
    expect((await fetch(`${base}/v1/extension/execute`, request)).status).toBe(401)
    for (const Origin of ['https://evil.example', 'http://127.0.0.1:1234', `chrome-extension://${'a'.repeat(32)}`]) {
      expect((await fetch(`${base}/v1/extension/execute`, { ...request, headers: { ...request.headers, Authorization: `Bearer ${token}`, Origin } })).status).toBe(403)
    }
  })
  it('returns a typed error without a connected extension', async () => {
    const { base, token } = await fixture()
    const response = await fetch(`${base}/v1/extension/execute`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'create_tab', params: {} }) })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'extension_not_connected' })
  })
  it('dispatches client commands through the real SSE result correlation', async () => {
    const { base, token } = await fixture()
    const controller = new AbortController()
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const stream = await fetch(`${base}/v1/extension/events`, { headers, signal: controller.signal })
    const reader = stream.body!.getReader()
    try {
      await reader.read()
      const result = callMethod('create_tab', { url: 'https://example.com' }, token, base)
      const message = await reader.read()
      const command = JSON.parse(new TextDecoder().decode(message.value).trim().slice(6)) as { id: string; method: string; params: unknown }
      expect(command.method).toBe('create_tab')
      expect(command.params).toEqual({ url: 'https://example.com' })
      await fetch(`${base}/v1/extension/result`, { method: 'POST', headers, body: JSON.stringify({ id: command.id, result: 42 }) })
      expect(await result).toBe(42)
    } finally { controller.abort(); await reader.cancel().catch(() => undefined) }
  })
})
