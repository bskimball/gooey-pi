// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise, type SnapshotFrom } from 'xstate'
import { dictationMachine } from '../../apps/desktop/src/hooks/dictationMachine'
import { Composer } from '../../apps/desktop/src/components/Composer'
import { useDictation } from '../../apps/desktop/src/hooks/useDictation'

vi.mock('../../apps/desktop/src/hooks/useDictation', () => ({ useDictation: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const start = vi.fn()
const finish = vi.fn()
const cancel = vi.fn()
const voice = {} as never

function composerProps(overrides: Record<string, unknown> = {}) {
  return {
    busy: false,
    model: 'auto',
    effort: 'medium' as const,
    modelsByProvider: new Map(),
    providers: [],
    reasoningLevels: ['medium' as const],
    fast: false,
    fastSupported: false,
    fastAvailable: false,
    imageInputSupported: true,
    skills: [],
    voice,
    transcriptionProvider: 'openai-live' as const,
    onModelChange: vi.fn(),
    onEffortChange: vi.fn(),
    onFastChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  }
}

describe('dictation lifecycle', () => {
  it('ignores a late transcription after cancel without interrupting a new recording', async () => {
    let complete!: (text: string) => void
    const close = vi.fn().mockResolvedValue(undefined)
    const stop = vi.fn()
    const machine = dictationMachine.provide({
      actors: {
        capture: fromPromise(async (): Promise<NonNullable<SnapshotFrom<typeof dictationMachine>['context']['capture']>> => ({
          kind: 'batch' as const,
          stream: { getTracks: () => [{ stop }] } as unknown as MediaStream,
          context: { close } as unknown as AudioContext,
          source: { disconnect: vi.fn() } as unknown as MediaStreamAudioSourceNode,
          processor: { disconnect: vi.fn() } as unknown as ScriptProcessorNode,
          sink: { disconnect: vi.fn() } as unknown as GainNode,
          chunks: [], frames: 1, sampleRate: 48_000, overflowed: false,
        })),
        transcribe: fromPromise(() => new Promise<string>((resolve) => { complete = resolve })),
      },
    })
    const actor = createActor(machine).start()
    const options = { voice, provider: 'openai' as const, onError: vi.fn() }
    const result = vi.fn()
    try {
      actor.send({ type: 'START', options, resolve: vi.fn() })
      await Promise.resolve(); await Promise.resolve()
      expect(actor.getSnapshot().matches({ active: 'recording' })).toBe(true)
      actor.send({ type: 'FINISH', options, resolve: result })
      actor.send({ type: 'CANCEL' })
      expect(result).toHaveBeenCalledExactlyOnceWith('')
      expect(stop).toHaveBeenCalledOnce()
      actor.send({ type: 'START', options, resolve: vi.fn() })
      await Promise.resolve(); await Promise.resolve()
      complete('stale transcript')
      await Promise.resolve(); await Promise.resolve()
      expect(actor.getSnapshot().matches({ active: 'recording' })).toBe(true)
      expect(result).toHaveBeenCalledOnce()
      expect(options.onError.mock.calls).toEqual([[''], ['']])
    } finally {
      actor.send({ type: 'CANCEL' })
      actor.stop()
    }
  })

  it('releases the microphone and audio context when the hook unmounts mid-recording', async () => {
    const { useDictation: realUseDictation } = await vi.importActual<typeof import('../../apps/desktop/src/hooks/useDictation')>('../../apps/desktop/src/hooks/useDictation')
    const stopTrack = vi.fn()
    const closeContext = vi.fn().mockResolvedValue(undefined)
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
    vi.stubGlobal('AudioContext', class {
      sampleRate = 48_000
      destination = {}
      createMediaStreamSource = node
      createScriptProcessor = node
      createGain = () => ({ ...node(), gain: { value: 1 } })
      resume = () => Promise.resolve()
      close = closeContext
    })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) } })
    let dictation!: ReturnType<typeof realUseDictation>
    function Probe() {
      dictation = realUseDictation(voice, 'openai', vi.fn())
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Probe />))
      await act(async () => { await dictation.start() })
      expect(dictation.state).toBe('recording')
      act(() => root.unmount())
      expect(stopTrack).toHaveBeenCalledOnce()
      expect(closeContext).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
      Reflect.deleteProperty(navigator, 'mediaDevices')
    }
  })
})

describe('composer dictation controls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    start.mockReset(); finish.mockReset(); cancel.mockReset()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('places an idle microphone before Send', () => {
    vi.mocked(useDictation).mockReturnValue({ state: 'idle', start, finish, cancel })
    act(() => root.render(<Composer {...composerProps()} />))
    const actions = container.querySelector('.composer__actions')!
    expect([...actions.children].map((element) => element.getAttribute('aria-label'))).toEqual(['Context usage', 'Start dictation', 'Send message'])
  })

  it('turns context into cancel and the microphone into stop while recording', () => {
    vi.mocked(useDictation).mockReturnValue({ state: 'recording', start, finish, cancel })
    act(() => root.render(<Composer {...composerProps()} />))
    const cancelButton = container.querySelector<HTMLButtonElement>('[aria-label="Cancel dictation"]')!
    expect(container.querySelector('[aria-label="Stop and transcribe dictation"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Transcribe and send message"]')).not.toBeNull()
    act(() => cancelButton.click())
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('transcribes, inserts, and sends when Send is clicked during recording', async () => {
    finish.mockResolvedValue('ship the voice feature')
    const onSend = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useDictation).mockReturnValue({ state: 'recording', start, finish, cancel })
    act(() => root.render(<Composer {...composerProps({ onSend })} />))
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Transcribe and send message"]')?.click())
    expect(finish).toHaveBeenCalledOnce()
    expect(onSend).toHaveBeenCalledWith('ship the voice feature', [], 'queue')
  })
})
