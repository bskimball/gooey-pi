import { assign, setup } from 'xstate'
import type { VoiceCredentialProvider, VoiceCredentialStatus } from '@/types/api'

export interface VoiceSettingsInput {
  voiceAvailable: boolean
  selfHostedUrl: string
  selfHostedModel: string
}

export interface VoiceSettingsContext {
  voiceAvailable: boolean
  status: VoiceCredentialStatus | null
  credential: VoiceCredentialProvider | null
  apiKey: string
  failure: string
  selfHostedUrl: string
  selfHostedModel: string
  selfHostedMessage: string
}

export type VoiceSettingsEvent =
  | { type: 'CHECK_STATUS' }
  | { type: 'VOICE_UNAVAILABLE' }
  | { type: 'STATUS_LOADED'; status: VoiceCredentialStatus }
  | { type: 'RESTART_REQUIRED' }
  | { type: 'STATUS_FAILED'; error: string }
  | { type: 'OPEN_CREDENTIAL'; provider: VoiceCredentialProvider }
  | { type: 'CLOSE_CREDENTIAL' }
  | { type: 'SET_API_KEY'; value: string }
  | { type: 'SAVE_CREDENTIAL' }
  | { type: 'SAVE_SUCCEEDED'; status: VoiceCredentialStatus }
  | { type: 'SAVE_FAILED'; error: string }
  | { type: 'DELETE_CREDENTIAL' }
  | { type: 'DELETE_SUCCEEDED'; status: VoiceCredentialStatus }
  | { type: 'DELETE_FAILED'; error: string }
  | { type: 'SYNC_SELF_HOSTED'; url: string; model: string }
  | { type: 'SET_SELF_HOSTED_URL'; value: string }
  | { type: 'SET_SELF_HOSTED_MODEL'; value: string }
  | { type: 'TEST_SELF_HOSTED' }
  | { type: 'TEST_SUCCEEDED' }
  | { type: 'TEST_FAILED'; error: string }

export const voiceSettingsMachine = setup({
  types: {
    context: {} as VoiceSettingsContext,
    events: {} as VoiceSettingsEvent,
    input: {} as VoiceSettingsInput,
  },
}).createMachine({
  id: 'voiceSettings',
  type: 'parallel',
  context: ({ input }) => ({
    voiceAvailable: input.voiceAvailable,
    status: null,
    credential: null,
    apiKey: '',
    failure: '',
    selfHostedUrl: input.selfHostedUrl,
    selfHostedModel: input.selfHostedModel,
    selfHostedMessage: '',
  }),
  states: {
    service: {
      initial: 'checking',
      states: {
        checking: {
          always: {
            guard: ({ context }) => !context.voiceAvailable,
            target: 'restartRequired',
          },
          on: {
            STATUS_LOADED: {
              target: 'ready',
              actions: assign({ status: ({ event }) => event.status, failure: '' }),
            },
            RESTART_REQUIRED: {
              target: 'restartRequired',
              actions: assign({ status: null, credential: null, failure: '' }),
            },
            STATUS_FAILED: {
              target: 'error',
              actions: assign({ status: null, failure: ({ event }) => event.error }),
            },
            VOICE_UNAVAILABLE: {
              target: 'restartRequired',
              actions: assign({ voiceAvailable: false, status: null, credential: null, failure: '' }),
            },
          },
        },
        ready: {
          initial: 'idle',
          on: {
            CHECK_STATUS: {
              target: 'checking',
              actions: assign({ voiceAvailable: true }),
            },
            VOICE_UNAVAILABLE: {
              target: 'restartRequired',
              actions: assign({ voiceAvailable: false, status: null, credential: null, failure: '' }),
            },
          },
          states: {
            idle: {
              on: {
                OPEN_CREDENTIAL: {
                  target: 'modalOpen',
                  actions: assign({ credential: ({ event }) => event.provider, failure: '' }),
                },
                DELETE_CREDENTIAL: {
                  target: 'deleting',
                  actions: assign({ failure: '' }),
                },
              },
            },
            modalOpen: {
              initial: 'editing',
              states: {
                editing: {
                  on: {
                    SET_API_KEY: { actions: assign({ apiKey: ({ event }) => event.value }) },
                    CLOSE_CREDENTIAL: {
                      target: '#voiceSettings.service.ready.idle',
                      actions: assign({ credential: null, apiKey: '', failure: '' }),
                    },
                    SAVE_CREDENTIAL: {
                      target: 'saving',
                      actions: assign({ failure: '' }),
                    },
                  },
                },
                saving: {
                  on: {
                    SAVE_SUCCEEDED: {
                      target: '#voiceSettings.service.ready.idle',
                      actions: assign({ status: ({ event }) => event.status, apiKey: '', credential: null }),
                    },
                    SAVE_FAILED: {
                      target: 'editing',
                      actions: assign({ failure: ({ event }) => event.error }),
                    },
                  },
                },
              },
            },
            deleting: {
              on: {
                DELETE_SUCCEEDED: {
                  target: 'idle',
                  actions: assign({ status: ({ event }) => event.status }),
                },
                DELETE_FAILED: {
                  target: 'idle',
                  actions: assign({ failure: ({ event }) => event.error }),
                },
              },
            },
          },
        },
        restartRequired: {
          on: {
            CHECK_STATUS: {
              target: 'checking',
              actions: assign({ voiceAvailable: true }),
            },
          },
        },
        error: {
          on: {
            CHECK_STATUS: {
              target: 'checking',
              actions: assign({ voiceAvailable: true }),
            },
            VOICE_UNAVAILABLE: {
              target: 'restartRequired',
              actions: assign({ voiceAvailable: false, status: null, credential: null, failure: '' }),
            },
          },
        },
      },
    },
    selfHostedTest: {
      initial: 'idle',
      on: {
        SET_SELF_HOSTED_URL: {
          target: '.idle',
          actions: assign({ selfHostedUrl: ({ event }) => event.value, selfHostedMessage: '' }),
        },
        SET_SELF_HOSTED_MODEL: {
          target: '.idle',
          actions: assign({ selfHostedModel: ({ event }) => event.value, selfHostedMessage: '' }),
        },
        SYNC_SELF_HOSTED: {
          actions: assign({
            selfHostedUrl: ({ event }) => event.url,
            selfHostedModel: ({ event }) => event.model,
          }),
        },
      },
      states: {
        idle: {
          on: {
            TEST_SELF_HOSTED: { target: 'testing', actions: assign({ selfHostedMessage: '' }) },
          },
        },
        testing: {
          on: {
            TEST_SUCCEEDED: {
              target: 'connected',
              actions: assign({ selfHostedMessage: 'Connected. Apex successfully transcribed a test audio clip.' }),
            },
            TEST_FAILED: {
              target: 'error',
              actions: assign({ selfHostedMessage: ({ event }) => event.error }),
            },
          },
        },
        connected: {
          on: {
            TEST_SELF_HOSTED: { target: 'testing', actions: assign({ selfHostedMessage: '' }) },
          },
        },
        error: {
          on: {
            TEST_SELF_HOSTED: { target: 'testing', actions: assign({ selfHostedMessage: '' }) },
          },
        },
      },
    },
  },
})
