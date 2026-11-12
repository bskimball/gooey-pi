import { assign, setup } from 'xstate'
import {
  type PiBehaviorMode,
  type PiFusionPair,
  type PiHydraTier,
  readActivePiFusionPair,
  readSavedPiBehaviorMode,
  readSavedPiHydraTier,
} from '@/lib/harness'

interface PiModeControlContext {
  mode: PiBehaviorMode
  hydraTier: PiHydraTier
  pair: PiFusionPair | null
  pendingCommand: string | null
  requestToken: symbol | null
}

type PiModeControlEvent =
  | { type: 'SEND_COMMAND'; command: string; token: symbol }
  | { type: 'SETTLE_COMMAND'; token: symbol }
  | { type: 'SYNC_MODE'; mode: PiBehaviorMode }
  | { type: 'SYNC_HYDRA_TIER'; hydraTier: PiHydraTier }
  | { type: 'SYNC_PAIR'; pair: PiFusionPair | null }
  | { type: 'RESET_PENDING' }

const clearedPending = {
  pendingCommand: null,
  requestToken: null,
}

export const piModeControlMachine = setup({
  types: {
    context: {} as PiModeControlContext,
    events: {} as PiModeControlEvent,
  },
  guards: {
    matchesRequestToken: ({ context, event }) =>
      event.type === 'SETTLE_COMMAND' && context.requestToken === event.token,
  },
  actions: {
    startCommand: assign(({ event }) => {
      if (event.type !== 'SEND_COMMAND') return {}
      return {
        pendingCommand: event.command,
        requestToken: event.token,
      }
    }),
    clearPending: assign(clearedPending),
    applyMode: assign(({ event }) => {
      if (event.type !== 'SYNC_MODE') return {}
      return { mode: event.mode, ...clearedPending }
    }),
    applyHydraTier: assign(({ event }) => {
      if (event.type !== 'SYNC_HYDRA_TIER') return {}
      return { hydraTier: event.hydraTier, ...clearedPending }
    }),
    applyPair: assign(({ event }) => {
      if (event.type !== 'SYNC_PAIR') return {}
      return { pair: event.pair, ...clearedPending }
    }),
  },
}).createMachine({
  id: 'piModeControl',
  initial: 'idle',
  context: () => ({
    mode: readSavedPiBehaviorMode(),
    hydraTier: readSavedPiHydraTier(),
    pair: readActivePiFusionPair(),
    ...clearedPending,
  }),
  on: {
    SYNC_MODE: {
      target: '.idle',
      actions: 'applyMode',
    },
    SYNC_HYDRA_TIER: {
      target: '.idle',
      actions: 'applyHydraTier',
    },
    SYNC_PAIR: {
      target: '.idle',
      actions: 'applyPair',
    },
    RESET_PENDING: {
      target: '.idle',
      actions: 'clearPending',
    },
  },
  states: {
    idle: {
      on: {
        SEND_COMMAND: {
          target: 'pending',
          actions: 'startCommand',
        },
      },
    },
    pending: {
      on: {
        SETTLE_COMMAND: {
          guard: 'matchesRequestToken',
          target: 'idle',
          actions: 'clearPending',
        },
      },
    },
  },
})
