import { useCallback, useRef, useState } from 'react'
import { assign, initialTransition, setup, transition } from 'xstate'

// One capability mutation runs at a time: the Pi settings lock serializes them anyway,
// and a single busy id gives every toggle and remove control the same guard.
interface Context {
  skillId: string | null
}

type Event = { type: 'START'; skillId: string } | { type: 'FINISH' }

export const pluginOperationMachine = setup({
  types: { context: {} as Context, events: {} as Event },
}).createMachine({
  id: 'pluginOperation',
  context: { skillId: null },
  initial: 'idle',
  states: {
    idle: {
      on: { START: { target: 'busy', actions: assign(({ event }) => ({ skillId: event.skillId })) } },
    },
    busy: {
      on: { FINISH: { target: 'idle', actions: assign({ skillId: null }) } },
    },
  },
})

export function usePluginOperation() {
  const snapshotRef = useRef(initialTransition(pluginOperationMachine)[0])
  const [snapshot, setSnapshot] = useState(snapshotRef.current)
  const send = useCallback((event: Event) => {
    const [next] = transition(pluginOperationMachine, snapshotRef.current, event)
    snapshotRef.current = next
    setSnapshot(next)
  }, [])
  // Guards read the ref, not render state, so two clicks in one tick cannot both start.
  const begin = useCallback((skillId: string) => {
    if (snapshotRef.current.matches('busy')) return false
    send({ type: 'START', skillId })
    return true
  }, [send])
  const finish = useCallback(() => send({ type: 'FINISH' }), [send])
  return { busyId: snapshot.context.skillId, begin, finish }
}
