import { and, assign, initialTransition, setup, transition, type SnapshotFrom } from 'xstate'

export interface DraftCommit {
  id: number
  value: string
  baseline: string
  revision: number
  sawDifferentSource: boolean
}

export interface DraftSettlement {
  value: string
  baseline: string
}

export interface DraftState {
  value: string
  source: string
  baseline: string
  dirty: boolean
  revision: number
  pending: DraftCommit | null
  settlement: DraftSettlement | null
  error: string
}

export type DraftAction =
  | { type: 'sync'; value: string }
  | { type: 'edit'; value: string; error: string }
  | { type: 'commit'; id: number; value: string }
  | { type: 'resolve'; id: number }
  | { type: 'reject'; id: number; error: string }

function hasSettlementRollback(context: DraftState, syncedValue: string): boolean {
  return Boolean(
    context.settlement &&
    syncedValue === context.settlement.baseline &&
    context.settlement.value !== context.settlement.baseline,
  )
}

function isPendingRollback(context: DraftState): boolean {
  const submitted = context.pending
  return Boolean(
    submitted &&
    submitted.sawDifferentSource &&
    context.source === submitted.baseline &&
    submitted.value !== submitted.baseline,
  )
}

function resolvedCommittedValue(context: DraftState): string {
  const submitted = context.pending!
  return context.source !== submitted.baseline ? context.source : submitted.value
}

export const draftSettingMachine = setup({
  types: {
    context: {} as DraftState,
    events: {} as DraftAction,
    input: {} as string,
  },
  guards: {
    hasError: ({ event }) => event.type === 'edit' && Boolean(event.error),
    editMatchesBaseline: ({ context, event }) => event.type === 'edit' && !event.error && event.value === context.baseline,
    isSettlementRollback: ({ context, event }) => event.type === 'sync' && hasSettlementRollback(context, event.value),
    isClean: ({ context }) => !context.dirty,
    syncMatchesDraft: ({ context, event }) => event.type === 'sync' && event.value === context.value,
    isPendingCommit: ({ context, event }) => (event.type === 'resolve' || event.type === 'reject') && context.pending?.id === event.id,
    isPendingRollbackCurrent: ({ context }) => isPendingRollback(context) && context.revision === context.pending!.revision,
    isPendingRollbackDirty: ({ context }) => isPendingRollback(context) && context.revision !== context.pending!.revision && context.value !== context.pending!.baseline,
    isPendingRollbackClean: ({ context }) => isPendingRollback(context) && context.revision !== context.pending!.revision && context.value === context.pending!.baseline,
    isResolveCurrent: ({ context }) => !isPendingRollback(context) && context.revision === context.pending!.revision,
    isResolveDirty: ({ context }) => !isPendingRollback(context) && context.revision !== context.pending!.revision && context.value !== resolvedCommittedValue(context),
    isRejectCurrent: ({ context }) => context.revision === context.pending!.revision,
    isRejectDirty: ({ context }) => context.revision !== context.pending!.revision && context.value !== context.pending!.baseline,
  },
  actions: {
    syncRollback: assign(({ context, event }) => (event.type === 'sync' ? {
      source: event.value,
      baseline: event.value,
      dirty: context.value !== event.value,
      settlement: null,
      error: 'The setting could not be saved.',
    } : {})),
    syncClean: assign(({ event }) => (event.type === 'sync' ? {
      value: event.value,
      source: event.value,
      baseline: event.value,
      dirty: false,
      settlement: null,
    } : {})),
    syncMatch: assign(({ event }) => (event.type === 'sync' ? {
      source: event.value,
      baseline: event.value,
      dirty: false,
      settlement: null,
    } : {})),
    syncDirty: assign(({ event }) => (event.type === 'sync' ? {
      source: event.value,
      baseline: event.value,
      dirty: true,
      settlement: null,
    } : {})),
    editDraft: assign(({ context, event }) => (event.type === 'edit' ? {
      value: event.value,
      dirty: event.value !== context.baseline,
      revision: context.revision + 1,
      error: event.error,
    } : {})),
    startCommit: assign(({ context, event }) => (event.type === 'commit' ? {
      pending: {
        id: event.id,
        value: event.value,
        baseline: context.baseline,
        revision: context.revision,
        sawDifferentSource: false,
      },
      settlement: null,
      error: '',
    } : {})),
    syncPending: assign(({ context, event }) => {
      if (event.type !== 'sync' || !context.pending) return {}
      return {
        source: event.value,
        pending: {
          ...context.pending,
          sawDifferentSource: context.pending.sawDifferentSource || event.value !== context.pending.baseline,
        },
      }
    }),
    resolveRollbackError: assign(({ context }) => {
      const submitted = context.pending!
      return {
        baseline: submitted.baseline,
        dirty: context.value !== submitted.baseline,
        pending: null,
        settlement: null,
        error: 'The setting could not be saved.',
      }
    }),
    resolveRollbackClear: assign(({ context }) => {
      const submitted = context.pending!
      return {
        baseline: submitted.baseline,
        dirty: context.value !== submitted.baseline,
        pending: null,
        settlement: null,
        error: '',
      }
    }),
    resolveCurrent: assign(({ context }) => {
      const submitted = context.pending!
      const committed = resolvedCommittedValue(context)
      return {
        value: committed,
        baseline: committed,
        dirty: false,
        pending: null,
        settlement: { value: committed, baseline: submitted.baseline },
        error: '',
      }
    }),
    resolveNewerEdit: assign(({ context }) => {
      const submitted = context.pending!
      const committed = resolvedCommittedValue(context)
      return {
        baseline: committed,
        dirty: context.value !== committed,
        pending: null,
        settlement: { value: committed, baseline: submitted.baseline },
        error: '',
      }
    }),
    rejectCurrent: assign(({ context, event }) => {
      if (event.type !== 'reject' || !context.pending) return {}
      return {
        baseline: context.pending.baseline,
        dirty: context.value !== context.pending.baseline,
        pending: null,
        settlement: null,
        error: event.error,
      }
    }),
    rejectStaleError: assign(({ context }) => ({
      baseline: context.pending!.baseline,
      dirty: context.value !== context.pending!.baseline,
      pending: null,
      settlement: null,
      error: '',
    })),
  },
}).createMachine({
  id: 'draftSetting',
  initial: 'clean',
  context: ({ input }) => ({
    value: input,
    source: input,
    baseline: input,
    dirty: false,
    revision: 0,
    pending: null,
    settlement: null,
    error: '',
  }),
  states: {
    clean: {
      on: {
        sync: { actions: 'syncClean' },
        edit: [
          { guard: 'hasError', target: 'error', actions: 'editDraft' },
          { guard: 'editMatchesBaseline', actions: 'editDraft' },
          { target: 'dirty', actions: 'editDraft' },
        ],
        commit: { target: 'committing', actions: 'startCommit' },
      },
    },
    dirty: {
      on: {
        sync: [
          { guard: 'isSettlementRollback', target: 'error', actions: 'syncRollback' },
          { guard: 'syncMatchesDraft', target: 'clean', actions: 'syncMatch' },
          { actions: 'syncDirty' },
        ],
        edit: [
          { guard: 'hasError', target: 'error', actions: 'editDraft' },
          { guard: 'editMatchesBaseline', target: 'clean', actions: 'editDraft' },
          { actions: 'editDraft' },
        ],
        commit: { target: 'committing', actions: 'startCommit' },
      },
    },
    committing: {
      on: {
        sync: { actions: 'syncPending' },
        edit: { actions: 'editDraft' },
        resolve: [
          { guard: and(['isPendingCommit', 'isPendingRollbackCurrent']), target: 'error', actions: 'resolveRollbackError' },
          { guard: and(['isPendingCommit', 'isPendingRollbackDirty']), target: 'dirty', actions: 'resolveRollbackClear' },
          { guard: and(['isPendingCommit', 'isPendingRollbackClean']), target: 'clean', actions: 'resolveRollbackClear' },
          { guard: and(['isPendingCommit', 'isResolveCurrent']), target: 'settled', actions: 'resolveCurrent' },
          { guard: and(['isPendingCommit', 'isResolveDirty']), target: 'dirty', actions: 'resolveNewerEdit' },
          { guard: 'isPendingCommit', target: 'settled', actions: 'resolveNewerEdit' },
        ],
        reject: [
          { guard: and(['isPendingCommit', 'isRejectCurrent']), target: 'error', actions: 'rejectCurrent' },
          { guard: and(['isPendingCommit', 'isRejectDirty']), target: 'dirty', actions: 'rejectStaleError' },
          { guard: 'isPendingCommit', target: 'clean', actions: 'rejectStaleError' },
        ],
      },
    },
    settled: {
      on: {
        sync: [
          { guard: 'isSettlementRollback', target: 'error', actions: 'syncRollback' },
          { guard: 'isClean', target: 'clean', actions: 'syncClean' },
          { guard: 'syncMatchesDraft', target: 'clean', actions: 'syncMatch' },
          { target: 'dirty', actions: 'syncDirty' },
        ],
        edit: [
          { guard: 'hasError', target: 'error', actions: 'editDraft' },
          { guard: 'editMatchesBaseline', target: 'clean', actions: 'editDraft' },
          { target: 'dirty', actions: 'editDraft' },
        ],
        commit: { target: 'committing', actions: 'startCommit' },
      },
    },
    error: {
      on: {
        sync: [
          { guard: 'isSettlementRollback', actions: 'syncRollback' },
          { guard: 'isClean', actions: 'syncClean' },
          { guard: 'syncMatchesDraft', actions: 'syncMatch' },
          { actions: 'syncDirty' },
        ],
        edit: [
          { guard: 'hasError', actions: 'editDraft' },
          { guard: 'editMatchesBaseline', target: 'clean', actions: 'editDraft' },
          { target: 'dirty', actions: 'editDraft' },
        ],
        commit: { target: 'committing', actions: 'startCommit' },
      },
    },
  },
})

export type DraftSettingSnapshot = SnapshotFrom<typeof draftSettingMachine>

export function initialDraftSetting(value: string): DraftSettingSnapshot {
  const [snapshot] = initialTransition(draftSettingMachine, value)
  return snapshot
}

export function draftSettingTransition(snapshot: DraftSettingSnapshot, action: DraftAction): DraftSettingSnapshot {
  const [next] = transition(draftSettingMachine, snapshot, action)
  return next
}

const snapshotByState = new WeakMap<DraftState, DraftSettingSnapshot>()

export function createDraftState(value: string): DraftState {
  const snapshot = initialDraftSetting(value)
  const state: DraftState = { ...snapshot.context }
  snapshotByState.set(state, snapshot)
  return state
}

export function reduceDraftState(state: DraftState, action: DraftAction): DraftState {
  const current = snapshotByState.get(state) ?? initialDraftSetting(state.value)
  const next = draftSettingTransition(current, action)
  if (next === current) return state
  const nextState: DraftState = { ...next.context }
  snapshotByState.set(nextState, next)
  return nextState
}

export function browserHomeValidation(value: string): string {
  if (value.trim().length === 0) return 'Enter a home page URL.'
  if (value.trim().length > 8192) return 'The home page URL is too long.'
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    return 'Enter a complete http:// or https:// URL.'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Use an http:// or https:// URL.'
  if (parsed.username || parsed.password) return 'URLs containing credentials are not allowed.'
  return ''
}

export function normalizeBrowserHome(value: string): string {
  return new URL(value.trim()).toString()
}

export function terminalShellValidation(value: string): string {
  if (value.length === 0) return 'Enter a shell executable path.'
  if (value.includes('\0')) return 'The shell path cannot contain a NUL character.'
  if (value.length > 4096) return 'The shell path is too long.'
  if (!value.startsWith('/')) return 'Enter an absolute shell path beginning with /.'
  return ''
}

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The setting could not be saved.'
}
