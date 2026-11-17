import type { AppSettings, AppMeta, ApexModelCatalog } from '../packages/core/src/types/api'

export function createStorySettings(): AppSettings {
  return {
    theme: 'system',
    locale: 'system',
    interfaceFontScale: 110,
    projectSortMode: 'recent',
    sidebarOpen: true,
    inspectorOpen: false,
    showFileChangesPopup: true,
    checkoutStrategy: 'worktree',
    keepRunningInBackground: false,
    launchAtLogin: false,
    terminalOpen: false,
    defaultInspectorTab: 'summary',
    browserHome: 'about:blank',
    browserAskForDownloads: true,
    terminalShell: '',
    reduceMotion: true,
    showReasoningSummaries: true,
    showToolCalls: true,
    messageEnterAction: 'queue',
    runtimePaths: { pi: '' },
    enabledHarnesses: ['pi'],
    telemetry: false,
    askUserEnabled: true,
    browserEnabled: true,
    computerUseEnabled: false,
    piDisabledProviders: [],
    piDisabledModels: [],
    lastSelectedModels: { pi: 'fixture/story-model' },
    activeHarness: 'pi',
    petEnabled: false,
    petId: 'orb',
    petSize: 75,
    voiceTranscriptionProvider: 'openai-live',
    voiceOpenAiLiveTranscriptionModel: 'gpt-live-transcribe',
    voiceOpenAiTranscriptionModel: 'gpt-4o-transcribe',
    voiceGroqTranscriptionModel: 'whisper-large-v3-turbo',
    voiceDeepgramTranscriptionModel: 'nova-3',
    voiceSelfHostedUrl: '',
    voiceSelfHostedModel: '',
    voiceLocalWhisperExecutable: '',
    voiceLocalWhisperModel: '',
    voiceRealtimeModel: 'gpt-realtime-2.1',
    voiceRealtimeVoice: 'marin',
  }
}
export function createStoryMeta(): AppMeta {
  return { version: '0.0.0-storybook', platform: 'linux', homeDir: '/storybook', harnesses: { pi: { path: null, version: 'fixture' } } }
}
export function createStoryModelCatalog(): ApexModelCatalog {
  return {
    apexVersion: '0.0.0-storybook',
    refreshedAt: '2026-01-01T00:00:00.000Z',
    providers: [{ id: 'fixture', name: 'Story provider', authMethod: 'api_key', configured: true, modelCount: 1, availableModelCount: 1, enabled: true }],
    models: [
      {
        key: 'fixture/story-model',
        provider: 'fixture',
        id: 'story-model',
        name: 'Story model',
        reasoning: true,
        input: ['text', 'image'],
        contextWindow: 200000,
        maxTokens: 8192,
        availableThinkingLevels: ['off', 'low', 'medium', 'high'],
        fastModeSupported: false,
        available: true,
        enabled: true,
      },
    ],
  }
}
