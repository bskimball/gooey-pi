import type { HostMessage, SessionSummary, WebviewMessage } from '../packages/vscode/src/protocol'
import type { ApexApi } from '../packages/core/src/types/api'
import { createApexStoryFixture, createStoryEvents, installHostFixture, registerStoryCleanup, unsupportedHostMethod } from './host-fixtures'

const messages = createStoryEvents<HostMessage>()
const outgoing = createStoryEvents<WebviewMessage>()
let host: ApexApi | undefined
let sessionCatalog: SessionSummary[] = []
let currentPath: string | null = null
function getHost() {
  if (host) return host
  if (window.apex) return window.apex
  installVsCodeHostFixture()
  return window.apex
}

/** Call before mount to configure both the VS Code module and window.apex. */
export function installVsCodeHostFixture(options: { host?: ApexApi; sessions?: SessionSummary[]; currentPath?: string | null } = {}) {
  host = options.host ?? createApexStoryFixture()
  sessionCatalog = options.sessions ?? []
  currentPath = options.currentPath ?? null
  installHostFixture(host)
  registerStoryCleanup(() => {
    host = undefined
    sessionCatalog = []
    currentPath = null
    messages.reset()
    outgoing.reset()
  })
}
export const emitHostMessage = messages.emit
export function onPostedHostMessage(listener: (message: WebviewMessage) => void) {
  const unsubscribe = outgoing.subscribe(listener)
  registerStoryCleanup(unsubscribe)
  return unsubscribe
}
export function postToHost(message: WebviewMessage) {
  // Deliberately observable, but never forwarded to VS Code or a window message transport.
  outgoing.emit(message)
}
export function onHostMessage(listener: (message: HostMessage) => void) {
  const unsubscribe = messages.subscribe(listener)
  registerStoryCleanup(unsubscribe)
  return unsubscribe
}
export const sessions = {
  list: async () => ({ sessions: structuredClone(sessionCatalog), currentPath }),
  read: (path: string) => getHost().sessions.read(path),
  switch: async (path: string) => {
    currentPath = path
    messages.emit({ type: 'sessions:current', path })
  },
  onCurrent: (callback: (path: string | null) => void) =>
    onHostMessage((message) => {
      if (message.type === 'sessions:current') callback(message.path)
    }),
}
export const browser = {
  state: () => getHost().browser.state(),
  getExtensionStatus: () => getHost().browser.getExtensionStatus(),
  onChanged: (cb: Parameters<ApexApi['browser']['onChanged']>[0]) => {
    const stopHost = getHost().browser.onChanged(cb)
    const stopMessage = onHostMessage((message) => {
      if (message.type === 'browserState') cb(message.state)
    })
    return () => {
      stopHost()
      stopMessage()
    }
  },
  onExtensionStatusChanged: (cb: Parameters<ApexApi['browser']['onExtensionStatusChanged']>[0]) => {
    const stopHost = getHost().browser.onExtensionStatusChanged(cb)
    const stopMessage = onHostMessage((message) => {
      if (message.type === 'browserState') cb(message.status)
    })
    return () => {
      stopHost()
      stopMessage()
    }
  },
  setActiveSession: (key: string | null) => getHost().browser.setActiveSession(key),
  setTabPaused: (key: string, tabId: string, paused: boolean) => getHost().browser.setTabPaused(key, tabId, paused),
  focusExtensionTab: (key: string, tabId: string) => getHost().browser.focusExtensionTab(key, tabId),
  popOutTab: async (_key: string, _tabId: string): Promise<boolean> => unsupportedHostMethod('vscode.browser.popOutTab'),
}
export function installApexShim() {
  installHostFixture(getHost())
}
/** Storybook owns the theme. Do not install the production MutationObserver. */
export function syncTheme() {}
