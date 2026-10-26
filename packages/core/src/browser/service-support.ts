import { requireRecord } from '../validation'
import type { ExtensionBrowserBridge } from './extension-bridge'
import type { NativeImageLike, WebContentsLike } from './web-contents'

export const MAX_TABS_PER_SESSION = 6
export const MAX_TABS_TOTAL = 24
export const ATTACH_TIMEOUT_MS = 15_000
export const LOAD_TIMEOUT_MS = 20_000
export const SETTLE_MS = 150
export const MAX_TYPE_CHARS = 8_000
export const MAX_EVALUATE_CHARS = 16_000
export const MAX_EVALUATE_RESULT_CHARS = 20_000
export const MAX_READ_TEXT_CHARS = 40_000
export const MAX_READ_ELEMENTS = 300
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024
export const SCREENSHOT_JPEG_QUALITY = 70
export const ACTION_REVOKED_MESSAGE = 'Browser tab access changed before this action could start'
export const GLIDE_MAX_MS = 550
export const GLIDE_MIN_MS = 160
export const GLIDE_STEP_MS = 28
export interface CdpKey {
  key: string
  code: string
  keyCode: number
  text?: string
}
export interface TabActionSerial {
  tail: Promise<unknown>
}
export const PRESS_KEYS: Record<string, CdpKey> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
}
export const PRESS_MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  control: 2,
  meta: 4,
  shift: 8,
}
export const CDP_BUTTON_MASKS: Record<string, number> = {
  left: 1,
  right: 2,
  middle: 4,
}
export interface TabState {
  backend?: 'webview' | 'extension'
  chromeTabId?: number
  pairedByUser?: boolean
  paused?: boolean
  tabId: string
  sessionKey: string
  webContentsId: number | null
  url: string
  title: string
  pointer: { x: number; y: number } | null
  generation: number
  revoked: boolean
  serial: TabActionSerial
  attachWaiters: Array<{
    resolve(): void
    reject(error: Error): void
    timer: NodeJS.Timeout
  }>
  unbindGuest: (() => void) | null
}
export interface PageInfo {
  url: string
  title: string
  innerWidth: number
  innerHeight: number
  scrollY: number
  scrollHeight: number
  readyState: string
}
export interface AgentBrowserServiceOptions {
  getGuest(webContentsId: number): WebContentsLike | undefined
  extensionBridge?: ExtensionBrowserBridge
  extensionPath?: string
  imageFromDataURL?: (url: string) => NativeImageLike
  attachTimeoutMs?: number
  loadTimeoutMs?: number
  actionTimeoutMs?: number
}
export function isAllowedTabUrl(raw: string): boolean {
  if (raw === 'about:blank') return true
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}
export function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    const timer = setTimeout(resolveDelay, ms)
    timer.unref?.()
  })
}
export async function dispatchDrag(
  dispatch: (params: Record<string, unknown>) => Promise<unknown>,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
  button: string,
): Promise<void> {
  await dispatch({ type: 'mouseMoved', ...from })
  await dispatch({ type: 'mousePressed', ...from, button, buttons: CDP_BUTTON_MASKS[button], clickCount: 1 })
  for (let step = 1; step <= steps; step += 1) {
    await dispatch({
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * step) / steps),
      y: Math.round(from.y + ((to.y - from.y) * step) / steps),
      button,
      buttons: CDP_BUTTON_MASKS[button],
    })
  }
  await dispatch({ type: 'mouseReleased', ...to, button, buttons: 0, clickCount: 1 })
}
export function parseScriptJson(payload: unknown, label: string): Record<string, unknown> {
  if (typeof payload !== 'string') throw new Error(`The page did not respond to ${label}. It may still be loading; try again.`)
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    throw new Error(`The page returned malformed data for ${label}.`)
  }
  return requireRecord(parsed, label)
}
export function logNavigationFailure(url: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('ERR_ABORTED')) return
  console.warn(`Apex browser could not load ${url}: ${message}`)
}
