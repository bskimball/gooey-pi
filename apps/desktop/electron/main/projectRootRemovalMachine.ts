import { assign, initialTransition, setup, transition, type SnapshotFrom } from 'xstate'

type Event = { type: 'MARK'; removalId: string } | { type: 'RELEASE'; removalId: string }

/**
 * One folder root's removal marks. Each in-flight remove() owns a mark keyed by
 * its removalId, and the root stays pending until every owner releases it. A
 * grant or a concurrent removal therefore never clears another operation's mark.
 */
export const projectRootRemovalMachine = setup({
  types: { context: {} as { owners: readonly string[] }, events: {} as Event },
}).createMachine({
  id: 'projectRootRemoval',
  context: { owners: [] },
  initial: 'none',
  states: {
    none: {
      on: { MARK: { target: 'pendingRemoval', actions: assign(({ context, event }) => ({ owners: [...context.owners, event.removalId] })) } },
    },
    pendingRemoval: {
      on: {
        MARK: { guard: ({ context, event }) => !context.owners.includes(event.removalId), actions: assign(({ context, event }) => ({ owners: [...context.owners, event.removalId] })) },
        RELEASE: [
          {
            guard: ({ context, event }) => context.owners.every((owner) => owner === event.removalId),
            target: 'none',
            actions: assign({ owners: [] }),
          },
          { actions: assign(({ context, event }) => ({ owners: context.owners.filter((owner) => owner !== event.removalId) })) },
        ],
      },
    },
  },
})

/** Roots with at least one in-flight removal; absent means `none`. */
export type RootRemovals = Map<string, SnapshotFrom<typeof projectRootRemovalMachine>>

export function markRootRemoval(removals: RootRemovals, root: string, removalId: string): void {
  const current = removals.get(root) ?? initialTransition(projectRootRemovalMachine)[0]
  removals.set(root, transition(projectRootRemovalMachine, current, { type: 'MARK', removalId })[0])
}

export function releaseRootRemoval(removals: RootRemovals, root: string, removalId: string): void {
  const current = removals.get(root)
  if (!current) return
  const [next] = transition(projectRootRemovalMachine, current, { type: 'RELEASE', removalId })
  if (next.matches('none')) removals.delete(root)
  else removals.set(root, next)
}
