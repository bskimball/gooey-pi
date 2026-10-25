import { join } from 'node:path'
import { ExtensionBrowserBridge } from '../../../../electron/main/browser/extension-bridge'
import { CapabilityBridge, type CapabilityClaim } from '../../../../electron/main/lib/capability-bridge'
import { ExtensionBrowserService, type ScreenshotResizer } from './service'

class BrowserCapability extends CapabilityBridge {
  protected readonly rateLimit = 240
  protected readonly rateLimitError = 'Browser API rate limit exceeded; slow down and retry shortly'
  constructor(readonly service: ExtensionBrowserService, readonly extensionPath: string) { super() }
  protected environmentEntries(url: string, token: string): NodeJS.ProcessEnv {
    return { PRIME_WORK_BROWSER_URL: url, PRIME_WORK_BROWSER_TOKEN: token, PRIME_WORK_BROWSER_EXTENSION_PATH: this.extensionPath }
  }
  protected async dispatch(method: string, params: Record<string, unknown>, claim: CapabilityClaim): Promise<unknown> {
    if (!claim.sessionPath) throw new Error('Browser control is not available yet for this thread; try again in a moment')
    await this.service.refreshExtensionState()
    const key = claim.sessionPath
    switch (method) {
      case 'terminal.read': throw new Error('terminal_read is not available in VS Code')
      case 'tabs.list': return this.service.listTabs(key)
      case 'tabs.open': return this.service.openTab(key, params)
      case 'tabs.close': return this.service.closeTabScoped(key, params)
      case 'tabs.select': return this.service.selectTabScoped(key, params)
      case 'navigate': return this.service.navigate(key, params)
      case 'screenshot': return this.service.screenshot(key, params)
      case 'click': return this.service.click(key, params)
      case 'drag': return this.service.drag(key, params)
      case 'type': return this.service.type(key, params)
      case 'press_key': return this.service.pressKey(key, params)
      case 'scroll': return this.service.scroll(key, params)
      case 'read_page': return this.service.readPage(key, params)
      case 'evaluate': return this.service.evaluate(key, params)
      default: throw new TypeError(`Unsupported browser method ${method}`)
    }
  }
}

/** Lives outside Pi's process lifecycle; each launch gets a fresh scoped claim. */
export class BrowserHost {
  readonly bridge = new ExtensionBrowserBridge({ bridgeKind: 'vscode' })
  readonly service: ExtensionBrowserService
  readonly capability: BrowserCapability
  readonly extensionPath: string
  private starting: Promise<void> | undefined
  constructor(distDirectory: string, resizeScreenshot?: ScreenshotResizer) {
    this.extensionPath = join(distDirectory, 'extensions', 'omp-work-browser.ts')
    this.service = new ExtensionBrowserService({ extensionBridge: this.bridge, extensionPath: join(distDirectory, 'browser-extension'), resizeScreenshot })
    this.capability = new BrowserCapability(this.service, this.extensionPath)
  }
  start(): Promise<void> {
    return this.starting ??= (async () => { await this.bridge.startOrConnect(); await this.capability.start() })()
  }
  async stop() {
    await this.starting?.catch(() => undefined)
    this.service.beginShutdown()
    await Promise.all([this.bridge.stop(), this.capability.stop()])
  }
}
