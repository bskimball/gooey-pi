import type { EditorFileContext, HostMessage, HostState, SessionSummary, TranscriptOp } from '../../packages/vscode/src/protocol'
import type { TranscriptMessage } from '../../packages/core/src/types/api'

export const sessionPath = '/storybook/apex/sessions/keyboard.jsonl'
export const catalog: SessionSummary[] = [
  {
    path: sessionPath,
    id: 'keyboard',
    title: 'Keyboard navigation review',
    preview: 'Preserve focus when switching sessions and returning to the composer.',
    updatedAt: '2026-01-15T12:00:00Z',
    messageCount: 12,
  },
  {
    path: '/storybook/apex/sessions/settings.jsonl',
    id: 'settings',
    title: 'Review provider settings and long model names in the narrow editor sidebar',
    preview: 'Check wrapping, disabled providers, and accessible labels.',
    updatedAt: '2026-01-14T12:00:00Z',
    messageCount: 24,
  },
  {
    path: '/storybook/apex/sessions/owned.jsonl',
    id: 'owned',
    title: 'Desktop implementation',
    preview: 'Continue the same conversation from the desktop.',
    updatedAt: '2026-01-13T12:00:00Z',
    messageCount: 8,
    owner: 'Apex desktop',
  },
]
export const readyState: HostState = {
  connection: 'standalone',
  status: 'ready',
  cwd: '/storybook/apex',
  homeDir: '/storybook',
  sessionName: 'Keyboard navigation review',
  isStreaming: false,
  model: 'fixture/reviewer',
  thinkingLevel: 'medium',
  thinkingLevels: ['off', 'low', 'medium', 'high'],
  models: [
    {
      key: 'fixture/reviewer',
      provider: 'fixture',
      id: 'reviewer',
      name: 'Review model',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 200000,
      maxTokens: 16000,
      availableThinkingLevels: ['off', 'low', 'medium', 'high'],
      fastModeSupported: false,
      available: true,
    },
  ],
  providers: [{ id: 'fixture', name: 'Storybook provider', authMethod: 'external', configured: true, modelCount: 1, availableModelCount: 1, enabled: true }],
  commands: [{ name: 'review', description: 'Review the current changes', source: 'prompt' }],
  statuses: {},
  queued: [],
  messageEnterAction: 'queue',
  contextUsage: { tokens: 24000, contextWindow: 200000, percent: 12 },
  sessionUsage: { cost: 0.12 },
}
export const editorFile: EditorFileContext = {
  name: 'SessionPicker.tsx',
  path: '/storybook/apex/packages/vscode/webview/SessionPicker.tsx',
  dirty: true,
  selection: { startLine: 94, endLine: 118, count: 1 },
}
export const conversation: TranscriptMessage[] = [
  { id: 'user-review', role: 'user', timestamp: '2026-01-15T12:00:00Z', parts: [{ type: 'text', text: 'Review the session picker keyboard behavior. Preserve the current Apex design.' }] },
  {
    id: 'assistant-review',
    role: 'assistant',
    timestamp: '2026-01-15T12:00:01Z',
    completedAt: '2026-01-15T12:00:15Z',
    parts: [{ type: 'text', text: 'The picker supports arrow navigation, Home, End, and Escape. I will check focus restoration after a session switch and verify the narrow editor layout.' }],
  },
]
export function messagesFor(state: HostState = readyState, file: EditorFileContext | null = null, streaming = false): HostMessage[] {
  const messages = streaming
    ? [
        ...conversation,
        {
          id: 'assistant-live',
          role: 'assistant',
          streaming: true,
          parts: [
            { type: 'thinking', text: 'Checking the focus target after closing the picker.' },
            { type: 'text', text: 'The trigger retains focus after Escape. Next I am checking session switching…' },
          ],
        } satisfies TranscriptMessage,
      ]
    : conversation
  const ops: TranscriptOp[] = messages.map((message) => ({ kind: 'saved', message }))
  return [
    { type: 'state', state },
    { type: 'reset', ops },
    { type: 'editorContext', file },
    { type: 'git', git: { isRepo: true, branch: 'feature/keyboard-review', files: [] } },
  ]
}
export const browserMessage: Extract<HostMessage, { type: 'browserState' }> = {
  type: 'browserState',
  state: {
    tabs: [
      {
        backend: 'extension',
        pairedByUser: true,
        paused: false,
        tabId: 'storybook-tab',
        sessionFile: sessionPath,
        url: 'https://example.invalid/review',
        title: 'Keyboard review preview',
        attached: true,
        active: true,
        canGoBack: false,
        canGoForward: false,
      },
    ],
  },
  status: { connected: true, extensionPath: '/storybook/browser-extension', bridgePort: null, activeSessionKey: sessionPath, pairedTabCount: 1 },
}
export const extensionMessage: HostMessage = {
  type: 'extensionUi',
  request: { type: 'extension_ui_request', method: 'select', id: 'review-next', title: 'Which check should run next?', options: ['Keyboard navigation', 'Narrow editor layout', 'Both clients'] },
}
