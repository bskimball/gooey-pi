import { randomUUID } from 'node:crypto'
import type { BrowserWindow, WebContents } from 'electron'

// Only the verified main-frame IPC caller receives this single-use window name.
const requests = new WeakMap<WebContents, string>()

export function prepareInspectorWindow(owner: WebContents): string {
  const name = `apex-inspector-${randomUUID()}`
  requests.set(owner, name)
  return name
}

export function enableInspectorWindow(owner: BrowserWindow, harden: (child: BrowserWindow) => void, hidden: boolean): void {
  const contents = owner.webContents
  let child: BrowserWindow | undefined
  contents.setWindowOpenHandler(({ url, frameName, features }) => {
    if (child || url !== 'about:blank' || features || requests.get(contents) !== frameName) return { action: 'deny' }
    requests.delete(contents)
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        title: 'Inspector', width: 600, height: Math.min(820, owner.getBounds().height),
        minWidth: 400, minHeight: 320, frame: true, titleBarStyle: 'default', titleBarOverlay: false,
        autoHideMenuBar: true, show: !hidden,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: true },
      },
    }
  })
  contents.on('did-create-window', (window) => {
    child = window
    harden(window)
    window.setMenu(null)
    window.webContents.setZoomFactor(contents.getZoomFactor())
    window.once('closed', () => { child = undefined })
  })
  const dispose = () => {
    requests.delete(contents)
    if (child && !child.isDestroyed()) child.destroy()
  }
  owner.on('closed', dispose)
  owner.on('hide', () => child?.close())
  contents.on('render-process-gone', dispose)
  contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) dispose()
  })
}
