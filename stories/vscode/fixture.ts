import { createApexStoryFixture, registerStoryCleanup } from '../../.storybook/host-fixtures'
import { emitHostMessage, installVsCodeHostFixture, onPostedHostMessage, sessions } from '../../.storybook/vscode-host-fixture'
import type { HostMessage, WebviewMessage } from '../../packages/vscode/src/protocol'
import { browserMessage, catalog, conversation, sessionPath } from './scenarios'

export type CatalogMode = 'ready' | 'empty' | 'loading' | 'error' | 'switch-error'
let cleanupActive: (() => void) | undefined
/** Only the Storybook alias is configured here. No production host import or editor API. */
export function installScenario(initial: HostMessage[] = [], mode: CatalogMode = 'ready') {
  // Preview, meta and story beforeEach hooks can all run. Only the latest scenario may reply.
  cleanupActive?.()
  let tab = browserMessage.state.tabs[0]
  const host = createApexStoryFixture({
    sessions: { read: async () => structuredClone(conversation) },
    app: { openExternal: async () => true, openInVsCode: async () => true },
    projects: { listFiles: async () => ({ entries: [{ path: 'packages/vscode/webview/SessionPicker.tsx', type: 'file' }], skipped: 0 }) },
    browser: {
      state: async () => ({ tabs: tab ? [tab] : [] }),
      getExtensionStatus: async () => browserMessage.status,
      focusExtensionTab: async () => true,
      setTabPaused: async (_key, _id, paused) => {
        if (!tab) return null
        tab = { ...tab, paused }
        emitHostMessage({ ...browserMessage, state: { tabs: [tab] } })
        return tab
      },
    },
  })
  installVsCodeHostFixture({ host, sessions: mode === 'empty' ? [] : catalog, currentPath: sessionPath })
  const originalList = sessions.list
  const originalSwitch = sessions.switch
  // The shared fixture currently exposes only a settled catalog. Keep overrides local and restore them.
  if (mode === 'loading') sessions.list = () => new Promise(() => {})
  if (mode === 'error')
    sessions.list = async () => {
      throw new Error('The saved session catalog could not be read. Try again.')
    }
  if (mode === 'switch-error')
    sessions.switch = async () => {
      throw new Error('This session is owned by another editor window.')
    }
  const posted: WebviewMessage[] = []
  const stop = onPostedHostMessage((message) => {
    posted.push(message)
    if (message.type === 'ready') initial.forEach(emitHostMessage)
    if (message.type === 'extensionUiResponse') emitHostMessage({ type: 'extensionUi', request: null })
  })
  const cleanup = () => {
    stop()
    sessions.list = originalList
    sessions.switch = originalSwitch
    if (cleanupActive === cleanup) cleanupActive = undefined
  }
  cleanupActive = cleanup
  registerStoryCleanup(() => {
    if (cleanupActive === cleanup) cleanup()
  })
  return posted
}
