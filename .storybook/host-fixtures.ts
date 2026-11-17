import type { ApexApi } from '../packages/core/src/types/api'
export { createApexStoryFixture, type ApexStoryOverrides } from './apex-fixture'
export { installVoiceMediaFixture } from './voice-fixture'

/** Explicit failure for host operations a story does not model. Never contact a real host. */
export function unsupportedHostMethod(method: string): never {
  throw new Error(`Storybook host fixture does not implement ${method}. Add an explicit deterministic fixture.`)
}

/** A fresh channel per story. Register reset with registerStoryCleanup if retained outside render. */
export function createStoryEvents<T>() {
  const listeners = new Set<(event: T) => void>()
  return {
    subscribe(listener: (event: T) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(event: T) {
      for (const listener of listeners) listener(event)
    },
    reset() {
      listeners.clear()
    },
  }
}

const cleanups = new Set<() => void>()
export function registerStoryCleanup(cleanup: () => void) {
  cleanups.add(cleanup)
  return () => {
    cleanups.delete(cleanup)
  }
}

/**
 * No partial object is cast to ApexApi. Connected stories must provide a complete typed
 * adapter; unsupported operations should explicitly call unsupportedHostMethod.
 * Prefer component props accepting Pick<ApexApi, ...> when available.
 */
export function installHostFixture(host: ApexApi) {
  Object.defineProperty(window, 'apex', { configurable: true, value: host })
}

export function resetStoryEnvironment() {
  for (const cleanup of [...cleanups].reverse()) cleanup()
  cleanups.clear()
  Object.defineProperty(window, 'apex', { configurable: true, value: undefined })
  // This is the dedicated Storybook origin only, never the Electron renderer's origin.
  localStorage.clear()
  sessionStorage.clear()
}
