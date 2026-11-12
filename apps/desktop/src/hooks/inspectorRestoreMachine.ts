import { setup } from 'xstate'

// Tracks whether the inspector was hidden only because the compact layout needed the
// sidebar. Any user reopen, or an external clear, drops the pending restore so the
// inspector does not reappear on a later widen.
export const inspectorRestoreMachine = setup({
  types: { events: {} as { type: 'HIDE' } | { type: 'CLEAR' } },
}).createMachine({
  id: 'inspectorRestore',
  initial: 'idle',
  states: {
    idle: {
      on: { HIDE: { target: 'compactHidden' } },
    },
    compactHidden: {
      on: { CLEAR: { target: 'idle' } },
    },
  },
})
