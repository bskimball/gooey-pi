import { assign, setup } from 'xstate'

export interface ApexTurnContext {
  promptToken: number
  runStarted: boolean
  compacting: boolean
  inFlightCompact: boolean
  compactionEnded: boolean
  switching: boolean
  queuePaused: boolean
  wasPausedBeforeSwitch: boolean
}

export type ApexTurnEvent =
  | { type: 'RESET_TRANSCRIPT' }
  | { type: 'BEGIN_SWITCH' }
  | { type: 'END_SWITCH' }
  | { type: 'BEGIN_NEW_SESSION' }
  | { type: 'NEW_SESSION_READY' }
  | { type: 'PAUSE_QUEUE'; paused: boolean }
  | { type: 'BEGIN_PROMPT'; assignToken: (token: number) => void }
  | { type: 'BEGIN_COMPACT'; assignToken: (token: number) => void }
  | { type: 'FINISH_COMPACT'; token: number; onSettled: (compactionEnded: boolean) => void }
  | { type: 'OPTIMISTIC_SETTLED'; token: number; onDropPlaceholder: () => void; onFullySettled: () => void }
  | { type: 'AGENT_START' }
  | { type: 'COMPACTION_START'; manualOrIdle: boolean }
  | { type: 'COMPACTION_END'; onExtensionCompactionSettled: () => void }
  | { type: 'AGENT_SETTLED'; onSettled: () => void }

export const apexSessionTurnMachine = setup({
  types: {
    context: {} as ApexTurnContext,
    events: {} as ApexTurnEvent,
  },
  guards: {
    optimisticFullySettled: ({ context, event }) =>
      event.type === 'OPTIMISTIC_SETTLED'
      && event.token === context.promptToken
      && !context.runStarted
      && !context.compacting,
    optimisticCompacting: ({ context, event }) =>
      event.type === 'OPTIMISTIC_SETTLED'
      && event.token === context.promptToken
      && !context.runStarted
      && context.compacting,
    extensionCompactionSettled: ({ context }) =>
      context.compacting && !context.inFlightCompact && !context.runStarted,
    compactionEndedDuringActiveRun: ({ context }) =>
      !context.inFlightCompact && context.runStarted,
    settledWhileNotCompacting: ({ context }) => !context.compacting,
  },
}).createMachine({
  id: 'apexSessionTurn',
  context: {
    promptToken: 0,
    runStarted: false,
    compacting: false,
    inFlightCompact: false,
    compactionEnded: false,
    switching: false,
    queuePaused: false,
    wasPausedBeforeSwitch: false,
  },
  initial: 'idle',
  on: {
    RESET_TRANSCRIPT: {
      target: '.idle',
      actions: assign(({ context }) => ({
        promptToken: context.promptToken + 1,
        runStarted: false,
        compacting: false,
        inFlightCompact: false,
        compactionEnded: false,
      })),
    },
    BEGIN_SWITCH: {
      actions: assign(({ context }) => ({
        switching: true,
        wasPausedBeforeSwitch: context.queuePaused,
        queuePaused: true,
      })),
    },
    END_SWITCH: {
      actions: assign(({ context }) => ({
        switching: false,
        queuePaused: context.wasPausedBeforeSwitch,
      })),
    },
    BEGIN_NEW_SESSION: {
      actions: assign({
        switching: true,
        queuePaused: true,
        wasPausedBeforeSwitch: false,
      }),
    },
    NEW_SESSION_READY: {
      actions: assign({
        queuePaused: false,
        wasPausedBeforeSwitch: false,
      }),
    },
    PAUSE_QUEUE: {
      actions: assign(({ event }) => ({
        queuePaused: event.paused,
      })),
    },
    BEGIN_PROMPT: {
      target: '.optimisticPrompt',
      actions: assign(({ context, event }) => {
        const token = context.promptToken + 1
        event.assignToken(token)
        return {
          promptToken: token,
          queuePaused: false,
          runStarted: false,
        }
      }),
    },
    BEGIN_COMPACT: {
      target: '.compacting',
      actions: assign(({ context, event }) => {
        const token = context.promptToken + 1
        event.assignToken(token)
        return {
          promptToken: token,
          queuePaused: false,
          runStarted: false,
          compacting: true,
          inFlightCompact: true,
          compactionEnded: false,
        }
      }),
    },
    FINISH_COMPACT: {
      target: '.idle',
      actions: [
        ({ context, event }) => {
          if (event.token === context.promptToken) {
            event.onSettled(context.compactionEnded)
          }
        },
        assign({
          inFlightCompact: false,
          compacting: false,
          compactionEnded: false,
        }),
      ],
    },
    OPTIMISTIC_SETTLED: [
      {
        guard: 'optimisticFullySettled',
        target: '.idle',
        actions: ({ event }) => {
          event.onDropPlaceholder()
          event.onFullySettled()
        },
      },
      {
        guard: 'optimisticCompacting',
        target: '.compacting',
        actions: ({ event }) => event.onDropPlaceholder(),
      },
    ],
    AGENT_START: {
      target: '.streaming',
      actions: assign({
        runStarted: true,
        compacting: false,
      }),
    },
    COMPACTION_START: {
      target: '.compacting',
      actions: assign(({ context, event }) => ({
        compacting: event.manualOrIdle ? true : context.compacting,
      })),
    },
    COMPACTION_END: [
      {
        guard: 'extensionCompactionSettled',
        target: '.idle',
        actions: [
          ({ event }) => event.onExtensionCompactionSettled(),
          assign({ compactionEnded: true, compacting: false }),
        ],
      },
      {
        guard: 'compactionEndedDuringActiveRun',
        target: '.streaming',
        actions: assign({ compactionEnded: true, compacting: false }),
      },
      {
        actions: assign({ compactionEnded: true }),
      },
    ],
    AGENT_SETTLED: [
      {
        guard: 'settledWhileNotCompacting',
        target: '.idle',
        actions: [
          assign({ runStarted: false }),
          ({ event }) => event.onSettled(),
        ],
      },
      {
        target: '.compacting',
        actions: assign({ runStarted: false }),
      },
    ],
  },
  states: {
    idle: {},
    optimisticPrompt: {},
    streaming: {},
    compacting: {},
  },
})
