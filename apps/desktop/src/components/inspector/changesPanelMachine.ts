import { assign, setup } from 'xstate'

export type DiffScope = 'unstaged' | 'staged'

export interface ChangesPanelInput {
  initialSelectedPath?: string
}

export interface ChangesPanelContext {
  scope: DiffScope
  selectedPath: string | undefined
  diff: string
  requestId: number
  commitMessage: string
  confirmUndoTarget: string | null
  actionError: string
}

export type ChangesPanelEvent =
  | { type: 'SET_SCOPE'; scope: DiffScope }
  | { type: 'SELECT_PATH'; path: string | undefined }
  | { type: 'DIFF_LOAD_START'; requestId: number }
  | { type: 'DIFF_LOAD_SUCCESS'; requestId: number; diff: string }
  | { type: 'DIFF_LOAD_ERROR'; requestId: number }
  | { type: 'DIFF_SET_STATIC'; diff: string }
  | { type: 'OPEN_COMMIT' }
  | { type: 'SET_COMMIT_MESSAGE'; message: string }
  | { type: 'FILL_COMMIT_SUMMARY'; summary: string }
  | { type: 'COMMIT_SUBMIT' }
  | { type: 'COMMIT_SUCCESS' }
  | { type: 'COMMIT_ERROR'; error: string }
  | { type: 'OPEN_CONFIRM_UNDO'; path: string }
  | { type: 'CONFIRM_UNDO_SUBMIT' }
  | { type: 'CONFIRM_UNDO_SUCCESS' }
  | { type: 'CONFIRM_UNDO_ERROR'; error: string }
  | { type: 'CLOSE_MODAL' }
  | { type: 'MUTATE_START' }
  | { type: 'MUTATE_ERROR'; error: string }

export const changesPanelMachine = setup({
  types: {
    input: {} as ChangesPanelInput | undefined,
    context: {} as ChangesPanelContext,
    events: {} as ChangesPanelEvent,
  },
  guards: {
    isCurrentRequest: ({ context, event }) =>
      (event.type === 'DIFF_LOAD_SUCCESS' || event.type === 'DIFF_LOAD_ERROR') &&
      event.requestId === context.requestId,
    hasStaticDiff: ({ event }) =>
      event.type === 'DIFF_SET_STATIC' && event.diff.length > 0,
  },
}).createMachine({
  id: 'changesPanel',
  context: ({ input }) => ({
    scope: 'unstaged',
    selectedPath: input?.initialSelectedPath,
    diff: '',
    requestId: 0,
    commitMessage: '',
    confirmUndoTarget: null,
    actionError: '',
  }),
  type: 'parallel',
  on: {
    SET_SCOPE: {
      actions: assign(({ event }) => ({
        scope: event.scope,
        actionError: '',
      })),
    },
    SELECT_PATH: {
      actions: assign(({ event }) => ({
        selectedPath: event.path,
      })),
    },
    MUTATE_START: {
      actions: assign({ actionError: '' }),
    },
    MUTATE_ERROR: {
      actions: assign(({ event }) => ({ actionError: event.error })),
    },
  },
  states: {
    diffView: {
      initial: 'idle',
      on: {
        DIFF_LOAD_START: {
          target: '.loading',
          reenter: true,
          actions: assign(({ event }) => ({
            requestId: event.requestId,
          })),
        },
        DIFF_SET_STATIC: [
          {
            guard: 'hasStaticDiff',
            target: '.loaded',
            actions: assign(({ context, event }) => ({
              requestId: context.requestId + 1,
              diff: event.diff,
            })),
          },
          {
            target: '.idle',
            actions: assign(({ context, event }) => ({
              requestId: context.requestId + 1,
              diff: event.diff,
            })),
          },
        ],
      },
      states: {
        idle: {},
        loading: {
          on: {
            DIFF_LOAD_SUCCESS: {
              guard: 'isCurrentRequest',
              target: 'loaded',
              actions: assign(({ event }) => ({
                diff: event.diff,
              })),
            },
            DIFF_LOAD_ERROR: {
              guard: 'isCurrentRequest',
              target: 'loaded',
              actions: assign({
                diff: 'Unable to load this diff.',
              }),
            },
          },
        },
        loaded: {},
      },
    },
    modal: {
      initial: 'none',
      states: {
        none: {
          on: {
            OPEN_COMMIT: {
              target: 'commit',
              actions: assign({ actionError: '' }),
            },
            OPEN_CONFIRM_UNDO: {
              target: 'confirmUndo',
              actions: assign(({ event }) => ({
                confirmUndoTarget: event.path,
              })),
            },
          },
        },
        commit: {
          initial: 'editing',
          states: {
            editing: {
              on: {
                SET_COMMIT_MESSAGE: {
                  actions: assign(({ event }) => ({
                    commitMessage: event.message,
                  })),
                },
                FILL_COMMIT_SUMMARY: {
                  actions: assign(({ event }) => ({
                    actionError: '',
                    commitMessage: event.summary,
                  })),
                },
                COMMIT_SUBMIT: {
                  target: 'submitting',
                  actions: assign({ actionError: '' }),
                },
                CLOSE_MODAL: {
                  target: '#changesPanel.modal.none',
                },
              },
            },
            submitting: {
              on: {
                COMMIT_SUCCESS: {
                  target: '#changesPanel.modal.none',
                  actions: assign({
                    commitMessage: '',
                    actionError: '',
                  }),
                },
                COMMIT_ERROR: {
                  target: 'editing',
                  actions: assign(({ event }) => ({
                    actionError: event.error,
                  })),
                },
              },
            },
          },
        },
        confirmUndo: {
          initial: 'idle',
          states: {
            idle: {
              on: {
                CONFIRM_UNDO_SUBMIT: {
                  target: 'restoring',
                  actions: assign({ actionError: '' }),
                },
                CLOSE_MODAL: {
                  target: '#changesPanel.modal.none',
                  actions: assign({ confirmUndoTarget: null }),
                },
              },
            },
            restoring: {
              on: {
                CONFIRM_UNDO_SUCCESS: {
                  target: '#changesPanel.modal.none',
                  actions: assign({
                    confirmUndoTarget: null,
                    actionError: '',
                  }),
                },
                CONFIRM_UNDO_ERROR: {
                  target: 'idle',
                  actions: assign(({ event }) => ({
                    actionError: event.error,
                  })),
                },
              },
            },
          },
        },
      },
    },
  },
})
