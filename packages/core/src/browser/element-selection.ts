import type { BrowserAnnotationElement, BrowserAnnotationRect } from '../types/api'
import { parseBrowserSourceHint } from './source'

const MAX_SNIPPET_LENGTH = 2048
const MAX_SELECTOR_LENGTH = 1024
const MAX_URL_LENGTH = 2048
const MAX_CLASS_COUNT = 10
const MAX_CLASS_LENGTH = 120
const MAX_ID_LENGTH = 256
const MAX_TAG_LENGTH = 64
const MAX_COMPONENT_LENGTH = 120

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips control characters from untrusted page text
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g

export interface SharedTabSelectionState {
  url: string
  selection?: BrowserAnnotationElement
  picking?: boolean
}

function boundSingleLine(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  const clean = value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim()
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean
}

function sanitizeRect(raw: unknown): BrowserAnnotationRect {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (value: unknown) => {
    const parsed = typeof value === 'number' ? value : Number.NaN
    return Number.isFinite(parsed) ? Math.round(parsed) : 0
  }
  return { x: num(source.x), y: num(source.y), width: num(source.width), height: num(source.height) }
}

/** Bounds an element payload from the extension picker. Returns null when it is not a usable capture. */
export function sanitizeBrowserElement(raw: unknown): BrowserAnnotationElement | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const selector = boundSingleLine(source.selector, MAX_SELECTOR_LENGTH)
  const tagName = boundSingleLine(source.tagName, MAX_TAG_LENGTH).toLowerCase()
  if (!selector || !tagName) return null
  const classes = Array.isArray(source.classes)
    ? source.classes
        .filter((item): item is string => typeof item === 'string' && item.length > 0)
        .slice(0, MAX_CLASS_COUNT)
        .map((item) => boundSingleLine(item, MAX_CLASS_LENGTH))
    : []
  const href = boundSingleLine(source.href, MAX_URL_LENGTH)
  const src = boundSingleLine(source.src, MAX_URL_LENGTH)
  const sourceHint = parseBrowserSourceHint(source.sourceHint)
  const component = boundSingleLine(source.component, MAX_COMPONENT_LENGTH)
  const captureId = boundSingleLine(source.captureId, 120)
  return {
    ...(captureId ? { captureId } : {}),
    selector,
    tagName,
    id: boundSingleLine(source.id, MAX_ID_LENGTH),
    classes,
    text: boundSingleLine(source.text, MAX_SNIPPET_LENGTH),
    ...(component ? { component } : {}),
    ...(sourceHint ? { sourceHint } : {}),
    ...(href ? { href } : {}),
    ...(src ? { src } : {}),
    rect: sanitizeRect(source.rect),
  }
}

function sameDocument(left: string, right: string): boolean {
  if (left === right) return true
  try {
    const a = new URL(left)
    const b = new URL(right)
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search
  } catch {
    return false
  }
}

/**
 * Applies a shared-tab selection event. A URL change drops the previous element.
 * Returns true when the event was a selection event, including a payload that was rejected.
 */
export function applySharedTabEvent(tab: SharedTabSelectionState, event: Record<string, unknown>): boolean {
  if (typeof event.url === 'string' && event.url !== tab.url) tab.selection = undefined
  if (event.type === 'element_selected') {
    if (typeof event.pageUrl === 'string' && tab.url && !sameDocument(event.pageUrl, tab.url)) return true
    if (event.cleared === true) {
      tab.selection = undefined
      return true
    }
    const element = sanitizeBrowserElement(event.element)
    if (element) tab.selection = element
    return true
  }
  if (event.type === 'tab_picking_changed') {
    if (typeof event.picking !== 'boolean') throw new TypeError('picking must be a boolean')
    tab.picking = event.picking
    return true
  }
  return false
}
