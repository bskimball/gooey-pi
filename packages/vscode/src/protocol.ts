import type { AgentBrowserState, AgentBrowserExtensionStatus, TranscriptMessage } from 'apex-core/types/api'

export type BrowserMethod = 'getExtensionStatus' | 'state' | 'setActiveSession' | 'setTabPaused' | 'focusExtensionTab' | 'popOutTab'

// Messages exchanged between the extension host and the Apex webview.
// Model/provider shapes mirror pi-desktop's PrimeModelDescriptor/PrimeProviderDescriptor.

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ModelDescriptor {
  key: string
  provider: string
  id: string
  name: string
  reasoning: boolean
  input: Array<'text' | 'image'>
  contextWindow: number
  maxTokens: number
  availableThinkingLevels: ThinkingLevel[]
  fastModeSupported: boolean
  available: boolean
}

export interface ProviderDescriptor {
  id: string
  name: string
  authMethod: 'oauth' | 'api_key' | 'external'
  configured: boolean
  modelCount: number
  availableModelCount: number
  enabled: boolean
}

export interface PromptImage { type: 'image'; mimeType: string; data: string }

export interface QueuedPrompt { id: string; text: string; intent: 'queue' | 'steer'; timestamp?: number; images?: PromptImage[]; editorContext?: string }

export interface RuntimeCommand { name: string; description?: string; source: 'extension' | 'prompt' | 'skill' }

export interface EditorFileContext {
  name: string
  path: string
  dirty: boolean
  selection: { startLine: number; endLine: number; count: number } | null
}

export interface HostState {
  status: 'starting' | 'ready' | 'exited'
  error?: string
  cwd?: string
  sessionName?: string
  isStreaming: boolean
  model?: string
  thinkingLevel: ThinkingLevel
  thinkingLevels: ThinkingLevel[]
  models: ModelDescriptor[]
  providers: ProviderDescriptor[]
  commands: RuntimeCommand[]
  queued: QueuedPrompt[]
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null }
  sessionUsage?: { cost: number | null; tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } }
  messageEnterAction: 'queue' | 'steer'
}

/**
 * Transcript operations, replayed in order by the webview. Raw pi events go through
 * pi-desktop's reducer; the apex_* ops cover what the reducer leaves to the app.
 */
export type TranscriptOp =
  | { kind: 'saved'; message: TranscriptMessage }
  | { kind: 'event'; event: Record<string, unknown> }
  | { kind: 'user'; id: string; text: string; images?: PromptImage[]; timestamp: number; startAssistant: boolean }
  | { kind: 'notice'; id: string; text: string; timestamp: number }

export interface SessionSummary { path: string; id: string; title: string; preview: string; updatedAt: string; messageCount: number }

export type HostMessage =
  | { type: 'editorContext'; file: EditorFileContext | null }
  | { type: 'sessions:list'; requestId: number; sessions: SessionSummary[]; currentPath: string | null; error?: string }
  | { type: 'sessions:switch'; requestId: number; error?: string }
  | { type: 'sessions:current'; path: string | null }
  | { type: 'resizeScreenshot'; requestId: number; dataUrl: string; width: number; height: number; quality: number }
  | { type: 'browserState'; state: AgentBrowserState; status: AgentBrowserExtensionStatus }
  | { type: 'browserResponse'; requestId: number; result?: unknown; error?: string }
  | { type: 'reset'; ops: TranscriptOp[] }
  | { type: 'ops'; ops: TranscriptOp[] }
  | { type: 'state'; state: HostState }
  | { type: 'extensionUi'; request: Record<string, unknown> | null }
  | { type: 'files'; requestId: number; entries: Array<{ path: string; type: 'file' | 'directory' }> }

export type WebviewMessage =
  | { type: 'sessions:list'; requestId: number }
  | { type: 'sessions:switch'; requestId: number; path: string }
  | { type: 'screenshotResized'; requestId: number; data?: string }
  | { type: 'browserRequest'; requestId: number; method: BrowserMethod; tabId?: string; paused?: boolean }
  | { type: 'ready' }
  | { type: 'send'; text: string; images: PromptImage[]; intent: 'queue' | 'steer' }
  | { type: 'stop' }
  | { type: 'removeQueued'; id: string }
  | { type: 'sendQueued'; id: string }
  | { type: 'setModel'; key: string }
  | { type: 'setThinking'; level: ThinkingLevel }
  | { type: 'extensionUiResponse'; id: string; response: Record<string, unknown> }
  | { type: 'command'; action: { type: string; [key: string]: unknown } }
  | { type: 'listFiles'; requestId: number }
  | { type: 'openExternal'; url: string }
