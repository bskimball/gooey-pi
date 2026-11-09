import { assign, fromPromise, setup } from 'xstate'

export type ReplyFeedbackState = 'idle' | 'sending' | 'sent' | 'failed'

interface Context {
  draft: string
  sendReply: (() => Promise<void>) | null
}

type Event =
  | { type: 'EDIT'; draft: string }
  | { type: 'SUBMIT'; sendReply: () => Promise<void> }
  | { type: 'RESET' }

export const activityReplyMachine = setup({
  types: { context: {} as Context, events: {} as Event },
  actors: {
    deliver: fromPromise<void, () => Promise<void>>(({ input }) => input()),
  },
}).createMachine({
  id: 'activityReply',
  context: {
    draft: '',
    sendReply: null,
  },
  initial: 'idle',
  on: {
    RESET: {
      target: '.idle',
      actions: assign({ draft: '', sendReply: null }),
    },
  },
  states: {
    idle: {
      on: {
        EDIT: { actions: assign(({ event }) => ({ draft: event.draft })) },
        SUBMIT: {
          target: 'sending',
          actions: assign(({ event }) => ({ sendReply: event.sendReply })),
        },
      },
    },
    sending: {
      invoke: {
        src: 'deliver',
        input: ({ context }) => context.sendReply!,
        onDone: {
          target: 'sent',
          actions: assign({ draft: '', sendReply: null }),
        },
        onError: {
          target: 'failed',
          actions: assign({ sendReply: null }),
        },
      },
    },
    sent: {
      after: {
        2200: { target: 'idle' },
      },
      on: {
        EDIT: {
          target: 'idle',
          actions: assign(({ event }) => ({ draft: event.draft })),
        },
        SUBMIT: {
          target: 'sending',
          actions: assign(({ event }) => ({ sendReply: event.sendReply })),
        },
      },
    },
    failed: {
      on: {
        EDIT: {
          target: 'idle',
          actions: assign(({ event }) => ({ draft: event.draft })),
        },
        SUBMIT: {
          target: 'sending',
          actions: assign(({ event }) => ({ sendReply: event.sendReply })),
        },
      },
    },
  },
})
