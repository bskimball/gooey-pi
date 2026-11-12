import { assign, createActor, setup, type SnapshotFrom } from 'xstate'
import type { RpcObject } from './types'

/**
 * Activity of one harness child. Regions are independent because the harness
 * can report them in overlapping combinations (a retry while a turn is open,
 * get_state reporting compaction mid-turn); each region owns one lifecycle.
 */
export interface RuntimeActivityInput {
  /** How long a poll-reported compaction end waits for the agent's own compaction_end. */
  endGraceMs: number
  /**
   * How long a post-compaction continuation waits for the agent's next turn.
   * Matches the idle window: a runtime silent that long counts as idle.
   */
  continuationBoundMs: number
  emit: (event: RpcObject) => void
  refreshContextUsage: () => void
}

interface RuntimeActivityContext extends RuntimeActivityInput {
  /** The latest harness turn report since the current continuation began is idle. */
  reportedIdle: boolean
  /** The continuation bound elapsed; the window closes on the next idle report. */
  boundElapsed: boolean
}

export type RuntimeActivityEvent =
  | { type: 'CANCEL' }
  | { type: 'AGENT_START' }
  | { type: 'AGENT_END' }
  | { type: 'AUTO_RETRY_START' }
  | { type: 'AUTO_RETRY_END' }
  | { type: 'COMPACTION_START' }
  | { type: 'COMPACTION_ENDED'; willRetry: boolean }
  /** get_state reports (never buffered, so they can be trusted at any time). */
  | { type: 'REPORTED_STREAMING' }
  | { type: 'REPORTED_IDLE' }
  | { type: 'REPORTED_COMPACTING' }
  | { type: 'REPORTED_NOT_COMPACTING' }
  /** Watchdog poll results, accepted only when newer than the last real compaction event. */
  | { type: 'POLLED_COMPACTING' }
  | { type: 'POLLED_NOT_COMPACTING' }
  | { type: 'WATCHDOG_DISPOSED' }

const runtimeActivitySetup = setup({
  types: {
    context: {} as RuntimeActivityContext,
    input: {} as RuntimeActivityInput,
    events: {} as RuntimeActivityEvent,
  },
  delays: {
    endGrace: ({ context }) => context.endGraceMs,
    continuationBound: ({ context }) => context.continuationBoundMs,
  },
  actions: {
    emitSyntheticStart: ({ context }) => context.emit({ type: 'compaction_start', synthetic: true }),
    emitSyntheticEndForNewTurn: ({ context }) => context.emit({ type: 'compaction_end', synthetic: true, aborted: false, willRetry: true }),
    emitSyntheticEndForGrace: ({ context }) => {
      context.emit({ type: 'compaction_end', synthetic: true, aborted: false, willRetry: false })
      context.refreshContextUsage()
    },
  },
})

// Shared by the real and synthetic episodes; typed through the setup so string
// action and target names stay literal.
const compactionEpisode = runtimeActivitySetup.createStateConfig({
  initial: 'active',
  on: {
    // The agent's own turn start closes any open compaction row (synthetic end).
    AGENT_START: { target: 'idle', actions: 'emitSyntheticEndForNewTurn' },
    COMPACTION_ENDED: 'idle',
    COMPACTION_START: { target: '.active' },
    REPORTED_COMPACTING: { target: '.active' },
    POLLED_COMPACTING: { target: '.active' },
  },
  states: {
    active: {
      on: {
        AGENT_END: 'quiet',
        REPORTED_NOT_COMPACTING: 'quiet',
        POLLED_NOT_COMPACTING: 'closing',
      },
    },
    quiet: {
      on: { POLLED_NOT_COMPACTING: 'closing' },
    },
    // The agent stopped compacting but its own compaction_end has not arrived;
    // the grace window lets the real event land before the row is closed here.
    closing: {
      on: { WATCHDOG_DISPOSED: 'quiet' },
      after: { endGrace: { target: '#compactionIdle', actions: 'emitSyntheticEndForGrace' } },
    },
  },
})

export const runtimeActivityMachine = runtimeActivitySetup.createMachine({
  id: 'runtimeActivity',
  type: 'parallel',
  context: ({ input }) => ({ ...input, reportedIdle: false, boundElapsed: false }),
  states: {
    turn: {
      initial: 'idle',
      on: { CANCEL: '.idle' },
      states: {
        idle: { on: { AGENT_START: 'streaming', REPORTED_STREAMING: 'streaming' } },
        streaming: { on: { AGENT_END: 'idle', REPORTED_IDLE: 'idle' } },
      },
    },
    // Provider auto-retry backoff: agent_end fires, then the same turn restarts.
    // Only auto_retry_end or the restarting agent_start clears it, so get_state
    // reports during the backoff cannot clear it.
    retry: {
      initial: 'clear',
      on: { CANCEL: '.clear' },
      states: {
        clear: { on: { AUTO_RETRY_START: 'retrying' } },
        retrying: { on: { AUTO_RETRY_END: 'clear', AGENT_START: 'clear' } },
      },
    },
    // After a compaction that will retry, the agent starts the next turn on its
    // own. If that start never arrives, the window closes once continuationBound
    // passes and the harness has reported idle since the compaction ended. A
    // runtime still reporting streaming stays busy until its turn ends.
    continuation: {
      initial: 'clear',
      on: { CANCEL: '.clear' },
      states: {
        clear: {
          on: { COMPACTION_ENDED: { guard: ({ event }) => event.willRetry, target: 'pending' } },
        },
        pending: {
          entry: assign({ reportedIdle: false, boundElapsed: false }),
          after: {
            continuationBound: [
              { guard: ({ context }) => context.reportedIdle, target: 'clear' },
              { actions: assign({ boundElapsed: true }) },
            ],
          },
          on: {
            COMPACTION_ENDED: [{ guard: ({ event }) => event.willRetry, target: 'pending', reenter: true }, { target: 'clear' }],
            AGENT_START: 'clear',
            AGENT_END: 'clear',
            REPORTED_STREAMING: { actions: assign({ reportedIdle: false }) },
            REPORTED_IDLE: [
              { guard: ({ context }) => context.boundElapsed, target: 'clear' },
              { actions: assign({ reportedIdle: true }) },
            ],
          },
        },
      },
    },
    compaction: {
      initial: 'idle',
      states: {
        idle: {
          id: 'compactionIdle',
          on: {
            COMPACTION_START: 'real',
            REPORTED_COMPACTING: 'unannounced',
            POLLED_COMPACTING: { target: 'synthetic', actions: 'emitSyntheticStart' },
          },
        },
        // get_state says compacting but no compaction event has opened a row;
        // the next poll announces it.
        unannounced: {
          on: {
            COMPACTION_START: 'real',
            POLLED_COMPACTING: { target: 'synthetic', actions: 'emitSyntheticStart' },
            POLLED_NOT_COMPACTING: 'idle',
            REPORTED_NOT_COMPACTING: 'idle',
            AGENT_START: 'idle',
            AGENT_END: 'idle',
            COMPACTION_ENDED: 'idle',
          },
        },
        real: compactionEpisode,
        synthetic: compactionEpisode,
      },
    },
    watchdog: {
      initial: 'armed',
      states: {
        armed: { on: { WATCHDOG_DISPOSED: 'disposed' } },
        disposed: {},
      },
    },
  },
})

export type RuntimeActivitySnapshot = SnapshotFrom<typeof runtimeActivityMachine>

/** Creates the live activity actor. Timers are unref'd like the rest of the runtime's timers. */
export function createRuntimeActivityActor(input: RuntimeActivityInput) {
  return createActor(runtimeActivityMachine, {
    input,
    clock: {
      setTimeout: (callback, delayMs) => {
        const timer = setTimeout(callback, delayMs)
        timer.unref()
        return timer
      },
      clearTimeout: (timer) => clearTimeout(timer),
    },
  }).start()
}

/** Maps a harness event frame to its activity transition, or null when the frame does not move activity. */
export function activityEventFromFrame(frame: RpcObject): RuntimeActivityEvent | null {
  switch (frame.type) {
    case 'agent_start': return { type: 'AGENT_START' }
    case 'agent_end': return { type: 'AGENT_END' }
    case 'auto_retry_start': return { type: 'AUTO_RETRY_START' }
    case 'auto_retry_end': return { type: 'AUTO_RETRY_END' }
    case 'compaction_start': return { type: 'COMPACTION_START' }
    case 'compaction_end': return { type: 'COMPACTION_ENDED', willRetry: frame.willRetry === true }
    default: return null
  }
}

export function streamingActivity(snapshot: RuntimeActivitySnapshot): boolean {
  return snapshot.matches({ turn: 'streaming' })
    || snapshot.matches({ retry: 'retrying' })
    || snapshot.matches({ continuation: 'pending' })
}

export function compactingActivity(snapshot: RuntimeActivitySnapshot): boolean {
  return snapshot.matches({ compaction: 'unannounced' })
    || snapshot.matches({ compaction: { real: 'active' } })
    || snapshot.matches({ compaction: { synthetic: 'active' } })
}

/** A compaction row was opened by the watchdog; a real compaction_start is then a duplicate. */
export function syntheticCompactionOpen(snapshot: RuntimeActivitySnapshot): boolean {
  return snapshot.matches({ compaction: 'synthetic' })
}

export function watchdogArmed(snapshot: RuntimeActivitySnapshot): boolean {
  return snapshot.matches({ watchdog: 'armed' })
}
