import { assign, setup } from 'xstate'
import type { SessionRecord, SessionStatus } from '@/types/api'

/** Renderer-owned lifecycle states. `unknown` is catalog-only and seeds as idle. */
export type SessionStatusState = Exclude<SessionStatus, 'unknown'>

export interface SessionStatusContext {
  /** Per-session lifecycle revision; every handled trigger advances it. */
  revision: number
  unread: boolean
}

/** Lifecycle triggers, normalized from raw runtime and UI events. */
export type SessionStatusTrigger =
  | { type: 'AGENT_STARTED' }
  | { type: 'COMPACTION_FINISHED' }
  | { type: 'TURN_ENDED' }
  | { type: 'TURN_FAILED' }
  | { type: 'ATTENTION_REQUIRED' }
  | { type: 'QUESTION_RESOLVED' }
  | { type: 'RUNTIME_EXITED'; expected: boolean }

/** `visible` decides whether a terminal or attention trigger leaves the session unread. */
export type SessionStatusEvent = SessionStatusTrigger & { visible: boolean }

export type SessionStatusSource = Pick<SessionRecord, 'status' | 'eventRevision' | 'unread'>

export const sessionStatusMachine = setup({
  types: {
    context: {} as SessionStatusContext,
    events: {} as SessionStatusEvent,
  },
  guards: {
    expectedExit: ({ event }) => event.type === 'RUNTIME_EXITED' && event.expected,
  },
}).createMachine({
  id: 'sessionStatus',
  initial: 'idle',
  context: { revision: 0, unread: false },
  on: {
    AGENT_STARTED: {
      target: '.running',
      actions: assign(({ context }) => ({ revision: context.revision + 1, unread: false })),
    },
    COMPACTION_FINISHED: {
      target: '.complete',
      actions: assign(({ context }) => ({ revision: context.revision + 1, unread: false })),
    },
    TURN_ENDED: {
      target: '.complete',
      actions: assign(({ context, event }) => ({ revision: context.revision + 1, unread: !event.visible })),
    },
    TURN_FAILED: {
      target: '.failed',
      actions: assign(({ context }) => ({ revision: context.revision + 1 })),
    },
    ATTENTION_REQUIRED: {
      target: '.waiting',
      actions: assign(({ context, event }) => ({ revision: context.revision + 1, unread: !event.visible })),
    },
  },
  states: {
    idle: {},
    running: {
      on: {
        RUNTIME_EXITED: [
          {
            guard: 'expectedExit',
            target: 'complete',
            actions: assign(({ context, event }) => ({ revision: context.revision + 1, unread: !event.visible })),
          },
          {
            target: 'failed',
            actions: assign(({ context }) => ({ revision: context.revision + 1 })),
          },
        ],
      },
    },
    waiting: {
      on: {
        QUESTION_RESOLVED: {
          target: 'running',
          actions: assign(({ context }) => ({ revision: context.revision + 1, unread: false })),
        },
        RUNTIME_EXITED: [
          {
            guard: 'expectedExit',
            target: 'complete',
            actions: assign(({ context, event }) => ({ revision: context.revision + 1, unread: !event.visible })),
          },
          {
            target: 'failed',
            actions: assign(({ context }) => ({ revision: context.revision + 1 })),
          },
        ],
      },
    },
    complete: {},
    failed: {},
  },
})

/** Pure seed for a stored session; the machine state is exactly the stored status. */
export function sessionStatusSnapshot(session: SessionStatusSource) {
  return sessionStatusMachine.resolveState({
    value: session.status === 'unknown' ? 'idle' : session.status,
    context: { revision: session.eventRevision ?? 0, unread: session.unread === true },
  })
}
