import { describe, expect, it } from 'vitest'
import { messageActionForKey, type MessageShortcutEvent } from '../../apps/desktop/src/lib/message-shortcuts'

const event = (overrides: Partial<MessageShortcutEvent> = {}): MessageShortcutEvent => ({
  key: 'Enter', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...overrides,
})

describe('message shortcuts', () => {
  it('defaults Enter to steer and Ctrl+Enter to queue', () => {
    expect(messageActionForKey(event())).toBe('steer')
    expect(messageActionForKey(event({ ctrlKey: true }))).toBe('queue')
  })

  it('treats Cmd+Enter as the macOS alias for queueing', () => {
    expect(messageActionForKey(event({ metaKey: true }))).toBe('queue')
    expect(messageActionForKey(event({ metaKey: true, ctrlKey: true }))).toBe('queue')
    expect(messageActionForKey(event({ metaKey: true, shiftKey: true }))).toBeNull()
  })

  it('swaps the shortcuts when Enter is configured to queue', () => {
    expect(messageActionForKey(event(), 'queue')).toBe('queue')
    expect(messageActionForKey(event({ ctrlKey: true }), 'queue')).toBe('steer')
    expect(messageActionForKey(event({ metaKey: true }), 'queue')).toBe('steer')
  })

  it('leaves newlines, composition, and unsupported modifiers alone', () => {
    expect(messageActionForKey(event({ shiftKey: true }))).toBeNull()
    expect(messageActionForKey(event({ isComposing: true }))).toBeNull()
    expect(messageActionForKey(event({ altKey: true }))).toBeNull()
    expect(messageActionForKey(event({ key: 'a' }))).toBeNull()
  })
})
