import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionBrowserBridge } from '../../apps/desktop/electron/main/browser/extension-bridge'

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
})
