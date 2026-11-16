import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex';
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { styles as workbenchStyles } from 'apex-ui/styles/workbench.stylex'
import { styles as activityStyles } from 'apex-ui/styles/activity.stylex'
import { styles as overlaysStyles } from 'apex-ui/styles/overlays.stylex'
import { useMemo, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { CircleNotch } from './icons'
import type { GitStatus, HarnessId, TranscriptMessage } from '@/types/api'
import { ChangesCard } from './ChangesCard'
import { ErrorBoundary } from './ErrorBoundary'
import { HARNESS_SHORT_NAMES } from '@/lib/harness'
import { PiWelcomeMark } from './ui'
import { ActivityMessage, AgentMessage, AssistantMessage, GoalMessage, SteerReadMarker, UserMessage, renderNarrative, renderNarrativeWithActivity } from './transcript/messages'
import { useTranscriptScroll } from './transcript/scroll'
import { createAssistantTurnCoalescer } from './transcript/grouping'
import { createSessionSummarySelector } from './inspector/session-summary'
import { SubagentContext } from './transcript/subagent-lane'
import { TurnNavigator } from './transcript/turn-navigator'
import { formatWorkedDuration, LiveElapsed, LiveWorkVerb, ThinkingDots, WorkDisclosure } from './transcript/timeline'
import { WorkspaceImageContext } from './WorkspaceImage'
import { BrowserReferenceContext } from './transcript/BrowserReferenceCards'
import type { BrowserReference } from '@/lib/browser-annotations'

const styles = stylex.create({
  header: {
    position: 'relative', zIndex: 20, width: '100%', maxWidth: 'var(--transcript-measure)', marginInline: 'auto',
    backgroundColor: 'var(--canvas)', boxShadow: '0 6px 16px -8px rgb(0 0 0 / 0.45)',
    borderBottomLeftRadius: 'var(--radius-lg)', borderBottomRightRadius: 'var(--radius-lg)',
    display: 'flex', alignItems: 'center', gap: 12, paddingInline: { default: 24, '@media (max-width: 720px)': 18 }, paddingBlock: 4, minHeight: 36, flexShrink: 0,
  },
  currentTurn: { flex: '1 1 auto', minWidth: 0 },
  hidden: { display: 'none' },
})

export { classifyTool, formatWorkedDuration } from './transcript/timeline'
export { tokenizeSyntax } from './transcript/syntax'

export { coalesceAssistantTurns } from './transcript/grouping'

function timestampValue(value?: string | number): number | undefined {
  if (value === undefined) return undefined
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

interface TranscriptProps {
  messages: TranscriptMessage[]
  git: GitStatus
  /** Active workspace root for resolving assistant Markdown local images. */
  cwd?: string
  onRevealBrowserReference?(reference: BrowserReference): void
  /** Active harness; brands the assistant marks and working copy. */
  harness?: HarnessId
  loading?: boolean
  hidden?: boolean
  active?: boolean
  showReasoning?: boolean
  showTools?: boolean
  onOpenChanges(): void
  onSuggestion(prompt: string): void
  suggestionsDisabled?: boolean
  /** Render the pinned changes card here; the app docks it beside the composer when false. */
  showPinnedChanges?: boolean
  /** Reserve room for bottom-docked changes and queued-message affordances. */
  bottomDockHasChanges?: boolean
  queuedMessageCount?: number
  sessionActions?: ReactNode
  onOpenSessionReference?(sessionId: string, harness: HarnessId): void
  onOpenSpecialist?(id: string): void
  /** `chat` renders a conversation (prompts right, replies left) instead of a working thread. */
  variant?: 'thread' | 'chat'
  /** Name in live working labels; defaults to the harness name. */
  shortName?: string
}


function ActiveAssistantMessage({ message, shortName, showReasoning, showTools }: { message: TranscriptMessage; shortName: string; showReasoning: boolean; showTools: boolean }) {
  const visibleActivity = message.parts.some((part) => part.type === 'thinking' && showReasoning || (part.type === 'toolCall' || part.type === 'toolResult') && showTools || part.type === 'agentMessage' || part.type === 'compaction')
  // The live turn streams in the same chronological order the settled turn keeps, so finishing only adds a Thought header to reasoning.
  return (
    <article className={`message message--assistant message--streaming ${stylex.props(transcriptStyles.message, transcriptStyles.messageAssistant).className ?? ""}`}>
      <div className={`message__content ${stylex.props(transcriptStyles.messageContent).className ?? ""}`}>
        {visibleActivity
          ? <WorkDisclosure message={message} showReasoning={showReasoning} showTools={showTools}>{renderNarrativeWithActivity(message.parts, 'turn', showReasoning, showTools, true, true, `Assistant response ${message.id}`)}</WorkDisclosure>
          : <>
            {renderNarrative(message.parts, 'live', true, `Assistant response ${message.id}`)}
            <div className={`streaming-state ${stylex.props(transcriptStyles.streamingState).className ?? ""}`} aria-live="polite"><ThinkingDots /> <LiveWorkVerb mode="streaming" prefix={`${shortName} is `} /> <LiveElapsed since={message.startedAt ?? message.timestamp} /></div>
          </>}
      </div>
    </article>
  )
}



export function Transcript({ messages, git, cwd, onRevealBrowserReference, harness = 'pi', loading, hidden = false, active = false, showReasoning = true, showTools = true, onOpenChanges, onSuggestion, suggestionsDisabled, showPinnedChanges = true, bottomDockHasChanges = false, queuedMessageCount = 0, sessionActions, onOpenSessionReference, onOpenSpecialist, variant = 'thread', shortName }: TranscriptProps) {
  const workingName = shortName ?? HARNESS_SHORT_NAMES[harness]
  const [selectSummary] = useState(createSessionSummarySelector)
  const { specialists } = selectSummary(messages)
  const subagentContext = useMemo(() => ({ specialists, onOpen: onOpenSpecialist }), [specialists, onOpenSpecialist])
  const [coalesce] = useState(createAssistantTurnCoalescer)
  const groupedMessages = useMemo(() => coalesce(messages), [coalesce, messages])
  const { announcement, hiddenCount, scrollRef, showEarlier, updatePinnedState, visibleMessages } = useTranscriptScroll(groupedMessages, active)
  const activeAssistantId = useMemo(() => active && groupedMessages.at(-1)?.role === 'assistant' ? groupedMessages.at(-1)?.id : undefined, [active, groupedMessages])
  // Workspace changes belong to the newest settled turn; older turns cannot claim the current working tree.
  const latestSettledAssistantId = useMemo(() => {
    for (let index = groupedMessages.length - 1; index >= 0; index -= 1) {
      const message = groupedMessages[index]
      if (message.role === 'assistant' && !message.streaming && message.id !== activeAssistantId) return message.id
    }
    return undefined
  }, [activeAssistantId, groupedMessages])
  let lastUserMessageIndex = -1
  for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
    const candidate = visibleMessages[index]
    if (candidate.role === 'user' && candidate.kind !== 'steer-read-marker') {
      lastUserMessageIndex = index
      break
    }
  }
  const transcriptClasses = [
    'transcript',
    'scroll-area',
    variant === 'chat' ? 'transcript--chat' : '',
    showPinnedChanges && git.files.length ? 'has-pinned-changes' : '',
    bottomDockHasChanges ? 'has-docked-changes' : '',
    queuedMessageCount > 0 ? 'has-queued-messages' : '',
  ].filter(Boolean).join(' ')

  return <BrowserReferenceContext.Provider value={onRevealBrowserReference}><WorkspaceImageContext.Provider value={cwd}><SubagentContext.Provider value={subagentContext}>
    {sessionActions ? <div {...stylex.props(styles.header, hidden && styles.hidden)}>
      <div {...stylex.props(styles.currentTurn)}>{!loading ? <TurnNavigator scrollRef={scrollRef} active={active} inline /> : null}</div>
      {sessionActions}
    </div> : null}
    <div ref={scrollRef} className={[[`${transcriptClasses} `].filter(Boolean).join(' '), stylex.props(baseStyles.scrollArea, transcriptStyles.transcript, queuedMessageCount > 0 && transcriptStyles.transcriptHasQueuedMessages, showPinnedChanges && git.files.length > 0 && transcriptStyles.transcriptHasPinnedChanges, hidden && styles.hidden, [responsiveStyles.transcript, responsiveLayoutStyles.transcript]).className].filter(Boolean).join(" ")} aria-busy={loading} onScroll={updatePinnedState}>
      <div className={`sr-only ${stylex.props(baseStyles.srOnly).className ?? ""}`} role="status" aria-live="polite">{announcement}</div>
      <div className={`transcript__inner ${stylex.props(workbenchStyles.transcriptInner, transcriptStyles.transcriptInner, responsiveStyles.transcriptInner).className ?? ""}`}>
        {loading ? <div className={`transcript-loading ${stylex.props(transcriptStyles.transcriptLoading).className ?? ""}`}><CircleNotch className={`spin ${stylex.props(activityStyles.spin, overlaysStyles.spin).className ?? ""}`} size={16} /> Loading session…</div> : null}
        {!loading && messages.length === 0 ? <div className={`session-welcome ${stylex.props(transcriptStyles.sessionWelcome).className ?? ""}`}>
          <PiWelcomeMark size={112} />
          <h1>What should we work on?</h1>
          <p>{HARNESS_SHORT_NAMES[harness]} can inspect this project, edit files, run tools, and keep working across sessions.</p>
          <div className={`prompt-suggestions ${stylex.props(transcriptStyles.promptSuggestions).className ?? ""}`}>
            <button type="button" disabled={suggestionsDisabled} onClick={() => onSuggestion('Summarize this project')}>Summarize this project</button>
            <button type="button" disabled={suggestionsDisabled} onClick={() => onSuggestion('Find a useful next task')}>Find a useful next task</button>
            <button type="button" disabled={suggestionsDisabled} onClick={() => onSuggestion('Run the test suite')}>Run the test suite</button>
          </div>
        </div> : null}
        {hiddenCount > 0 ? <button type="button" className={`transcript__show-earlier ${stylex.props(transcriptStyles.transcriptShowEarlier).className ?? ""}`} onClick={showEarlier}>Show {Math.min(250, hiddenCount)} earlier messages</button> : null}
        {visibleMessages.map((message, messageIndex) => {
          // The prompt line carries its turn's outcome, borrowed from every assistant segment
          // before the following prompt: steering and compaction can split one turn into several.
          let turnLabel: string | undefined
          let turnSince: string | number | undefined
          let turnRunning = false
          let turnFailed = false
          if (message.role === 'user') {
            const segments: TranscriptMessage[] = []
            for (let index = messageIndex + 1; index < visibleMessages.length; index += 1) {
              const candidate = visibleMessages[index]
              if (candidate.role === 'user' && candidate.kind !== 'steer-read-marker') break
              if (candidate.role === 'assistant') segments.push(candidate)
            }
            const isLastPrompt = messageIndex === lastUserMessageIndex
            // An active session's last turn is still running even between segments (e.g. mid-compaction).
            turnRunning = segments.some((segment) => segment.streaming || segment.id === activeAssistantId) || (active && isLastPrompt)
            turnFailed = !turnRunning && segments.some((segment) => Boolean(segment.errorMessage))
            turnSince = segments[0]?.startedAt ?? segments[0]?.timestamp ?? message.timestamp
            if (segments.length > 0 && !turnRunning) {
              const startedAt = timestampValue(segments[0].startedAt ?? segments[0].timestamp)
              const completedAt = timestampValue(segments.at(-1)?.completedAt)
              if (startedAt !== undefined && completedAt !== undefined && completedAt >= startedAt) turnLabel = formatWorkedDuration(completedAt - startedAt)
            }
          }
          return <ErrorBoundary key={message.id} fallback={<div className={`message message--render-failure ${stylex.props(transcriptStyles.message).className ?? ""}`} role="note">This message could not be displayed.</div>}>
          {message.kind === 'steer-read-marker' ? <SteerReadMarker message={message} />
            : message.role === 'user' ? <UserMessage message={message} turnLabel={turnLabel} turnSince={turnSince} turnRunning={turnRunning} turnFailed={turnFailed} onOpenSessionReference={onOpenSessionReference} />
            : message.role === 'assistant' ? message.streaming || message.id === activeAssistantId
              ? <ActiveAssistantMessage message={message} shortName={workingName} showReasoning={showReasoning} showTools={showTools} />
              : <AssistantMessage message={message} harness={harness} shortName={workingName} showReasoning={showReasoning} showTools={showTools} git={message.id === latestSettledAssistantId && git.files.length ? git : undefined} onOpenChanges={onOpenChanges} />
            : message.role === 'agent' ? <AgentMessage message={message} />
            : message.role === 'goal' ? <GoalMessage message={message} />
            : message.role === 'tool' || message.role === 'system' ? <ActivityMessage message={message} harness={harness} />
            : <div className={[`message message--${message.role}`, stylex.props(transcriptStyles.message, ((message.role === "user")) && transcriptStyles.messageUser, ((message.role === "steer-read")) && transcriptStyles.messageSteerRead, ((message.role === "assistant")) && transcriptStyles.messageAssistant, ((message.role === "activity")) && transcriptStyles.messageActivity, ((message.role === "agent")) && transcriptStyles.messageAgent, ((message.role === "goal")) && transcriptStyles.messageGoal, ((message.role === "user")) && [responsiveStyles.messageUser, responsiveLayoutStyles.messageUser]).className].filter(Boolean).join(' ')}>{message.parts.map((part, partIndex) => part.type === 'text' ? <span key={partIndex}>{part.text}</span> : null)}</div>}
          </ErrorBoundary>
        })}
        {active && !activeAssistantId ? <article className={`message message--assistant message--streaming transcript-active-placeholder ${stylex.props(transcriptStyles.message, transcriptStyles.messageAssistant, transcriptStyles.transcriptActivePlaceholder).className ?? ""}`} aria-live="polite">
          <div className={`streaming-state ${stylex.props(transcriptStyles.streamingState).className ?? ""}`}><ThinkingDots /> <LiveWorkVerb mode="streaming" prefix={`${workingName} is `} /></div>
        </article> : null}
        <div />
      </div>
    </div>
    {!hidden && !loading && !sessionActions ? <TurnNavigator scrollRef={scrollRef} active={active} /> : null}
    {!hidden && showPinnedChanges && git.files.length ? <div className={`transcript-changes-pin ${stylex.props(workbenchStyles.transcriptChangesPin, transcriptStyles.transcriptChangesPin).className ?? ""}`}><ChangesCard git={git} onOpenChanges={onOpenChanges} /></div> : null}
  </SubagentContext.Provider></WorkspaceImageContext.Provider></BrowserReferenceContext.Provider>
}
