/** Unit 2 exported UI families. Helpers are intentionally not counted as renderers.
 * References are checked against concrete CSF exports, not invented coverage labels.
 * A family entry means rendered coverage, not exhaustive visual validation.
 */
import * as composer from './Composer.stories'
import * as browser from './BrowserAttachments.stories'
import * as transcript from './Transcript.stories'
import * as agents from './AgentsAndQuestions.stories'
import * as rich from './RichContent.stories'
import * as task from './TaskWorkflow.stories'

type ChatSources = {
  'apps/desktop/src/components/Composer.tsx': typeof import('../../apps/desktop/src/components/Composer')
  'apps/desktop/src/components/ComposerBusyIndicator.tsx': typeof import('../../apps/desktop/src/components/ComposerBusyIndicator')
  'apps/desktop/src/components/ComposerQueue.tsx': typeof import('../../apps/desktop/src/components/ComposerQueue')
  'apps/desktop/src/components/ModelPicker.tsx': typeof import('../../apps/desktop/src/components/ModelPicker')
  'apps/desktop/src/components/CheckoutPicker.tsx': typeof import('../../apps/desktop/src/components/CheckoutPicker')
  'apps/desktop/src/components/PiModeControl.tsx': typeof import('../../apps/desktop/src/components/PiModeControl')
  'apps/desktop/src/components/ContextUsageRing.tsx': typeof import('../../apps/desktop/src/components/ContextUsageRing')
  'apps/desktop/src/components/ExecutingModelChip.tsx': typeof import('../../apps/desktop/src/components/ExecutingModelChip')
  'apps/desktop/src/components/BrowserSelectionTray.tsx': typeof import('../../apps/desktop/src/components/BrowserSelectionTray')
  'apps/desktop/src/components/ExtensionTabControls.tsx': typeof import('../../apps/desktop/src/components/ExtensionTabControls')
  'apps/desktop/src/components/Transcript.tsx': typeof import('../../apps/desktop/src/components/Transcript')
  'apps/desktop/src/components/transcript/messages.tsx': typeof import('../../apps/desktop/src/components/transcript/messages')
  'apps/desktop/src/components/transcript/timeline.tsx': typeof import('../../apps/desktop/src/components/transcript/timeline')
  'apps/desktop/src/components/transcript/work-group.tsx': typeof import('../../apps/desktop/src/components/transcript/work-group')
  'apps/desktop/src/components/transcript/subagent-lane.tsx': typeof import('../../apps/desktop/src/components/transcript/subagent-lane')
  'apps/desktop/src/components/transcript/ask-user-card.tsx': typeof import('../../apps/desktop/src/components/transcript/ask-user-card')
  'apps/desktop/src/components/transcript/edit-diff.tsx': typeof import('../../apps/desktop/src/components/transcript/edit-diff')
  'apps/desktop/src/components/transcript/syntax.tsx': typeof import('../../apps/desktop/src/components/transcript/syntax')
  'apps/desktop/src/components/transcript/TimelinePage.tsx': typeof import('../../apps/desktop/src/components/transcript/TimelinePage')
  'apps/desktop/src/components/transcript/turn-navigator.tsx': typeof import('../../apps/desktop/src/components/transcript/turn-navigator')
  'apps/desktop/src/components/transcript/turn-receipt.tsx': typeof import('../../apps/desktop/src/components/transcript/turn-receipt')
  'apps/desktop/src/components/transcript/BrowserReferenceCards.tsx': typeof import('../../apps/desktop/src/components/transcript/BrowserReferenceCards')
  'apps/desktop/src/components/transcript/TranscriptImage.tsx': typeof import('../../apps/desktop/src/components/transcript/TranscriptImage')
  'apps/desktop/src/components/MarkdownText.tsx': typeof import('../../apps/desktop/src/components/MarkdownText')
  'apps/desktop/src/components/WorkspaceImage.tsx': typeof import('../../apps/desktop/src/components/WorkspaceImage')
  'apps/desktop/src/components/HtmlFence.tsx': typeof import('../../apps/desktop/src/components/HtmlFence')
  'apps/desktop/src/components/ProjectPreview.tsx': typeof import('../../apps/desktop/src/components/ProjectPreview')
  'apps/desktop/src/components/InteractiveChatContext.tsx': typeof import('../../apps/desktop/src/components/InteractiveChatContext')
  'apps/desktop/src/components/ContextExcerpt.tsx': typeof import('../../apps/desktop/src/components/ContextExcerpt')
  'apps/desktop/src/lib/task-context.tsx': typeof import('../../apps/desktop/src/lib/task-context')
  'apps/desktop/src/components/TaskWorkflowChrome.tsx': typeof import('../../apps/desktop/src/components/TaskWorkflowChrome')
  'apps/desktop/src/components/TaskWorkflowDialogs.tsx': typeof import('../../apps/desktop/src/components/TaskWorkflowDialogs')
  'apps/desktop/src/components/ChangedFiles.tsx': typeof import('../../apps/desktop/src/components/ChangedFiles')
  'apps/desktop/src/components/ChangesCard.tsx': typeof import('../../apps/desktop/src/components/ChangesCard')
}

function story<Exports extends { default: { title: string } }>(source: keyof ChatSources, exports: Exports, name: Exclude<keyof Exports, 'default'>) {
  return { source, title: exports.default.title, export: name }
}
export const chatCoverage = {
  Composer: story('apps/desktop/src/components/Composer.tsx', composer, 'Empty'),
  ComposerBusyIndicator: story('apps/desktop/src/components/ComposerBusyIndicator.tsx', composer, 'UsageAndExecution'),
  ComposerQueue: story('apps/desktop/src/components/ComposerQueue.tsx', composer, 'QueueInteractions'),
  ModelPicker: story('apps/desktop/src/components/ModelPicker.tsx', composer, 'ModelAndCheckoutPickers'),
  CheckoutPicker: story('apps/desktop/src/components/CheckoutPicker.tsx', composer, 'ModelAndCheckoutPickers'),
  CheckoutPickerFields: story('apps/desktop/src/components/CheckoutPicker.tsx', composer, 'ModelAndCheckoutPickers'),
  PiModeControl: story('apps/desktop/src/components/PiModeControl.tsx', composer, 'ModeSettings'),
  ChatSettings: story('apps/desktop/src/components/PiModeControl.tsx', composer, 'ModelAndCheckoutPickers'),
  ChatSettingsSection: story('apps/desktop/src/components/PiModeControl.tsx', composer, 'ModelAndCheckoutPickers'),
  ChatSettingsField: story('apps/desktop/src/components/PiModeControl.tsx', composer, 'ModelAndCheckoutPickers'),
  PiModeStatus: story('apps/desktop/src/components/PiModeControl.tsx', composer, 'ModeSettings'),
  PiModeFields: story('apps/desktop/src/components/PiModeControl.tsx', composer, 'ModeSettings'),
  ContextUsageRing: story('apps/desktop/src/components/ContextUsageRing.tsx', composer, 'UsageAndExecution'),
  ExecutingModelChip: story('apps/desktop/src/components/ExecutingModelChip.tsx', composer, 'UsageAndExecution'),
  BrowserSelectionTray: story('apps/desktop/src/components/BrowserSelectionTray.tsx', browser, 'Connected'),
  ExtensionStatusIndicator: story('apps/desktop/src/components/ExtensionTabControls.tsx', browser, 'Offline'),
  ExtensionTabCard: story('apps/desktop/src/components/ExtensionTabControls.tsx', browser, 'Connected'),
  ExtensionTabPill: story('apps/desktop/src/components/ExtensionTabControls.tsx', browser, 'Paused'),
  Transcript: story('apps/desktop/src/components/Transcript.tsx', transcript, 'Settled'),
  AssistantMessage: story('apps/desktop/src/components/transcript/messages.tsx', transcript, 'MessageKinds'),
  UserMessage: story('apps/desktop/src/components/transcript/messages.tsx', transcript, 'MessageKinds'),
  SteerReadMarker: story('apps/desktop/src/components/transcript/messages.tsx', transcript, 'MessageKinds'),
  ActivityMessage: story('apps/desktop/src/components/transcript/messages.tsx', transcript, 'MessageKinds'),
  AgentMessage: story('apps/desktop/src/components/transcript/messages.tsx', transcript, 'MessageKinds'),
  GoalMessage: story('apps/desktop/src/components/transcript/messages.tsx', transcript, 'MessageKinds'),
  LiveElapsed: story('apps/desktop/src/components/transcript/timeline.tsx', transcript, 'TimelineStates'),
  WorkTimeline: story('apps/desktop/src/components/transcript/timeline.tsx', transcript, 'TimelineStates'),
  WorkDisclosure: story('apps/desktop/src/components/transcript/timeline.tsx', transcript, 'TimelineStates'),
  WorkGroup: story('apps/desktop/src/components/transcript/work-group.tsx', transcript, 'WorkGroups'),
  MorphInline: story('apps/desktop/src/components/transcript/subagent-lane.tsx', agents, 'TodoStates'),
  SubagentLane: story('apps/desktop/src/components/transcript/subagent-lane.tsx', agents, 'SpecialistStates'),
  TodoStep: story('apps/desktop/src/components/transcript/subagent-lane.tsx', agents, 'TodoStates'),
  SubagentContext: story('apps/desktop/src/components/transcript/subagent-lane.tsx', agents, 'SpecialistStates'),
  AskUserCard: story('apps/desktop/src/components/transcript/ask-user-card.tsx', agents, 'QuestionStates'),
  EditDiff: story('apps/desktop/src/components/transcript/edit-diff.tsx', transcript, 'DiffAndSyntax'),
  SyntaxText: story('apps/desktop/src/components/transcript/syntax.tsx', transcript, 'DiffAndSyntax'),
  InlineText: story('apps/desktop/src/components/transcript/syntax.tsx', transcript, 'DiffAndSyntax'),
  TimelinePage: story('apps/desktop/src/components/transcript/TimelinePage.tsx', transcript, 'DeferredHistory'),
  TurnNavigator: story('apps/desktop/src/components/transcript/turn-navigator.tsx', transcript, 'TurnNavigation'),
  TurnReceipt: story('apps/desktop/src/components/transcript/turn-receipt.tsx', transcript, 'Receipts'),
  BrowserReferenceCards: story('apps/desktop/src/components/transcript/BrowserReferenceCards.tsx', browser, 'Connected'),
  BrowserReferenceContext: story('apps/desktop/src/components/transcript/BrowserReferenceCards.tsx', browser, 'Connected'),
  TranscriptImage: story('apps/desktop/src/components/transcript/TranscriptImage.tsx', rich, 'ImageLoadedAndZoom'),
  ImageParts: story('apps/desktop/src/components/transcript/TranscriptImage.tsx', rich, 'ImageBrokenAndUnavailable'),
  MarkdownText: story('apps/desktop/src/components/MarkdownText.tsx', rich, 'MarkdownDocument'),
  MarkdownScopeContext: story('apps/desktop/src/components/MarkdownText.tsx', rich, 'MarkdownScopes'),
  WorkspaceImage: story('apps/desktop/src/components/WorkspaceImage.tsx', rich, 'WorkspaceImages'),
  WorkspaceImageContext: story('apps/desktop/src/components/WorkspaceImage.tsx', rich, 'WorkspaceImages'),
  HtmlFence: story('apps/desktop/src/components/HtmlFence.tsx', rich, 'HtmlPreviewAndSource'),
  ProjectPreview: story('apps/desktop/src/components/ProjectPreview.tsx', rich, 'ProjectStoppedChrome'),
  InteractiveChatProvider: story('apps/desktop/src/components/InteractiveChatContext.tsx', rich, 'HtmlFeedback'),
  ContextExcerpt: story('apps/desktop/src/components/ContextExcerpt.tsx', task, 'ExcerptSelection'),
  TaskWorkflowContext: story('apps/desktop/src/lib/task-context.tsx', task, 'SideConversation'),
  TaskWorkflowFinished: story('apps/desktop/src/components/TaskWorkflowChrome.tsx', task, 'Finished'),
  TaskWorkflowNotice: story('apps/desktop/src/components/TaskWorkflowChrome.tsx', task, 'ErrorNotice'),
  TaskWorkflowDialogs: story('apps/desktop/src/components/TaskWorkflowDialogs.tsx', task, 'History'),
  ChangedFilesList: story('apps/desktop/src/components/ChangedFiles.tsx', task, 'ChangedFilesAndCards'),
  ChangesCard: story('apps/desktop/src/components/ChangesCard.tsx', task, 'ChangedFilesAndCards'),
  WorkspaceChangesCard: story('apps/desktop/src/components/ChangesCard.tsx', task, 'ChangedFilesAndCards'),
}

export const residualCoverage = {
  htmlHostProtocol:
    'HtmlPreviewAndSource and HtmlFeedback render actual no-host srcDoc preview and manual feedback. Automatic iframe postMessage feedback requires native apex-preview://document/render?html= and is excluded, not emulated. No adapter is needed for manual feedback.',
  projectGuest: 'ProjectStoppedChrome uses about:blank, never a local server. Browser webview is inert. Native ready/failure events and execution are not covered.',
  interaction: 'Source switching, zoom, excerpt errors/attachment, history file loading, feedback send/failure/pending, and dismissal are reachable interactions, not browser-verified snapshots.',
}
