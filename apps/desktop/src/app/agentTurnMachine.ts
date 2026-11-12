import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assign, initialTransition, setup, transition, type SnapshotFrom } from 'xstate'

// Renderer-side view of one runtime's agent turn. The main process's
// RuntimeInfo.isStreaming stays the source of truth; these events mirror it
// (RUNTIME_*) and add the renderer's own lifecycle markers: submission
// admission (SUBMIT/ADMISSION_ENDED), a prompt handed to the agent (ADMITTED),
// stop requests, and the queue flush gate that decides when a queued prompt may
// be sent while idle.
export type AgentTurnEvent =
  | { type: 'SUBMIT'; submissionId?: number }
  | { type: 'ADMISSION_ENDED'; submissionId?: number }
  | { type: 'WORKSPACE_CHANGED' }
  | { type: 'ADMITTED' }
  | { type: 'PROMPT_SETTLED' }
  | { type: 'MIRRORED_IDLE' }
  | { type: 'RUNTIME_STREAMING' }
  | { type: 'RUNTIME_IDLE' }
  | { type: 'RUNTIME_CHANGED' }
  | { type: 'STOP' }
  | { type: 'STOP_SETTLED' }
  | { type: 'FLUSH_START' }
  | { type: 'FLUSH_DONE' }
  | { type: 'FLUSH_FAILED' }
  | { type: 'FLUSH_RETRY' }

interface AgentTurnContext {
  submissionId: number
}

export const agentTurnMachine = setup({
  types: {
    context: {} as AgentTurnContext,
    events: {} as AgentTurnEvent,
  },
}).createMachine({
  id: 'agentTurn',
  type: 'parallel',
  context: { submissionId: 0 },
  states: {
    // Single-flight gate for a submission's async admission. Ends with the
    // submission whether or not a turn started, and clears when the active
    // workspace switches so an older background start never blocks the new view.
    admission: {
      initial: 'idle',
      on: { RUNTIME_CHANGED: '.idle', WORKSPACE_CHANGED: '.idle' },
      states: {
        idle: {
          on: {
            SUBMIT: {
              target: 'admitting',
              actions: assign({
                submissionId: ({ context, event }) => event.submissionId ?? context.submissionId + 1,
              }),
            },
          },
        },
        admitting: {
          on: {
            ADMISSION_ENDED: {
              guard: ({ context, event }) => event.submissionId === undefined || event.submissionId === context.submissionId,
              target: 'idle',
            },
          },
        },
      },
    },
    turn: {
      initial: 'idle',
      // An idle mirror may predate prompt admission. Keep optimism until the
      // prompt settles, starts streaming, is rejected, or is stopped.
      on: {
        ADMITTED: { target: '.optimistic' },
        MIRRORED_IDLE: { target: '.idle' },
        RUNTIME_STREAMING: { target: '.streaming' },
        // A different runtime or workspace starts with no turn of its own; the
        // mirror effect then reports its isStreaming.
        RUNTIME_CHANGED: { target: '.idle' },
        WORKSPACE_CHANGED: { target: '.idle' },
      },
      states: {
        optimistic: {
          on: {
            MIRRORED_IDLE: {},
            PROMPT_SETTLED: 'idle',
            RUNTIME_IDLE: 'idle',
            STOP: 'stopping',
          },
        },
        idle: {
          on: { RUNTIME_IDLE: { target: 'idle' } },
        },
        streaming: {
          on: {
            RUNTIME_IDLE: { target: 'idle' },
            STOP: { target: 'stopping' },
          },
        },
        stopping: {
          on: {
            STOP_SETTLED: { target: 'idle' },
            RUNTIME_IDLE: { target: 'idle' },
          },
        },
      },
    },
    queue: {
      initial: 'idle',
      states: {
        idle: {
          on: { FLUSH_START: { target: 'flushing' } },
        },
        flushing: {
          on: {
            FLUSH_DONE: { target: 'idle' },
            FLUSH_FAILED: { target: 'failed' },
          },
        },
        // A failed head stays parked until FLUSH_RETRY; the caller schedules
        // that retry so an idle failure cannot stall the queue forever.
        failed: {
          on: {
            FLUSH_RETRY: { target: 'idle' },
            // A cleared failure (agent_end) re-enters the flush directly.
            FLUSH_START: { target: 'flushing' },
          },
        },
      },
    },
  },
})

export type AgentTurnSnapshot = SnapshotFrom<typeof agentTurnMachine>

export function initialAgentTurn(): AgentTurnSnapshot {
  const [snapshot] = initialTransition(agentTurnMachine)
  return snapshot
}

export function agentTurnTransition(snapshot: AgentTurnSnapshot, event: AgentTurnEvent): AgentTurnSnapshot {
  const [next] = transition(agentTurnMachine, snapshot, event)
  return next
}

// Busy while a turn is streaming or stopping. Submission admission is a
// separate region: it gates a second submit but does not show the stop control.
export function isAgentBusy(snapshot: AgentTurnSnapshot): boolean {
  return !snapshot.matches({ turn: 'idle' })
}

export function isSubmissionAdmitting(snapshot: AgentTurnSnapshot): boolean {
  return snapshot.matches({ admission: 'admitting' })
}

// Delay before an idle-failed queued prompt is retried; keeps a failing bridge from spinning.
export const QUEUE_FLUSH_RETRY_MS = 3_000

// Synchronous access for the send path, which must admit or refuse a submit
// before React re-renders.
export interface AgentTurnHandle {
  current(): AgentTurnSnapshot
  send(event: AgentTurnEvent): void
}

// Non-React handle with the same synchronous semantics as useAgentTurn, for
// callers that run outside a component.
export function createAgentTurnHandle(): AgentTurnHandle {
  let snapshot = initialAgentTurn()
  return {
    current: () => snapshot,
    send: (event) => { snapshot = agentTurnTransition(snapshot, event) },
  }
}

// Renderer state for one runtime's turn. The ref is advanced synchronously in
// send(), so handle.current() reflects the latest event even within one tick.
/** RuntimeInfo is main-process truth; its identity and isStreaming are mirrored into the turn. */
export function useAgentTurn(runtimeId: string | undefined, runtimeStreaming: boolean, workspaceGeneration?: number) {
  const [snapshot, setSnapshot] = useState(initialAgentTurn)
  const ref = useRef(snapshot)
  const send = useCallback((event: AgentTurnEvent) => {
    ref.current = agentTurnTransition(ref.current, event)
    setSnapshot(ref.current)
  }, [])
  const mirroredRuntimeIdRef = useRef(runtimeId)
  const mirroredGenerationRef = useRef(workspaceGeneration)
  useEffect(() => {
    const generationChanged = workspaceGeneration !== undefined && mirroredGenerationRef.current !== workspaceGeneration
    mirroredGenerationRef.current = workspaceGeneration
    if (mirroredRuntimeIdRef.current !== runtimeId) {
      const firstRuntime = mirroredRuntimeIdRef.current === undefined && runtimeId !== undefined && !generationChanged
      mirroredRuntimeIdRef.current = runtimeId
      if (!firstRuntime || !ref.current.matches({ turn: 'optimistic' })) send({ type: 'RUNTIME_CHANGED' })
    } else if (generationChanged) {
      send({ type: 'WORKSPACE_CHANGED' })
    }
    send({ type: runtimeStreaming ? 'RUNTIME_STREAMING' : 'MIRRORED_IDLE' })
  }, [send, runtimeId, runtimeStreaming, workspaceGeneration])
  const handle = useMemo<AgentTurnHandle>(() => ({ current: () => ref.current, send }), [send])
  return [snapshot, send, handle] as const
}
