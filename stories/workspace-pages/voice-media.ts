export type VoiceScene = 'connecting' | 'listening' | 'speaking' | 'error'
/** Browser-only protocol simulator. No native peer, stream, recorder or audio device is constructed. */
export function installVoiceScene(scene: VoiceScene) {
  const mediaDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
  const peerDescriptor = Object.getOwnPropertyDescriptor(window, 'RTCPeerConnection')
  const channels = new Set<FixtureChannel>()
  const tracks = new Set<{ enabled: boolean; stop(): void }>()
  class FixtureChannel extends EventTarget {
    readyState = 'connecting'
    send(_message: string) {
      /* Protocol output is deliberately not transported. */
    }
    close() {
      this.readyState = 'closed'
      channels.delete(this)
    }
    open() {
      if (this.readyState === 'closed') return
      this.readyState = 'open'
      this.dispatchEvent(new Event('open'))
      if (scene === 'speaking') this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'output_audio_buffer.started' }) }))
    }
  }
  class FixturePeer extends EventTarget {
    private channel: FixtureChannel | null = null
    createDataChannel(_label: string) {
      this.channel = new FixtureChannel()
      channels.add(this.channel)
      return this.channel
    }
    addTrack() {
      /* No native MediaStreamTrack is accepted or created. */
    }
    async createOffer() {
      return { type: 'offer', sdp: 'offline-story-offer' }
    }
    async setLocalDescription() {
      /* Offline negotiation only. */
    }
    async setRemoteDescription() {
      this.channel?.open()
    }
    close() {
      this.channel?.close()
    }
  }
  Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: FixturePeer })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: async () => [],
      getSupportedConstraints: () => ({}),
      getDisplayMedia: async () => {
        throw new Error('Display capture is disabled in stories')
      },
      getUserMedia: async () => {
        if (scene === 'error') throw new DOMException('Fixture microphone permission denied', 'NotAllowedError')
        if (scene === 'connecting') return new Promise<never>(() => undefined)
        const track = {
          enabled: true,
          stop() {
            tracks.delete(track)
          },
        }
        tracks.add(track)
        return { getTracks: () => [track], getAudioTracks: () => [track] }
      },
    },
  })
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    for (const channel of channels) channel.close()
    for (const track of tracks) track.stop()
    if (mediaDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDescriptor)
    else Reflect.deleteProperty(navigator, 'mediaDevices')
    if (peerDescriptor) Object.defineProperty(window, 'RTCPeerConnection', peerDescriptor)
    else Reflect.deleteProperty(window, 'RTCPeerConnection')
  }
  return restore
}
