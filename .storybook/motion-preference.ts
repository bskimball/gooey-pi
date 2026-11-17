/** Storybook-only override. Full mode delegates to the operating system preference. */
const nativeMatchMedia = window.matchMedia.bind(window)
let reduced = false
const preferences = new Map<string, MotionPreference>()
type LegacyListener = (this: MediaQueryList, event: MediaQueryListEvent) => void

class MotionPreference extends EventTarget implements MediaQueryList {
  readonly media: string
  readonly native: MediaQueryList
  onchange: MediaQueryList['onchange'] = null
  private readonly legacyListeners = new Map<LegacyListener, EventListener>()
  private readonly onNativeChange = () => this.notify()

  constructor(query: string) {
    super()
    this.media = query
    this.native = nativeMatchMedia(query)
    this.native.addEventListener('change', this.onNativeChange)
  }

  get matches() {
    return reduced ? !this.media.includes('no-preference') : this.native.matches
  }

  notify() {
    const event = new MediaQueryListEvent('change', { matches: this.matches, media: this.media })
    this.dispatchEvent(event)
    this.onchange?.call(this, event)
  }

  addListener(listener: LegacyListener | null) {
    if (!listener || this.legacyListeners.has(listener)) return
    const wrapped: EventListener = (event) => {
      if (event instanceof MediaQueryListEvent) listener.call(this, event)
    }
    this.legacyListeners.set(listener, wrapped)
    this.addEventListener('change', wrapped)
  }

  removeListener(listener: LegacyListener | null) {
    if (!listener) return
    const wrapped = this.legacyListeners.get(listener)
    if (wrapped) this.removeEventListener('change', wrapped)
    this.legacyListeners.delete(listener)
  }

  dispose() {
    this.native.removeEventListener('change', this.onNativeChange)
  }
}

window.matchMedia = (query) => {
  // Leave viewport and every unrelated media query native.
  if (!/^\(prefers-reduced-motion(?::\s*(reduce|no-preference))?\)$/.test(query)) return nativeMatchMedia(query)
  let preference = preferences.get(query)
  if (!preference) {
    preference = new MotionPreference(query)
    preferences.set(query, preference)
  }
  return preference
}

export function setReducedMotion(value: boolean) {
  if (reduced === value) return
  reduced = value
  for (const preference of preferences.values()) preference.notify()
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    setReducedMotion(false)
    for (const preference of preferences.values()) preference.dispose()
    window.matchMedia = nativeMatchMedia
  })
}
