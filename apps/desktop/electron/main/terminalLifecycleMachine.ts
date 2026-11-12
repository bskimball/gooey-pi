import { createActor, setup, type ActorRefFrom } from 'xstate'

type Event = { type: 'KILL' } | { type: 'KILL_FAILED' } | { type: 'EXITED' }

/**
 * One PTY's lifecycle. A kill that fails while the process is still alive
 * returns it to running, so its output and active context come back.
 */
export const terminalLifecycleMachine = setup({
  types: { events: {} as Event },
}).createMachine({
  id: 'terminalLifecycle',
  initial: 'running',
  states: {
    running: { on: { KILL: 'terminating', EXITED: 'exited' } },
    terminating: { on: { KILL_FAILED: 'running', EXITED: 'exited' } },
    exited: {},
  },
})

export type TerminalLifecycle = ActorRefFrom<typeof terminalLifecycleMachine>

export function createTerminalLifecycle(): TerminalLifecycle {
  return createActor(terminalLifecycleMachine).start()
}

export function isTerminalTerminating(lifecycle: TerminalLifecycle): boolean {
  return lifecycle.getSnapshot().matches('terminating')
}

export function isTerminalExited(lifecycle: TerminalLifecycle): boolean {
  return lifecycle.getSnapshot().matches('exited')
}

export function isTerminalRunning(lifecycle: TerminalLifecycle): boolean {
  return lifecycle.getSnapshot().matches('running')
}
