import { assign, enqueueActions, sendParent, setup, type ActorRefFrom } from 'xstate'
import type { PendingExtensionUi } from './useExtensionUi'

const requestMachine = setup({
  types: {
    context: {} as { runtimeId: string; id: string; timeout?: number },
    input: {} as { runtimeId: string; id: string; timeout?: number },
    events: {} as { type: 'ANSWER' | 'CANCEL' } | { type: 'SHORTEN'; timeout: number },
  },
  guards: { timed: ({ context }) => context.timeout !== undefined },
  delays: { timeout: ({ context }) => context.timeout ?? 0 },
}).createMachine({
  context: ({ input }) => input,
  initial: 'pending',
  states: {
    pending: {
      initial: 'initializing',
      on: { ANSWER: 'answered', CANCEL: 'cancelled' },
      states: {
        initializing: { always: [{ guard: 'timed', target: 'timed' }, { target: 'untimed' }] },
        timed: {
          after: { timeout: { target: '#extensionRequest.timedOut' } },
          on: { SHORTEN: { target: 'timed', reenter: true, actions: assign({ timeout: ({ event }) => event.timeout }) } },
        },
        untimed: {},
      },
    },
    answered: { type: 'final' },
    cancelled: { type: 'final' },
    timedOut: {
      type: 'final',
      entry: sendParent(({ context }) => ({ type: 'EXPIRED', runtimeId: context.runtimeId, id: context.id })),
    },
  },
  id: 'extensionRequest',
})

interface Context {
  pendingByRuntime: ReadonlyMap<string, PendingExtensionUi>
  actors: ReadonlyMap<string, ActorRefFrom<typeof requestMachine>>
  visible: PendingExtensionUi | null
  timedOutQuestionnaires: ReadonlySet<string>
}

type Event =
  | { type: 'UPSERT'; pending: PendingExtensionUi; show: boolean }
  | { type: 'SELECT'; runtimeId?: string }
  | { type: 'CLEAR'; runtimeId: string; outcome?: 'ANSWER' | 'CANCEL' }
  | { type: 'EXPIRED'; runtimeId: string; id: string }
  | { type: 'RESET' }

export const extensionUiMachine = setup({
  types: { context: {} as Context, events: {} as Event },
  actors: { request: requestMachine },
  guards: {
    currentRequest: ({ context, event }) => event.type === 'EXPIRED'
      && context.pendingByRuntime.get(event.runtimeId)?.request.id === event.id,
  },
  actions: {
    cancelRequest: (_, _params: { pending: PendingExtensionUi }) => {},
    remove: enqueueActions(({ context, event, enqueue }) => {
      if (event.type !== 'CLEAR' && event.type !== 'EXPIRED') return
      const actor = context.actors.get(event.runtimeId)
      if (actor) {
        if (event.type === 'CLEAR') enqueue.sendTo(actor, { type: event.outcome ?? 'CANCEL' })
        enqueue.stopChild(actor)
      }
      enqueue.assign(({ context }) => {
        const pendingByRuntime = new Map(context.pendingByRuntime)
        const actors = new Map(context.actors)
        pendingByRuntime.delete(event.runtimeId)
        actors.delete(event.runtimeId)
        return { pendingByRuntime, actors, visible: context.visible?.runtimeId === event.runtimeId ? null : context.visible }
      })
    }),
  },
}).createMachine({
  context: { pendingByRuntime: new Map(), actors: new Map(), visible: null, timedOutQuestionnaires: new Set() },
  initial: 'listening',
  states: {
    listening: {
      on: {
        UPSERT: {
          actions: [
            enqueueActions(({ context, event, enqueue }) => {
              const previous = context.pendingByRuntime.get(event.pending.runtimeId)
              const actor = context.actors.get(event.pending.runtimeId)
              if (actor && previous?.request.id === event.pending.request.id
                && previous.deadline !== undefined && event.pending.deadline !== undefined
                && event.pending.deadline < previous.deadline) {
                enqueue.sendTo(actor, { type: 'SHORTEN', timeout: Math.max(0, event.pending.deadline - Date.now()) })
              }
            }),
            assign(({ context, event, spawn }) => {
              const { pending } = event
              const actors = new Map(context.actors)
              if (!actors.has(pending.runtimeId)) {
                actors.set(pending.runtimeId, spawn('request', { input: {
                  runtimeId: pending.runtimeId,
                  id: pending.request.id,
                  timeout: 'timeout' in pending.request ? pending.request.timeout : undefined,
                } }))
              }
              return {
                actors,
                pendingByRuntime: new Map(context.pendingByRuntime).set(pending.runtimeId, pending),
                visible: event.show ? pending : context.visible,
              }
            }),
          ],
        },
        SELECT: { actions: assign({ visible: ({ context, event }) => event.runtimeId ? context.pendingByRuntime.get(event.runtimeId) ?? null : null }) },
        CLEAR: { actions: 'remove' },
        EXPIRED: {
          guard: 'currentRequest',
          actions: [
            enqueueActions(({ context, event, enqueue }) => {
              const pending = context.pendingByRuntime.get(event.runtimeId)
              if (!pending) return
              if (pending.request.method === 'questionnaire') {
                enqueue.assign({ timedOutQuestionnaires: new Set(context.timedOutQuestionnaires).add(`${event.runtimeId}:${pending.request.id}`) })
              }
              enqueue({ type: 'cancelRequest', params: { pending } })
            }),
            'remove',
          ],
        },
        RESET: {
          actions: enqueueActions(({ context, enqueue }) => {
            for (const pending of context.pendingByRuntime.values()) enqueue({ type: 'cancelRequest', params: { pending } })
            for (const actor of context.actors.values()) enqueue.stopChild(actor)
            enqueue.assign({ pendingByRuntime: new Map(), actors: new Map(), visible: null, timedOutQuestionnaires: new Set() })
          }),
        },
      },
    },
  },
})
