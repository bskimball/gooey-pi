import { assign, setup, type SnapshotFrom } from 'xstate'

export interface AttachedSessionContext {
  refreshInFlight: boolean
  refreshPending: boolean
}

export type AttachedSessionEvent =
  | { type: 'CONNECTED' }
  | { type: 'REPLAY' }
  | { type: 'REFRESH_REQUESTED' }
  | { type: 'REFRESH_FINISHED' }
  | { type: 'DISCONNECT' }
  | { type: 'DISPOSE' }

export const attachedSessionMachine = setup({
  types: {
    context: {} as AttachedSessionContext,
    events: {} as AttachedSessionEvent,
  },
  guards: {
    isRefreshing: ({ context }) => context.refreshInFlight,
    hasRefreshPending: ({ context }) => context.refreshPending,
  },
  actions: {
    startRefresh: assign({ refreshInFlight: true, refreshPending: false }),
    queueRefresh: assign({ refreshPending: true }),
    finishRefresh: assign({ refreshInFlight: false, refreshPending: false }),
    clearRefresh: assign({ refreshInFlight: false, refreshPending: false }),
  },
}).createMachine({
  id: 'attachedSession',
  context: { refreshInFlight: false, refreshPending: false },
  initial: 'connecting',
  states: {
    connecting: {
      on: {
        CONNECTED: 'connected',
        DISCONNECT: { target: 'disconnected', actions: 'clearRefresh' },
        DISPOSE: { target: 'disposed', actions: 'clearRefresh' },
      },
    },
    connected: {
      initial: 'idle',
      on: {
        REFRESH_REQUESTED: [
          { guard: 'isRefreshing', actions: 'queueRefresh' },
          { actions: 'startRefresh' },
        ],
        REFRESH_FINISHED: [
          { guard: 'hasRefreshPending', actions: 'startRefresh' },
          { actions: 'finishRefresh' },
        ],
        DISCONNECT: { target: 'disconnected', actions: 'clearRefresh' },
        DISPOSE: { target: 'disposed', actions: 'clearRefresh' },
      },
      states: {
        idle: {
          on: { REPLAY: 'publishing' },
        },
        publishing: {},
      },
    },
    disconnected: {
      on: {
        DISPOSE: { target: 'disposed', actions: 'clearRefresh' },
      },
    },
    disposed: {},
  },
})

export type AttachedSessionSnapshot = SnapshotFrom<typeof attachedSessionMachine>

export const isAttachedConnecting = (snapshot: AttachedSessionSnapshot): boolean => snapshot.matches('connecting')
export const isAttachedConnected = (snapshot: AttachedSessionSnapshot): boolean => snapshot.matches('connected')
export const canAttachedPublish = (snapshot: AttachedSessionSnapshot): boolean => snapshot.matches({ connected: 'publishing' })
export const canAttachedReceiveEvents = (snapshot: AttachedSessionSnapshot): boolean =>
  snapshot.matches('connecting') || snapshot.matches('connected')
export const isAttachedDisposed = (snapshot: AttachedSessionSnapshot): boolean => snapshot.matches('disposed')
