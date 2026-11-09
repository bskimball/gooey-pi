import { assign, fromPromise, setup } from 'xstate'
import type { PrimeWorkApi, VoiceTranscriptionProvider } from '@/types/api'

interface BatchCapture {
  kind: 'batch'
  stream: MediaStream
  context: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  sink: GainNode
  chunks: Float32Array[]
  frames: number
  sampleRate: number
  overflowed: boolean
}

interface LiveCapture {
  kind: 'live'
  stream: MediaStream
  peer: RTCPeerConnection
  channel: RTCDataChannel
  transcript: string
  completed?: (value: string) => void
  failed?: (error: Error) => void
}

type Capture = BatchCapture | LiveCapture
interface Options {
  voice: PrimeWorkApi['voice']
  provider: VoiceTranscriptionProvider
  onError: (message: string) => void
}
interface Context {
  options: Options | null
  capture: Capture | null
  resolve: ((text: string) => void) | null
  started: (() => void) | null
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

function closeCapture(capture: Capture | null): void {
  if (!capture) return
  stopTracks(capture.stream)
  if (capture.kind === 'live') {
    capture.failed?.(new Error('Dictation cancelled.'))
    try { capture.channel.close() } catch { /* already closed */ }
    capture.peer.close()
  } else {
    capture.processor.disconnect()
    capture.source.disconnect()
    capture.sink.disconnect()
    void capture.context.close().catch(() => undefined)
  }
}

function encodeWav(chunks: Float32Array[], frames: number, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + frames * 2)
  const view = new DataView(buffer)
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }
  write(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); write(8, 'WAVE')
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  write(36, 'data'); view.setUint32(40, frames * 2, true)
  let offset = 44
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[index] ?? 0))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return new Uint8Array(buffer)
}

function waitForChannel(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Realtime transcription did not connect.')), 15_000)
    channel.addEventListener('open', () => { window.clearTimeout(timer); resolve() }, { once: true })
    channel.addEventListener('error', () => { window.clearTimeout(timer); reject(new Error('Realtime transcription connection failed.')) }, { once: true })
  })
}

async function createCapture(options: Options, signal: AbortSignal): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
  if (signal.aborted) {
    stopTracks(stream)
    throw new Error('Dictation cancelled.')
  }
  let capture: Capture | null = null
  const abort = () => closeCapture(capture)
  signal.addEventListener('abort', abort, { once: true })
  try {
    if (options.provider === 'openai-live') {
      const peer = new RTCPeerConnection()
      for (const track of stream.getTracks()) peer.addTrack(track, stream)
      const channel = peer.createDataChannel('oai-events')
      const live: LiveCapture = { kind: 'live', stream, peer, channel, transcript: '' }
      capture = live
      channel.addEventListener('message', (event) => {
        let payload: unknown
        try { payload = JSON.parse(String(event.data)) } catch { return }
        if (!payload || typeof payload !== 'object') return
        const message = payload as Record<string, unknown>
        if (message.type === 'conversation.item.input_audio_transcription.delta' && typeof message.delta === 'string') live.transcript += message.delta
        if (message.type === 'conversation.item.input_audio_transcription.completed') live.completed?.(typeof message.transcript === 'string' ? message.transcript : live.transcript)
        if (message.type === 'error') live.failed?.(new Error('Realtime transcription failed.'))
      })
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      const answer = await options.voice.createRealtimeCall({ mode: 'transcription', sdp: offer.sdp ?? '' })
      await peer.setRemoteDescription({ type: 'answer', sdp: answer })
      await waitForChannel(channel)
    } else {
      const context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4_096, 1, 1)
      const sink = context.createGain()
      sink.gain.value = 0
      const batch: BatchCapture = { kind: 'batch', stream, context, source, processor, sink, chunks: [], frames: 0, sampleRate: context.sampleRate, overflowed: false }
      capture = batch
      await context.resume()
      if (signal.aborted) throw new Error('Dictation cancelled.')
      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0)
        if (batch.frames + samples.length > batch.sampleRate * 4 * 60) { batch.overflowed = true; return }
        batch.chunks.push(new Float32Array(samples))
        batch.frames += samples.length
      }
      source.connect(processor); processor.connect(sink); sink.connect(context.destination)
    }
    if (signal.aborted) throw new Error('Dictation cancelled.')
    return capture
  } catch (error) {
    if (!signal.aborted) {
      if (capture) closeCapture(capture)
      else stopTracks(stream)
    }
    signal.removeEventListener('abort', abort)
    throw error
  }
}

async function transcribe(capture: Capture, options: Options, signal: AbortSignal): Promise<string> {
  if (capture.kind === 'live') {
    return new Promise<string>((resolve, reject) => {
      const cleanup = () => { window.clearTimeout(timer); signal.removeEventListener('abort', abort); capture.completed = undefined; capture.failed = undefined }
      const abort = () => { cleanup(); reject(new Error('Dictation cancelled.')) }
      const timer = window.setTimeout(() => { cleanup(); reject(new Error('Realtime transcription timed out.')) }, 20_000)
      signal.addEventListener('abort', abort, { once: true })
      capture.completed = (text) => { cleanup(); resolve(text.trim()) }
      capture.failed = (error) => { cleanup(); reject(error) }
      capture.channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
    })
  }
  if (capture.overflowed) throw new Error('Dictation is limited to four minutes per recording.')
  if (capture.frames === 0) return ''
  if (options.provider === 'openai-live') throw new Error('The transcription provider changed while recording.')
  return (await options.voice.transcribe({ provider: options.provider, audio: encodeWav(capture.chunks, capture.frames, capture.sampleRate) })).trim()
}

export const dictationMachine = setup({
  types: {
    context: {} as Context,
    events: {} as
      | { type: 'START'; options: Options; resolve: () => void }
      | { type: 'FINISH'; options: Options; resolve: (text: string) => void }
      | { type: 'CANCEL' },
  },
  actors: {
    capture: fromPromise<Capture, Options>(({ input, signal }) => createCapture(input, signal)),
    transcribe: fromPromise<string, { capture: Capture; options: Options }>(({ input, signal }) => transcribe(input.capture, input.options, signal)),
  },
  actions: {
    cleanup: assign(({ context }) => {
      closeCapture(context.capture)
      context.started?.()
      return { capture: null, started: null }
    }),
  },
}).createMachine({
  id: 'dictation',
  context: { options: null, capture: null, resolve: null, started: null },
  initial: 'idle',
  states: {
    idle: {
      on: { START: { target: 'active', actions: assign(({ event }) => { event.options.onError(''); return { options: event.options, started: event.resolve, resolve: null } }) } },
    },
    active: {
      initial: 'connecting',
      exit: 'cleanup',
      on: { CANCEL: { target: '#dictation.idle', actions: ({ context }) => context.resolve?.('') } },
      states: {
        connecting: {
          invoke: {
            src: 'capture',
            input: ({ context }) => context.options!,
            onDone: { target: 'recording', actions: assign(({ context, event }) => {
              context.started?.()
              return { capture: event.output, started: null }
            }) },
            onError: { target: '#dictation.idle', actions: ({ context, event }) => context.options?.onError(event.error instanceof Error ? event.error.message : 'Could not start microphone capture.') },
          },
        },
        recording: {
          on: { FINISH: { target: 'transcribing', actions: assign(({ event }) => ({ resolve: event.resolve, options: event.options })) } },
        },
        transcribing: {
          invoke: {
            src: 'transcribe',
            input: ({ context }) => ({ capture: context.capture!, options: context.options! }),
            onDone: { target: '#dictation.idle', actions: ({ context, event }) => context.resolve?.(event.output) },
            onError: { target: '#dictation.idle', actions: ({ context, event }) => {
              context.options?.onError(event.error instanceof Error ? event.error.message : 'Could not transcribe the recording.')
              context.resolve?.('')
            } },
          },
        },
      },
    },
  },
})
