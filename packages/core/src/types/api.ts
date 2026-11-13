import type { BrowserSourceHint, BrowserSourceResult } from '../browser/source'
export type { BrowserSourceHint, BrowserSourceResult } from '../browser/source'

/**
 * Session partition shared by the in-app browser webviews. The renderer's
 * webview attribute must match the main process's will-attach-webview gate
 * exactly, or webview attach is silently blocked.
 */
export const BROWSER_PARTITION = 'persist:apex-browser'

export interface ApexExtensionTool {
  name: string
  label: string
  description: string
  parameters: Record<string, unknown>
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; details?: unknown; isError?: boolean }>
}

export interface ApexExtensionApi {
  registerTool(tool: ApexExtensionTool): void
}

export type ThemeMode = 'system' | 'light' | 'dark'
export type WorkspaceView = 'session' | 'projects' | 'activity' | 'scheduled' | 'plugins' | 'settings'
export type InspectorTab = 'summary' | 'specialists' | 'changes' | 'browser' | 'files'
export type SessionStatus = 'idle' | 'running' | 'waiting' | 'complete' | 'failed' | 'unknown'

export const HARNESS_IDS = ['pi'] as const
export type RuntimeHarnessId = (typeof HARNESS_IDS)[number]
export type HarnessId = RuntimeHarnessId

export interface HarnessStatus {
  path: string | null
  version: string | null
  problem?: {
    path: string
    reason: string
  }
}

export interface AppMeta {
  version: string
  platform: NodeJS.Platform
  homeDir: string
  harnesses: Record<HarnessId, HarnessStatus>
}

export type ApplicationMenuName = 'file' | 'edit' | 'view' | 'window' | 'help'

export type AppUpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error' | 'unsupported'

export interface AppUpdateState {
  phase: AppUpdatePhase
  version?: string
  percent?: number
  message?: string
}

export interface ProjectScripts {
  setup: string
  run: string
  /** Exact setup command most recently started for this project. */
  setupLastRun?: string
  /** Missing while the latest setup command is running or was interrupted. */
  setupLastExitCode?: number
}

export interface ProjectRecord {
  id: string
  /** Agent harness this project grant belongs to; grants never cross harnesses. */
  harness: HarnessId
  name: string
  path: string
  folders: string[]
  primaryFolder: string
  pinned: boolean
  createdAt: string
  lastOpenedAt: string
  sessionCount: number
  gitBranch?: string
  inferred?: boolean
  readOnly?: boolean
  scripts?: ProjectScripts
}

export interface SessionRecord {
  id: string
  /** Agent harness that owns this session; populated by the owning session service. */
  harness: HarnessId
  filePath: string
  projectPath: string
  title: string
  createdAt: string
  updatedAt: string
  lastUserMessageAt?: string
  status: SessionStatus
  model?: string
  provider?: string
  thinkingLevel?: string
  behaviorMode?: string
  depth: number
  /** App-owned presentation role; it does not grant runtime capabilities. */
  role?: 'coordinator'
  pinned?: boolean
  unread?: boolean
  /** Monotonic renderer lifecycle revision used to distinguish attention events. */
  eventRevision?: number
  /** Lifecycle revision that authored the current status; absent when the catalog owns it. */
  statusEventRevision?: number
  preview?: string
  archived?: boolean
  syncRevision?: number
}

export interface PromptImage {
  type: 'image'
  mimeType: string
  data: string
}

export interface BrowserAnnotationRect {
  x: number
  y: number
  width: number
  height: number
}

/** Element info captured from the embedded browser page. Every field is untrusted page data: bounded on capture, rendered as plain text only. */
export interface BrowserAnnotationElement {
  /** Distinguishes repeated user captures of the same DOM element. */
  captureId?: string
  selector: string
  tagName: string
  id: string
  classes: string[]
  text: string
  href?: string
  src?: string
  component?: string
  sourceHint?: BrowserSourceHint
  rect: BrowserAnnotationRect
  preview?: PromptImage
}

export interface BrowserAnnotation {
  id: string
  tabId?: string
  comment: string
  element: BrowserAnnotationElement
  source?: BrowserSourceResult
  preview?: PromptImage
  pageUrl: string
  pageTitle: string
  /** True once the page navigated away after capture: the live marker is gone but the captured info remains valid. */
  stale: boolean
  createdAt: number
}

export type ApexCompactionReason = 'manual' | 'threshold' | 'overflow' | 'requested'
export type ApexCompactionStatus = 'running' | 'done' | 'failed' | 'cancelled'
export type ApexCompactionOutcome = 'failed' | 'cancelled' | 'skipped'

export type MessagePart =
  | { type: 'text'; partId?: string; text: string }
  | { type: 'thinking'; partId?: string; text: string }
  | { type: 'toolCall'; partId?: string; id?: string; name: string; args?: unknown }
  | {
      type: 'toolResult'
      partId?: string
      name?: string
      text: string
      images?: Array<{ type: 'image'; partId?: string; mimeType?: string; data?: string; dataTruncated?: boolean }>
      isError?: boolean
      streaming?: boolean
      details?: unknown
    }
  | { type: 'agentMessage'; partId?: string; text: string; agentName?: string }
  | { type: 'image'; partId?: string; mimeType?: string; data?: string; dataTruncated?: boolean }
  | {
      type: 'compaction'
      partId?: string
      status: ApexCompactionStatus
      reason?: ApexCompactionReason
      outcome?: ApexCompactionOutcome
      tokensBefore?: number
      firstKeptEntryId?: string
      summary?: string
      error?: string
      customInstructions?: string
      willRetry?: boolean
    }

export interface TranscriptMessage {
  id: string
  role: 'user' | 'assistant' | 'agent' | 'goal' | 'tool' | 'system'
  /** Renderer-local steering lifecycle. Persisted transcripts remain harness-owned. */
  steerState?: 'accepted' | 'read'
  /** Lightweight renderer-only boundary showing where an accepted steer was consumed. */
  kind?: 'steer-read-marker'
  timestamp?: string | number
  agentName?: string
  startedAt?: string | number
  completedAt?: string | number
  /** Latest assistant attempt failure, separate from response content. */
  errorMessage?: string
  parts: MessagePart[]
  streaming?: boolean
}

export interface ApexContextUsage {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

export interface SessionUsageTokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

/** Cumulative cost and token totals for the in-context session, as reported by get_session_stats. */
export interface SessionUsage {
  /** USD cost summed from catalog pricing; null when the harness reports none. */
  cost: number | null
  tokens?: SessionUsageTokens
}

export interface RuntimeInfo {
  runtimeId: string
  harness: HarnessId
  sessionId?: string
  sessionFile?: string
  cwd: string
  isStreaming: boolean
  sessionActions?: SessionActionSnapshot
  isCompacting?: boolean
  model?: { provider?: string; id?: string; name?: string } | null
  /** Renderer-local notice; never persisted or used to update the model picker. */
  executingModel?: { provider?: string; id: string; label: string; isFallback: true } | null
  thinkingLevel?: string
  availableThinkingLevels?: ApexThinkingLevel[]
  fastModeSupported?: boolean
  imageInputSupported?: boolean
  fastModeAvailable?: boolean
  serviceTier?: ApexServiceTier
  contextUsage?: ApexContextUsage
  sessionUsage?: SessionUsage
}

export const APEX_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ApexThinkingLevel = (typeof APEX_THINKING_LEVELS)[number]
export type ApexServiceTier = 'auto' | 'default' | 'flex' | 'scale' | 'priority' | null
export type ProviderAuthMethod = 'oauth' | 'api_key' | 'external'

export interface ApexModelDescriptor {
  key: string
  provider: string
  id: string
  name: string
  reasoning: boolean
  input: Array<'text' | 'image'>
  contextWindow: number
  maxTokens: number
  availableThinkingLevels: ApexThinkingLevel[]
  fastModeSupported: boolean
  available: boolean
  /** Apex visibility policy for this harness; absent catalogs predate per-model controls. */
  enabled?: boolean
}

export interface ApexProviderDescriptor {
  id: string
  name: string
  authMethod: ProviderAuthMethod
  configured: boolean
  modelCount: number
  availableModelCount: number
  enabled: boolean
}

export interface ApexModelCatalog {
  apexVersion: string
  refreshedAt: string
  models: ApexModelDescriptor[]
  providers: ApexProviderDescriptor[]
  warning?: string
}

export interface ApexEventEnvelope {
  runtimeId: string
  event: Record<string, unknown>
  sequence?: number
}

export interface SessionChangeEvent {
  filePath?: string
  /** Harness whose session catalog changed; absent events predate harness scoping. */
  harness?: HarnessId
}

export interface SkillRecord {
  id: string
  name: string
  description: string
  kind: 'skill' | 'extension' | 'prompt' | 'package' | 'mcp'
  location: 'bundled' | 'user' | 'project' | 'system'
  path?: string
  enabled: boolean
  icon?: string
  source?: string
  /** MCP server ids this package exists to bridge. Used to collapse duplicate capability rows. */
  associatedMcpServers?: string[]
  associatedPackageSource?: string
  /** Exact bounded map key used only for definition removal; never rendered as display copy. */
  definitionKey?: string
  /** False when an external definition key cannot be represented safely by the app removal API. */
  definitionRemovalAvailable?: boolean
  availability?: {
    available: boolean
    detail: string
    actionUrl?: string
  }
}

export interface PluginWarning {
  scope: 'user' | 'project'
  path: string
  message: string
}

export interface PluginCatalog {
  skills: SkillRecord[]
  warnings: PluginWarning[]
}

export type McpConnectionInput = {
  name: string
  scope: 'user' | 'project'
  projectPath?: string
} & (
  | { type: 'http'; url: string; auth?: 'none' | 'oauth' | 'bearer'; bearerTokenEnvVar?: string }
  | { type: 'stdio'; command: string; args?: string[] }
)

export interface McpStateInput {
  name: string
  scope: 'user' | 'project'
  projectPath?: string
  enabled: boolean
}

export interface CapabilityMutationInput {
  kind: 'package' | 'mcp'
  action: 'enable' | 'disable' | 'remove'
  name: string
  /** Exact bounded MCP map key for definition-only removal. */
  definitionKey?: string
  source?: string
  scope: 'user' | 'project'
  projectPath?: string
}

export interface ExtensionInstallInput {
  source: string
  scope: 'user' | 'project'
  projectPath?: string
}

export interface EffectiveCapability { capability: string; filename: string; present: boolean }
export interface EffectiveInstructionSource { scope: 'project' | 'parent' | 'user'; kind: 'AGENTS.override.md' | 'AGENTS.md' | 'AGENTS.MD' | 'CLAUDE.md' | 'CLAUDE.MD' | 'SYSTEM.md'; path: string; bytes: number }
export interface EffectiveSkillDir { path: string; count: number }
/** Metadata about what a run in a project will load; never file contents. */
export interface EffectiveRunConfig { injectedCapabilities: EffectiveCapability[]; instructionSources: EffectiveInstructionSource[]; skillDirs: EffectiveSkillDir[] }

export interface RuntimeOwnerView { app: 'desktop' | 'vscode'; label: string; sessions: string[] }

export interface ProjectFileEntry { path: string; type: 'file' | 'directory' }
export interface ProjectFileListing { entries: ProjectFileEntry[]; skipped: number }

export interface GitWorktree {
  path: string
  name: string
  branch?: string
  head: string
  current: boolean
  detached: boolean
}

export const CHECKOUT_STRATEGIES = ['worktree', 'branch'] as const
export type CheckoutStrategy = (typeof CHECKOUT_STRATEGIES)[number]

export interface LocalGitBranch {
  name: string
  current: boolean
}

export type CheckoutCatalog =
  | { strategy: 'worktree'; activePath: string; checkouts: GitWorktree[] }
  | { strategy: 'branch'; activeName: string; checkouts: LocalGitBranch[] }

export type CheckoutAction =
  | { strategy: 'worktree'; operation: 'open'; path: string }
  | { strategy: 'worktree'; operation: 'create'; branch: string }
  | { strategy: 'branch'; operation: 'switch'; branch: string }
  | { strategy: 'branch'; operation: 'create'; branch: string }

export type CheckoutSelection =
  | { strategy: 'worktree'; path: string }
  | { strategy: 'branch'; branch: string }

export type CheckoutRefusalCode =
  | 'strategy-changed'
  | 'active-work'
  | 'dirty-worktree'
  | 'checkout-not-found'
  | 'checkout-already-exists'

export type CheckoutChangeResult =
  | { kind: 'applied'; project: ProjectRecord; checkout: CheckoutSelection }
  | { kind: 'unchanged'; project: ProjectRecord; checkout: CheckoutSelection }
  | { kind: 'cancelled' }
  | { kind: 'refused'; code: CheckoutRefusalCode; message: string }

export interface GitFileChange {
  path: string
  status: string
  staged: boolean
  additions: number
  deletions: number
}
export interface GitStatus {
  isRepo: boolean
  branch?: string
  upstream?: string
  ahead?: number
  behind?: number
  files: GitFileChange[]
  truncated?: boolean
  /** False when the host cannot supply additions/deletions; omitted means the counts are real. */
  lineCounts?: boolean
  error?: string
}
export interface GitDiff { path?: string; staged: boolean; text: string; truncated: boolean; error?: string }

/** A fresh Git observation, not a cleanup authorization. */
export interface GitIntegrationReview {
  status: GitStatus
  integration:
    | { kind: 'integrated' | 'not-integrated'; target: string; evidence?: 'local-cached-remote-tracking-ref' }
    | { kind: 'unknown'; reason: string }
}

/**
 * The one result shape for subprocess-backed operations (git commit, package
 * install, MCP settings updates). `reason` classifies failures: the subprocess
 * timed out, exceeded its output limit, exited non-zero, or the operation was
 * blocked before or instead of running the subprocess.
 */
export type ProcessFailureReason = 'timeout' | 'overflow' | 'exit' | 'blocked'
export interface ProcessOutcome { ok: boolean; output: string; reason?: ProcessFailureReason }

export interface TerminalSpawnOptions { cwd: string; sessionPath?: string; shell?: string; command?: string; cols?: number; rows?: number }
export interface TerminalDataEvent { terminalId: string; data: string }
export interface TerminalExitEvent { terminalId: string; exitCode: number; signal?: number }
export interface TerminalSelectionContext { tabId: string; label: string; text: string; truncated: boolean }
export interface TerminalPromptContext extends TerminalSelectionContext { cwd?: string }
export interface TerminalActiveContext { label: string; content: string; truncated: boolean }

/** An agent background job (bg_start) mirrored read-only into the terminal drawer. */
export type BackgroundJobStatus = 'running' | 'completed' | 'failed' | 'killed'
export interface BackgroundJob {
  key: string
  id: string
  sessionFile: string
  title: string
  command: string
  cwd: string
  pid?: number
  persistent: boolean
  startedAt: number
  endedAt?: number
  status: BackgroundJobStatus
  exitCode: number | null
  signal: string | null
  stopping: boolean
  /** False while no agent runtime is attached to receive stop requests. */
  connected: boolean
}
export interface BackgroundJobSnapshot extends BackgroundJob { output: string }
export type BackgroundJobEvent =
  | { type: 'started'; job: BackgroundJob; output: string }
  | { type: 'updated'; job: BackgroundJob }
  | { type: 'output'; key: string; data: string }
  | { type: 'removed'; key: string }

export type MessageEnterAction = 'queue' | 'steer'
export type PromptDeliveryIntent = 'queue' | 'steer'

export interface PetDefinition {
  /** Stable settings key. Codex pets are namespaced as codex/<folder>. */
  id: string
  /** Package manifest id, used to deduplicate bundled and Codex copies. */
  petId: string
  displayName: string
  description: string
  source: 'built-in' | 'codex'
  kind: 'orb' | 'spritesheet'
}

export interface QueuedPrompt {
  id: string
  text: string
  intent: PromptDeliveryIntent
  /** Stable presentation data while a steer waits for the agent to pick it up. */
  timestamp?: number
  parts?: MessagePart[]
  /** The most recent automatic flush attempt failed admission. */
  flushAttemptFailed?: boolean
}

export interface SessionActionSnapshot {
  queuedCount: number
  steering: string[]
  followUps: string[]
  active?: {
    kind: 'turn' | 'session_command'
    phase: 'preparing' | 'committing' | 'running'
    label?: string
  }
}

export const INTERFACE_FONT_SCALES = [105, 110, 115] as const
export type InterfaceFontScale = typeof INTERFACE_FONT_SCALES[number]
export const LOCALE_PREFERENCES = ['system', 'en', 'zh-CN'] as const
export type LocalePreference = typeof LOCALE_PREFERENCES[number]
export const PROJECT_SORT_MODES = ['recent', 'alphabetical'] as const
export type ProjectSortMode = typeof PROJECT_SORT_MODES[number]

export interface AppSettings {
  theme: ThemeMode
  locale: LocalePreference
  /** Bounded interface text scale; 110 is the designed default. */
  interfaceFontScale: InterfaceFontScale
  /** Order the renderer derives for project lists; 'recent' keeps launch behaviour unchanged. */
  projectSortMode: ProjectSortMode
  sidebarOpen: boolean
  inspectorOpen: boolean
  showFileChangesPopup: boolean
  checkoutStrategy: CheckoutStrategy
  /** Keep the desktop process available for scheduled work after its window closes. */
  keepRunningInBackground: boolean
  /** Ask the operating system to launch Apex when the user signs in. */
  launchAtLogin: boolean
  terminalOpen: boolean
  defaultInspectorTab: InspectorTab
  browserHome: string
  browserAskForDownloads: boolean
  terminalShell: string
  reduceMotion: boolean
  showReasoningSummaries: boolean
  showToolCalls: boolean
  messageEnterAction: MessageEnterAction
  /** Optional absolute executable overrides; blank keeps automatic discovery. */
  runtimePaths: Record<HarnessId, string>
  /** Legacy visibility preference retained for state compatibility; executable detection is authoritative. */
  enabledHarnesses: HarnessId[]
  /**
   * Legacy diagnostics preference retained for persisted-state compatibility.
   * The Privacy UI deliberately ignores this field; any reporting use needs separate review.
   */
  telemetry: boolean
  /** Apex-managed ask_user tool, shared by every interactive harness. */
  askUserEnabled: boolean
  /** Expose Apex's thread-scoped in-app browser controls to new sessions. */
  browserEnabled: boolean
  /** Expose the separately installed TryCUA driver to new sessions through its official CLI. */
  computerUseEnabled: boolean
  /** Providers hidden from Apex's pi model picker; pi config is untouched. */
  piDisabledProviders: string[]
  /** Models hidden from Apex's pi model picker; pi config is untouched. */
  piDisabledModels: string[]
  /** Last usable model selected in each harness; blank falls back to the first usable catalog model. */
  lastSelectedModels: Record<HarnessId, string>
  /** The runtime used by the desktop workspace. */
  activeHarness: RuntimeHarnessId
  /** Desktop companion shown above the workspace. */
  petEnabled: boolean
  /** Built-in or discovered pet selection id. */
  petId: string
  /** Desktop companion size as a percentage of its native workspace size. */
  petSize: number
  /** Speech-to-text path used by the composer microphone. */
  voiceTranscriptionProvider: VoiceTranscriptionProvider
  /** Provider model IDs stay configurable without exposing provider credentials. */
  voiceOpenAiLiveTranscriptionModel: string
  voiceOpenAiTranscriptionModel: string
  voiceGroqTranscriptionModel: string
  voiceDeepgramTranscriptionModel: string
  /** User-managed OpenAI-compatible Parakeet or Whisper transcription server. */
  voiceSelfHostedUrl: string
  voiceSelfHostedModel: string
  /** User-managed whisper.cpp installation for offline transcription. */
  voiceLocalWhisperExecutable: string
  voiceLocalWhisperModel: string
  /** Realtime orb model and synthesized voice. */
  voiceRealtimeModel: string
  voiceRealtimeVoice: string
}

export const VOICE_TRANSCRIPTION_PROVIDERS = ['openai-live', 'openai', 'groq', 'deepgram', 'self-hosted', 'local-whisper'] as const
export type VoiceTranscriptionProvider = typeof VOICE_TRANSCRIPTION_PROVIDERS[number]
export const VOICE_CREDENTIAL_PROVIDERS = ['openai', 'groq', 'deepgram', 'self-hosted'] as const
export type VoiceCredentialProvider = typeof VOICE_CREDENTIAL_PROVIDERS[number]

export interface VoiceCredentialStorageStatus {
  available: boolean
  message?: string
}

export interface VoiceCredentialStatus {
  configured: Record<VoiceCredentialProvider, boolean>
  source: Partial<Record<VoiceCredentialProvider, 'saved' | 'environment' | 'session'>>
  storage: VoiceCredentialStorageStatus
}

export type VoiceRealtimeCallRequest =
  | { mode: 'conversation'; sdp: string; harness: HarnessId }
  | { mode: 'transcription'; sdp: string }

export interface VoiceTranscriptionRequest {
  provider: Exclude<VoiceTranscriptionProvider, 'openai-live'>
  audio: Uint8Array
}

export interface VoiceSelfHostedTestRequest {
  url: string
  model: string
}

export interface VoiceProjectSummary {
  id: string
  harness: HarnessId
  name: string
  lastOpenedAt: string
}

export interface VoiceTaskStarted {
  projectId: string
  projectName: string
  harness: HarnessId
  runtimeId: string
  sessionId?: string
  sessionFile: string
  model?: Pick<ApexModelDescriptor, 'key' | 'provider' | 'id' | 'name'>
  reasoning?: ApexThinkingLevel
}

export type VoiceToolRequest =
  | { name: 'list_projects'; arguments: { query?: string } }
  | { name: 'list_models'; arguments: { query?: string } }
  | { name: 'start_task'; arguments: { project_id: string; prompt: string; title?: string; model?: string; reasoning?: string } }
  | { name: 'get_local_context'; arguments: Record<string, never> }
  | { name: 'search_web'; arguments: { query: string } }

export interface VoiceToolResult {
  output: string
  task?: VoiceTaskStarted
}

export type ScheduleDefinitionStatus = 'active' | 'paused' | 'completed' | 'blocked'
export type ScheduleRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'interrupted' | 'cancelled'
export type ScheduleCreatedBy = 'user' | 'agent'

export type ScheduleTarget =
  | { kind: 'project'; projectId: string }
  | { kind: 'session'; projectId: string; sessionId: string }

export type ScheduleTiming =
  | { kind: 'once'; at: string }
  | { kind: 'rrule'; dtstartLocal: string; timeZone: string; rrule: string }

export interface ScheduleExecution {
  model: 'auto' | string
  thinking: 'auto' | ApexThinkingLevel
  speed: 'normal' | 'fast'
}

export interface ScheduleRunRecord {
  id: string
  taskId: string
  taskRevision: number
  trigger: 'scheduled' | 'manual'
  scheduledFor: string
  queuedAt: string
  startedAt?: string
  finishedAt?: string
  status: ScheduleRunStatus
  execution: ScheduleExecution
  sessionId?: string
  sessionFile?: string
  error?: string
  skippedCount?: number
}

export interface AutomationScheduleRecord {
  schemaVersion: 1
  id: string
  /** Harness that owns the target, model catalog, and runtime for every run. */
  harness: HarnessId
  revision: number
  title: string
  prompt: string
  target: ScheduleTarget
  timing: ScheduleTiming
  execution: ScheduleExecution
  status: ScheduleDefinitionStatus
  createdBy: ScheduleCreatedBy
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  blockedReason?: string
  runs: ScheduleRunRecord[]
}

export interface ScheduleInput {
  title?: string
  prompt: string
  target: ScheduleTarget
  timing: ScheduleTiming
  execution: ScheduleExecution
  createdBy?: ScheduleCreatedBy
}

export interface SchedulePatch {
  revision: number
  title?: string
  prompt?: string
  target?: ScheduleTarget
  timing?: ScheduleTiming
  execution?: ScheduleExecution
}

export interface SchedulePreview {
  timing: ScheduleTiming
  occurrences: string[]
}

export interface ScheduleChangeEvent {
  taskId?: string
  reason: 'created' | 'updated' | 'deleted' | 'run'
}

/** One agent-controlled browser tab. The registry lives in the main process; the renderer hosts the webview guests and mirrors this state. */
export interface AgentBrowserTabRecord {
  backend?: 'webview' | 'extension'
  pairedByUser?: boolean
  paused?: boolean
  chromeTabId?: number
  tabId: string
  /** Canonical session file path of the thread this tab belongs to. */
  sessionFile: string
  url: string
  title: string
  /** Whether a live webview guest is currently bound to this tab. */
  attached: boolean
  /** Whether this is the session's currently targeted tab. */
  active: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** True while the user is clicking an element in a shared Chrome tab. */
  picking?: boolean
  /** Last element the user selected in a shared Chrome tab. Untrusted page data. */
  selection?: BrowserAnnotationElement
}

export interface AgentBrowserExtensionStatus {
  connected: boolean
  extensionPath: string
  bridgePort: number | null
  activeSessionKey: string | null
  pairedTabCount: number
}

export interface AgentBrowserState {
  tabs: AgentBrowserTabRecord[]
}

/** Emitted for every agent browser action, so the UI can surface the Browser panel while the agent works. */
export interface AgentBrowserActivityEvent {
  sessionFile: string
  tabId: string
}

/** Emitted when the agent moves the pointer in a tab, so the UI can animate a synthetic cursor along the same path on the same clock. */
export interface AgentBrowserPointerEvent {
  tabId: string
  sessionFile: string
  /** Previous pointer position, or null when the cursor first appears in a tab. */
  from: { x: number; y: number } | null
  to: { x: number; y: number }
  action: 'move' | 'click' | 'scroll'
  /** How long the glide takes; 0 means the cursor appears in place. */
  durationMs: number
}

/** A run records observed checkout changes, not exclusively agent-authored edits. */
export interface RunReceipt {
  id: string
  sessionId: string
  sessionFile?: string
  startedAt: string
  finishedAt?: string
  state: 'open' | 'complete' | 'incomplete'
  error?: string
  anchorUserEntryId?: string
  memberUserEntryIds: string[]
  inputs: Array<{ kind: 'prompt' | 'steer' | 'follow_up'; disposition: 'pending' | 'started' | 'queued' | 'handled' | 'rejected' | 'uncertain' }>
  changes?: Array<{ path: string; kind: 'added' | 'deleted' | 'modified' }>
  attribution: 'observed-checkout'
}
export type RunHistoricalContent = { kind: 'file'; base64: string; binary: boolean; size: number } | { kind: 'symlink'; target: string } | null
export interface RunHistoricalFile { before: RunHistoricalContent; after: RunHistoricalContent }

/** A separate session with Pi read/search tools only; this is not an OS sandbox. */
export interface SideConversation {
  parentSession: string
  sessionFile: string
  cwd: string
  createdAt: string
  policy: 'read-only-tools'
  initialContext?: string
}
export interface SideReturnContext { sourceSession: string; text: string }

export type FinishLocalUse =
  | { kind: 'agent'; harness: HarnessId; runtimeId: string }
  | { kind: 'terminal'; terminalId: string }
  | { kind: 'external-session'; app: 'desktop' | 'vscode'; label: string; session: string; projectPath?: string }
export interface FinishObservation {
  sessionFile: string
  cwd: string
  git: GitIntegrationReview
  worktree: { root?: string; kind: 'primary' | 'linked' | 'unknown'; head?: string; ownership: 'apex-created' | 'unknown'; ownershipReason: string }
  conflicts: FinishLocalUse[]
  /** Candidate only: the idle task runtime is still attached and must be stopped before manual cleanup. */
  cleanup: { eligible: boolean; reasons: string[] }
  nextActions: string[]
}
export interface FinishReview extends FinishObservation { token: string; expiresAt: string }
export interface FinishedTask { status: 'finished'; sessionFile: string; finishedAt: string; review: FinishObservation }

export interface RewindPreview {
  token: string
  selectedUserEntryId: string
  anchorUserEntryId: string
  prompt: string
  rewindToRunStart: boolean
  receipt?: RunReceipt
  checkout: string
  worktree: { linked: boolean; primary: boolean }
  restore: { available: boolean; reason?: string; fingerprint?: string; changes: Array<{ path: string; kind: 'added' | 'deleted' | 'modified' }> }
  warning: string
}
export type RewindResult =
  | { kind: 'cancelled' }
  | { kind: 'rewound'; sessionFile: string; sessionId: string; prompt: string; files: 'kept' | 'restored' }
  | { kind: 'restore-failed'; sessionFile: string; sessionId: string; prompt: string; error: string; filesMayBePartial: boolean }

export interface CoordinatorAttachment {
  attachmentId: string
  eventSequence: number
  session: SessionRecord
  runtime: RuntimeInfo
  messages: TranscriptMessage[]
  pendingDialogs: Record<string, unknown>[]
}

export interface ApexApi {
  coordinator: {
    open(projectId: string): Promise<CoordinatorAttachment>
    close(attachmentId: string): Promise<boolean>
  }
  app: { getMeta(): Promise<AppMeta>; refreshHarnesses(): Promise<{ meta: AppMeta; settings: AppSettings }>; openExternal(url: string): Promise<boolean>; revealPath(path: string): Promise<boolean>; openInVsCode(path: string, line?: number): Promise<boolean>; resolveBrowserSource(cwd: string, hint: BrowserSourceHint): Promise<BrowserSourceResult>; readWorkspaceImage(cwd: string, path: string): Promise<PromptImage>; popupMenu(menu: ApplicationMenuName, x: number, y: number): Promise<boolean>; setTitleBarTheme(theme: Exclude<ThemeMode, 'system'>): Promise<boolean>; onOpenSettings(callback: () => void): () => void; /** Absolute path of a dropped or picked file; empty for clipboard data that never existed on disk. */ pathForFile(file: File): string }
  updates: {
    getState(): Promise<AppUpdateState>
    check(): Promise<AppUpdateState>
    downloadAndInstall(): Promise<boolean>
    onChanged(callback: (state: AppUpdateState) => void): () => void
  }
  projects: {
    list(harness?: HarnessId): Promise<ProjectRecord[]>
    listFiles(root: string, harness?: HarnessId): Promise<ProjectFileListing>
    readTextFile(root: string, path: string, harness?: HarnessId): Promise<{ path: string; text: string; truncated: boolean }>
    listCheckouts(projectId: string, harness?: HarnessId): Promise<CheckoutCatalog>
    executeCheckout(projectId: string, action: CheckoutAction, harness?: HarnessId): Promise<CheckoutChangeResult>
    add(harness?: HarnessId): Promise<ProjectRecord | null>
    grantInferred(path: string, harness?: HarnessId): Promise<ProjectRecord>
    remove(id: string, harness?: HarnessId): Promise<boolean>
    touch(id: string, harness?: HarnessId): Promise<boolean>
    setPinned(id: string, pinned: boolean, harness?: HarnessId): Promise<boolean>
    updateScripts(id: string, scripts: Pick<ProjectScripts, 'setup' | 'run'>, harness?: HarnessId): Promise<ProjectScripts>
    markSetupStarted(id: string, setup: string, harness?: HarnessId): Promise<ProjectScripts>
    finishSetup(id: string, setup: string, exitCode: number, harness?: HarnessId): Promise<ProjectScripts | undefined>
  }
  sessions: {
    create(projectPath: string, harness?: HarnessId): Promise<SessionRecord>
    list(projectPath?: string, includeArchived?: boolean, harness?: HarnessId, force?: boolean): Promise<SessionRecord[]>
    read(filePath: string): Promise<TranscriptMessage[]>
    reviewFinish(runtimeId: string, filePath: string): Promise<FinishReview>
    finishTask(runtimeId: string, filePath: string, token: string, confirmation: 'finish'): Promise<FinishedTask>
    getFinishedTask(filePath: string): Promise<FinishedTask | null>
    listFinishedTasks(): Promise<FinishedTask[]>
    createSideConversation(parentSession: string, options?: { excerpt?: string; harness?: HarnessId }): Promise<SideConversation>
    listSideConversations(parentSession: string): Promise<SideConversation[]>
    getSideConversation(sessionFile: string): Promise<SideConversation | null>
    prepareSideReturn(parentRuntimeId: string, sideSession: string, text: string): Promise<SideReturnContext>
    previewRewind(runtimeId: string, filePath: string, userEntryId: string): Promise<RewindPreview>
    rewind(runtimeId: string, filePath: string, token: string, options?: { restoreFiles: false } | { restoreFiles: true; confirmation: 'restore'; fingerprint: string }): Promise<RewindResult>
    listRunReceipts(filePath: string): Promise<RunReceipt[]>
    readRunFile(filePath: string, userEntryId: string, path: string): Promise<RunHistoricalFile>
    followUp(filePath: string, message: string, intent?: PromptDeliveryIntent): Promise<boolean>
    rename(filePath: string, title: string): Promise<boolean>
    archive(filePath: string, archived?: boolean): Promise<boolean>
    onChanged(callback: (event: SessionChangeEvent) => void): () => void
    /** Other live Apex apps (VS Code windows, other desktop instances) and the sessions their Pi runtimes hold. */
    runtimeOwners(): Promise<RuntimeOwnerView[]>
    /** Transfers an idle session to VS Code by default; attach keeps Desktop's runtime running. */
    continueInVsCode(filePath: string, mode?: 'transfer' | 'attach'): Promise<void>
  }
  runtime: {
    /** Instruction files, skill directories, and injected extensions a run in an authorized project path will pick up. */
    effectiveConfig(cwd: string): Promise<EffectiveRunConfig>
  }
  agent: {
    start(options: { cwd: string; sessionPath?: string; model?: string; thinking?: string; fast?: boolean; harness?: HarnessId }): Promise<RuntimeInfo>
    command(runtimeId: string, command: Record<string, unknown>): Promise<Record<string, unknown>>
    stop(runtimeId: string): Promise<boolean>
    list(): Promise<RuntimeInfo[]>
    onEvent(callback: (envelope: ApexEventEnvelope) => void): () => void
  }
  providers: {
    catalog(force?: boolean, harness?: HarnessId): Promise<ApexModelCatalog>
    setEnabled(providerId: string, enabled: boolean, harness?: HarnessId): Promise<ApexModelCatalog>
    setDisabled(providerIds: string[], harness?: HarnessId): Promise<ApexModelCatalog>
    setModelEnabled(modelKey: string, enabled: boolean, harness?: HarnessId): Promise<ApexModelCatalog>
  }
  voice: {
    credentialStatus(): Promise<VoiceCredentialStatus>
    saveApiKey(provider: VoiceCredentialProvider, apiKey: string): Promise<VoiceCredentialStatus>
    deleteApiKey(provider: VoiceCredentialProvider): Promise<VoiceCredentialStatus>
    createRealtimeCall(request: VoiceRealtimeCallRequest): Promise<string>
    transcribe(request: VoiceTranscriptionRequest): Promise<string>
    testSelfHosted(request: VoiceSelfHostedTestRequest): Promise<boolean>
    executeTool(request: VoiceToolRequest, harness: HarnessId): Promise<VoiceToolResult>
  }
  pets: {
    list(): Promise<PetDefinition[]>
    sprite(id: string): Promise<string | null>
  }
  terminal: {
    create(options: TerminalSpawnOptions): Promise<{ terminalId: string; shell: string }>
    bindSession(terminalId: string, sessionPath: string | null): Promise<boolean>
    input(terminalId: string, data: string): void
    resize(terminalId: string, cols: number, rows: number): void
    setActiveContext(terminalId: string, context: TerminalActiveContext): void
    clearActiveContext(terminalId: string): void
    kill(terminalId: string): Promise<boolean>
    onData(callback: (event: TerminalDataEvent) => void): () => void
    onExit(callback: (event: TerminalExitEvent) => void): () => void
  }
  backgroundJobs: {
    list(): Promise<BackgroundJobSnapshot[]>
    stop(key: string): Promise<boolean>
    dismiss(key: string): Promise<boolean>
    onEvent(callback: (event: BackgroundJobEvent) => void): () => void
  }
  git: { status(cwd: string): Promise<GitStatus>; reviewIntegration(cwd: string): Promise<GitIntegrationReview>; diff(cwd: string, path?: string, staged?: boolean): Promise<GitDiff>; stage(cwd: string, paths: string[]): Promise<boolean>; unstage(cwd: string, paths: string[]): Promise<boolean>; restore(cwd: string, paths: string[]): Promise<boolean>; commit(cwd: string, message: string): Promise<ProcessOutcome> }
  plugins: {
    list(projectPath?: string, harness?: HarnessId): Promise<PluginCatalog>
    install(source: string, harness?: HarnessId): Promise<ProcessOutcome>
    installExtension(input: ExtensionInstallInput, harness?: HarnessId): Promise<ProcessOutcome>
    setMcpSupport(enabled: boolean, harness?: HarnessId): Promise<ProcessOutcome>
    connectMcp(input: McpConnectionInput, harness?: HarnessId): Promise<ProcessOutcome>
    setMcpEnabled(input: McpStateInput, harness?: HarnessId): Promise<ProcessOutcome>
    mutateCapability(input: CapabilityMutationInput, harness?: HarnessId): Promise<ProcessOutcome>
    refresh(harness?: HarnessId): Promise<PluginCatalog>
  }
  settings: { get(): Promise<AppSettings>; update(patch: Partial<AppSettings>): Promise<AppSettings>; resetBrowserData(): Promise<boolean> }
  browser: {
    getExtensionStatus(): Promise<AgentBrowserExtensionStatus>
    onExtensionStatusChanged(callback: (status: AgentBrowserExtensionStatus) => void): () => void
    setActiveSession(sessionKey: string | null): Promise<void>
    setTabPaused(sessionKey: string, tabId: string, paused: boolean): Promise<AgentBrowserTabRecord | null>
    setTabPicking(sessionKey: string, tabId: string, picking: boolean): Promise<AgentBrowserTabRecord | null>
    popOutTab(sessionKey: string, tabId: string): Promise<AgentBrowserTabRecord | null>
    focusExtensionTab(sessionKey: string, tabId: string): Promise<boolean>
    captureSelection(sessionKey: string, tabId: string, pageUrl: string, selector: string): Promise<PromptImage>
    revealSelection(sessionKey: string, tabId: string, pageUrl: string, selector: string): Promise<boolean>
    clearSelection(sessionKey: string, tabId: string, captureId?: string): Promise<boolean>
    state(): Promise<AgentBrowserState>
    attachTab(tabId: string, webContentsId: number): Promise<boolean>
    selectTab(tabId: string): Promise<boolean>
    closeTab(tabId: string): Promise<boolean>
    setPreviewContext(webContentsId: number | null, sessionFile: string | null): Promise<boolean>
    navigateTab(tabId: string, action: 'back' | 'forward' | 'reload' | 'url', url?: string): Promise<boolean>
    onChanged(callback: (state: AgentBrowserState) => void): () => void
    onPointer(callback: (event: AgentBrowserPointerEvent) => void): () => void
    onActivity(callback: (event: AgentBrowserActivityEvent) => void): () => void
  }
  schedules: {
    list(harness?: HarnessId): Promise<AutomationScheduleRecord[]>
    get(id: string): Promise<AutomationScheduleRecord>
    preview(timing: ScheduleTiming, count?: number): Promise<SchedulePreview>
    create(input: ScheduleInput, harness?: HarnessId): Promise<AutomationScheduleRecord>
    update(id: string, patch: SchedulePatch): Promise<AutomationScheduleRecord>
    pause(id: string): Promise<AutomationScheduleRecord>
    resume(id: string): Promise<AutomationScheduleRecord>
    delete(id: string): Promise<boolean>
    runNow(id: string): Promise<ScheduleRunRecord>
    onChanged(callback: (event: ScheduleChangeEvent) => void): () => void
  }
}

declare global { interface Window { apex: ApexApi } }
