import { assign, createActor, setup, type ActorRefFrom } from 'xstate'

export type ScheduleServiceEvent =
  | { type: 'START' }
  | { type: 'STOP' }
  | { type: 'RUN_STARTED' }
  | { type: 'RUN_FINISHED' }

/**
 * Lifecycle for AutomationService: gates timer arming and queue draining,
 * and coordinates graceful stop while active runs finish.
 */
export const scheduleServiceMachine = setup({
  types: {
    context: {} as { activeRuns: number },
    events: {} as ScheduleServiceEvent,
  },
  guards: {
    hasActiveRuns: ({ context }) => context.activeRuns > 0,
    isLastRun: ({ context }) => context.activeRuns <= 1,
  },
  actions: {
    incRuns: assign({ activeRuns: ({ context }) => context.activeRuns + 1 }),
    decRuns: assign({ activeRuns: ({ context }) => Math.max(0, context.activeRuns - 1) }),
  },
}).createMachine({
  id: 'scheduleService',
  initial: 'running',
  context: { activeRuns: 0 },
  states: {
    running: {
      initial: 'idle',
      on: {
        STOP: [
          { guard: 'hasActiveRuns', target: 'stopping' },
          { target: 'closed' },
        ],
      },
      states: {
        idle: {
          on: {
            RUN_STARTED: { target: 'executing', actions: 'incRuns' },
          },
        },
        executing: {
          on: {
            RUN_STARTED: { actions: 'incRuns' },
            RUN_FINISHED: [
              { guard: 'isLastRun', target: 'idle', actions: 'decRuns' },
              { actions: 'decRuns' },
            ],
          },
        },
      },
    },
    stopping: {
      on: {
        RUN_FINISHED: [
          { guard: 'isLastRun', target: 'closed', actions: 'decRuns' },
          { actions: 'decRuns' },
        ],
      },
    },
    closed: {
      on: {
        START: 'running',
      },
    },
  },
})

export type ScheduleServiceLifecycle = ActorRefFrom<typeof scheduleServiceMachine>

export function createScheduleServiceLifecycle(): ScheduleServiceLifecycle {
  return createActor(scheduleServiceMachine).start()
}
