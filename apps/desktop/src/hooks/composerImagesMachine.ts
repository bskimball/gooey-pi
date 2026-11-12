import { assign, setup } from 'xstate'
import type { PromptImage } from '@/types/api'

export interface ComposerImage extends PromptImage {
  id: string
  name: string
  size: number
}

export interface ComposerUnsupportedFile {
  id: string
  name: string
  size: number
  mimeType: string
}

export interface ComposerImagesContext {
  images: ComposerImage[]
  unsupportedFiles: ComposerUnsupportedFile[]
  error: string
  errorRevision: number
  pendingBatches: number
  reservedCount: number
  reservedBytes: number
  dragDepth: number
}

export type ComposerImagesEvent =
  | { type: 'DRAG_ENTER' }
  | { type: 'DRAG_LEAVE' }
  | { type: 'DROP' }
  | { type: 'SET_ERROR'; message: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'ADD_UNSUPPORTED'; files: ComposerUnsupportedFile[] }
  | { type: 'BATCH_START'; count: number; bytes: number }
  | { type: 'BATCH_SUCCEED'; images: ComposerImage[]; count: number; bytes: number; startingErrorRevision: number }
  | { type: 'BATCH_FAIL'; message: string; count: number; bytes: number }
  | { type: 'CLEAR' }
  | { type: 'REMOVE'; id: string }
  | { type: 'RESTORE'; images: ComposerImage[] }

export const composerImagesMachine = setup({
  types: {
    context: {} as ComposerImagesContext,
    events: {} as ComposerImagesEvent,
  },
  guards: {
    isLastDragLevel: ({ context }) => context.dragDepth <= 1,
    isLastPendingBatch: ({ context }) => context.pendingBatches <= 1,
  },
  actions: {
    startBatch: assign({
      pendingBatches: ({ context }) => context.pendingBatches + 1,
      reservedCount: ({ context, event }) => event.type === 'BATCH_START' ? context.reservedCount + event.count : context.reservedCount,
      reservedBytes: ({ context, event }) => event.type === 'BATCH_START' ? context.reservedBytes + event.bytes : context.reservedBytes,
    }),
    succeedBatch: assign(({ context, event }) => {
      if (event.type !== 'BATCH_SUCCEED') return {}
      return {
        images: [...context.images, ...event.images],
        error: context.errorRevision === event.startingErrorRevision ? '' : context.error,
        pendingBatches: Math.max(0, context.pendingBatches - 1),
        reservedCount: Math.max(0, context.reservedCount - event.count),
        reservedBytes: Math.max(0, context.reservedBytes - event.bytes),
      }
    }),
    failBatch: assign(({ context, event }) => {
      if (event.type !== 'BATCH_FAIL') return {}
      return {
        error: event.message,
        errorRevision: context.errorRevision + 1,
        pendingBatches: Math.max(0, context.pendingBatches - 1),
        reservedCount: Math.max(0, context.reservedCount - event.count),
        reservedBytes: Math.max(0, context.reservedBytes - event.bytes),
      }
    }),
  },
}).createMachine({
  id: 'composerImages',
  type: 'parallel',
  context: {
    images: [],
    unsupportedFiles: [],
    error: '',
    errorRevision: 0,
    pendingBatches: 0,
    reservedCount: 0,
    reservedBytes: 0,
    dragDepth: 0,
  },
  states: {
    drag: {
      initial: 'idle',
      states: {
        idle: {
          on: {
            DRAG_ENTER: {
              target: 'over',
              actions: assign({ dragDepth: ({ context }) => context.dragDepth + 1 }),
            },
          },
        },
        over: {
          on: {
            DRAG_ENTER: {
              actions: assign({ dragDepth: ({ context }) => context.dragDepth + 1 }),
            },
            DRAG_LEAVE: [
              { guard: 'isLastDragLevel', target: 'idle', actions: assign({ dragDepth: 0 }) },
              { actions: assign({ dragDepth: ({ context }) => context.dragDepth - 1 }) },
            ],
            DROP: {
              target: 'idle',
              actions: assign({ dragDepth: 0 }),
            },
          },
        },
      },
    },
    ingestion: {
      initial: 'idle',
      on: {
        SET_ERROR: {
          actions: assign({
            error: ({ event }) => event.message,
            errorRevision: ({ context }) => context.errorRevision + 1,
          }),
        },
        CLEAR_ERROR: {
          actions: assign({ error: '' }),
        },
        ADD_UNSUPPORTED: {
          actions: assign({
            unsupportedFiles: ({ context, event }) => [...context.unsupportedFiles, ...event.files],
            error: '',
          }),
        },
        CLEAR: {
          actions: assign({ images: [], unsupportedFiles: [] }),
        },
        REMOVE: {
          actions: assign({
            images: ({ context, event }) => context.images.filter((image) => image.id !== event.id),
            unsupportedFiles: ({ context, event }) => context.unsupportedFiles.filter((file) => file.id !== event.id),
            error: '',
            errorRevision: ({ context }) => context.errorRevision + 1,
          }),
        },
        RESTORE: {
          actions: assign({
            images: ({ context, event }) => [...event.images, ...context.images],
          }),
        },
      },
      states: {
        idle: {
          on: {
            BATCH_START: { target: 'processing', actions: 'startBatch' },
          },
        },
        processing: {
          on: {
            BATCH_START: { actions: 'startBatch' },
            BATCH_SUCCEED: [
              { guard: 'isLastPendingBatch', target: 'idle', actions: 'succeedBatch' },
              { actions: 'succeedBatch' },
            ],
            BATCH_FAIL: [
              { guard: 'isLastPendingBatch', target: 'idle', actions: 'failBatch' },
              { actions: 'failBatch' },
            ],
          },
        },
      },
    },
  },
})
