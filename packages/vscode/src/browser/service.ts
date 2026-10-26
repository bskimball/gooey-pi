import { randomBytes } from 'node:crypto'

type WebContents = ReturnType<typeof extensionGuest>

import type { ExtensionBrowserBridge } from 'apex-core/browser/extension-bridge'
import { extensionGuest, PAUSED_MESSAGE } from 'apex-core/browser/extension-tab-driver'
import { ACTION_TIMEOUT_MS, guardGuestCall, QUEUE_RELEASE_GRACE_MS, releaseQueueEventually } from 'apex-core/browser/guest-call-guard'
import { cursorMarkerScript, elementAtPointScript, evaluateScript, pageInfoScript, readPageScript, refPointScript, removeCursorMarkerScript, scrollByScript } from 'apex-core/browser/page-scripts'
import {
  ACTION_REVOKED_MESSAGE,
  CDP_BUTTON_MASKS,
  type CdpKey,
  delay,
  dispatchDrag,
  GLIDE_MAX_MS,
  GLIDE_MIN_MS,
  GLIDE_STEP_MS,
  isAllowedTabUrl,
  LOAD_TIMEOUT_MS,
  MAX_EVALUATE_CHARS,
  MAX_EVALUATE_RESULT_CHARS,
  MAX_READ_ELEMENTS,
  MAX_READ_TEXT_CHARS,
  MAX_SCREENSHOT_BYTES,
  MAX_TABS_PER_SESSION,
  MAX_TABS_TOTAL,
  MAX_TYPE_CHARS,
  type PageInfo,
  PRESS_KEYS,
  PRESS_MODIFIER_BITS,
  parseScriptJson,
  SCREENSHOT_JPEG_QUALITY,
  SETTLE_MS,
  type TabState,
} from 'apex-core/browser/service-support'
import { canonicalSessionPath } from 'apex-core/session-paths'
import { requireString } from 'apex-core/validation'
import type { AgentBrowserState, AgentBrowserTabRecord } from '../../../../apps/desktop/src/types/api'

function jpegDimensions(data: string): { width: number; height: number } {
  const bytes = Buffer.from(data, 'base64')
  if (bytes.readUInt16BE(0) !== 0xffd8) throw new Error('Invalid extension JPEG')
  for (let offset = 2; offset + 8 < bytes.length; ) {
    if (bytes[offset++] !== 0xff) break
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xda || marker === 0xd9) break
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) break
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  throw new Error('Extension JPEG has no image dimensions')
}

export type ScreenshotResizer = (dataUrl: string, width: number, height: number, quality: number) => Promise<string | undefined>

/** Chrome-only port of pi-desktop's action pipeline; no Electron runtime. */
export class ExtensionBrowserService {
  private readonly tabs = new Map<string, TabState>()
  private readonly activeBySession = new Map<string, string>()
  private readonly changeListeners = new Set<(state: AgentBrowserState) => void>()
  private nextGeneration = 1
  private activeSessionKey: string | null = null
  private closed = false
  private readonly actionTimeoutMs = ACTION_TIMEOUT_MS
  private readonly loadTimeoutMs = LOAD_TIMEOUT_MS
  constructor(private readonly options: { extensionBridge: ExtensionBrowserBridge; extensionPath: string; resizeScreenshot?: ScreenshotResizer }) {
    options.extensionBridge.setContext(() => ({ activeSessionKey: this.activeSessionKey, tabs: this.state().tabs }))
    options.extensionBridge.onEvent((event) => this.extensionEvent(event))
  }
  beginShutdown() {
    this.closed = true
    for (const tab of this.tabs.values()) this.releaseTab(tab)
    this.tabs.clear()
    this.changeListeners.clear()
  }
  state(): AgentBrowserState {
    return {
      tabs: [...this.tabs.values()].map((tab) => ({
        backend: 'extension',
        pairedByUser: tab.pairedByUser,
        paused: tab.paused,
        chromeTabId: tab.chromeTabId,
        tabId: tab.tabId,
        sessionFile: tab.sessionKey,
        url: tab.url,
        title: tab.title,
        attached: tab.chromeTabId !== undefined && this.options.extensionBridge.isConnected(),
        active: this.activeBySession.get(tab.sessionKey) === tab.tabId,
        canGoBack: true,
        canGoForward: true,
      })),
    }
  }
  async listTabs(sessionKey: string): Promise<Record<string, unknown>> {
    return {
      tabs: this.state()
        .tabs.filter((tab) => tab.sessionFile === sessionKey)
        .map(({ sessionFile, canGoBack, canGoForward, ...tab }) => tab),
    }
  }
  async openTab(sessionKey: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.requireOpen()
    if (!this.options.extensionBridge.isConnected()) throw new Error('Browser extension is not connected')
    const existing = [...this.tabs.values()].filter((tab) => tab.sessionKey === sessionKey)
    const paired = params.url === undefined && existing.find((tab) => tab.pairedByUser)
    if (paired) {
      this.activeBySession.set(sessionKey, paired.tabId)
      this.push()
      return { ...this.state().tabs.find((tab) => tab.tabId === paired.tabId) }
    }
    if (existing.length >= MAX_TABS_PER_SESSION || this.tabs.size >= MAX_TABS_TOTAL) throw new Error('Close unused browser tabs before opening another')
    const url = params.url === undefined ? '' : requireString(params.url, 'url', { min: 1, max: 2048, trim: true })
    if (url && !isAllowedTabUrl(url)) throw new Error('Only credential-free http(s) URLs can be opened in the Apex browser')
    const tab = this.newTab(sessionKey, url, 'extension')
    try {
      if (url) tab.chromeTabId = await this.createChromeTab(url, sessionKey)
      this.push()
      return { ...this.state().tabs.find((item) => item.tabId === tab.tabId) }
    } catch (error) {
      this.removeTab(tab)
      throw error
    }
  }
  private async createChromeTab(url: string, sessionKey: string): Promise<number> {
    const id = await this.options.extensionBridge.call('create_tab', { url }, sessionKey)
    if (!Number.isSafeInteger(id)) throw new Error('Invalid Chrome tab id')
    return id as number
  }
  async closeTabScoped(sessionKey: string, params: Record<string, unknown>) {
    const tab = this.requireSessionTab(sessionKey, requireString(params.tabId, 'tabId', { min: 1, max: 64 }))
    this.removeTab(tab)
    return this.listTabs(sessionKey)
  }
  async selectTabScoped(sessionKey: string, params: Record<string, unknown>) {
    const tab = this.requireSessionTab(sessionKey, requireString(params.tabId, 'tabId', { min: 1, max: 64 }))
    this.activeBySession.set(sessionKey, tab.tabId)
    this.push()
    return this.listTabs(sessionKey)
  }
  async navigate(sessionKey: string, params: Record<string, unknown>) {
    return this.withTab(sessionKey, params, async (tab, guest) => {
      const url = params.url === undefined ? undefined : requireString(params.url, 'url', { min: 1, max: 2048, trim: true })
      if (url !== undefined && !isAllowedTabUrl(url)) throw new Error('Only credential-free http(s) URLs can be opened in the Apex browser')
      const action = url === undefined ? requireString(params.action, 'action', { min: 1, max: 16 }) : undefined
      if (action !== undefined && !['back', 'forward', 'reload'].includes(action)) throw new TypeError('action must be back, forward, or reload')
      await this.options.extensionBridge.call('navigate', { chromeTabId: tab.chromeTabId, url, action })
      return this.describe(tab, guest)
    })
  }
  async screenshot(sessionKey: string, params: Record<string, unknown>) {
    return this.withTab(sessionKey, params, async (tab, guest) => {
      const info = await this.pageInfo(guest)
      if (info.innerWidth <= 0 || info.innerHeight <= 0) throw new Error('The browser tab has no visible content to capture yet')
      if (tab.pointer) await guest.executeJavaScript(cursorMarkerScript(tab.pointer.x, tab.pointer.y)).catch(() => undefined)
      let data: string
      try {
        let quality = SCREENSHOT_JPEG_QUALITY
        do {
          const result = (await this.options.extensionBridge.call('cdp', {
            chromeTabId: tab.chromeTabId,
            method: 'Page.captureScreenshot',
            params: { format: 'jpeg', quality, captureBeyondViewport: false },
          })) as { data?: unknown }
          if (typeof result?.data !== 'string') throw new Error('Invalid extension screenshot')
          data = result.data
          const size = jpegDimensions(data)
          if (Math.abs(size.width - info.innerWidth) > 1 || Math.abs(size.height - info.innerHeight) > 1) {
            try {
              const resized = await this.options.resizeScreenshot?.(`data:image/jpeg;base64,${data}`, info.innerWidth, info.innerHeight, quality / 100)
              if (resized) {
                const dimensions = jpegDimensions(resized)
                if (dimensions.width === info.innerWidth && dimensions.height === info.innerHeight) data = resized
              }
            } catch {
              /* Without a working webview resizer, retain the original image and its true pixel dimensions. */
            }
          }
          if (Buffer.byteLength(data, 'base64') <= MAX_SCREENSHOT_BYTES || quality <= 30) break
          quality -= 20
        } while (quality >= 30)
      } finally {
        if (tab.pointer) await guest.executeJavaScript(removeCursorMarkerScript()).catch(() => undefined)
      }
      return { ...(await this.describe(tab, guest)), mimeType: 'image/jpeg', data, ...jpegDimensions(data) }
    })
  }
  private async withTab(sessionKey: string, params: Record<string, unknown>, action: (tab: TabState, guest: WebContents) => Promise<Record<string, unknown>>) {
    this.requireOpen()
    const id = params.tabId === undefined ? this.activeBySession.get(sessionKey) : requireString(params.tabId, 'tabId', { min: 1, max: 64 })
    if (!id) throw new Error('This thread has no browser tab yet. Open one with browser_tabs {"action":"open"} first.')
    const tab = this.requireSessionTab(sessionKey, id)
    const generation = tab.generation
    const check = () => {
      if (tab.paused) throw new Error(PAUSED_MESSAGE)
      if (this.closed || tab.revoked || tab.generation !== generation || this.tabs.get(id) !== tab || tab.sessionKey !== sessionKey) throw new Error(ACTION_REVOKED_MESSAGE)
    }
    check()
    const run = tab.serial.tail.then(async () => {
      check()
      if (tab.chromeTabId === undefined && typeof params.url === 'string') {
        if (!isAllowedTabUrl(params.url)) throw new Error('Only credential-free http(s) URLs can be opened in the Apex browser')
        tab.chromeTabId = await this.createChromeTab(params.url, sessionKey)
        tab.url = params.url
        this.push()
      }
      check()
      if (tab.chromeTabId === undefined) throw new Error('Navigate this pending tab to a URL first')
      if (!this.options.extensionBridge.isConnected()) throw new Error('Browser extension is not connected')
      const guest = extensionGuest(this.options.extensionBridge, tab, () => {
        throw new Error('Use CDP screenshots')
      })
      return action(tab, guest)
    })
    tab.serial.tail = releaseQueueEventually(run, this.actionTimeoutMs + QUEUE_RELEASE_GRACE_MS)
    return run
  }

  getExtensionStatus() {
    return {
      connected: this.options.extensionBridge?.isConnected() ?? false,
      extensionPath: this.options.extensionPath ?? '',
      bridgePort: this.options.extensionBridge?.port ?? null,
      activeSessionKey: this.activeSessionKey,
      pairedTabCount: [...this.tabs.values()].filter((tab) => tab.chromeTabId !== undefined).length,
    }
  }

  onExtensionStatusChanged(listener: (status: ReturnType<ExtensionBrowserService['getExtensionStatus']>) => void): () => void {
    const notify = () => listener(this.getExtensionStatus())
    const off = this.options.extensionBridge?.onChanged(notify)
    const offTabs = this.onDidChange(notify)
    return () => {
      off?.()
      offTabs()
    }
  }

  async refreshExtensionState(): Promise<void> {
    await this.options.extensionBridge.refreshState()
  }
  async setActiveSession(value: unknown): Promise<void> {
    this.activeSessionKey = value === null ? null : canonicalSessionPath(requireString(value, 'sessionKey', { min: 1, max: 4096 }))
    await this.options.extensionBridge.setActiveSession(this.activeSessionKey)
    if (this.options.extensionBridge?.isConnected())
      await this.options.extensionBridge.call('sync_tab_state', {
        activeSessionKey: this.activeSessionKey,
        tabs: this.state().tabs,
      })
    this.push()
  }

  async setTabPaused(session: string, id: string, paused: unknown): Promise<AgentBrowserTabRecord | null> {
    if (typeof paused !== 'boolean') throw new TypeError('paused must be a boolean')
    const tab = this.requireSessionTab(canonicalSessionPath(session), id)
    if (tab.backend !== 'extension') return null
    tab.paused = paused
    tab.generation = this.nextGeneration++
    this.push()
    await this.options.extensionBridge?.call('sync_tab_state', {
      chromeTabId: tab.chromeTabId,
      paused,
    })
    return this.state().tabs.find((item) => item.tabId === id) ?? null
  }

  async focusExtensionTab(session: string, id: string): Promise<boolean> {
    const tab = this.requireSessionTab(canonicalSessionPath(session), id)
    if (tab.chromeTabId === undefined) return false
    await this.options.extensionBridge?.call('focus_tab', {
      chromeTabId: tab.chromeTabId,
    })
    return true
  }

  private extensionEvent(event: Record<string, unknown>): void {
    this.requireOpen()
    if (!Number.isSafeInteger(event.chromeTabId)) throw new TypeError('chromeTabId must be an integer')
    let tab = [...this.tabs.values()].find((item) => item.chromeTabId === event.chromeTabId)
    if (event.type === 'tab_paired') {
      const session = event.sessionKey ?? this.activeSessionKey
      if (typeof session !== 'string') throw new Error('Select a thread in Apex before sharing this tab')
      const serial = tab?.serial
      if (tab) {
        tab.pairedByUser = true
        this.removeTab(tab)
      }
      tab = this.newTab(canonicalSessionPath(session), typeof event.url === 'string' ? event.url : '', 'extension')
      tab.chromeTabId = event.chromeTabId as number
      if (serial) tab.serial = serial
      tab.pairedByUser = true
    }
    if (!tab) return
    if (event.type === 'tab_closed' || event.type === 'tab_unpaired') {
      tab.pairedByUser = true
      this.removeTab(tab)
      return
    }
    if (typeof event.url === 'string') tab.url = event.url
    if (typeof event.title === 'string') tab.title = event.title
    if (event.type === 'tab_pause_changed') {
      if (typeof event.paused !== 'boolean') throw new TypeError('paused must be a boolean')
      tab.paused = event.paused
      tab.generation = this.nextGeneration++
    }
    this.push()
  }

  private newTab(sessionKey: string, url: string, backend: 'webview' | 'extension'): TabState {
    const tab: TabState = {
      tabId: `bt-${randomBytes(6).toString('hex')}`,
      sessionKey,
      url,
      backend,
      webContentsId: null,
      title: '',
      pointer: null,
      generation: this.nextGeneration++,
      revoked: false,
      serial: { tail: Promise.resolve() },
      attachWaiters: [],
      unbindGuest: null,
    }
    this.tabs.set(tab.tabId, tab)
    this.activeBySession.set(sessionKey, tab.tabId)
    return tab
  }

  onDidChange(listener: (state: AgentBrowserState) => void): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  async click(sessionKey: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.withTab(sessionKey, params, async (tab, guest) => {
      if (params.glide !== undefined && typeof params.glide !== 'boolean') throw new TypeError('glide must be a boolean')
      const point = await this.resolvePoint(guest, params, false)
      const button = params.button === undefined ? 'left' : requireString(params.button, 'button', { min: 1, max: 8 })
      if (!['left', 'right', 'middle'].includes(button)) throw new TypeError('button must be left, right, or middle')
      const clickCount = params.double === true ? 2 : 1
      guest.focus()
      await this.glidePointer(tab, guest, point, params.glide === false)
      // Hovering along the glide can shift layout (menus, sticky headers);
      // for ref clicks re-resolve the element position before pressing.
      let target = point
      if (params.ref !== undefined && params.glide !== false) {
        try {
          target = await this.resolvePoint(guest, params, false)
          tab.pointer = { ...target }
        } catch {
          /* the pre-glide point remains the best estimate */
        }
      }
      const hit = await this.elementAt(guest, target)
      for (let press = 0; press < clickCount; press += 1) {
        await this.dispatchInput(guest, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: target.x,
          y: target.y,
          button,
          buttons: CDP_BUTTON_MASKS[button],
          clickCount: press + 1,
        })
        await this.dispatchInput(guest, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: target.x,
          y: target.y,
          button,
          buttons: 0,
          clickCount: press + 1,
        })
      }
      // A click may start a navigation; give the page a moment before reporting.
      await delay(SETTLE_MS)
      await this.waitForLoad(guest, 2_000)
      return {
        ...(await this.describe(tab, guest)),
        clicked: hit ?? undefined,
      }
    })
  }

  async drag(sessionKey: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.withTab(sessionKey, params, async (tab, guest) => {
      const from = await this.resolvePoint(guest, params, false)
      const to = await this.resolvePoint(guest, { ref: params.to_ref, x: params.to_x, y: params.to_y }, false, false)
      const steps = params.steps ?? 12
      if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 1 || steps > 50) throw new TypeError('steps must be an integer from 1 to 50')
      const button = params.button ?? 'left'
      if (typeof button !== 'string' || !['left', 'right', 'middle'].includes(button)) throw new TypeError('button must be left, right, or middle')
      guest.focus()
      await dispatchDrag((event) => this.dispatchInput(guest, 'Input.dispatchMouseEvent', event), from, to, steps, button)
      tab.pointer = { ...to }
      return this.describe(tab, guest)
    })
  }

  async type(sessionKey: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.withTab(sessionKey, params, async (tab, guest) => {
      if (params.glide !== undefined && typeof params.glide !== 'boolean') throw new TypeError('glide must be a boolean')
      const text = requireString(params.text, 'text', {
        min: 0,
        max: MAX_TYPE_CHARS,
      })
      if (params.ref !== undefined) {
        const point = await this.resolvePoint(guest, params, true)
        await this.glidePointer(tab, guest, point, params.glide === false)
      }
      guest.focus()
      try {
        await this.dispatchInput(guest, 'Input.insertText', { text })
      } catch {
        await guest.insertText(text)
      }
      if (params.submit === true) {
        await delay(50)
        await this.sendKey(guest, PRESS_KEYS.enter, [])
        await delay(SETTLE_MS)
        await this.waitForLoad(guest, 2_000)
      }
      return this.describe(tab, guest)
    })
  }

  async pressKey(sessionKey: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.withTab(sessionKey, params, async (tab, guest) => {
      const rawKey = requireString(params.key, 'key', {
        min: 1,
        max: 24,
        trim: true,
      })
      const key =
        rawKey.length === 1
          ? {
              key: rawKey,
              code: '',
              keyCode: rawKey.toUpperCase().charCodeAt(0),
              text: rawKey,
            }
          : PRESS_KEYS[rawKey.toLowerCase()]
      if (!key) throw new TypeError(`key must be a single character or one of: ${Object.keys(PRESS_KEYS).join(', ')}`)
      const modifiers: string[] = []
      if (params.modifiers !== undefined) {
        if (!Array.isArray(params.modifiers)) throw new TypeError('modifiers must be an array')
        for (const modifier of params.modifiers.slice(0, 4)) {
          const name = requireString(modifier, 'modifier', {
            min: 1,
            max: 12,
            trim: true,
          }).toLowerCase()
          if (PRESS_MODIFIER_BITS[name] === undefined) throw new TypeError('modifiers may only include shift, control, alt, meta')
          modifiers.push(name)
        }
      }
      const repeat = params.repeat ?? 1
      if (typeof repeat !== 'number' || !Number.isInteger(repeat) || repeat < 1 || repeat > 200) throw new TypeError('repeat must be an integer from 1 to 200')
      guest.focus()
      for (let n = 0; n < repeat; n += 1) await this.sendKey(guest, key, modifiers)
      if (key.key === 'Enter' || key.key === ' ' || modifiers.length > 0) {
        await delay(SETTLE_MS)
        await this.waitForLoad(guest, 2_000)
      }
      return this.describe(tab, guest)
    })
  }

  async scroll(sessionKey: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.withTab(sessionKey, params, async (tab, guest) => {
      const direction = requireString(params.direction, 'direction', {
        min: 1,
        max: 8,
        trim: true,
      })
      if (!['up', 'down', 'left', 'right'].includes(direction)) throw new TypeError('direction must be up, down, left, or right')
      let amount = 600
      if (params.amount !== undefined) {
        if (!Number.isSafeInteger(params.amount) || (params.amount as number) < 1 || (params.amount as number) > 20_000) throw new TypeError('amount must be an integer between 1 and 20000 pixels')
        amount = params.amount as number
      }
      const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0
      const deltaY = direction === 'up' ? -amount : direction === 'down' ? amount : 0
      if (Number.isSafeInteger(params.x) && Number.isSafeInteger(params.y)) {
        // A wheel event at a point reaches nested scroll containers that
        // window.scrollBy cannot; CDP wheel deltas follow DOM semantics
        // (positive scrolls down/right).
        await this.glidePointer(tab, guest, { x: params.x as number, y: params.y as number })
        await this.dispatchInput(guest, 'Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: params.x as number,
          y: params.y as number,
          deltaX,
          deltaY,
        })
        await delay(SETTLE_MS)
        return this.describe(tab, guest)
      }
      const payload = await this.runPageScript(guest, scrollByScript(deltaX, deltaY), 'scroll')
      return { ...(await this.describe(tab, guest)), ...payload }
    })
  }

  async readPage(sessionKey: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.withTab(sessionKey, params, async (_tab, guest) => {
      const mode = params.mode === undefined ? 'interactive' : requireString(params.mode, 'mode', { min: 1, max: 16, trim: true })
      if (mode !== 'interactive' && mode !== 'text') throw new TypeError('mode must be interactive or text')
      return this.runPageScript(guest, readPageScript(mode, MAX_READ_TEXT_CHARS, MAX_READ_ELEMENTS), 'read_page')
    })
  }

  async evaluate(sessionKey: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.withTab(sessionKey, params, async (_tab, guest) => {
      const code = requireString(params.code, 'code', {
        min: 1,
        max: MAX_EVALUATE_CHARS,
      })
      return this.runPageScript(guest, evaluateScript(code, MAX_EVALUATE_RESULT_CHARS), 'evaluate')
    })
  }

  private requireOpen(): void {
    if (this.closed) throw new Error('Apex is shutting down')
  }

  private requireSessionTab(sessionKey: string, tabId: string): TabState {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.sessionKey !== sessionKey) throw new Error('That browser tab does not belong to this thread')
    return tab
  }

  private async runPageScript(guest: WebContents, script: string, label: string): Promise<Record<string, unknown>> {
    return parseScriptJson(await guardGuestCall(guest, guest.executeJavaScript(script), this.actionTimeoutMs), label)
  }

  private revokeTab(tab: TabState): void {
    if (tab.revoked) return
    tab.revoked = true
    tab.generation = this.nextGeneration++
    for (const waiter of tab.attachWaiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(ACTION_REVOKED_MESSAGE))
    }
  }

  private releaseTab(tab: TabState): void {
    this.revokeTab(tab)
    tab.unbindGuest?.()
    tab.unbindGuest = null
  }

  private removeTab(tab: TabState): void {
    if (tab.chromeTabId !== undefined && !tab.pairedByUser) void this.options.extensionBridge?.call('close_tab', { chromeTabId: tab.chromeTabId }).catch(() => undefined)
    this.releaseTab(tab)
    this.tabs.delete(tab.tabId)
    if (this.activeBySession.get(tab.sessionKey) === tab.tabId) {
      const fallback = [...this.tabs.values()].find((candidate) => candidate.sessionKey === tab.sessionKey)
      if (fallback) this.activeBySession.set(tab.sessionKey, fallback.tabId)
      else this.activeBySession.delete(tab.sessionKey)
    }
    if (tab.chromeTabId !== undefined && tab.pairedByUser) void this.options.extensionBridge?.call('release_tab', { chromeTabId: tab.chromeTabId }).catch(() => undefined)
    this.push()
  }

  private waitForLoad(guest: WebContents, timeoutMs = this.loadTimeoutMs): Promise<void> {
    if (!guest.isLoading()) return Promise.resolve()
    return new Promise((resolveLoad) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        guest.removeListener('did-stop-loading', onStop)
        clearTimeout(timer)
        void delay(SETTLE_MS).then(resolveLoad)
      }
      const onStop = () => finish()
      const timer = setTimeout(finish, timeoutMs)
      timer.unref?.()
      guest.once('did-stop-loading', onStop)
    })
  }

  private async pageInfo(guest: WebContents): Promise<PageInfo> {
    const payload = await this.runPageScript(guest, pageInfoScript(), 'page info')
    return {
      url: typeof payload.url === 'string' ? payload.url : guest.getURL(),
      title: typeof payload.title === 'string' ? payload.title : '',
      innerWidth: Number.isSafeInteger(payload.innerWidth) ? (payload.innerWidth as number) : 0,
      innerHeight: Number.isSafeInteger(payload.innerHeight) ? (payload.innerHeight as number) : 0,
      scrollY: Number.isSafeInteger(payload.scrollY) ? (payload.scrollY as number) : 0,
      scrollHeight: Number.isSafeInteger(payload.scrollHeight) ? (payload.scrollHeight as number) : 0,
      readyState: typeof payload.readyState === 'string' ? payload.readyState : 'unknown',
    }
  }

  private async describe(tab: TabState, guest: WebContents): Promise<Record<string, unknown>> {
    const info = guest.isDestroyed() ? null : await this.pageInfo(guest).catch(() => null)
    tab.url = info?.url ?? tab.url
    tab.title = info?.title ?? tab.title
    this.push()
    return {
      url: tab.url,
      title: tab.title,
      viewport: info ? { width: info.innerWidth, height: info.innerHeight } : undefined,
      pointer: tab.pointer ? { ...tab.pointer } : undefined,
    }
  }

  private async elementAt(guest: WebContents, point: { x: number; y: number }): Promise<Record<string, unknown> | null> {
    try {
      const payload = await this.runPageScript(guest, elementAtPointScript(point.x, point.y), 'element at point')
      return typeof payload.tag === 'string'
        ? {
            tag: payload.tag,
            name: typeof payload.name === 'string' ? payload.name : '',
          }
        : null
    } catch {
      return null
    }
  }

  private async resolvePoint(guest: WebContents, params: Record<string, unknown>, focus: boolean, scroll = true): Promise<{ x: number; y: number }> {
    if (params.ref !== undefined) {
      if (!Number.isSafeInteger(params.ref) || (params.ref as number) < 0 || (params.ref as number) > 999) throw new TypeError('ref must be an element number from browser_read_page')
      const payload = await this.runPageScript(guest, refPointScript(params.ref as number, focus, scroll), 'element ref')
      if (typeof payload.error === 'string') throw new Error(payload.error.slice(0, 300))
      if (!Number.isSafeInteger(payload.x) || !Number.isSafeInteger(payload.y)) throw new Error('The element position could not be determined')
      return { x: payload.x as number, y: payload.y as number }
    }
    if (typeof params.x !== 'number' || !Number.isFinite(params.x) || typeof params.y !== 'number' || !Number.isFinite(params.y))
      throw new TypeError('Provide either ref (from browser_read_page) or x and y coordinates')
    const x = params.x as number
    const y = params.y as number
    if (x < 0 || y < 0 || x > 20_000 || y > 20_000) throw new TypeError('x and y must be within the page viewport')
    return { x: Math.round(x), y: Math.round(y) }
  }

  private async glidePointer(tab: TabState, guest: WebContents, to: { x: number; y: number }, instant = false): Promise<void> {
    const from = tab.pointer
    const distance = from ? Math.hypot(to.x - from.x, to.y - from.y) : 0
    const durationMs = !instant && from && distance > 2 ? Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, Math.round(distance * 0.9))) : 0
    if (from && durationMs > 0) {
      const steps = Math.min(18, Math.max(5, Math.round(durationMs / GLIDE_STEP_MS)))
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps
        const eased = progress * progress * (3 - 2 * progress)
        await this.dispatchInput(guest, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: Math.round(from.x + (to.x - from.x) * eased),
          y: Math.round(from.y + (to.y - from.y) * eased),
        })
        await delay(durationMs / steps)
      }
    } else {
      await this.dispatchInput(guest, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: to.x,
        y: to.y,
      })
    }
    tab.pointer = { x: to.x, y: to.y }
  }

  private async dispatchInput(guest: WebContents, method: string, params: Record<string, unknown>): Promise<void> {
    if (!guest.debugger.isAttached()) guest.debugger.attach('1.3')
    await guest.debugger.sendCommand(method, params)
  }

  private async sendKey(guest: WebContents, key: CdpKey, modifiers: string[]): Promise<void> {
    const bits = modifiers.reduce((mask, name) => mask | (PRESS_MODIFIER_BITS[name] ?? 0), 0)
    const base = {
      modifiers: bits,
      key: key.key,
      code: key.code,
      windowsVirtualKeyCode: key.keyCode,
      nativeVirtualKeyCode: key.keyCode,
    }
    // A key with text uses keyDown so the page also receives the character;
    // keys without text (arrows, tab) and chorded shortcuts (ctrl/alt/meta
    // held) use rawKeyDown.
    const chorded = (bits & (PRESS_MODIFIER_BITS.alt | PRESS_MODIFIER_BITS.control | PRESS_MODIFIER_BITS.meta)) !== 0
    if (key.text && !chorded)
      await this.dispatchInput(guest, 'Input.dispatchKeyEvent', {
        ...base,
        type: 'keyDown',
        text: key.text,
      })
    else
      await this.dispatchInput(guest, 'Input.dispatchKeyEvent', {
        ...base,
        type: 'rawKeyDown',
      })
    await this.dispatchInput(guest, 'Input.dispatchKeyEvent', {
      ...base,
      type: 'keyUp',
    })
  }

  private push(): void {
    if (this.closed) return
    const snapshot = this.state()
    for (const listener of this.changeListeners) {
      try {
        listener(snapshot)
      } catch {
        /* one bad listener must not break the rest */
      }
    }
  }
}
