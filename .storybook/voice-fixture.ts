import { registerStoryCleanup } from './host-fixtures'

/** Install before mounting voice UI. Denies device access without ever invoking native media APIs. */
export function installVoiceMediaFixture(): () => void {
  const restorers: Array<() => void> = []
  function replace(target: object, key: string, value: unknown) {
    const previous = Object.getOwnPropertyDescriptor(target, key)
    Object.defineProperty(target, key, { configurable: true, value })
    restorers.push(() => {
      if (previous) Object.defineProperty(target, key, previous)
      else Reflect.deleteProperty(target, key)
    })
  }
  const denied = async (): Promise<never> => {
    throw new DOMException('Media is disabled in Storybook fixtures', 'NotAllowedError')
  }
  replace(navigator, 'mediaDevices', {
    getUserMedia: denied,
    getDisplayMedia: denied,
    enumerateDevices: async () => [],
    getSupportedConstraints: () => ({}),
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  class DisabledPeerConnection {
    constructor() {
      throw new DOMException('WebRTC is disabled in Storybook fixtures', 'NotSupportedError')
    }
  }
  class DisabledMediaRecorder {
    static isTypeSupported() {
      return false
    }
    constructor() {
      throw new DOMException('Media recording is disabled in Storybook fixtures', 'NotSupportedError')
    }
  }
  replace(window, 'RTCPeerConnection', DisabledPeerConnection)
  replace(window, 'MediaRecorder', DisabledMediaRecorder)
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    for (const undo of restorers.reverse()) undo()
  }
  registerStoryCleanup(restore)
  return restore
}
