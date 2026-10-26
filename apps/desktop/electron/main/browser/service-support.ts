import type { NativeImage, WebContents } from 'electron'
import type { AgentBrowserServiceOptions as CoreOptions } from 'apex-core/browser/service-support'

export * from 'apex-core/browser/service-support'

export interface AgentBrowserServiceOptions extends Omit<CoreOptions, 'getGuest' | 'imageFromDataURL'> {
  getGuest(webContentsId: number): WebContents | undefined
  imageFromDataURL?: (url: string) => NativeImage
}
