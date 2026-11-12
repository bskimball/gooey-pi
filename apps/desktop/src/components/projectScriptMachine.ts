import { assign, setup, type SnapshotFrom } from 'xstate'
import type { HarnessId } from '@/types/api'
import type { ProjectScriptKind } from './ProjectRunControl'
import type { TerminalCommandOutcome } from './TerminalDrawer'

export interface ProjectScriptRun {
  requestId: string
  projectId: string
  harness: HarnessId
  kind: ProjectScriptKind
  command: string
  drawerId?: string
  tabId?: string
  ownsDrawer: boolean
}

interface Context {
  run?: ProjectScriptRun
  exitCode?: number
  setupFailure?: { projectId: string; error: string }
}

export type ProjectScriptEvent =
  | { type: 'REQUEST' }
  | { type: 'ABORT' }
  | { type: 'START'; run: ProjectScriptRun }
  | { type: 'TAB_STARTED'; tabId: string }
  | { type: 'EXIT'; exitCode: number }
  | { type: 'FAIL'; error: string }
  | { type: 'CANCEL' }

export type ProjectScriptSnapshot = SnapshotFrom<typeof projectScriptMachine>

// Maps a terminal command outcome to the lifecycle event it produces.
export function projectScriptFinishEvent(outcome: TerminalCommandOutcome): ProjectScriptEvent {
  if ('exitCode' in outcome) return { type: 'EXIT', exitCode: outcome.exitCode }
  if ('error' in outcome) return { type: 'FAIL', error: outcome.error }
  return { type: 'CANCEL' }
}

export function isProjectScriptBusy(snapshot: ProjectScriptSnapshot): boolean {
  return snapshot.matches('starting') || snapshot.matches('settingUp') || snapshot.matches('running')
}

// One lifecycle for setup and run scripts. `starting` covers the async grant and
// markSetupStarted calls before a terminal exists, so busy checks cover the whole span.
export const projectScriptMachine = setup({
  types: { context: {} as Context, events: {} as ProjectScriptEvent },
}).createMachine({
  id: 'projectScript',
  context: {},
  initial: 'idle',
  states: {
    idle: { on: { REQUEST: { target: 'starting', actions: assign({ setupFailure: undefined }) } } },
    starting: {
      on: {
        ABORT: { target: 'idle' },
        START: [
          { guard: ({ event }) => event.run.kind === 'setup', target: 'settingUp', actions: assign({ run: ({ event }) => event.run }) },
          { target: 'running', actions: assign({ run: ({ event }) => event.run }) },
        ],
      },
    },
    settingUp: {
      on: {
        TAB_STARTED: { actions: assign({ run: ({ context, event }) => context.run && { ...context.run, tabId: event.tabId } }) },
        EXIT: { target: 'exited', actions: assign({ run: undefined, exitCode: ({ event }) => event.exitCode }) },
        FAIL: {
          target: 'setupFailed',
          actions: assign({ run: undefined, setupFailure: ({ context, event }) => ({ projectId: context.run?.projectId ?? '', error: event.error }) }),
        },
        CANCEL: { target: 'idle', actions: assign({ run: undefined }) },
      },
    },
    running: {
      on: {
        TAB_STARTED: { actions: assign({ run: ({ context, event }) => context.run && { ...context.run, tabId: event.tabId } }) },
        EXIT: { target: 'exited', actions: assign({ run: undefined, exitCode: ({ event }) => event.exitCode }) },
        FAIL: { target: 'idle', actions: assign({ run: undefined }) },
        CANCEL: { target: 'idle', actions: assign({ run: undefined }) },
      },
    },
    setupFailed: { on: { REQUEST: { target: 'starting', actions: assign({ setupFailure: undefined }) } } },
    exited: { on: { REQUEST: { target: 'starting', actions: assign({ setupFailure: undefined }) } } },
  },
})
