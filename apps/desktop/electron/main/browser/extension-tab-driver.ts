import type { NativeImage, WebContents } from 'electron'
import type { ExtensionTab } from 'apex-core/browser/extension-tab-driver'
import { extensionGuest as coreExtensionGuest } from 'apex-core/browser/extension-tab-driver'
import type { ExtensionBrowserBridge } from 'apex-core/browser/extension-bridge'

export * from 'apex-core/browser/extension-tab-driver'

/** Preserve the desktop adapter's existing WebContents contract. */
export function extensionGuest(bridge: ExtensionBrowserBridge, tab: ExtensionTab, imageFromDataURL: (url: string) => NativeImage): WebContents {
  return coreExtensionGuest(bridge, tab, imageFromDataURL) as unknown as WebContents
}
