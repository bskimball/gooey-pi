import { assign, setup, type SnapshotFrom } from 'xstate'

export interface ExtensionBridgeContext {
  port: number | null
  remoteBase: string | null
}

export type ExtensionBridgeEvent =
  | { type: 'START' }
  | { type: 'LISTENED'; port: number | null }
  | { type: 'START_FAILED' }
  | { type: 'STREAM_CONNECTED' }
  | { type: 'STREAM_DISCONNECTED' }
  | { type: 'CONNECT_REMOTE'; base: string; port: number }
  | { type: 'REMOTE_CONNECTED' }
  | { type: 'REMOTE_DISCONNECTED' }
  | { type: 'STOP' }

export const extensionBridgeMachine = setup({
  types: {
    context: {} as ExtensionBridgeContext,
    events: {} as ExtensionBridgeEvent,
  },
  actions: {
    setListened: assign(({ event }) => (event.type === 'LISTENED' ? { port: event.port, remoteBase: null } : {})),
    setRemote: assign(({ event }) => (event.type === 'CONNECT_REMOTE' ? { remoteBase: event.base, port: event.port } : {})),
    clearConnection: assign({ port: null, remoteBase: null }),
  },
}).createMachine({
  id: 'extensionBridge',
  context: { port: null, remoteBase: null },
  initial: 'idle',
  states: {
    idle: {
      on: {
        START: { target: 'starting', actions: 'clearConnection' },
        CONNECT_REMOTE: { target: 'remotePolling', actions: 'setRemote' },
        STOP: { target: 'stopped', actions: 'clearConnection' },
      },
    },
    starting: {
      on: {
        LISTENED: { target: 'localListening', actions: 'setListened' },
        START_FAILED: { target: 'idle', actions: 'clearConnection' },
        STOP: { target: 'stopped', actions: 'clearConnection' },
      },
    },
    localListening: {
      initial: 'disconnected',
      on: {
        STOP: { target: 'stopped', actions: 'clearConnection' },
        CONNECT_REMOTE: { target: 'remotePolling', actions: 'setRemote' },
      },
      states: {
        disconnected: {
          on: { STREAM_CONNECTED: 'streamConnected' },
        },
        streamConnected: {
          on: {
            STREAM_CONNECTED: 'streamConnected',
            STREAM_DISCONNECTED: 'disconnected',
          },
        },
      },
    },
    remotePolling: {
      initial: 'disconnected',
      on: {
        STOP: { target: 'stopped', actions: 'clearConnection' },
        START: { target: 'starting', actions: 'clearConnection' },
      },
      states: {
        disconnected: {
          on: { REMOTE_CONNECTED: 'connected' },
        },
        connected: {
          on: { REMOTE_DISCONNECTED: 'disconnected' },
        },
      },
    },
    stopped: {
      on: {
        START: { target: 'starting', actions: 'clearConnection' },
        CONNECT_REMOTE: { target: 'remotePolling', actions: 'setRemote' },
      },
    },
  },
})

export type ExtensionBridgeSnapshot = SnapshotFrom<typeof extensionBridgeMachine>

export function isBridgeConnected(snapshot: ExtensionBridgeSnapshot): boolean {
  return snapshot.matches({ localListening: 'streamConnected' }) || snapshot.matches({ remotePolling: 'connected' })
}

export function isBridgeRemote(snapshot: ExtensionBridgeSnapshot): boolean {
  return snapshot.matches('remotePolling')
}

export function isBridgeListening(snapshot: ExtensionBridgeSnapshot): boolean {
  return snapshot.matches('localListening')
}

export function isBridgeStopped(snapshot: ExtensionBridgeSnapshot): boolean {
  return snapshot.matches('stopped')
}
