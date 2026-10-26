import type { BrowserMethod, HostMessage, SessionSummary, WebviewMessage } from '../src/protocol'
import type { AgentBrowserState, AgentBrowserTabRecord, AgentBrowserExtensionStatus, ProjectFileListing } from 'apex-core/types/api'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void }

const vscode = acquireVsCodeApi()

export function postToHost(message: WebviewMessage) {
  vscode.postMessage(message)
}

type Listener = (message: HostMessage) => void
const listeners = new Set<Listener>()
window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  if (event.data.type === 'resizeScreenshot') void resizeScreenshot(event.data)
  for (const listener of listeners) listener(event.data)
})

async function resizeScreenshot(request: Extract<HostMessage, { type: 'resizeScreenshot' }>) {
  try {
    const bytes = Uint8Array.from(atob(request.dataUrl.split(',')[1]), char => char.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }))
    let blob: Blob
    try {
      const canvas = new OffscreenCanvas(request.width, request.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Screenshot canvas is unavailable')
      context.drawImage(bitmap, 0, 0, request.width, request.height)
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: request.quality })
    } finally { bitmap.close() }
    const result = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < result.length; offset += 32768) binary += String.fromCharCode(...result.subarray(offset, offset + 32768))
    postToHost({ type: 'screenshotResized', requestId: request.requestId, data: btoa(binary) })
  } catch {
    postToHost({ type: 'screenshotResized', requestId: request.requestId })
  }
}

export function onHostMessage(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

let fileRequest = 0
function listFiles(): Promise<ProjectFileListing> {
  const requestId = ++fileRequest
  return new Promise((resolve) => {
    const stop = onHostMessage((message) => {
      if (message.type !== 'files' || message.requestId !== requestId) return
      stop()
      resolve({ entries: message.entries, skipped: 0 })
    })
    postToHost({ type: 'listFiles', requestId })
  })
}

let sessionRequestId = 0
export const sessions = {
  list: (): Promise<{ sessions: SessionSummary[]; currentPath: string | null }> => {
    const requestId = ++sessionRequestId
    return new Promise((resolve, reject) => {
      const stop = onHostMessage(message => {
        if (message.type !== 'sessions:list' || message.requestId !== requestId) return
        stop()
        if (message.error) reject(new Error(message.error))
        else resolve({ sessions: message.sessions, currentPath: message.currentPath })
      })
      postToHost({ type: 'sessions:list', requestId })
    })
  },
  switch: (path: string): Promise<void> => {
    const requestId = ++sessionRequestId
    return new Promise((resolve, reject) => {
      const stop = onHostMessage(message => {
        if (message.type !== 'sessions:switch' || message.requestId !== requestId) return
        stop()
        if (message.error) reject(new Error(message.error))
        else resolve()
      })
      postToHost({ type: 'sessions:switch', requestId, path })
    })
  },
  onCurrent: (callback: (path: string | null) => void) => onHostMessage(message => { if (message.type === 'sessions:current') callback(message.path) }),
}

let browserRequestId = 0
function browserRequest<T>(method: BrowserMethod, args: { tabId?: string; paused?: boolean } = {}): Promise<T> {
  const requestId = ++browserRequestId
  return new Promise((resolve, reject) => {
    const stop = onHostMessage(message => {
      if (message.type !== 'browserResponse' || message.requestId !== requestId) return
      stop()
      if (message.error) reject(new Error(message.error))
      else resolve(message.result as T)
    })
    postToHost({ type: 'browserRequest', requestId, method, ...args })
  })
}

export const browser = {
  state: () => browserRequest<AgentBrowserState>('state'),
  getExtensionStatus: () => browserRequest<AgentBrowserExtensionStatus>('getExtensionStatus'),
  onChanged: (cb: (state: AgentBrowserState) => void) => onHostMessage(message => { if (message.type === 'browserState') cb(message.state) }),
  onExtensionStatusChanged: (cb: (status: AgentBrowserExtensionStatus) => void) => onHostMessage(message => { if (message.type === 'browserState') cb(message.status) }),
  setActiveSession: (_key: string | null) => browserRequest<void>('setActiveSession'),
  setTabPaused: (_key: string, tabId: string, paused: boolean) => browserRequest<AgentBrowserTabRecord | null>('setTabPaused', { tabId, paused }),
  focusExtensionTab: (_key: string, tabId: string) => browserRequest<boolean>('focusExtensionTab', { tabId }),
  popOutTab: (_key: string, tabId: string) => browserRequest<boolean>('popOutTab', { tabId }),
}

/**
 * pi-desktop components reach the Electron preload through optional `window.prime` calls.
 * Only the calls the reused components make are bridged; everything else stays absent.
 */
export function installPrimeShim() {
  const prime = {
    app: {
      openExternal: async (url: string) => { postToHost({ type: 'openExternal', url }); return true },
      revealPath: async () => false,
      openInVsCode: async () => false,
    },
    projects: { listFiles },
    browser,
  }
  ;(window as unknown as { prime: unknown }).prime = prime
}

/** Mirror the VS Code theme kind onto pi-desktop's `data-theme` switch. */
export function syncTheme() {
  const apply = () => {
    const light = document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light')
    document.documentElement.dataset.theme = light ? 'light' : 'dark'
  }
  apply()
  new MutationObserver(apply).observe(document.body, { attributes: true, attributeFilter: ['class'] })
}
