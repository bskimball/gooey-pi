import { assign, setup } from 'xstate'
import type { ApexThinkingLevel, SchedulePreview } from '@/types/api'

export type ScheduleFilter = 'active' | 'paused' | 'attention' | 'all'
export type Frequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'advanced'
export type EditorMode = 'create' | 'edit'

export type ScheduleForm = {
  title: string
  prompt: string
  targetKind: 'project' | 'session'
  projectId: string
  sessionId: string
  timingKind: 'once' | 'recurring'
  date: string
  time: string
  timeZone: string
  frequency: Frequency
  interval: string
  weekdays: string[]
  advancedRrule: string
  model: string
  thinking: 'auto' | ApexThinkingLevel
  fast: boolean
}

const EMPTY_FORM: ScheduleForm = {
  title: '',
  prompt: '',
  targetKind: 'project',
  projectId: '',
  sessionId: '',
  timingKind: 'recurring',
  date: '',
  time: '',
  timeZone: 'UTC',
  frequency: 'daily',
  interval: '1',
  weekdays: [],
  advancedRrule: '',
  model: '',
  thinking: 'auto',
  fast: false,
}

export interface ScheduledPageContext {
  filter: ScheduleFilter
  selectedId: string | null
  editorMode: EditorMode
  scheduleId: string | undefined
  form: ScheduleForm
  baseline: string
  formError: string
  preview: SchedulePreview | null
  previewError: string
  previewRequestId: number
  action: string | null
  actionError: string
  actionNotice: string
}

export type ScheduledPageEvent =
  | { type: 'SET_FILTER'; filter: ScheduleFilter }
  | { type: 'SELECT_SCHEDULE'; id: string | null }
  | { type: 'SYNC_SELECTED_SCHEDULE'; id: string }
  | { type: 'OPEN_CREATE'; form: ScheduleForm }
  | { type: 'OPEN_EDIT'; scheduleId: string; form: ScheduleForm }
  | { type: 'UPDATE_FORM'; patch: Partial<ScheduleForm> }
  | { type: 'CLOSE_EDITOR' }
  | { type: 'VALIDATION_ERROR'; error: string }
  | { type: 'SUBMIT' }
  | { type: 'SAVE_SUCCESS' }
  | { type: 'SAVE_ERROR'; error: string }
  | { type: 'PREVIEW_CLEAR' }
  | { type: 'PREVIEW_START' }
  | { type: 'PREVIEW_CANCEL' }
  | { type: 'PREVIEW_SUCCESS'; requestId: number; preview: SchedulePreview }
  | { type: 'PREVIEW_ERROR'; requestId: number; error: string }
  | { type: 'ROW_ACTION_START'; action: string }
  | { type: 'ROW_ACTION_SUCCESS'; notice: string; clearSelection?: boolean }
  | { type: 'ROW_ACTION_ERROR'; error: string }

function mergeForm(current: ScheduleForm, patch: Partial<ScheduleForm>): ScheduleForm {
  return { ...current, ...patch }
}

export const scheduledPageMachine = setup({
  types: {
    context: {} as ScheduledPageContext,
    events: {} as ScheduledPageEvent,
  },
  guards: {
    isPatchedFormDirty: ({ context, event }) => {
      if (event.type !== 'UPDATE_FORM') return false
      return JSON.stringify(mergeForm(context.form, event.patch)) !== context.baseline
    },
    isCurrentPreviewRequest: ({ context, event }) => {
      if (event.type !== 'PREVIEW_SUCCESS' && event.type !== 'PREVIEW_ERROR') return false
      return event.requestId === context.previewRequestId
    },
  },
  actions: {
    openCreateEditor: assign(({ context, event }) => {
      if (event.type !== 'OPEN_CREATE') return {}
      return {
        editorMode: 'create' as const,
        scheduleId: undefined,
        form: event.form,
        baseline: JSON.stringify(event.form),
        formError: '',
        preview: null,
        previewError: '',
        previewRequestId: context.previewRequestId + 1,
      }
    }),
    openEditEditor: assign(({ context, event }) => {
      if (event.type !== 'OPEN_EDIT') return {}
      return {
        editorMode: 'edit' as const,
        scheduleId: event.scheduleId,
        form: event.form,
        baseline: JSON.stringify(event.form),
        formError: '',
        preview: null,
        previewError: '',
        previewRequestId: context.previewRequestId + 1,
      }
    }),
    applyFormPatch: assign(({ context, event }) => {
      if (event.type !== 'UPDATE_FORM') return {}
      return { form: mergeForm(context.form, event.patch) }
    }),
    closeEditorState: assign(({ context }) => ({
      scheduleId: undefined,
      formError: '',
      preview: null,
      previewError: '',
      previewRequestId: context.previewRequestId + 1,
    })),
    resetPreviewState: assign(({ context }) => ({
      preview: null,
      previewError: '',
      previewRequestId: context.previewRequestId + 1,
    })),
    startPreviewRequest: assign(({ context }) => ({
      previewError: '',
      previewRequestId: context.previewRequestId + 1,
    })),
    invalidatePreviewRequest: assign(({ context }) => ({
      previewRequestId: context.previewRequestId + 1,
    })),
  },
}).createMachine({
  id: 'scheduledPage',
  type: 'parallel',
  context: {
    filter: 'active',
    selectedId: null,
    editorMode: 'create',
    scheduleId: undefined,
    form: EMPTY_FORM,
    baseline: '',
    formError: '',
    preview: null,
    previewError: '',
    previewRequestId: 0,
    action: null,
    actionError: '',
    actionNotice: '',
  },
  on: {
    SET_FILTER: {
      actions: assign(({ event }) => ({ filter: event.filter })),
    },
    SELECT_SCHEDULE: {
      actions: assign(({ event }) => ({
        selectedId: event.id,
        actionError: '',
        actionNotice: '',
      })),
    },
    SYNC_SELECTED_SCHEDULE: {
      actions: assign(({ event }) => ({ selectedId: event.id })),
    },
  },
  states: {
    editor: {
      initial: 'closed',
      states: {
        closed: {
          on: {
            OPEN_CREATE: {
              target: 'editing.idle',
              actions: 'openCreateEditor',
            },
            OPEN_EDIT: {
              target: 'editing.idle',
              actions: 'openEditEditor',
            },
          },
        },
        editing: {
          initial: 'idle',
          states: {
            idle: {
              on: {
                UPDATE_FORM: [
                  {
                    guard: 'isPatchedFormDirty',
                    target: 'dirty',
                    actions: 'applyFormPatch',
                  },
                  {
                    actions: 'applyFormPatch',
                  },
                ],
                VALIDATION_ERROR: {
                  target: 'error',
                  actions: assign(({ event }) => ({ formError: event.error })),
                },
                SUBMIT: {
                  target: 'saving',
                  actions: assign({ formError: '' }),
                },
                CLOSE_EDITOR: {
                  target: '#scheduledPage.editor.closed',
                  actions: 'closeEditorState',
                },
              },
            },
            dirty: {
              on: {
                UPDATE_FORM: [
                  {
                    guard: 'isPatchedFormDirty',
                    actions: 'applyFormPatch',
                  },
                  {
                    target: 'idle',
                    actions: 'applyFormPatch',
                  },
                ],
                VALIDATION_ERROR: {
                  target: 'error',
                  actions: assign(({ event }) => ({ formError: event.error })),
                },
                SUBMIT: {
                  target: 'saving',
                  actions: assign({ formError: '' }),
                },
                CLOSE_EDITOR: {
                  target: '#scheduledPage.editor.closed',
                  actions: 'closeEditorState',
                },
              },
            },
            saving: {
              on: {
                SAVE_SUCCESS: {
                  target: '#scheduledPage.editor.closed',
                  actions: 'closeEditorState',
                },
                SAVE_ERROR: {
                  target: 'error',
                  actions: assign(({ event }) => ({ formError: event.error })),
                },
              },
            },
            error: {
              on: {
                UPDATE_FORM: {
                  actions: 'applyFormPatch',
                },
                VALIDATION_ERROR: {
                  actions: assign(({ event }) => ({ formError: event.error })),
                },
                SUBMIT: {
                  target: 'saving',
                  actions: assign({ formError: '' }),
                },
                CLOSE_EDITOR: {
                  target: '#scheduledPage.editor.closed',
                  actions: 'closeEditorState',
                },
              },
            },
          },
        },
      },
    },
    preview: {
      initial: 'idle',
      on: {
        OPEN_CREATE: { target: '.idle' },
        OPEN_EDIT: { target: '.idle' },
        CLOSE_EDITOR: { target: '.idle' },
        SAVE_SUCCESS: { target: '.idle' },
        PREVIEW_CLEAR: {
          target: '.idle',
          actions: 'resetPreviewState',
        },
        PREVIEW_START: {
          target: '.loading',
          actions: 'startPreviewRequest',
        },
        PREVIEW_CANCEL: {
          actions: 'invalidatePreviewRequest',
        },
      },
      states: {
        idle: {},
        loading: {
          on: {
            PREVIEW_SUCCESS: {
              guard: 'isCurrentPreviewRequest',
              target: 'ready',
              actions: assign(({ event }) => ({ preview: event.preview, previewError: '' })),
            },
            PREVIEW_ERROR: {
              guard: 'isCurrentPreviewRequest',
              target: 'error',
              actions: assign(({ event }) => ({ preview: null, previewError: event.error })),
            },
          },
        },
        ready: {},
        error: {},
      },
    },
    rowAction: {
      initial: 'idle',
      states: {
        idle: {
          on: {
            ROW_ACTION_START: {
              target: 'running',
              actions: assign(({ event }) => ({
                action: event.action,
                actionError: '',
                actionNotice: '',
              })),
            },
          },
        },
        running: {
          on: {
            ROW_ACTION_SUCCESS: {
              target: 'notice',
              actions: assign(({ context, event }) => ({
                action: null,
                actionNotice: event.notice,
                actionError: '',
                selectedId: event.clearSelection ? null : context.selectedId,
              })),
            },
            ROW_ACTION_ERROR: {
              target: 'error',
              actions: assign(({ event }) => ({
                action: null,
                actionError: event.error,
              })),
            },
          },
        },
        notice: {
          on: {
            SELECT_SCHEDULE: { target: 'idle' },
            ROW_ACTION_START: {
              target: 'running',
              actions: assign(({ event }) => ({
                action: event.action,
                actionError: '',
                actionNotice: '',
              })),
            },
          },
        },
        error: {
          on: {
            SELECT_SCHEDULE: { target: 'idle' },
            ROW_ACTION_START: {
              target: 'running',
              actions: assign(({ event }) => ({
                action: event.action,
                actionError: '',
                actionNotice: '',
              })),
            },
          },
        },
      },
    },
  },
})
