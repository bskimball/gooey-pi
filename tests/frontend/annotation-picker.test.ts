// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  annotationMarkersScript,
  annotationPickerScript,
  annotationTakeScript,
  annotationTeardownScript,
  boundInnerText,
  buildSelectorPath,
  captureSourceMetadata,
} from '../../apps/desktop/src/lib/annotation-picker'
import { sanitizeCapturedElement } from '../../apps/desktop/src/lib/browser-annotations'

type AnnotatorWindow = Window & { __primeAnnotator?: { take(): string | null } }

// Runs an injected-picker script the same way webview.executeJavaScript would:
// as plain page-level code against the (jsdom) document.
function runScript(source: string): unknown {
  // biome-ignore lint/security/noGlobalEval: tests execute the injected picker script against jsdom exactly as the webview would
  return globalThis.eval(source)
}

afterEach(() => {
  runScript(annotationTeardownScript())
  document.body.innerHTML = ''
})

describe('buildSelectorPath', () => {
  it('prefers the nearest unique id and stops there', () => {
    document.body.innerHTML = '<div id="app"><ul><li>a</li><li><span>target</span></li></ul></div>'
    const span = document.querySelector('span') as Element
    const selector = buildSelectorPath(span)
    expect(selector).toBe('#app > ul > li:nth-of-type(2) > span')
    expect(document.querySelector(selector)).toBe(span)
  })

  it('falls back to a full nth-of-type path when ids are duplicated', () => {
    document.body.innerHTML = '<div id="dup"></div><div id="dup"><p>first</p><p>second</p></div>'
    const second = document.querySelectorAll('p')[1] as Element
    const selector = buildSelectorPath(second)
    expect(selector).toBe('html > body > div:nth-of-type(2) > p:nth-of-type(2)')
    expect(document.querySelector(selector)).toBe(second)
  })

  it('escapes ids that are not plain identifiers', () => {
    document.body.innerHTML = '<div id="my target"><b>x</b></div>'
    const bold = document.querySelector('b') as Element
    const selector = buildSelectorPath(bold)
    expect(document.querySelector(selector)).toBe(bold)
  })

  it('omits nth-of-type for only children of their tag', () => {
    document.body.innerHTML = '<main><section><button>go</button></section></main>'
    const button = document.querySelector('button') as Element
    expect(buildSelectorPath(button)).toBe('html > body > main > section > button')
  })
})

describe('boundInnerText', () => {
  it('collapses whitespace and truncates to the bound', () => {
    expect(boundInnerText('  Sign\n\n  up\tnow  ', 100)).toBe('Sign up now')
    expect(boundInnerText('x'.repeat(50), 10)).toHaveLength(10)
    expect(boundInnerText(null, 10)).toBe('')
  })
})

describe('original source metadata', () => {
  it('reads same-element explicit, Astro and Svelte locations and allows a file-only stamp', () => {
    const element = document.createElement('button')
    element.setAttribute('data-source-file', 'src/Button.tsx')
    expect(captureSourceMetadata(element).sourceHint).toEqual({ kind: 'explicit', path: 'src/Button.tsx' })
    element.setAttribute('data-source-line', '12')
    element.setAttribute('data-source-component', 'Button')
    expect(captureSourceMetadata(element)).toMatchObject({ component: 'Button', sourceHint: { line: 12 } })
    element.removeAttribute('data-source-file')
    element.setAttribute('data-astro-source-file', 'src/Button.astro')
    element.setAttribute('data-astro-source-loc', '8:2')
    expect(captureSourceMetadata(element).sourceHint).toEqual({ kind: 'astro', path: 'src/Button.astro', line: 8 })
    element.removeAttribute('data-astro-source-file')
    Object.assign(element, { __svelte_meta: { loc: { file: 'src/Button.svelte', line: 7, column: 0 } } })
    expect(captureSourceMetadata(element).sourceHint).toEqual({ kind: 'svelte', path: 'src/Button.svelte', line: 8 })
    Object.assign(element, { __svelte_meta: { loc: { file: 'src/Button.svelte', line: 0, column: 0 } } })
    expect(captureSourceMetadata(element).sourceHint).toEqual({ kind: 'svelte', path: 'src/Button.svelte', line: 1 })
  })

  it('refuses malformed paths and positions rather than repairing or guessing them', () => {
    const element = document.createElement('button')
    for (const path of ['', 'x'.repeat(4097), 'bad\npath']) {
      element.setAttribute('data-source-file', path)
      expect(captureSourceMetadata(element).sourceHint).toBeUndefined()
    }
    element.setAttribute('data-source-file', 'src/Button.tsx')
    for (const line of ['0', '2147483648', '1.5', 'maybe']) {
      element.setAttribute('data-source-line', line)
      expect(captureSourceMetadata(element).sourceHint).toBeUndefined()
    }
    element.removeAttribute('data-source-file')
    element.setAttribute('data-astro-source-file', 'src/Button.astro')
    element.setAttribute('data-astro-source-loc', 'invalid')
    Object.assign(element, { __svelte_meta: { loc: { file: 'src/Button.svelte', line: true } } })
    expect(captureSourceMetadata(element).sourceHint).toBeUndefined()
  })

  it('uses bounded React owner names but never a generated stack as an original source location', () => {
    const element = document.createElement('button')
    const named = { type: { displayName: 'Card'.repeat(50) } }
    const anonymous = { type: null, _debugOwner: named }
    Object.assign(element, { __reactFiber$test: { _debugOwner: anonymous, _debugStack: { stack: 'generated.tsx:999:20' } } })
    expect(captureSourceMetadata(element).component).toHaveLength(120)
    expect(captureSourceMetadata(element).sourceHint).toBeUndefined()
    function Card() { return null }
    Object.assign(element, { __reactFiber$test: { _debugOwner: { type: Card } } })
    expect(captureSourceMetadata(element).component).toBe('Card')
    const cycle: { type: object; _debugOwner?: unknown } = { type: {} }
    cycle._debugOwner = cycle
    Object.assign(element, { __reactFiber$test: { _debugOwner: cycle } })
    expect(captureSourceMetadata(element).component).toBeUndefined()
    Object.defineProperty(element, '__svelte_meta', { get() { throw new Error('page-owned getter') } })
    expect(() => captureSourceMetadata(element)).not.toThrow()
  })
})

describe('injected picker script', () => {
  it('is idempotent and captures a bounded element payload on click', () => {
    document.body.innerHTML = '<div id="app"><a id="cta" class="btn primary" href="https://example.com/signup">Join   now</a></div>'
    runScript(annotationPickerScript('start'))
    runScript(annotationPickerScript('start'))
    // A second injection must not duplicate overlays or listeners.
    expect(document.querySelectorAll('div[style*="2147483646"]')).toHaveLength(1)

    const anchor = document.querySelector('#cta') as HTMLElement
    anchor.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    const hover = document.querySelector('div[style*="2147483646"]') as HTMLElement
    expect(hover.style.display).toBe('block')

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor.dispatchEvent(click)
    // The picker swallows the click so the page does not navigate.
    expect(click.defaultPrevented).toBe(true)

    const payload = runScript(annotationTakeScript()) as string
    const parsed = JSON.parse(payload) as unknown[]
    expect(parsed).toHaveLength(1)
    const clean = sanitizeCapturedElement(parsed[0])
    expect(clean).not.toBeNull()
    expect(clean!.selector).toBe('#cta')
    expect(clean!.tagName).toBe('a')
    expect(clean!.classes).toEqual(['btn', 'primary'])
    expect(clean!.text).toBe('Join now')
    expect(clean!.href).toBe('https://example.com/signup')
    // Drained: a second take returns null.
    expect(runScript(annotationTakeScript())).toBeNull()
  })

  it('captures original source stamps only from the selected element', () => {
    document.body.innerHTML = '<button id="explicit" data-source-file="src/Button.tsx" data-source-line="7" data-source-component="Button"><span id="child">Label</span></button><section id="astro" data-astro-source-file="/repo/src/Hero.astro" data-astro-source-loc="12:4"></section><div id="svelte"></div>'
    Object.assign(document.querySelector('#svelte')!, { __svelte_meta: { loc: { file: 'src/Card.svelte', line: 9, column: 0 } } })
    runScript(annotationPickerScript('start'))
    for (const id of ['explicit', 'astro', 'svelte', 'child']) document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const selected = JSON.parse(String(runScript(annotationTakeScript()))).map((raw: unknown) => sanitizeCapturedElement(raw))
    expect(selected[0]).toMatchObject({ component: 'Button', sourceHint: { kind: 'explicit', path: 'src/Button.tsx', line: 7 } })
    expect(selected[1].sourceHint).toEqual({ kind: 'astro', path: '/repo/src/Hero.astro', line: 12 })
    expect(selected[2].sourceHint).toEqual({ kind: 'svelte', path: 'src/Card.svelte', line: 10 })
    expect(selected[3].sourceHint).toBeUndefined()
  })

  it('captures a React owner name without claiming generated stack positions are TSX source', () => {
    document.body.innerHTML = '<button id="react">Profile</button><button id="invalid" data-source-file="src/Foo.tsx" data-source-line="0">Invalid</button>'
    function Profile() { return null }
    Object.assign(document.getElementById('react')!, { __reactFiber$fixture: { _debugOwner: { type: Profile }, _debugStack: new Error('http://localhost:5173/src/Profile.tsx:999:20') } })
    runScript(annotationPickerScript('start'))
    for (const id of ['react', 'invalid']) document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const selected = JSON.parse(String(runScript(annotationTakeScript()))).map((raw: unknown) => sanitizeCapturedElement(raw))
    expect(selected[0].component).toBe('Profile')
    expect(selected.every((item: { sourceHint?: unknown }) => item.sourceHint === undefined)).toBe(true)
  })

  it('stop removes the hover overlay and its listeners but keeps markers', () => {
    document.body.innerHTML = '<p id="note">hello</p>'
    runScript(annotationPickerScript('start'))
    runScript(annotationMarkersScript([{ selector: '#note', index: 3 }]))
    runScript(annotationPickerScript('stop'))

    expect(document.querySelector('div[style*="2147483646"]')).toBeNull()
    const marker = document.querySelector('div[style*="2147483645"]')
    expect(marker).not.toBeNull()
    expect(marker?.textContent).toBe('3')

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    ;(document.querySelector('#note') as HTMLElement).dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(runScript(annotationTakeScript())).toBeNull()
  })

  it('re-renders markers on update, skips unresolvable selectors, and clears on empty', () => {
    document.body.innerHTML = '<p id="a">a</p><p id="b">b</p>'
    runScript(annotationMarkersScript([
      { selector: '#a', index: 1 },
      { selector: '#missing', index: 2 },
      { selector: ']]] invalid', index: 3 },
      { selector: '#b', index: 4 },
    ]))
    const badges = [...document.querySelectorAll('div[style*="2147483645"] div > div')].map((badge) => badge.textContent)
    expect(badges).toEqual(['1', '4'])

    runScript(annotationMarkersScript([{ selector: '#b', index: 1 }]))
    expect(document.querySelectorAll('div[style*="2147483645"]')).toHaveLength(1)
    expect(document.querySelector('div[style*="2147483645"]')?.textContent).toBe('1')

    runScript(annotationMarkersScript([]))
    expect(document.querySelector('div[style*="2147483645"]')).toBeNull()
  })

  it('tears down every overlay and the namespace itself', () => {
    document.body.innerHTML = '<p id="a">a</p>'
    runScript(annotationPickerScript('start'))
    runScript(annotationMarkersScript([{ selector: '#a', index: 1 }]))
    expect(runScript(annotationTeardownScript())).toBe(true)

    expect((window as AnnotatorWindow).__primeAnnotator).toBeUndefined()
    expect(document.querySelector('div[style*="2147483646"]')).toBeNull()
    expect(document.querySelector('div[style*="2147483645"]')).toBeNull()
    // Teardown when nothing was injected reports false and stays quiet.
    expect(runScript(annotationTeardownScript())).toBe(false)
  })

  it('embeds marker selectors safely even with hostile content', () => {
    document.body.innerHTML = '<p id="a">a</p>'
    const hostile = '</script><img src=x onerror=alert(1)>  '
    // Must not throw while evaluating: the payload is JSON-embedded, not concatenated markup.
    runScript(annotationMarkersScript([{ selector: hostile, index: 1 }]))
    expect(document.querySelector('div[style*="2147483645"]')).toBeNull()
  })
})
