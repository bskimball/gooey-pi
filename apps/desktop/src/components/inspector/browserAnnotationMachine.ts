import { assign, fromPromise, setup } from 'xstate'
import type { BrowserAnnotationElement, BrowserSourceResult } from '@/types/api'

export type AnnotationSourceState = BrowserSourceResult | { kind: 'checking' }

interface PopoverContext {
  source: AnnotationSourceState
  error: string
  resolveSource: (() => Promise<BrowserSourceResult>) | null
  openInVsCode: ((path: string, line?: number) => Promise<boolean>) | null
}

type PopoverEvent =
  | {
      type: 'CHECK'
      resolveSource: () => Promise<BrowserSourceResult>
      openInVsCode: (path: string, line?: number) => Promise<boolean>
    }
  | { type: 'OPEN_IN_VSCODE' }

export const annotationSourceMachine = setup({
  types: { context: {} as PopoverContext, events: {} as PopoverEvent },
  actors: {
    resolve: fromPromise<BrowserSourceResult, () => Promise<BrowserSourceResult>>(({ input }) => input()),
    open: fromPromise<{ source: BrowserSourceResult; opened: boolean }, {
      resolveSource: () => Promise<BrowserSourceResult>
      openInVsCode: (path: string, line?: number) => Promise<boolean>
    }>(async ({ input, signal }) => {
      const source = await input.resolveSource()
      if (signal.aborted || source.kind !== 'resolved') return { source, opened: true }
      const opened = await input.openInVsCode(source.path, source.line)
      return { source, opened }
    }),
  },
}).createMachine({
  id: 'annotationSource',
  context: {
    source: { kind: 'checking' },
    error: '',
    resolveSource: null,
    openInVsCode: null,
  },
  initial: 'idle',
  on: {
    CHECK: {
      target: '.checking',
      reenter: true,
      actions: assign(({ event }) => ({
        source: { kind: 'checking' as const },
        error: '',
        resolveSource: event.resolveSource,
        openInVsCode: event.openInVsCode,
      })),
    },
  },
  states: {
    idle: {},
    checking: {
      invoke: {
        src: 'resolve',
        input: ({ context }) => context.resolveSource!,
        onDone: {
          target: 'settled',
          actions: assign(({ event }) => ({ source: event.output })),
        },
        onError: {
          target: 'settled',
          actions: assign({
            source: {
              kind: 'unknown' as const,
              reason: 'Source validation failed. Visual context can still be attached.',
            },
          }),
        },
      },
    },
    settled: {
      on: {
        OPEN_IN_VSCODE: {
          target: 'opening',
          actions: assign({ error: '' }),
        },
      },
    },
    opening: {
      invoke: {
        src: 'open',
        input: ({ context }) => ({
          resolveSource: context.resolveSource!,
          openInVsCode: context.openInVsCode!,
        }),
        onDone: {
          target: 'settled',
          actions: assign(({ event }) => ({
            source: event.output.source,
            error: event.output.opened ? '' : 'VS Code could not open this source location.',
          })),
        },
        onError: {
          target: 'settled',
          actions: assign({ error: 'VS Code could not open this source location.' }),
        },
      },
    },
  },
})

interface PanelContext {
  pendingElement: BrowserAnnotationElement | null
  annotationText: string
  notice: string
}

type PanelEvent =
  | { type: 'TOGGLE'; atCapacity: boolean; capacityNotice: string }
  | { type: 'ELEMENT_CAPTURED'; element: BrowserAnnotationElement }
  | { type: 'SET_TEXT'; text: string }
  | { type: 'CANCEL' }
  | { type: 'SAVED' }
  | { type: 'CAPACITY_BLOCKED'; notice: string }
  | { type: 'NAVIGATED' }

export const browserAnnotationMachine = setup({
  types: { context: {} as PanelContext, events: {} as PanelEvent },
  guards: {
    atCapacity: ({ event }) => event.type === 'TOGGLE' && event.atCapacity,
  },
}).createMachine({
  id: 'browserAnnotation',
  context: {
    pendingElement: null,
    annotationText: '',
    notice: '',
  },
  type: 'parallel',
  states: {
    mode: {
      initial: 'idle',
      states: {
        idle: {
          on: {
            TOGGLE: [
              { guard: 'atCapacity' },
              { target: 'picking' },
            ],
          },
        },
        picking: {
          on: {
            TOGGLE: { target: 'idle' },
            CANCEL: { target: 'idle' },
            NAVIGATED: {
              target: 'idle',
              actions: assign({ pendingElement: null, annotationText: '' }),
            },
            ELEMENT_CAPTURED: {
              target: 'commenting',
              actions: assign(({ event }) => ({
                pendingElement: event.element,
                annotationText: '',
              })),
            },
          },
        },
        commenting: {
          on: {
            TOGGLE: {
              target: 'idle',
              actions: assign({ pendingElement: null, annotationText: '' }),
            },
            CANCEL: {
              target: 'idle',
              actions: assign({ pendingElement: null, annotationText: '' }),
            },
            NAVIGATED: {
              target: 'idle',
              actions: assign({ pendingElement: null, annotationText: '' }),
            },
            SET_TEXT: {
              actions: assign(({ event }) => ({ annotationText: event.text })),
            },
            SAVED: {
              target: 'idle',
              actions: assign({ pendingElement: null, annotationText: '' }),
            },
          },
        },
      },
    },
    banner: {
      initial: 'hidden',
      states: {
        hidden: {
          on: {
            TOGGLE: {
              guard: ({ context, event }) =>
                event.type === 'TOGGLE' && context.pendingElement === null && event.atCapacity,
              target: 'visible',
              actions: assign(({ event }) => ({ notice: event.capacityNotice })),
            },
            CAPACITY_BLOCKED: {
              target: 'visible',
              actions: assign(({ event }) => ({ notice: event.notice })),
            },
          },
        },
        visible: {
          after: {
            5000: {
              target: 'hidden',
              actions: assign({ notice: '' }),
            },
          },
          on: {
            TOGGLE: [
              {
                guard: ({ context, event }) =>
                  event.type === 'TOGGLE' && context.pendingElement === null && event.atCapacity,
                target: 'visible',
                reenter: true,
                actions: assign(({ event }) => ({ notice: event.capacityNotice })),
              },
              {
                guard: ({ context, event }) =>
                  event.type === 'TOGGLE' && context.pendingElement === null && !event.atCapacity,
                target: 'hidden',
                actions: assign({ notice: '' }),
              },
            ],
            CAPACITY_BLOCKED: {
              target: 'visible',
              reenter: true,
              actions: assign(({ event }) => ({ notice: event.notice })),
            },
          },
        },
      },
    },
  },
})
