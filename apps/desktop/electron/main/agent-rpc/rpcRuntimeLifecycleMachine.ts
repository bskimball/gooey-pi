import { assign, createActor, setup, type ActorRefFrom } from 'xstate'

export type RpcRuntimeLifecycleEvent =
  | { type: 'FRAME_RECEIVED' }
  | { type: 'TRANSPORT_FAILED'; stopPromise?: Promise<boolean> }
  | { type: 'STOP_REQUESTED'; stopPromise: Promise<boolean> }
  | { type: 'CLOSE_SETTLED' }
  | { type: 'PROCESS_EXITED' }

export interface RpcRuntimeLifecycleContext {
  transportFailed: boolean
  receivedFrame: boolean
  acceptingChunkFrames: boolean
  inputClosed: boolean
  stopPromise: Promise<boolean> | null
}

/**
 * Explicit lifecycle for one RpcRuntime child process.
 * Separates chunk-frame admission (closed on STOP_REQUESTED) from stdin
 * closure (closed on CLOSE_SETTLED or TRANSPORT_FAILED) so a graceful abort
 * can still flush before stdin ends.
 */
export const rpcRuntimeLifecycleMachine = setup({
  types: {
    context: {} as RpcRuntimeLifecycleContext,
    events: {} as RpcRuntimeLifecycleEvent,
  },
}).createMachine({
  id: 'rpcRuntimeLifecycle',
  initial: 'running',
  context: {
    transportFailed: false,
    receivedFrame: false,
    acceptingChunkFrames: true,
    inputClosed: false,
    stopPromise: null,
  },
  states: {
    running: {
      on: {
        FRAME_RECEIVED: { actions: assign({ receivedFrame: true }) },
        STOP_REQUESTED: {
          target: 'stopping',
          actions: assign({
            acceptingChunkFrames: false,
            stopPromise: ({ event }) => event.stopPromise,
          }),
        },
        TRANSPORT_FAILED: {
          target: 'stopping',
          actions: assign({
            transportFailed: true,
            acceptingChunkFrames: false,
            inputClosed: true,
            stopPromise: ({ context, event }) => context.stopPromise ?? event.stopPromise ?? null,
          }),
        },
        PROCESS_EXITED: {
          target: 'exited',
          actions: assign({ acceptingChunkFrames: false, inputClosed: true }),
        },
      },
    },
    stopping: {
      on: {
        FRAME_RECEIVED: { actions: assign({ receivedFrame: true }) },
        CLOSE_SETTLED: { actions: assign({ inputClosed: true }) },
        TRANSPORT_FAILED: {
          actions: assign({
            transportFailed: true,
            acceptingChunkFrames: false,
            inputClosed: true,
          }),
        },
        PROCESS_EXITED: {
          target: 'exited',
          actions: assign({ acceptingChunkFrames: false, inputClosed: true }),
        },
      },
    },
    exited: {},
  },
})

export type RpcRuntimeLifecycle = ActorRefFrom<typeof rpcRuntimeLifecycleMachine>

export function createRpcRuntimeLifecycle(): RpcRuntimeLifecycle {
  return createActor(rpcRuntimeLifecycleMachine).start()
}
