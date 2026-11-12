import { assign, setup } from 'xstate'
import type { TranscriptReconciliationMarker } from '@/app/agent-events'
import type { ApexEventBuffer } from '@/lib/events'

export interface TranscriptLoad {
  generation: number
  sessionFile: string
  eventBuffer: ApexEventBuffer
  runtimeId?: string
  reconciliation: boolean
  admissionRevision: number
}

export type WorkspaceLoadEvent =
  | { type: 'ACTIVATE'; load: TranscriptLoad | null }
  | { type: 'READ_STARTED'; load: TranscriptLoad }
  | { type: 'READ_SETTLED'; load: TranscriptLoad }
  | { type: 'LOAD_CANCELLED' }
  | { type: 'PROMPT_ADMITTED'; generation: number }
  | { type: 'PROMPT_SETTLED' }
  | { type: 'RECONCILIATION_NEEDED'; marker: TranscriptReconciliationMarker | null }
  | { type: 'RECONCILIATION_DEFERRED'; marker: TranscriptReconciliationMarker | null }

interface WorkspaceLoadContext {
  /** Admitted or in-flight transcript read; its event buffer holds live events until the read settles. */
  load: TranscriptLoad | null
  /** Bumped per admitted prompt; a read captured before a bump is stale. */
  promptRevision: number
  /** Generation whose prompt is admitted but has not yet started or failed. */
  promptGeneration: number | null
  reconciliationNeeded: TranscriptReconciliationMarker | null
  deferredReconciliation: TranscriptReconciliationMarker | null
}

// Phases: idle (no load) -> admitted (load buffering events, read not started)
// -> reading (initial read in flight) | reconciling (post-turn read in flight)
// -> idle on settle, cancel, or workspace activation. Every load exits through
// READ_SETTLED or LOAD_CANCELLED, so the initial-load indicator cannot stick.
export const workspaceLoadMachine = setup({
  types: {
    context: {} as WorkspaceLoadContext,
    events: {} as WorkspaceLoadEvent,
  },
}).createMachine({
  id: 'workspaceLoad',
  context: {
    load: null,
    promptRevision: 0,
    promptGeneration: null,
    reconciliationNeeded: null,
    deferredReconciliation: null,
  },
  initial: 'idle',
  on: {
    ACTIVATE: {
      target: '#workspaceLoad.idle',
      actions: assign(({ event }) => ({
        load: event.load,
        promptRevision: 0,
        promptGeneration: null,
        reconciliationNeeded: null,
        deferredReconciliation: null,
      })),
    },
    READ_STARTED: [
      {
        guard: ({ event }) => event.load.reconciliation,
        target: '#workspaceLoad.reconciling',
        actions: assign({ load: ({ event }) => event.load }),
      },
      {
        target: '#workspaceLoad.reading',
        actions: assign({ load: ({ event }) => event.load }),
      },
    ],
    READ_SETTLED: {
      guard: ({ context, event }) => context.load === event.load,
      target: '#workspaceLoad.idle',
      actions: assign({ load: null }),
    },
    LOAD_CANCELLED: {
      target: '#workspaceLoad.idle',
      actions: assign({ load: null, deferredReconciliation: null }),
    },
    PROMPT_ADMITTED: {
      actions: assign(({ context, event }) => ({
        promptRevision: context.promptRevision + 1,
        promptGeneration: event.generation,
        reconciliationNeeded: null,
      })),
    },
    PROMPT_SETTLED: {
      actions: assign({ promptGeneration: null }),
    },
    RECONCILIATION_NEEDED: {
      actions: assign({ reconciliationNeeded: ({ event }) => event.marker }),
    },
    RECONCILIATION_DEFERRED: {
      actions: assign({ deferredReconciliation: ({ event }) => event.marker }),
    },
  },
  states: {
    idle: {
      always: { guard: ({ context }) => context.load !== null, target: 'admitted' },
    },
    admitted: {},
    reading: {},
    reconciling: {},
  },
})
