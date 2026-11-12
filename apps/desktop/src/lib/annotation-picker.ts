import type { BrowserAnnotationElement, BrowserSourceHint } from '@/types/api'
import { MAX_BROWSER_ANNOTATIONS, MAX_SELECTOR_LENGTH, MAX_SNIPPET_LENGTH } from '@/lib/browser-annotations'

// The picker runs inside the guest page via webview.executeJavaScript. The
// helpers below are embedded into that script with Function.prototype.toString,
// so each one must stay fully self-contained: no references to module bindings,
// only standard browser globals. Nested helpers use object methods so keepNames
// cannot inject renderer-only bindings. Exports let tests exercise the DOM logic.

/** Builds a robust CSS selector path for an element: nearest unique id, then tag:nth-of-type segments. */
export function buildSelectorPath(element: Element): string {
  const helpers = {
    escapeAttr(value: string) { return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') },
    idSelector(value: string) {
      if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) return `#${value}`
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return `#${CSS.escape(value)}`
      return `[id="${helpers.escapeAttr(value)}"]`
    },
  }
  const parts: string[] = []
  let node: Element | null = element
  while (node && node.nodeType === 1 && parts.length < 32) {
    const tag = node.tagName.toLowerCase()
    if (tag === 'html') {
      parts.unshift('html')
      break
    }
    const id = node.getAttribute('id')
    if (id && node.ownerDocument && node.ownerDocument.querySelectorAll(`[id="${helpers.escapeAttr(id)}"]`).length === 1) {
      parts.unshift(helpers.idSelector(id))
      break
    }
    let index = 1
    let before: Element | null = node.previousElementSibling
    while (before) {
      if (before.tagName === node.tagName) index += 1
      before = before.previousElementSibling
    }
    let hasLaterTwin = false
    let after: Element | null = node.nextElementSibling
    while (after) {
      if (after.tagName === node.tagName) {
        hasLaterTwin = true
        break
      }
      after = after.nextElementSibling
    }
    parts.unshift(index > 1 || hasLaterTwin ? `${tag}:nth-of-type(${index})` : tag)
    node = node.parentElement
  }
  return parts.join(' > ')
}

/** Collapses whitespace and bounds visible text captured from the page. */
export function boundInnerText(value: string | null | undefined, maxLength: number): string {
  const collapsed = (value || '').replace(/\s+/g, ' ').trim()
  return collapsed.length > maxLength ? collapsed.slice(0, maxLength) : collapsed
}

/** Reads only original-source stamps. React owner stacks describe generated code, not TSX positions. */
export function captureSourceMetadata(element: Element): Pick<BrowserAnnotationElement, 'sourceHint' | 'component'> {
  const result: Pick<BrowserAnnotationElement, 'sourceHint' | 'component'> = {}
  const helpers = {
    record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' },
    hint(kind: BrowserSourceHint['kind'], path: unknown, rawLine: unknown): BrowserSourceHint | undefined {
      if (typeof path !== 'string' || !path.trim() || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)) return undefined
      let line: number | undefined
      if (rawLine !== null && rawLine !== undefined && rawLine !== '') {
        if (typeof rawLine === 'number') line = rawLine
        else if (typeof rawLine === 'string' && /^\d+$/.test(rawLine)) line = Number(rawLine)
        else return undefined
        if (!Number.isSafeInteger(line) || line < 1 || line > 2_147_483_647) return undefined
      }
      return { kind, path, ...(line !== undefined ? { line } : {}) }
    },
  }
  try {
    result.sourceHint = helpers.hint('explicit', element.getAttribute('data-source-file'), element.getAttribute('data-source-line'))
    const astroLocation = element.getAttribute('data-astro-source-loc')
    if (!result.sourceHint && (astroLocation === null || /^\d+:\d+$/.test(astroLocation))) {
      result.sourceHint = helpers.hint('astro', element.getAttribute('data-astro-source-file'), astroLocation?.split(':')[0])
    }
    const svelte: unknown = Reflect.get(element, '__svelte_meta')
    if (!result.sourceHint && helpers.record(svelte) && helpers.record(svelte.loc)) {
      const line = svelte.loc.line
      if (typeof line === 'number' && Number.isSafeInteger(line) && line >= 0) {
        result.sourceHint = helpers.hint('svelte', svelte.loc.file, line + 1)
      }
    }
    const explicitComponent = element.getAttribute('data-source-component')
    if (explicitComponent) result.component = explicitComponent.slice(0, 120)
    if (!result.component) {
      const key = Object.getOwnPropertyNames(element).find((name) => name.startsWith('__reactFiber$'))
      const fiber: unknown = key ? Reflect.get(element, key) : undefined
      let owner: unknown = helpers.record(fiber) ? fiber._debugOwner : undefined
      for (let depth = 0; helpers.record(owner) && depth < 32; depth += 1) {
        const type = owner.type
        if (typeof type === 'function' || helpers.record(type)) {
          const name: unknown = Reflect.get(type, 'displayName') || Reflect.get(type, 'name')
          if (typeof name === 'string' && name) { result.component = name.slice(0, 120); break }
        }
        owner = owner._debugOwner
      }
    }
  } catch { /* Metadata is optional and belongs to the untrusted page. */ }
  return result
}

const NAMESPACE = '__apexAnnotator'

// Idempotent bootstrap: defines window.__apexAnnotator once and touches no
// other page global. stop() removes every listener and the hover overlay;
// destroy() additionally clears markers and deletes the namespace.
const ENSURE_SCRIPT = `(function () {
  if (window.${NAMESPACE}) return;
  var buildSelectorPath = ${buildSelectorPath.toString()};
  var boundInnerText = ${boundInnerText.toString()};
  var captureSourceMetadata = ${captureSourceMetadata.toString()};
  var state = { picking: false, pending: [], hover: null, onMove: null, onClick: null, onKey: null, markerRoot: null, markers: [], reposition: null, raf: 0 };
  function ownedNode(target) {
    return target === state.hover || (state.markerRoot && state.markerRoot.contains(target));
  }
  function capture(el) {
    var rect = el.getBoundingClientRect();
    var anchor = typeof el.closest === 'function' ? el.closest('a[href]') : null;
    return {
      ...captureSourceMetadata(el),
      selector: buildSelectorPath(el),
      tagName: el.tagName ? el.tagName.toLowerCase() : '',
      id: el.getAttribute && el.getAttribute('id') ? el.getAttribute('id') : '',
      classes: Array.prototype.slice.call(el.classList || [], 0, 10),
      text: boundInnerText(el.innerText || el.textContent || '', ${MAX_SNIPPET_LENGTH}),
      href: typeof el.href === 'string' ? el.href : anchor && typeof anchor.href === 'string' ? anchor.href : '',
      src: typeof el.currentSrc === 'string' && el.currentSrc ? el.currentSrc : typeof el.src === 'string' ? el.src : '',
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
    };
  }
  function positionMarkers() {
    for (var i = 0; i < state.markers.length; i += 1) {
      var entry = state.markers[i];
      var rect = entry.el.getBoundingClientRect();
      var missing = rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0;
      entry.box.style.display = missing ? 'none' : 'block';
      entry.box.style.left = rect.left - 2 + 'px';
      entry.box.style.top = rect.top - 2 + 'px';
      entry.box.style.width = rect.width + 'px';
      entry.box.style.height = rect.height + 'px';
    }
  }
  var ns = {
    start: function () {
      if (state.picking) return;
      state.picking = true;
      var hover = document.createElement('div');
      hover.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;display:none;border:2px solid #2488ff;background:rgba(36,136,255,0.14);border-radius:2px;left:0;top:0;width:0;height:0;';
      (document.body || document.documentElement).appendChild(hover);
      state.hover = hover;
      state.onMove = function (event) {
        var target = event.target;
        if (!target || target.nodeType !== 1 || ownedNode(target)) { hover.style.display = 'none'; return; }
        var rect = target.getBoundingClientRect();
        hover.style.display = 'block';
        hover.style.left = rect.left - 2 + 'px';
        hover.style.top = rect.top - 2 + 'px';
        hover.style.width = rect.width + 'px';
        hover.style.height = rect.height + 'px';
      };
      state.onClick = function (event) {
        var target = event.target;
        if (!target || target.nodeType !== 1 || ownedNode(target)) return;
        event.preventDefault();
        event.stopPropagation();
        if (state.pending.length < ${MAX_BROWSER_ANNOTATIONS}) state.pending.push(capture(target));
        hover.style.display = 'none';
      };
      state.onKey = function (event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        state.pending = [{ cancelled: true }];
        ns.stop();
      };
      document.addEventListener('keydown', state.onKey, true);
      document.addEventListener('mousemove', state.onMove, true);
      document.addEventListener('click', state.onClick, true);
    },
    stop: function () {
      if (!state.picking) return;
      state.picking = false;
      if (state.onMove) document.removeEventListener('mousemove', state.onMove, true);
      if (state.onClick) document.removeEventListener('click', state.onClick, true);
      if (state.onKey) document.removeEventListener('keydown', state.onKey, true);
      state.onKey = null;
      state.onMove = null;
      state.onClick = null;
      if (state.hover && state.hover.parentNode) state.hover.parentNode.removeChild(state.hover);
      state.hover = null;
    },
    take: function () {
      if (state.pending.length === 0) return null;
      var out = state.pending;
      state.pending = [];
      return JSON.stringify(out);
    },
    setMarkers: function (list) {
      if (state.markerRoot && state.markerRoot.parentNode) state.markerRoot.parentNode.removeChild(state.markerRoot);
      if (state.reposition) {
        window.removeEventListener('scroll', state.reposition, true);
        window.removeEventListener('resize', state.reposition);
        state.reposition = null;
      }
      state.markerRoot = null;
      state.markers = [];
      if (!Array.isArray(list) || list.length === 0) return 0;
      var root = document.createElement('div');
      root.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483645;pointer-events:none;';
      for (var i = 0; i < list.length && i < ${MAX_BROWSER_ANNOTATIONS}; i += 1) {
        var el = null;
        try { el = document.querySelector(String(list[i].selector)); } catch (error) { el = null; }
        if (!el) continue;
        var box = document.createElement('div');
        box.style.cssText = 'position:fixed;border:1.5px solid #2488ff;background:rgba(36,136,255,0.08);border-radius:3px;';
        var badge = document.createElement('div');
        badge.textContent = String(Math.floor(Number(list[i].index)) || 0);
        badge.style.cssText = 'position:absolute;right:-10px;top:-10px;min-width:20px;height:20px;display:flex;align-items:center;justify-content:center;padding:0 3px;box-sizing:border-box;border:2px solid #fff;border-radius:10px;color:#fff;background:#2488ff;font:700 11px system-ui,sans-serif;';
        box.appendChild(badge);
        root.appendChild(box);
        state.markers.push({ el: el, box: box });
      }
      if (state.markers.length === 0) return 0;
      positionMarkers();
      (document.body || document.documentElement).appendChild(root);
      state.markerRoot = root;
      state.reposition = function () {
        if (state.raf) return;
        state.raf = requestAnimationFrame(function () { state.raf = 0; positionMarkers(); });
      };
      window.addEventListener('scroll', state.reposition, true);
      window.addEventListener('resize', state.reposition);
      return state.markers.length;
    },
    destroy: function () {
      ns.stop();
      ns.setMarkers([]);
      state.pending = [];
      delete window.${NAMESPACE};
    }
  };
  window.${NAMESPACE} = ns;
})();`

function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/** Starts or stops element picking inside the page. Injecting is idempotent. */
export function annotationPickerScript(command: 'start' | 'stop'): string {
  return `${ENSURE_SCRIPT}\nwindow.${NAMESPACE}.${command}();`
}

/** Drains any element selections the user clicked. Resolves to a JSON string or null. */
export function annotationTakeScript(): string {
  return `window.${NAMESPACE} ? window.${NAMESPACE}.take() : null`
}

export interface AnnotationMarker {
  selector: string
  index: number
}

/** Renders (or clears, with an empty list) the persistent numbered markers. */
export function annotationMarkersScript(markers: AnnotationMarker[]): string {
  const safe = markers.slice(0, MAX_BROWSER_ANNOTATIONS).map((marker) => ({
    selector: String(marker.selector).slice(0, MAX_SELECTOR_LENGTH),
    index: Number.isFinite(marker.index) ? Math.floor(marker.index) : 0,
  }))
  return `${ENSURE_SCRIPT}\nwindow.${NAMESPACE}.setMarkers(${embedJson(safe)});`
}

/** Removes every listener, overlay, and the namespace itself from the page. */
export function annotationTeardownScript(): string {
  return `window.${NAMESPACE} ? (window.${NAMESPACE}.destroy(), true) : false`
}
