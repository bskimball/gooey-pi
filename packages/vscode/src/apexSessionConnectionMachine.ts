import { assign, setup, type SnapshotFrom } from 'xstate'
import type { AttachedSession } from './attached-session'
import type { HostState } from './protocol'

export interface ApexConnectionContext {
  /** Desktop session this window is bound to; only meaningful in the Desktop states. */
  path: string | undefined
  /** Live Desktop view; only set in attachedDesktop. */
  view: AttachedSession | undefined
  error: string | undefined
  /** A failed attach while the local Pi still runs returns to ready instead of marking Desktop unavailable. */
  resumeLocal: boolean
}

export type ApexConnectionEvent =
  | { type: 'START_LOCAL' }
  | { type: 'LOCAL_STARTED' }
  | { type: 'LOCAL_EXITED'; error: string }
  | { type: 'BEGIN_SWITCH' }
  | { type: 'END_SWITCH' }
  | { type: 'RELEASE' }
  | { type: 'ATTACH_DESKTOP'; path: string; resumeLocal: boolean }
  | { type: 'ATTACHED'; path: string; view: AttachedSession }
  | { type: 'ATTACH_FAILED'; error: string }
  | { type: 'DESKTOP_UNAVAILABLE'; path: string; error: string }
  | { type: 'DESKTOP_DISCONNECTED'; view: AttachedSession; error: string }

/** Owns which runtime this window is connected to; Pi processes and transcripts stay in ApexSession. */
export const apexSessionConnectionMachine = setup({
  types: {
    context: {} as ApexConnectionContext,
    events: {} as ApexConnectionEvent,
  },
  actions: {
    beginAttach: assign(({ event }) => (event.type === 'ATTACH_DESKTOP' ? { path: event.path, view: undefined, error: undefined, resumeLocal: event.resumeLocal } : {})),
    markUnavailable: assign(({ event }) => (event.type === 'DESKTOP_UNAVAILABLE' ? { path: event.path, view: undefined, error: event.error, resumeLocal: false } : {})),
    recordExit: assign(({ event }) => (event.type === 'LOCAL_EXITED' ? { path: undefined, view: undefined, error: event.error, resumeLocal: false } : {})),
  },
  guards: {
    resumesLocal: ({ context }) => context.resumeLocal,
    isCurrentView: ({ context, event }) => event.type === 'DESKTOP_DISCONNECTED' && event.view === context.view,
  },
}).createMachine({
  id: 'apexSessionConnection',
  context: { path: undefined, view: undefined, error: undefined, resumeLocal: false },
  initial: 'starting',
  on: {
    START_LOCAL: { target: '.starting', actions: assign({ path: undefined, view: undefined, error: undefined, resumeLocal: false }) },
    RELEASE: { target: '.exited', actions: assign({ path: undefined, view: undefined, error: undefined, resumeLocal: false }) },
    DESKTOP_UNAVAILABLE: { target: '.desktopUnavailable', actions: 'markUnavailable' },
  },
  states: {
    starting: {
      on: {
        LOCAL_STARTED: { target: 'ready' },
        BEGIN_SWITCH: { target: 'switching' },
        LOCAL_EXITED: { target: 'exited', actions: 'recordExit' },
        ATTACH_DESKTOP: { target: 'attachingDesktop', actions: 'beginAttach' },
      },
    },
    ready: {
      on: {
        BEGIN_SWITCH: { target: 'switching' },
        LOCAL_EXITED: { target: 'exited', actions: 'recordExit' },
        ATTACH_DESKTOP: { target: 'attachingDesktop', actions: 'beginAttach' },
      },
    },
    switching: {
      on: {
        END_SWITCH: { target: 'ready' },
        LOCAL_EXITED: { target: 'exited', actions: 'recordExit' },
      },
    },
    exited: {
      on: {
        ATTACH_DESKTOP: { target: 'attachingDesktop', actions: 'beginAttach' },
        DESKTOP_UNAVAILABLE: { target: 'desktopUnavailable', actions: 'markUnavailable' },
      },
    },
    attachingDesktop: {
      on: {
        ATTACHED: { target: 'attachedDesktop', actions: assign(({ event }) => ({ path: event.path, view: event.view, error: undefined })) },
        ATTACH_FAILED: [
          { guard: 'resumesLocal', target: 'ready', actions: assign({ path: undefined, view: undefined, error: undefined, resumeLocal: false }) },
          { target: 'desktopUnavailable', actions: assign(({ event }) => ({ view: undefined, error: event.type === 'ATTACH_FAILED' ? event.error : undefined, resumeLocal: false })) },
        ],
        // The pending view is the only one that can still report: superseded views are disposed before their callbacks can fire.
        DESKTOP_DISCONNECTED: [
          { guard: 'resumesLocal', target: 'ready', actions: assign({ path: undefined, view: undefined, error: undefined, resumeLocal: false }) },
          { target: 'desktopUnavailable', actions: assign(({ event }) => ({ view: undefined, error: event.type === 'DESKTOP_DISCONNECTED' ? event.error : undefined, resumeLocal: false })) },
        ],
        LOCAL_EXITED: { target: 'exited', actions: 'recordExit' },
      },
    },
    attachedDesktop: {
      on: {
        ATTACH_DESKTOP: { target: 'attachingDesktop', actions: 'beginAttach' },
        DESKTOP_UNAVAILABLE: { target: 'desktopUnavailable', actions: 'markUnavailable' },
        DESKTOP_DISCONNECTED: { guard: 'isCurrentView', target: 'desktopUnavailable', actions: assign(({ event }) => ({ view: undefined, error: event.type === 'DESKTOP_DISCONNECTED' ? event.error : undefined })) },
      },
    },
    desktopUnavailable: {
      on: {
        ATTACH_DESKTOP: { target: 'attachingDesktop', actions: 'beginAttach' },
        DESKTOP_UNAVAILABLE: { target: 'desktopUnavailable', actions: 'markUnavailable' },
      },
    },
  },
})

type ConnectionSnapshot = SnapshotFrom<typeof apexSessionConnectionMachine>

/** Local Pi can take commands: it has finished starting and is not mid-switch, exited, or Desktop-owned. */
export const canAct = (snapshot: ConnectionSnapshot) => snapshot.matches('ready')

/** Desktop session this window is bound to, whether attached, attaching, or unavailable. */
export function desktopPathOf(snapshot: ConnectionSnapshot): string | undefined {
  const bound = snapshot.matches('attachingDesktop') || snapshot.matches('attachedDesktop') || snapshot.matches('desktopUnavailable')
  return bound ? snapshot.context.path : undefined
}

/** Host-visible status fields, derived from the lifecycle rather than written beside it. */
export function hostConnection(snapshot: ConnectionSnapshot): Pick<HostState, 'status' | 'connection' | 'error'> {
  const error = snapshot.context.error
  if (snapshot.matches('attachedDesktop')) return { status: 'ready', connection: 'desktop', error }
  if (snapshot.matches('attachingDesktop')) return { status: 'starting', connection: 'desktop', error }
  if (snapshot.matches('desktopUnavailable')) return { status: 'exited', connection: 'desktop', error }
  if (snapshot.matches('exited')) return { status: 'exited', connection: 'standalone', error }
  if (snapshot.matches('starting')) return { status: 'starting', connection: 'standalone', error }
  return { status: 'ready', connection: 'standalone', error }
}
