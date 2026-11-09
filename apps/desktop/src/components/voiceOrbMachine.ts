import { assign, setup } from 'xstate'
import type { VoiceTaskStarted } from '@/types/api'

export type OrbState = 'connecting' | 'listening' | 'user-speaking' | 'thinking' | 'agent-speaking' | 'error'

interface Context {
  muted: boolean
  error: string
  taskReceipt: VoiceTaskStarted | null
  taskOpened: boolean
  handledCalls: ReadonlySet<string>
  responseActive: boolean
  pendingToolCalls: number
  continuationPending: boolean
  pendingResponseCreateEventId: string | null
  clientEventSequence: number
  sendContinuation: ((eventId: string) => boolean) | null
}

type Event =
  | { type: 'RESET'; sendContinuation: (eventId: string) => boolean }
  | { type: 'CHANNEL_OPEN' }
  | { type: 'SPEECH_STARTED' }
  | { type: 'SPEECH_STOPPED' }
  | { type: 'RESPONSE_CREATED' }
  | { type: 'AUDIO_STARTED' }
  | { type: 'AUDIO_STOPPED' }
  | { type: 'RESPONSE_DONE' }
  | { type: 'TOOL_STARTED'; callId: string; isStartTask: boolean }
  | { type: 'TOOL_FINISHED'; openChannel: boolean }
  | { type: 'TASK_STARTED'; task: VoiceTaskStarted }
  | { type: 'TASK_OPENED' }
  | { type: 'TASK_OPEN_FAILED'; message: string }
  | { type: 'START_TASK_FAILED'; message: string }
  | { type: 'REALTIME_ERROR'; detail: string; code: string; eventId: string }
  | { type: 'CONNECT_FAILED'; message: string }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'MUTE_FOR_PET' }

export const voiceOrbMachine = setup({
  types: { context: {} as Context, events: {} as Event },
  actions: {
    maybeContinueAfterTools: assign(({ context }) => {
      if (
        context.responseActive
        || context.pendingToolCalls > 0
        || !context.continuationPending
        || !context.sendContinuation
      ) {
        return {}
      }
      const nextSequence = context.clientEventSequence + 1
      const eventId = `gooeypi-response-${Date.now().toString(36)}-${nextSequence}`
      if (!context.sendContinuation(eventId)) return {}
      return {
        continuationPending: false,
        responseActive: true,
        pendingResponseCreateEventId: eventId,
        clientEventSequence: nextSequence,
      }
    }),
  },
}).createMachine({
  id: 'voiceOrb',
  context: {
    muted: false,
    error: '',
    taskReceipt: null,
    taskOpened: false,
    handledCalls: new Set(),
    responseActive: false,
    pendingToolCalls: 0,
    continuationPending: false,
    pendingResponseCreateEventId: null,
    clientEventSequence: 0,
    sendContinuation: null,
  },
  initial: 'connecting',
  on: {
    RESET: {
      target: '.connecting',
      actions: assign(({ context, event }) => ({
        muted: context.muted,
        error: '',
        taskReceipt: context.taskReceipt,
        taskOpened: context.taskOpened,
        handledCalls: new Set<string>(),
        responseActive: false,
        pendingToolCalls: 0,
        continuationPending: false,
        pendingResponseCreateEventId: null,
        clientEventSequence: 0,
        sendContinuation: event.sendContinuation,
      })),
    },
    CHANNEL_OPEN: { target: '.listening' },
    SPEECH_STARTED: { target: '.userSpeaking' },
    SPEECH_STOPPED: { target: '.thinking' },
    RESPONSE_CREATED: {
      target: '.thinking',
      actions: assign({ responseActive: true }),
    },
    AUDIO_STARTED: { target: '.agentSpeaking' },
    AUDIO_STOPPED: { target: '.listening' },
    RESPONSE_DONE: {
      target: '.listening',
      actions: [
        assign({
          responseActive: false,
          pendingResponseCreateEventId: null,
        }),
        'maybeContinueAfterTools',
      ],
    },
    TOOL_STARTED: {
      target: '.thinking',
      actions: assign(({ context, event }) => ({
        handledCalls: new Set(context.handledCalls).add(event.callId),
        pendingToolCalls: context.pendingToolCalls + 1,
        error: event.isStartTask ? '' : context.error,
      })),
    },
    TOOL_FINISHED: {
      actions: [
        assign(({ context, event }) => ({
          pendingToolCalls: Math.max(0, context.pendingToolCalls - 1),
          continuationPending: event.openChannel ? true : context.continuationPending,
        })),
        'maybeContinueAfterTools',
      ],
    },
    TASK_STARTED: {
      actions: assign(({ event }) => ({
        taskReceipt: event.task,
        taskOpened: false,
      })),
    },
    TASK_OPENED: {
      actions: assign({ taskOpened: true }),
    },
    TASK_OPEN_FAILED: {
      actions: assign(({ event }) => ({
        error: `The task started, but Apex could not open it: ${event.message}`,
      })),
    },
    START_TASK_FAILED: {
      actions: assign(({ event }) => ({
        taskReceipt: null,
        error: `Task was not started: ${event.message}`,
      })),
    },
    REALTIME_ERROR: {
      target: '.error',
      actions: assign(({ context, event }) => {
        const correlated = Boolean(event.eventId && event.eventId === context.pendingResponseCreateEventId)
        let responseActive = context.responseActive
        let continuationPending = context.continuationPending
        let pendingResponseCreateEventId = context.pendingResponseCreateEventId
        if (correlated) {
          pendingResponseCreateEventId = null
          if (event.code === 'conversation_already_has_active_response') {
            responseActive = true
            continuationPending = true
          } else {
            responseActive = false
            continuationPending = false
          }
        }
        return {
          error: context.error.startsWith('Task was not started:') ? context.error : event.detail,
          responseActive,
          continuationPending,
          pendingResponseCreateEventId,
        }
      }),
    },
    CONNECT_FAILED: {
      target: '.error',
      actions: assign(({ event }) => ({
        error: event.message,
      })),
    },
    TOGGLE_MUTE: [
      {
        guard: ({ context }) => !context.muted,
        target: '.listening',
        actions: assign({ muted: true }),
      },
      {
        actions: assign({ muted: false }),
      },
    ],
    MUTE_FOR_PET: {
      target: '.listening',
      actions: assign({ muted: true }),
    },
  },
  states: {
    connecting: {},
    listening: {},
    userSpeaking: {},
    thinking: {},
    agentSpeaking: {},
    error: {
      on: {
        MUTE_FOR_PET: {
          actions: assign({ muted: true }),
        },
      },
    },
  },
})
