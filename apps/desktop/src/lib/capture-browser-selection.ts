import type { BrowserAnnotationInput } from './browser-annotations'
import type { BrowserAnnotationElement, PrimeWorkApi } from '@/types/api'

export async function captureBrowserSelection({
  bridge,
  sessionKey,
  tabId,
  pageUrl,
  pageTitle,
  cwd,
  element,
}: {
  bridge: {
    browser: Pick<PrimeWorkApi['browser'], 'captureSelection'>
    app: Pick<PrimeWorkApi['app'], 'resolveBrowserSource'>
  }
  sessionKey: string
  tabId: string
  pageUrl: string
  pageTitle: string
  cwd?: string
  element: BrowserAnnotationElement
}): Promise<{ input: BrowserAnnotationInput; warning?: string }> {
  let warning: string | undefined
  const preview = await bridge.browser.captureSelection(sessionKey, tabId, pageUrl, element.selector).catch((error: unknown) => {
    warning = `Image capture failed. Element details are attached. ${error instanceof Error ? error.message : String(error)}`
    return undefined
  })
  const source = cwd && element.sourceHint ? await bridge.app.resolveBrowserSource(cwd, element.sourceHint).catch(() => undefined) : undefined
  return {
    input: { comment: '', tabId, pageUrl, pageTitle, element, preview, source },
    warning,
  }
}
