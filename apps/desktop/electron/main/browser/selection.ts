import type { NativeImage, Rectangle, WebContents } from 'electron'
import type { ExtensionBrowserBridge } from 'apex-core/browser/extension-bridge'
import { extensionGuest } from 'apex-core/browser/extension-tab-driver'
import { guardGuestCall } from 'apex-core/browser/guest-call-guard'
import { parseScriptJson, SCREENSHOT_JPEG_QUALITY, type TabState } from 'apex-core/browser/service-support'
import { requireString } from 'apex-core/validation'
import type { PromptImage } from '../../../src/types/api'

const MAX_SELECTOR_LENGTH = 1024
const MAX_URL_LENGTH = 2048
const CROP_PADDING_PX = 16
const MAX_PREVIEW_DIMENSION = 720
const MAX_PREVIEW_BYTES = 180 * 1024

export interface SelectionActionHost {
  readonly extensionBridge?: ExtensionBrowserBridge
  readonly imageFromDataURL?: (url: string) => NativeImage
  readonly actionTimeoutMs: number
  waitForWebviewGuest(tab: TabState): Promise<WebContents>
  push(): void
}

export function sameDocument(left: string, right: string): boolean {
  if (left === right) return true
  try {
    const a = new URL(left)
    const b = new URL(right)
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search
  } catch {
    return false
  }
}

async function resolveUserGuest(tab: TabState, host: SelectionActionHost): Promise<WebContents> {
  if (tab.backend === 'extension') {
    if (tab.chromeTabId === undefined) throw new Error('Navigate this pending tab to a URL first')
    const bridge = host.extensionBridge
    if (!bridge?.isConnected()) throw new Error('Browser extension is not connected')
    // User selection actions are deliberate and must work while the tab is paused.
    const unpausedTab = {
      chromeTabId: tab.chromeTabId,
      paused: false,
      url: tab.url,
      title: tab.title,
    }
    return extensionGuest(
      bridge,
      unpausedTab,
      host.imageFromDataURL ??
        (() => {
          throw new Error('Screenshot decoder is unavailable')
        }),
    ) as unknown as WebContents
  }
  return host.waitForWebviewGuest(tab)
}

async function runUserScript(tab: TabState, guest: WebContents, host: SelectionActionHost, script: string, label: string): Promise<Record<string, unknown>> {
  if (tab.backend === 'extension') {
    const raw = await host.extensionBridge?.call('read_page', {
      chromeTabId: tab.chromeTabId,
      script,
    })
    return parseScriptJson(raw, label)
  }
  return parseScriptJson(await guardGuestCall(guest, guest.executeJavaScript(script), host.actionTimeoutMs), label)
}

function captureElementRectScript(selector: string): string {
  return `(() => {
		const url = String(location.href).slice(0, 2048);
		const innerWidth = Math.round(window.innerWidth || 0);
		const innerHeight = Math.round(window.innerHeight || 0);
		let el = null;
		try {
			el = document.querySelector(${JSON.stringify(selector)});
		} catch {
			return JSON.stringify({ url, innerWidth, innerHeight, found: false });
		}
		if (!el || !el.isConnected) return JSON.stringify({ url, innerWidth, innerHeight, found: false });
		const rect = el.getBoundingClientRect();
		return JSON.stringify({
			url,
			innerWidth,
			innerHeight,
			found: true,
			x: Math.round(rect.left),
			y: Math.round(rect.top),
			width: Math.round(rect.width),
			height: Math.round(rect.height),
		});
	})()`
}

function revealElementScript(selector: string, pageUrl: string): string {
  return `(() => {
		const sameDoc = (left, right) => {
			if (left === right) return true;
			try {
				const a = new URL(left);
				const b = new URL(right);
				return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
			} catch {
				return false;
			}
		};
		const url = String(location.href).slice(0, 2048);
		if (!sameDoc(url, ${JSON.stringify(pageUrl)})) return JSON.stringify({ url, found: false });
		let el = null;
		try {
			el = document.querySelector(${JSON.stringify(selector)});
		} catch {
			return JSON.stringify({ url, found: false });
		}
		if (!el || !el.isConnected) return JSON.stringify({ url, found: false });
		el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
		const rect = el.getBoundingClientRect();
		let ring = document.getElementById('__apexRevealOutline');
		if (ring) ring.remove();
		ring = document.createElement('div');
		ring.id = '__apexRevealOutline';
		ring.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #2488ff;background:rgba(36,136,255,.14);box-shadow:0 0 0 3px rgba(36,136,255,.22);border-radius:3px;transition:opacity 180ms ease-out;';
		ring.style.left = Math.round(rect.left - 2) + 'px';
		ring.style.top = Math.round(rect.top - 2) + 'px';
		ring.style.width = Math.max(0, Math.round(rect.width + 4)) + 'px';
		ring.style.height = Math.max(0, Math.round(rect.height + 4)) + 'px';
		if (document.documentElement) document.documentElement.appendChild(ring);
		setTimeout(() => {
			if (ring.isConnected) ring.remove();
		}, 1600);
		return JSON.stringify({ url, found: true });
	})()`
}

export function clampCropBounds(rect: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }, padding = CROP_PADDING_PX): Rectangle | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null
  if (rect.width <= 0 || rect.height <= 0) return null
  const left = Math.max(0, Math.floor(rect.x - padding))
  const top = Math.max(0, Math.floor(rect.y - padding))
  const right = Math.min(viewport.width, Math.ceil(rect.x + rect.width + padding))
  const bottom = Math.min(viewport.height, Math.ceil(rect.y + rect.height + padding))
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return null
  return { x: left, y: top, width, height }
}

export async function captureSelectionImage(tab: TabState, host: SelectionActionHost, pageUrlValue: unknown, selectorValue: unknown): Promise<PromptImage> {
  const pageUrl = requireString(pageUrlValue, 'pageUrl', {
    min: 1,
    max: MAX_URL_LENGTH,
    trim: true,
  })
  const selector = requireString(selectorValue, 'selector', {
    min: 1,
    max: MAX_SELECTOR_LENGTH,
    trim: true,
  })
  if (tab.url && !sameDocument(tab.url, pageUrl)) throw new Error('The page navigated before the element could be captured')
  const guest = await resolveUserGuest(tab, host)
  const payload = await runUserScript(tab, guest, host, captureElementRectScript(selector), 'capture selection')
  const currentUrl = typeof payload.url === 'string' ? payload.url : guest.getURL()
  if (!sameDocument(currentUrl, pageUrl)) throw new Error('The page navigated before the element could be captured')
  if (payload.found !== true) throw new Error('The selected element is no longer on the page')
  const innerWidth = typeof payload.innerWidth === 'number' && Number.isFinite(payload.innerWidth) ? Math.round(payload.innerWidth) : 0
  const innerHeight = typeof payload.innerHeight === 'number' && Number.isFinite(payload.innerHeight) ? Math.round(payload.innerHeight) : 0
  const rect = {
    x: typeof payload.x === 'number' ? payload.x : 0,
    y: typeof payload.y === 'number' ? payload.y : 0,
    width: typeof payload.width === 'number' ? payload.width : 0,
    height: typeof payload.height === 'number' ? payload.height : 0,
  }
  let image = await guardGuestCall(guest, guest.capturePage(undefined, { stayHidden: true, stayAwake: true }), host.actionTimeoutMs)
  if (tab.url && !sameDocument(tab.url, pageUrl)) throw new Error('The page navigated before the element could be captured')
  const size = image.getSize()
  if (!size.width || !size.height) throw new Error('The browser tab has no visible content to capture yet')
  const targetWidth = innerWidth > 0 ? Math.min(innerWidth, size.width) : size.width
  const targetHeight = innerHeight > 0 ? Math.min(innerHeight, size.height) : size.height
  if (targetWidth !== size.width || targetHeight !== size.height) {
    image = image.resize({ width: targetWidth, height: targetHeight })
  }
  const normalizedSize = image.getSize()
  const viewport = {
    width: normalizedSize.width || targetWidth,
    height: normalizedSize.height || targetHeight,
  }
  const cropRect = clampCropBounds(rect, viewport)
  if (!cropRect) throw new Error('The selected element is outside the visible viewport')
  image = image.crop(cropRect)
  const croppedSize = image.getSize()
  const cropWidth = croppedSize.width || cropRect.width
  const cropHeight = croppedSize.height || cropRect.height
  const longest = Math.max(cropWidth, cropHeight)
  if (longest > MAX_PREVIEW_DIMENSION) {
    const scale = MAX_PREVIEW_DIMENSION / longest
    image = image.resize({
      width: Math.max(1, Math.round(cropWidth * scale)),
      height: Math.max(1, Math.round(cropHeight * scale)),
    })
  }
  let quality = SCREENSHOT_JPEG_QUALITY
  let buffer = image.toJPEG(quality)
  while (buffer.byteLength > MAX_PREVIEW_BYTES && quality > 30) {
    quality -= 15
    buffer = image.toJPEG(quality)
  }
  if (buffer.byteLength > MAX_PREVIEW_BYTES) throw new Error('The element preview is too large. Select a smaller region.')
  const finalPage = await runUserScript(tab, guest, host, 'JSON.stringify({ url: location.href })', 'verify capture page')
  if (typeof finalPage.url !== 'string' || !sameDocument(finalPage.url, pageUrl)) throw new Error('The page navigated while the element was being captured')
  return {
    type: 'image',
    mimeType: 'image/jpeg',
    data: buffer.toString('base64'),
  }
}

export async function revealSelectedElement(tab: TabState, host: SelectionActionHost, pageUrlValue: unknown, selectorValue: unknown): Promise<boolean> {
  const pageUrl = requireString(pageUrlValue, 'pageUrl', {
    min: 1,
    max: MAX_URL_LENGTH,
    trim: true,
  })
  const selector = requireString(selectorValue, 'selector', {
    min: 1,
    max: MAX_SELECTOR_LENGTH,
    trim: true,
  })
  if (tab.url && !sameDocument(tab.url, pageUrl)) return false
  let guest: WebContents
  try {
    guest = await resolveUserGuest(tab, host)
  } catch {
    return false
  }
  let payload: Record<string, unknown>
  try {
    payload = await runUserScript(tab, guest, host, revealElementScript(selector, pageUrl), 'reveal selection')
  } catch {
    return false
  }
  const currentUrl = typeof payload.url === 'string' ? payload.url : guest.getURL()
  if (!sameDocument(currentUrl, pageUrl) || payload.found !== true) return false
  if (tab.backend === 'extension' && tab.chromeTabId !== undefined) {
    await host.extensionBridge?.call('focus_tab', { chromeTabId: tab.chromeTabId }).catch(() => undefined)
  }
  return true
}

export async function clearTabSelection(tab: TabState, host: SelectionActionHost, captureIdValue?: unknown): Promise<boolean> {
  const captureId =
    captureIdValue === undefined
      ? undefined
      : requireString(captureIdValue, 'captureId', {
          min: 1,
          max: 120,
          trim: true,
        })
  if (captureId !== undefined && tab.selection?.captureId !== undefined && tab.selection.captureId !== captureId) {
    return false
  }
  if (captureId !== undefined && !tab.selection) {
    return false
  }
  tab.selection = undefined
  tab.picking = false
  host.push()
  if (tab.backend === 'extension' && tab.chromeTabId !== undefined) {
    await host.extensionBridge?.call('set_picking', {
      chromeTabId: tab.chromeTabId,
      picking: false,
      clearSelection: true,
      ...(captureId ? { captureId } : {}),
    })
  }
  return true
}
