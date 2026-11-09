import { assign, fromPromise, setup } from 'xstate'
import type { SessionSummary } from '../src/protocol'

export interface ListedSessions {
  sessions: SessionSummary[]
  currentPath: string | null
}

interface Context {
  items: SessionSummary[]
  currentPath: string | null
  reportError: boolean
  listSessions: (() => Promise<ListedSessions>) | null
  onNotice: ((text: string) => void) | null
}

type Event =
  | { type: 'TOGGLE' }
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | {
      type: 'REFRESH'
      reportError: boolean
      listSessions: () => Promise<ListedSessions>
      onNotice: (text: string) => void
    }
  | {
      type: 'CURRENT_CHANGED'
      path: string | null
      listSessions: () => Promise<ListedSessions>
      onNotice: (text: string) => void
    }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const sessionPickerMachine = setup({
  types: { context: {} as Context, events: {} as Event },
  actors: {
    list: fromPromise<ListedSessions, () => Promise<ListedSessions>>(({ input }) => input()),
  },
}).createMachine({
  id: 'sessionPicker',
  context: {
    items: [],
    currentPath: null,
    reportError: false,
    listSessions: null,
    onNotice: null,
  },
  type: 'parallel',
  states: {
    disclosure: {
      initial: 'closed',
      states: {
        closed: {
          on: {
            TOGGLE: { target: 'open' },
            OPEN: { target: 'open' },
          },
        },
        open: {
          on: {
            TOGGLE: { target: 'closed' },
            CLOSE: { target: 'closed' },
          },
        },
      },
    },
    catalog: {
      initial: 'idle',
      states: {
        idle: {
          on: {
            REFRESH: {
              target: 'loading',
              actions: assign(({ event }) => ({
                reportError: event.reportError,
                listSessions: event.listSessions,
                onNotice: event.onNotice,
              })),
            },
            CURRENT_CHANGED: {
              target: 'loading',
              actions: assign(({ event }) => ({
                currentPath: event.path,
                reportError: false,
                listSessions: event.listSessions,
                onNotice: event.onNotice,
              })),
            },
          },
        },
        loading: {
          invoke: {
            src: 'list',
            input: ({ context }) => context.listSessions!,
            onDone: {
              target: 'idle',
              actions: assign(({ event }) => ({
                items: event.output.sessions,
                currentPath: event.output.currentPath,
              })),
            },
            onError: [
              {
                guard: ({ context }) => context.reportError,
                target: ['#sessionPicker.disclosure.closed', 'idle'],
                actions: ({ context, event }) => context.onNotice?.(errorMessage(event.error)),
              },
              {
                target: 'idle',
              },
            ],
          },
          on: {
            REFRESH: {
              target: 'loading',
              reenter: true,
              actions: assign(({ event }) => ({
                reportError: event.reportError,
                listSessions: event.listSessions,
                onNotice: event.onNotice,
              })),
            },
            CURRENT_CHANGED: {
              target: 'loading',
              reenter: true,
              actions: assign(({ event }) => ({
                currentPath: event.path,
                reportError: false,
                listSessions: event.listSessions,
                onNotice: event.onNotice,
              })),
            },
          },
        },
      },
    },
  },
})
