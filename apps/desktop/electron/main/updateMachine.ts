import { assign, fromPromise, raise, setup } from 'xstate'
import type { AppUpdateState } from '../../src/types/api'
import type { UpdateAdapter } from './updates'

interface Request<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function request<T>(): Request<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

interface Input {
  enabled: boolean
  updater: UpdateAdapter
  publish: (state: AppUpdateState) => void
  stopScheduledChecks: () => void
}

interface Context extends Input {
  state: AppUpdateState
  discoveredVersion: string | undefined
  check: Request<AppUpdateState> | null
  download: Request<boolean> | null
}

type Event =
  | { type: 'CHECK'; reply: (promise: Promise<AppUpdateState>) => void }
  | { type: 'DOWNLOAD'; reply: (promise: Promise<boolean>) => void }
  | { type: 'CHECKING' }
  | { type: 'AVAILABLE'; version: string }
  | { type: 'NOT_AVAILABLE'; version: string }
  | { type: 'PROGRESS'; percent: number }
  | { type: 'DOWNLOADED'; version: string }
  | { type: 'ERROR'; error: unknown }
  | { type: 'DOWNLOAD_STARTED' }
  | { type: 'CHECK_SETTLED' }
  | { type: 'DOWNLOAD_SETTLED'; success: boolean }

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 240) || 'Update check failed'
}

export const updateMachine = setup({
  types: { context: {} as Context, input: {} as Input, events: {} as Event },
  actors: {
    check: fromPromise<unknown, UpdateAdapter>(({ input }) => input.checkForUpdates()),
    download: fromPromise<unknown, UpdateAdapter>(({ input }) => input.downloadUpdate()),
  },
  guards: {
    enabled: ({ context }) => context.enabled,
    releaseActive: ({ context }) => ['available', 'downloading', 'downloaded'].includes(context.state.phase),
    available: ({ context }) => context.state.phase === 'available',
    downloaded: ({ context }) => context.state.phase === 'downloaded',
  },
  actions: {
    publish: ({ context }) => context.publish(structuredClone(context.state)),
    install: ({ context }) => context.updater.quitAndInstall(false, true),
    stopScheduledChecks: ({ context }) => context.stopScheduledChecks(),
    setState: assign(({ context, event }) => {
      let state: AppUpdateState
      let discoveredVersion = context.discoveredVersion
      switch (event.type) {
        case 'CHECKING': state = { phase: 'checking' }; break
        case 'AVAILABLE':
          discoveredVersion = event.version
          state = { phase: 'available', version: event.version }
          break
        case 'NOT_AVAILABLE':
          discoveredVersion = undefined
          state = { phase: 'not-available', version: event.version }
          break
        case 'DOWNLOADED':
          discoveredVersion = event.version
          state = { phase: 'downloaded', version: event.version }
          break
        case 'PROGRESS': state = { phase: 'downloading', percent: Math.max(0, Math.min(100, Math.round(event.percent))) }; break
        case 'DOWNLOAD_STARTED': state = { phase: 'downloading' }; break
        case 'ERROR': state = { phase: 'error', message: errorMessage(event.error) }; break
        default: return {}
      }
      const version = state.version ?? discoveredVersion
      return { state: version ? { ...state, version } : state, discoveredVersion }
    }),
    replyState: ({ context, event }) => {
      if (event.type === 'CHECK') event.reply(Promise.resolve(structuredClone(context.state)))
    },
    replyFalse: ({ event }) => { if (event.type === 'DOWNLOAD') event.reply(Promise.resolve(false)) },
    replyTrue: ({ event }) => { if (event.type === 'DOWNLOAD') event.reply(Promise.resolve(true)) },
    startCheck: assign(({ event }) => {
      const check = request<AppUpdateState>()
      if (event.type === 'CHECK') event.reply(check.promise)
      return { check }
    }),
    joinCheck: ({ context, event }) => { if (event.type === 'CHECK' && context.check) event.reply(context.check.promise) },
    finishCheck: assign(({ context }) => {
      context.check?.resolve(structuredClone(context.state))
      return { check: null }
    }),
    startDownload: assign(({ event }) => {
      const download = request<boolean>()
      if (event.type === 'DOWNLOAD') event.reply(download.promise)
      return { download }
    }),
    joinDownload: ({ context, event }) => { if (event.type === 'DOWNLOAD' && context.download) event.reply(context.download.promise) },
    finishDownload: assign(({ context, event }) => {
      if (event.type === 'DOWNLOAD_SETTLED') context.download?.resolve(event.success)
      return { download: null }
    }),
  },
}).createMachine({
  id: 'updates',
  context: ({ input }) => ({
    ...input,
    state: input.enabled ? { phase: 'idle' } : { phase: 'unsupported', message: 'Automatic updates are available in installed builds.' },
    discoveredVersion: undefined,
    check: null,
    download: null,
  }),
  initial: 'initializing',
  states: {
    initializing: { always: [{ guard: 'enabled', target: 'enabled' }, { target: 'unsupported' }] },
    unsupported: { on: { CHECK: { actions: 'replyState' }, DOWNLOAD: { actions: 'replyFalse' } } },
    enabled: {
      type: 'parallel',
      states: {
        phase: {
          initial: 'idle',
          on: {
            CHECKING: { target: '.checking', actions: ['setState', 'publish'] },
            AVAILABLE: { target: '.available', actions: ['setState', 'publish'] },
            NOT_AVAILABLE: { target: '.notAvailable', actions: ['setState', 'publish'] },
            PROGRESS: { target: '.downloading', actions: ['setState', 'publish'] },
            DOWNLOAD_STARTED: { target: '.downloading', actions: ['setState', 'publish'] },
            DOWNLOADED: { target: '.downloaded', actions: ['setState', 'stopScheduledChecks', 'publish'] },
            ERROR: { target: '.error', actions: ['setState', 'publish'] },
          },
          states: { idle: {}, checking: {}, available: {}, downloading: {}, downloaded: {}, notAvailable: {}, error: {} },
        },
        consent: {
          initial: 'unapproved',
          states: {
            unapproved: { on: { DOWNLOAD_STARTED: 'installOnComplete' } },
            installOnComplete: { on: { DOWNLOADED: { target: 'unapproved', actions: 'install' }, ERROR: 'unapproved' } },
          },
        },
        checking: {
          initial: 'idle',
          states: {
            idle: { on: { CHECK: [{ guard: 'releaseActive', actions: 'replyState' }, { target: 'pending', actions: 'startCheck' }] } },
            pending: {
              invoke: {
                src: 'check', input: ({ context }) => context.updater,
                onDone: { actions: raise({ type: 'CHECK_SETTLED' }) },
                onError: { actions: [raise(({ event }) => ({ type: 'ERROR', error: event.error })), raise({ type: 'CHECK_SETTLED' })] },
              },
              on: {
                CHECK: [{ guard: 'releaseActive', actions: 'replyState' }, { actions: 'joinCheck' }],
                CHECK_SETTLED: { target: 'idle', actions: 'finishCheck' },
              },
            },
          },
        },
        downloading: {
          initial: 'idle',
          states: {
            idle: {
              on: { DOWNLOAD: [
                { guard: 'downloaded', actions: ['install', 'replyTrue'] },
                { guard: 'available', target: 'pending', actions: ['startDownload', raise({ type: 'DOWNLOAD_STARTED' })] },
                { actions: 'replyFalse' },
              ] },
            },
            pending: {
              invoke: {
                src: 'download', input: ({ context }) => context.updater,
                onDone: { actions: raise({ type: 'DOWNLOAD_SETTLED', success: true }) },
                onError: { actions: [raise(({ event }) => ({ type: 'ERROR', error: event.error })), raise({ type: 'DOWNLOAD_SETTLED', success: false })] },
              },
              on: { DOWNLOAD: { actions: 'joinDownload' }, DOWNLOAD_SETTLED: { target: 'idle', actions: 'finishDownload' } },
            },
          },
        },
      },
    },
  },
})
