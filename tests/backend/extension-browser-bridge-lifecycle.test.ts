import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { initialTransition, transition } from 'xstate'
import { ExtensionBrowserBridge } from 'apex-core/browser/extension-bridge'
import {
  extensionBridgeMachine,
  isBridgeConnected,
  isBridgeListening,
  isBridgeRemote,
  isBridgeStopped,
} from '../../packages/core/src/browser/extensionBridgeMachine'

const bridges: ExtensionBrowserBridge[] = []
afterEach(async () => {
  await Promise.all(bridges.splice(0).map(bridge => bridge.stop()))
})

describe('ExtensionBrowserBridge token lifecycle', () => {
  it.each([undefined, 'Bearer wrong-token'])('rejects events with authorization %s after hello', async authorization => {
    const bridge = new ExtensionBrowserBridge({ port: 0 })
    bridges.push(bridge)
    await bridge.start()
    const base = `http://127.0.0.1:${bridge.port}/v1/extension`
    const origin = `chrome-extension://${'a'.repeat(32)}`
    const hello = await fetch(`${base}/hello`, { headers: { Origin: origin } })
    const body: unknown = await hello.json()
    expect(body).toMatchObject({ token: expect.stringMatching(/^[a-f0-9]{64}$/) })
    const response = await fetch(`${base}/events`, {
      headers: { Origin: origin, ...(authorization ? { Authorization: authorization } : {}) },
    })
    expect(response.status).toBe(401)
  })

  it('closes the listening socket on stop', async () => {
    const bridge = new ExtensionBrowserBridge({ port: 0 })
    bridges.push(bridge)
    await bridge.start()
    const port = bridge.port!
    await bridge.stop()
    const code = await new Promise<string | undefined>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); reject(new Error('Stopped bridge still accepts connections')) })
      socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code))
    })
    expect(code).toBe('ECONNREFUSED')
  })

  it('tracks remote polling and restart via startOrConnect', async () => {
    const broker = new ExtensionBrowserBridge({ port: 0, bridgeKind: 'vscode' })
    const client = new ExtensionBrowserBridge({ port: 0, bridgeKind: 'desktop' })
    bridges.push(broker, client)
    await broker.start()
    const base = `http://127.0.0.1:${broker.port}`
    await client.startOrConnect('vscode', base)
    expect(client.port).toBe(broker.port)
    expect(client.isConnected()).toBe(false)
    await client.stop()
    expect(client.port).toBeNull()
    await client.startOrConnect('vscode', base)
    expect(client.port).toBe(broker.port)
  })
})

describe('extensionBridgeMachine', () => {
  it('transitions through local listening, remote polling, and stopped states', () => {
    let snap = initialTransition(extensionBridgeMachine)[0]
    expect(snap.value).toBe('idle')
    expect(isBridgeConnected(snap)).toBe(false)

    snap = transition(extensionBridgeMachine, snap, { type: 'START' })[0]
    expect(snap.value).toBe('starting')
    snap = transition(extensionBridgeMachine, snap, { type: 'START_FAILED' })[0]
    expect(snap.value).toBe('idle')

    snap = transition(extensionBridgeMachine, snap, { type: 'START' })[0]
    snap = transition(extensionBridgeMachine, snap, { type: 'LISTENED', port: 29301 })[0]
    expect(isBridgeListening(snap)).toBe(true)
    expect(snap.context.port).toBe(29301)

    snap = transition(extensionBridgeMachine, snap, { type: 'STREAM_CONNECTED' })[0]
    expect(isBridgeConnected(snap)).toBe(true)
    snap = transition(extensionBridgeMachine, snap, { type: 'STREAM_DISCONNECTED' })[0]
    expect(isBridgeConnected(snap)).toBe(false)

    snap = transition(extensionBridgeMachine, snap, { type: 'STOP' })[0]
    expect(isBridgeStopped(snap)).toBe(true)
    expect(snap.context.port).toBeNull()

    snap = transition(extensionBridgeMachine, snap, { type: 'CONNECT_REMOTE', base: 'http://127.0.0.1:29301', port: 29301 })[0]
    expect(isBridgeRemote(snap)).toBe(true)
    expect(isBridgeConnected(snap)).toBe(false)
    snap = transition(extensionBridgeMachine, snap, { type: 'REMOTE_CONNECTED' })[0]
    expect(isBridgeConnected(snap)).toBe(true)
    snap = transition(extensionBridgeMachine, snap, { type: 'REMOTE_DISCONNECTED' })[0]
    expect(isBridgeConnected(snap)).toBe(false)
    snap = transition(extensionBridgeMachine, snap, { type: 'START' })[0]
    expect(snap.value).toBe('starting')
    snap = transition(extensionBridgeMachine, snap, { type: 'STOP' })[0]
    expect(isBridgeStopped(snap)).toBe(true)
  })
})
