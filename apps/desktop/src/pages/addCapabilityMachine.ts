import { useCallback, useRef, useState } from 'react'
import { assign, initialTransition, setup, transition } from 'xstate'

export type AddKind = 'mcp' | 'bundle' | 'extension'
export type McpScope = 'user' | 'project'

export interface AddCapabilityFields {
  source: string
  mcpName: string
  mcpCommand: string
  mcpArgs: string
  scope: McpScope
}

interface Context extends AddCapabilityFields {
  kind: AddKind | null
  // Success text while editing, or the failure reason while failed.
  output: string
}

type Event =
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | { type: 'CHOOSE'; kind: AddKind }
  | { type: 'BACK' }
  | { type: 'SET_FIELD'; field: keyof AddCapabilityFields; value: string }
  | { type: 'SUBMIT' }
  | { type: 'RESOLVE'; ok: boolean; output: string }
  | { type: 'FINISH' }

const KIND_FIELDS: Pick<Context, 'source' | 'mcpName' | 'mcpCommand' | 'mcpArgs'> = { source: '', mcpName: '', mcpCommand: '', mcpArgs: '' }

export const addCapabilityMachine = setup({
  types: { context: {} as Context, events: {} as Event },
}).createMachine({
  id: 'addCapability',
  context: {
    kind: null,
    output: '',
    scope: 'user',
    ...KIND_FIELDS,
  },
  initial: 'closed',
  on: {
    CLOSE: { target: '.closed' },
  },
  states: {
    closed: {
      on: {
        OPEN: { target: 'choosingKind', actions: assign({ kind: null, output: '' }) },
      },
    },
    choosingKind: {
      on: {
        CHOOSE: {
          target: 'editing',
          // Kind-specific fields never carry over from a previously selected kind.
          actions: assign(({ event }) => ({ kind: event.kind, output: '', ...KIND_FIELDS })),
        },
      },
    },
    editing: {
      on: {
        BACK: { target: 'choosingKind', actions: assign({ kind: null, output: '', ...KIND_FIELDS }) },
        SET_FIELD: { actions: assign(({ event }) => ({ [event.field]: event.value }) as Partial<Context>) },
        SUBMIT: { target: 'submitting', actions: assign({ output: '' }) },
      },
    },
    submitting: {
      on: {
        RESOLVE: [
          // Success clears the entered values; the output keeps the harness's message.
          {
            guard: ({ event }) => event.ok,
            target: 'editing',
            actions: assign(({ event }) => ({ output: event.output, source: '', mcpName: '', mcpCommand: '', mcpArgs: '' })),
          },
          { target: 'failed', actions: assign(({ event }) => ({ output: event.output })) },
        ],
        // A thrown submit leaves the form as the user filled it in.
        FINISH: { target: 'editing' },
      },
    },
    failed: {
      on: {
        BACK: { target: 'choosingKind', actions: assign({ kind: null, output: '', ...KIND_FIELDS }) },
        // The failure reason stays visible while the user edits and retries.
        SET_FIELD: { actions: assign(({ event }) => ({ [event.field]: event.value }) as Partial<Context>) },
        SUBMIT: { target: 'submitting', actions: assign({ output: '' }) },
      },
    },
  },
})

export function useAddCapabilityFlow() {
  const snapshotRef = useRef(initialTransition(addCapabilityMachine)[0])
  const [snapshot, setSnapshot] = useState(snapshotRef.current)
  const send = useCallback((event: Event) => {
    const [next] = transition(addCapabilityMachine, snapshotRef.current, event)
    snapshotRef.current = next
    setSnapshot(next)
  }, [])
  return { snapshot, send }
}
