import { setup, transition } from 'xstate'

/**
 * One specialist's lifecycle as reported by the parent's task_* receipts.
 * Receipts are replayed through this machine, so a terminal outcome can only
 * be reopened by a new generation (RUNNING), never by a late abort or close.
 */
export type SpecialistEvent =
  | { type: 'RUNNING' }
  | { type: 'UI_REQUESTS'; waiting: boolean }
  | { type: 'SETTLED' }
  | { type: 'FAILED' }
  | { type: 'ABORTED' }
  | { type: 'CLOSED' }

export const specialistMachine = setup({
  types: { events: {} as SpecialistEvent },
  guards: {
    waiting: ({ event }) => event.type === 'UI_REQUESTS' && event.waiting,
    notWaiting: ({ event }) => event.type === 'UI_REQUESTS' && !event.waiting,
  },
}).createMachine({
  id: 'specialist',
  initial: 'running',
  on: {
    RUNNING: '.running',
    FAILED: '.error',
  },
  states: {
    running: {
      on: { SETTLED: 'done', ABORTED: 'stopped', CLOSED: 'closed', UI_REQUESTS: { guard: 'waiting', target: 'waiting' } },
    },
    waiting: {
      on: { SETTLED: 'done', ABORTED: 'stopped', CLOSED: 'closed', UI_REQUESTS: { guard: 'notWaiting', target: 'running' } },
    },
    done: {},
    error: {},
    stopped: {},
    closed: {
      on: { SETTLED: 'done', ABORTED: 'stopped' },
    },
  },
})

export type SpecialistStatus = 'running' | 'waiting' | 'done' | 'error' | 'stopped' | 'closed'

export function applySpecialistEvents(status: SpecialistStatus, events: readonly SpecialistEvent[]): SpecialistStatus {
  let snapshot = specialistMachine.resolveState({ value: status })
  for (const event of events) [snapshot] = transition(specialistMachine, snapshot, event)
  return snapshot.value as SpecialistStatus
}

export const isLiveSpecialist = (status: SpecialistStatus): boolean => status === 'running' || status === 'waiting'
