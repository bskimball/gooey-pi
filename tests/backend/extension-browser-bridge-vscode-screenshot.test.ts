import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionBrowserBridge } from '../../electron/main/browser/extension-bridge'
import { ExtensionBrowserService, type ScreenshotResizer } from '../../packages/vscode/src/browser/service'

// Minimal SOF0 header: these tests exercise dimension decisions, not JPEG decoding.
function jpeg(width: number, height: number): string {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 0, 0, 0, 1, 1, 0x11, 0, 0xff, 0xd9])
  bytes.writeUInt16BE(height, 7)
  bytes.writeUInt16BE(width, 9)
  return bytes.toString('base64')
}

const services: ExtensionBrowserService[] = []
afterEach(() => {
  for (const service of services.splice(0)) service.beginShutdown()
  vi.restoreAllMocks()
})

async function fixture(width: number, height: number, resizeScreenshot?: ScreenshotResizer) {
  const original = jpeg(width, height)
  const bridge = new ExtensionBrowserBridge()
  vi.spyOn(bridge, 'isConnected').mockReturnValue(true)
  vi.spyOn(bridge, 'call').mockImplementation(async method => {
    if (method === 'create_tab') return 42
    if (method === 'evaluate') return JSON.stringify({ url: 'https://example.com/', title: 'Example', innerWidth: 640, innerHeight: 480 })
    if (method === 'cdp') return { data: original }
    throw new Error(`Unexpected command: ${method}`)
  })
  const service = new ExtensionBrowserService({ extensionBridge: bridge, extensionPath: '/extension', resizeScreenshot })
  services.push(service)
  const session = resolve('/sessions/screenshot.jsonl')
  const tab = await service.openTab(session, { url: 'https://example.com/' })
  return { original, capture: () => service.screenshot(session, { tabId: tab.tabId }) }
}

describe('VS Code screenshot CSS dimensions', () => {
  it.each([[640, 480], [639, 479], [641, 481], [639, 481], [641, 479]])('retains %sx%s within the one-pixel tolerance without resizing', async (width, height) => {
    const resize = vi.fn<ScreenshotResizer>()
    const { original, capture } = await fixture(width, height, resize)
    expect(await capture()).toMatchObject({ data: original, width, height })
    expect(resize).not.toHaveBeenCalled()
  })

  it.each([[642, 480], [640, 478], [1280, 960]])('requests CSS dimensions for a %sx%s capture', async (width, height) => {
    const normalized = jpeg(640, 480)
    const resize = vi.fn<ScreenshotResizer>().mockResolvedValue(normalized)
    const { original, capture } = await fixture(width, height, resize)
    expect(await capture()).toMatchObject({ data: normalized, width: 640, height: 480 })
    expect(resize).toHaveBeenCalledExactlyOnceWith(`data:image/jpeg;base64,${original}`, 640, 480, 0.7)
  })

  it.each(['absent', 'undefined', 'throws', 'wrong dimensions'] as const)('retains original true dimensions when resizer is %s', async failure => {
    const resize = failure === 'absent' ? undefined : vi.fn<ScreenshotResizer>().mockImplementation(async () => {
      if (failure === 'throws') throw new Error('Webview unavailable')
      return failure === 'wrong dimensions' ? jpeg(800, 600) : undefined
    })
    const { original, capture } = await fixture(1280, 960, resize)
    expect(await capture()).toMatchObject({ data: original, width: 1280, height: 960 })
  })
})
