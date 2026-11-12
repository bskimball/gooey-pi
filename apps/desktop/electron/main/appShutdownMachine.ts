import { createActor, setup, type ActorRefFrom } from 'xstate'

type Event =
  | { type: 'CONFIRM' }
  | { type: 'DISMISS' }
  | { type: 'APPROVE' }
  | { type: 'START' }

/**
 * Quit lifecycle for the main process. `confirming` blocks teardown: a quit
 * requested while the close dialog is open waits for the user's answer.
 */
export const appShutdownMachine = setup({
  types: { events: {} as Event },
}).createMachine({
  id: 'appShutdown',
  initial: 'running',
  states: {
    running: { on: { CONFIRM: 'confirming', APPROVE: 'approved', START: 'shuttingDown' } },
    confirming: { on: { APPROVE: 'approved', DISMISS: 'running' } },
    approved: { on: { START: 'shuttingDown' } },
    shuttingDown: {},
  },
})

export type AppShutdown = ActorRefFrom<typeof appShutdownMachine>

export function createAppShutdown(): AppShutdown {
  return createActor(appShutdownMachine).start()
}

export function isShutdownStarted(shutdown: AppShutdown): boolean {
  return shutdown.getSnapshot().matches('shuttingDown')
}

export function isShutdownApproved(shutdown: AppShutdown): boolean {
  return shutdown.getSnapshot().matches('approved')
}

export function isShutdownConfirming(shutdown: AppShutdown): boolean {
  return shutdown.getSnapshot().matches('confirming')
}
