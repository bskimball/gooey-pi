import { assign, setup } from 'xstate'

type BusyKind = 'switch' | 'create' | null

interface CheckoutPickerContext {
  branch: string
  error: string
  busyKind: BusyKind
}

type CheckoutPickerEvent =
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | { type: 'TOGGLE' }
  | { type: 'SET_BRANCH'; branch: string }
  | { type: 'SWITCH' }
  | { type: 'CREATE' }
  | { type: 'SUCCEED' }
  | { type: 'FAIL'; message: string }

export const checkoutPickerMachine = setup({
  types: {
    context: {} as CheckoutPickerContext,
    events: {} as CheckoutPickerEvent,
  },
  guards: {
    hasBranchName: ({ context }) => context.branch.trim().length > 0,
  },
  actions: {
    clearError: assign({ error: '' }),
    setBranch: assign(({ event }) =>
      event.type === 'SET_BRANCH' ? { branch: event.branch, error: '' } : {},
    ),
    startSwitch: assign({ error: '', busyKind: 'switch' as BusyKind }),
    startCreate: assign({ error: '', busyKind: 'create' as BusyKind }),
    finishSuccess: assign(({ context }) => ({
      branch: context.busyKind === 'create' ? '' : context.branch,
      error: '',
      busyKind: null as BusyKind,
    })),
    finishFailure: assign(({ event }) => ({
      error: event.type === 'FAIL' ? event.message : 'Could not change checkout',
      busyKind: null as BusyKind,
    })),
  },
}).createMachine({
  id: 'checkoutPicker',
  initial: 'closed',
  context: {
    branch: '',
    error: '',
    busyKind: null,
  },
  states: {
    closed: {
      on: {
        OPEN: { target: 'open.idle', actions: 'clearError' },
        TOGGLE: { target: 'open.idle', actions: 'clearError' },
      },
    },
    open: {
      initial: 'idle',
      on: {
        CLOSE: { target: 'closed', actions: 'clearError' },
        TOGGLE: { target: 'closed', actions: 'clearError' },
      },
      states: {
        idle: {
          on: {
            SET_BRANCH: { actions: 'setBranch' },
            SWITCH: { target: 'busy', actions: 'startSwitch' },
            CREATE: {
              guard: 'hasBranchName',
              target: 'busy',
              actions: 'startCreate',
            },
          },
        },
        busy: {
          on: {
            SET_BRANCH: {
              actions: assign(({ event }) =>
                event.type === 'SET_BRANCH' ? { branch: event.branch } : {},
              ),
            },
            SUCCEED: {
              target: '#checkoutPicker.closed',
              actions: 'finishSuccess',
            },
            FAIL: {
              target: 'error',
              actions: 'finishFailure',
            },
          },
        },
        error: {
          on: {
            SET_BRANCH: { target: 'idle', actions: 'setBranch' },
            SWITCH: { target: 'busy', actions: 'startSwitch' },
            CREATE: {
              guard: 'hasBranchName',
              target: 'busy',
              actions: 'startCreate',
            },
          },
        },
      },
    },
  },
})
