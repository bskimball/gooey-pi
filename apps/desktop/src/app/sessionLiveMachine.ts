import { assign, setup, transition } from 'xstate'
import type { PrimeContextUsage, SessionUsage } from '@/types/api'

/**
 * Live phases a running session can be in. `waiting` is not a phase: a pending
 * question is orthogonal to the run and lives in `pendingQuestion`.
 */
export type SessionLivePhase = 'idle' | 'thinking' | 'tool' | 'compacting' | 'retrying'

export interface SessionLiveTool {
  id?: string
  name: string
  summary?: string
  startedAt: number
}

export interface SessionLiveQuestion {
  id: string
  title: string
  method: string
  options?: string[]
  deadline?: number
  runtimeId: string
}

export interface SessionLiveContext {
  runtimeId: string
  lastEventAt: number
  currentTool?: SessionLiveTool
  runStartedAt?: number
  contextUsage?: PrimeContextUsage
  sessionUsage?: SessionUsage
  queuedCount?: number
  lastError?: string
  pendingQuestion?: SessionLiveQuestion
  /** Phase to return to when a compaction ends without a retry: `thinking` when a run was active. */
  compactionResume?: 'idle' | 'thinking'
}

export interface SessionLive extends SessionLiveContext {
  phase: SessionLivePhase
}

export interface SessionLiveToolInfo {
  id?: string
  name: string
  summary?: string
}

/** Normalized agent events. Raw payload parsing happens in session-live.ts before a transition. */
export type SessionLiveEvent =
  | { type: 'RUN_STARTED'; now: number; resetClock: boolean }
  | { type: 'TEXT_DELTA'; now: number }
  | { type: 'TOOL_STARTED'; now: number; tool: SessionLiveToolInfo }
  | { type: 'TOOL_UPDATED'; now: number; tool: SessionLiveToolInfo }
  | { type: 'TOOL_ENDED'; now: number }
  | { type: 'COMPACTION_STARTED'; now: number }
  | { type: 'COMPACTION_ENDED'; now: number; willRetry: boolean }
  | { type: 'RETRY_STARTED'; now: number }
  | { type: 'RETRY_SUCCEEDED'; now: number }
  | { type: 'RETRY_FAILED'; now: number; error?: string }
  | { type: 'RUN_FAILED'; now: number; error?: string }
  | { type: 'RUN_ENDED'; now: number }
  | { type: 'MESSAGE_ERRORED'; now: number; error?: string }
  | { type: 'QUESTION_OPENED'; now: number; question: SessionLiveQuestion }

/**
 * Agent event types that end a turn or run. Shared by renderer live state and
 * the status trigger mapping so the two cannot disagree on what terminates.
 */
export const SESSION_RUN_TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'agent_end',
  'error',
  'extension_error',
  'transport_error',
])

/** Advance the live timestamp and keep the run clock running. */
function touch({ context, event }: { context: SessionLiveContext; event: SessionLiveEvent }) {
  return { lastEventAt: event.now, runStartedAt: context.runStartedAt ?? event.now }
}

function compactionStartPatch(context: SessionLiveContext, event: SessionLiveEvent, resume: 'idle' | 'thinking') {
  return { ...touch({ context, event }), currentTool: undefined, compactionResume: resume }
}

function runStartPatch(context: SessionLiveContext, event: SessionLiveEvent & { type: 'RUN_STARTED' }) {
  return {
    lastEventAt: event.now,
    runStartedAt: event.resetClock ? event.now : context.runStartedAt ?? event.now,
    currentTool: undefined,
    lastError: undefined,
    pendingQuestion: undefined,
  }
}

export const sessionLiveMachine = setup({
  types: {
    input: {} as SessionLiveContext,
    context: {} as SessionLiveContext,
    events: {} as SessionLiveEvent,
  },
}).createMachine({
  id: 'sessionLive',
  context: ({ input }) => input,
  initial: 'idle',
  on: {
    RUN_STARTED: {
      target: '.thinking',
      actions: assign(({ context, event }) => runStartPatch(context, event)),
    },
    TEXT_DELTA: {
      target: '.thinking',
      actions: assign(({ context, event }) => ({ ...touch({ context, event }), currentTool: undefined })),
    },
    TOOL_STARTED: {
      target: '.tool',
      actions: assign(({ context, event }) => ({
        ...touch({ context, event }),
        currentTool: { ...event.tool, startedAt: event.now },
      })),
    },
    TOOL_UPDATED: {
      target: '.tool',
      actions: assign(({ context, event }) => ({
        ...touch({ context, event }),
        currentTool: { ...event.tool, startedAt: context.currentTool?.startedAt ?? event.now },
      })),
    },
    TOOL_ENDED: {
      target: '.thinking',
      actions: assign(({ context, event }) => ({
        ...touch({ context, event }),
        currentTool: undefined,
        pendingQuestion: undefined,
      })),
    },
    RETRY_STARTED: {
      target: '.retrying',
      actions: assign(({ context, event }) => ({ ...touch({ context, event }), currentTool: undefined })),
    },
    RETRY_SUCCEEDED: {
      target: '.thinking',
      actions: assign(({ context, event }) => ({ ...touch({ context, event }), currentTool: undefined })),
    },
    RETRY_FAILED: {
      target: '.idle',
      actions: assign(({ context, event }) => ({
        lastEventAt: event.now,
        currentTool: undefined,
        runStartedAt: undefined,
        pendingQuestion: undefined,
        lastError: event.error ?? context.lastError,
      })),
    },
    RUN_FAILED: {
      target: '.idle',
      actions: assign(({ context, event }) => ({
        lastEventAt: event.now,
        currentTool: undefined,
        runStartedAt: undefined,
        pendingQuestion: undefined,
        lastError: event.error ?? context.lastError,
      })),
    },
    RUN_ENDED: {
      target: '.idle',
      actions: assign(({ event }) => ({
        lastEventAt: event.now,
        currentTool: undefined,
        runStartedAt: undefined,
        pendingQuestion: undefined,
      })),
    },
    MESSAGE_ERRORED: {
      actions: assign(({ context, event }) => ({
        lastEventAt: event.now,
        lastError: event.error ?? context.lastError,
      })),
    },
    QUESTION_OPENED: {
      actions: assign(({ event }) => ({ lastEventAt: event.now, pendingQuestion: event.question })),
    },
  },
  states: {
    idle: {
      on: {
        COMPACTION_STARTED: {
          target: 'compacting',
          actions: assign(({ context, event }) => compactionStartPatch(context, event, 'idle')),
        },
      },
    },
    thinking: {
      on: {
        COMPACTION_STARTED: {
          target: 'compacting',
          actions: assign(({ context, event }) => compactionStartPatch(context, event, 'thinking')),
        },
      },
    },
    tool: {
      on: {
        COMPACTION_STARTED: {
          target: 'compacting',
          actions: assign(({ context, event }) => compactionStartPatch(context, event, 'thinking')),
        },
      },
    },
    retrying: {
      on: {
        COMPACTION_STARTED: {
          target: 'compacting',
          actions: assign(({ context, event }) => compactionStartPatch(context, event, 'thinking')),
        },
      },
    },
    compacting: {
      on: {
        COMPACTION_STARTED: {
          actions: assign(({ context, event }) => ({ ...touch({ context, event }), currentTool: undefined })),
        },
        TEXT_DELTA: {
          actions: assign(({ context, event }) => ({ ...touch({ context, event }), currentTool: undefined })),
        },
        COMPACTION_ENDED: [
          {
            guard: ({ context, event }) => event.willRetry || context.compactionResume === 'thinking',
            target: 'thinking',
            actions: assign(({ context, event }) => ({ ...touch({ context, event }), currentTool: undefined })),
          },
          {
            target: 'idle',
            actions: assign(({ event }) => ({ lastEventAt: event.now, currentTool: undefined, runStartedAt: undefined })),
          },
        ],
      },
    },
  },
})

/** Machine snapshot for a stored live entry; the state value is exactly its phase. */
export function sessionLiveSnapshot(live: SessionLive) {
  const { phase, ...context } = live
  return sessionLiveMachine.resolveState({ value: phase, context })
}

/** Strips unset keys so stored entries keep the optional-field shape consumers expect. */
export function sessionLiveFromSnapshot(snapshot: ReturnType<typeof sessionLiveSnapshot>): SessionLive {
  const entries = Object.entries(snapshot.context).filter(([, value]) => value !== undefined)
  return { ...Object.fromEntries(entries), phase: snapshot.value as SessionLivePhase } as SessionLive
}

/** Applies one normalized event to a live entry and returns the next entry. */
export function applySessionLiveEvent(live: SessionLive, event: SessionLiveEvent): SessionLive {
  const [next] = transition(sessionLiveMachine, sessionLiveSnapshot(live), event)
  return sessionLiveFromSnapshot(next)
}
