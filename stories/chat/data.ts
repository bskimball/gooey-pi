import type {
  ApexModelDescriptor,
  ApexProviderDescriptor,
  BrowserAnnotation,
  AgentBrowserTabRecord,
  GitStatus,
  MessagePart,
  TranscriptMessage,
  QueuedPrompt,
  CheckoutCatalog,
  SessionRecord,
} from '../../packages/core/src/types/api'

export const noop = () => undefined
export const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
export const image = { type: 'image', mimeType: 'image/png', data: png } satisfies Extract<MessagePart, { type: 'image' }>
export const imageUrl = `data:image/png;base64,${png}`
export const model = {
  key: 'fixture/reasoner',
  provider: 'fixture',
  id: 'reasoner',
  name: 'Reasoner',
  reasoning: true,
  input: ['text', 'image'],
  contextWindow: 200000,
  maxTokens: 16000,
  availableThinkingLevels: ['off', 'medium', 'high'],
  fastModeSupported: true,
  available: true,
  enabled: true,
} satisfies ApexModelDescriptor
export const providers: ApexProviderDescriptor[] = [
  { id: 'fixture', name: 'Sample provider', authMethod: 'api_key', configured: true, modelCount: 2, availableModelCount: 2, enabled: true },
  { id: 'local', name: 'Local models', authMethod: 'external', configured: true, modelCount: 1, availableModelCount: 1, enabled: true },
]
export const models = new Map<string, ApexModelDescriptor[]>([
  ['fixture', [model, { ...model, key: 'fixture/fast', id: 'fast', name: 'Fast model', reasoning: false }]],
  ['local', [{ ...model, key: 'local/small', provider: 'local', id: 'small', name: 'Small local model' }]],
])
export const git = {
  isRepo: true,
  branch: 'story/catalog',
  files: [
    { path: 'src/components/Chat.tsx', status: 'M', staged: false, additions: 32, deletions: 8 },
    { path: 'src/styles/chat.css', status: 'A', staged: true, additions: 18, deletions: 0 },
    { path: 'src/legacy/a/very/long/path/OldChat.tsx', status: 'D', staged: false, additions: 0, deletions: 64 },
  ],
} satisfies GitStatus
export const cleanGit = { isRepo: true, branch: 'main', files: [] } satisfies GitStatus
export const branches = {
  strategy: 'branch',
  activeName: 'main',
  checkouts: [
    { name: 'main', current: true },
    { name: 'design/chat-catalog', current: false },
  ],
} satisfies CheckoutCatalog
export const worktrees = {
  strategy: 'worktree',
  activePath: '/sample/apex',
  checkouts: [
    { path: '/sample/apex', name: 'apex', branch: 'main', head: '0123456', current: true, detached: false },
    { path: '/sample/apex-chat', name: 'apex-chat', branch: 'design/chat', head: 'abcdef0', current: false, detached: false },
  ],
} satisfies CheckoutCatalog
export const session = {
  id: 'story-session',
  harness: 'pi',
  filePath: '/sample/story.jsonl',
  projectPath: '/sample/apex',
  title: 'Chat design review',
  createdAt: '2026-01-01T12:00:00Z',
  updatedAt: '2026-01-01T12:05:00Z',
  status: 'idle',
  depth: 0,
} satisfies SessionRecord
export const annotation = {
  id: 'story-selection',
  comment: 'Keep this action aligned with the message.',
  element: { selector: '#send', tagName: 'button', id: 'send', classes: ['send'], text: 'Send', component: 'SendButton', rect: { x: 10, y: 20, width: 80, height: 32 } },
  preview: image,
  pageUrl: 'https://example.invalid/chat',
  pageTitle: 'Sample chat',
  stale: false,
  createdAt: 1767268800000,
} satisfies BrowserAnnotation
export const tab = {
  backend: 'extension',
  pairedByUser: true,
  tabId: 'story-tab',
  sessionFile: session.filePath,
  url: annotation.pageUrl,
  title: 'Sample chat',
  attached: true,
  active: true,
  canGoBack: false,
  canGoForward: false,
  selection: annotation.element,
} satisfies AgentBrowserTabRecord
export const queue: QueuedPrompt[] = [
  { id: 'queue-1', text: 'Also check keyboard focus in the narrow layout.', intent: 'queue', timestamp: 1767268800000 },
  { id: 'queue-2', text: 'Steer: preserve the existing composer and compare this attachment.', intent: 'steer', parts: [image], timestamp: 1767268800000 },
]
export const work: MessagePart[] = [
  { type: 'thinking', text: 'I will inspect the component contracts before changing the stories.' },
  { type: 'toolCall', id: 'read-1', name: 'read', args: { path: 'src/components/Chat.tsx', offset: 1, limit: 20 } },
  { type: 'toolResult', name: 'read', text: 'export function Chat() { return <main /> }' },
  { type: 'toolCall', id: 'search-1', name: 'ffgrep', args: { pattern: 'Composer', path: 'src/' } },
  { type: 'toolResult', name: 'ffgrep', text: 'src/components/Chat.tsx:24 Composer' },
  { type: 'toolCall', id: 'edit-1', name: 'edit', args: { path: 'src/components/Chat.tsx', oldText: 'ready: false', newText: 'ready: true' } },
  { type: 'toolResult', name: 'edit', text: 'Updated Chat.tsx' },
  { type: 'toolCall', id: 'cmd-1', name: 'bash', args: { command: 'npm run check:chat' } },
  { type: 'toolResult', name: 'bash', text: 'Checked 12 stories. All passed.' },
]
export const user = {
  id: 'prompt-1',
  role: 'user',
  timestamp: '2026-01-01T12:00:00Z',
  parts: [{ type: 'text', text: 'Review the chat design and preserve the existing components.' }, image],
} satisfies TranscriptMessage
export const assistant = {
  id: 'reply-1',
  role: 'assistant',
  startedAt: '2026-01-01T12:00:00Z',
  completedAt: '2026-01-01T12:01:12Z',
  parts: [...work, { type: 'text', text: 'The catalog now uses the **existing components**. Review the changes below.\n\n- Composer controls\n- Streaming timeline\n- Rich content' }],
} satisfies TranscriptMessage
export const live = {
  ...assistant,
  id: 'reply-live',
  completedAt: undefined,
  streaming: true,
  parts: [
    ...work,
    { type: 'toolCall', id: 'pending', name: 'bash', args: { command: 'Checking focused stories' } },
    { type: 'toolResult', name: 'bash', text: 'Checking composer…\nChecking transcript…', streaming: true },
  ],
} satisfies TranscriptMessage
export const failed = {
  ...assistant,
  id: 'reply-failed',
  errorMessage: 'The scoped check failed. No files were changed.',
  parts: [
    { type: 'toolCall', id: 'failure', name: 'bash', args: { command: 'npm run check:chat' } },
    { type: 'toolResult', name: 'bash', text: 'Missing fixture for history reader', isError: true },
  ],
} satisfies TranscriptMessage
