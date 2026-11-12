import { assign, setup, type SnapshotFrom } from 'xstate'

export interface PiRpcContext {
  frameFailed: boolean
}

export type PiRpcEvent =
  | { type: 'DISPOSE' }
  | { type: 'FRAME_ERROR' }
  | { type: 'CLOSE' }

export const piRpcMachine = setup({
  types: {
    context: {} as PiRpcContext,
    events: {} as PiRpcEvent,
  },
  actions: {
    markFrameFailed: assign({ frameFailed: true }),
  },
}).createMachine({
  id: 'piRpc',
  context: { frameFailed: false },
  initial: 'running',
  states: {
    running: {
      on: {
        DISPOSE: 'stopping',
        FRAME_ERROR: { actions: 'markFrameFailed' },
        CLOSE: 'exited',
      },
    },
    stopping: {
      on: {
        FRAME_ERROR: { actions: 'markFrameFailed' },
        CLOSE: 'exited',
      },
    },
    exited: {},
  },
})

export type PiRpcSnapshot = SnapshotFrom<typeof piRpcMachine>

export const isPiRpcRunning = (snapshot: PiRpcSnapshot): boolean => snapshot.matches('running')
export const isPiRpcStopping = (snapshot: PiRpcSnapshot): boolean => snapshot.matches('stopping')
export const isPiRpcExited = (snapshot: PiRpcSnapshot): boolean => snapshot.matches('exited')
export const hasPiRpcFrameFailed = (snapshot: PiRpcSnapshot): boolean => snapshot.context.frameFailed
