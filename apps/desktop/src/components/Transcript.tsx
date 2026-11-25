import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex';
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { styles as workbenchStyles } from 'apex-ui/styles/workbench.stylex'
import { styles as activityStyles } from 'apex-ui/styles/activity.stylex'
import { styles as overlaysStyles } from 'apex-ui/styles/overlays.stylex'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useMemo, useState, type ReactNode, type RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { CaretDown, CircleNotch } from './icons'
import type { GitStatus, HarnessId, TranscriptMessage } from '@/types/api'
import { ChangesCard } from './ChangesCard'
import { ErrorBoundary } from './ErrorBoundary'
import { HARNESS_SHORT_NAMES } from '@/lib/harness'
import { PiWelcomeMark } from './ui'
import { ActivityMessage, AgentMessage, AssistantMessage, GoalMessage, SteerReadMarker, UserMessage } from './transcript/messages'
import { useTranscriptScroll } from './transcript/scroll'
import { createAssistantTurnCoalescer } from './transcript/grouping'
import { createSessionSummarySelector } from './inspector/session-summary'
import { SubagentContext } from './transcript/subagent-lane'
import { useInstantMotion } from './ContentMotion'
import { TranscriptHeader } from './TranscriptHeader'
import { TurnNavigator } from './transcript/turn-navigator'
import { formatWorkedDuration } from './transcript/timeline'
import { WorkspaceImageContext } from './WorkspaceImage'
import { BrowserReferenceContext } from './transcript/BrowserReferenceCards'
import type { BrowserReference } from '@/lib/browser-annotations'

const styles = stylex.create({
  hidden: { display: 'none' },
  jumpToBottomWrap: {
    position: 'sticky',
    bottom: 12,
    zIndex: 18,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
    marginTop: -36,
    height: 36,
  },
  jumpToBottomButton: {
    pointerEvents: 'auto',
    height: 30,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    paddingInline: 11,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border-strong)',
    borderRadius: 999,
    color: 'var(--text)',
    backgroundColor: 'color-mix(in srgb, var(--surface-raised) 92%, transparent)',
    backdropFilter: 'blur(8px)',
    boxShadow: 'var(--shadow-control)',
    fontSize: 'var(--fs-meta)',
    fontWeight: 550,
    cursor: 'pointer',
    transform: {
      default: null,
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':active': 'scale(0.96)',
      },
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    transition: {
      default: 'transform 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color var(--fast), border-color var(--fast)',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    '@media (hover: hover) and (pointer: fine)': {
      ':hover': {
        backgroundColor: 'var(--surface-hover)',
        borderColor: 'var(--border-apex)',
      },
    },
  },
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
  /** A persistent workspace header owns turn navigation for this scroller. */
  externalScrollRef?: RefObject<HTMLDivElement | null>
  sessionActions?: ReactNode
  onOpenSessionReference?(sessionId: string, harness: HarnessId): void
  onOpenSpecialist?(id: string): void
  /** `chat` renders a conversation (prompts right, replies left) instead of a working thread. */
  variant?: 'thread' | 'chat'
  /** Name in live working labels; defaults to the harness name. */
  shortName?: string
}


export const Transcript = memo(function Transcript({ messages, git, cwd, onRevealBrowserReference, harness = 'pi', loading, hidden = false, active = false, showReasoning = true, showTools = true, onOpenChanges, onSuggestion, suggestionsDisabled, showPinnedChanges = true, bottomDockHasChanges = false, queuedMessageCount = 0, externalScrollRef, sessionActions, onOpenSessionReference, onOpenSpecialist, variant = 'thread', shortName }: TranscriptProps) {
  const workingName = shortName ?? HARNESS_SHORT_NAMES[harness]
  const [selectSummary] = useState(createSessionSummarySelector)
  const { specialists } = selectSummary(messages)
  const subagentContext = useMemo(() => ({ specialists, onOpen: onOpenSpecialist }), [specialists, onOpenSpecialist])
  const [coalesce] = useState(createAssistantTurnCoalescer)
  const groupedMessages = useMemo(() => coalesce(messages), [coalesce, messages])
  const { announcement, hiddenCount, isPinned, scrollRef, scrollToBottom, showEarlier, updatePinnedState, visibleMessages } = useTranscriptScroll(groupedMessages, active, externalScrollRef)
  const instant = useInstantMotion()
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
    {sessionActions && !hidden ? <TranscriptHeader scrollRef={scrollRef} active={active} loading={loading}>{sessionActions}</TranscriptHeader> : null}
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
            : message.role === 'assistant' ? <AssistantMessage live={Boolean(message.streaming) || message.id === activeAssistantId} message={message} harness={harness} shortName={workingName} showReasoning={showReasoning} showTools={showTools} git={message.id === latestSettledAssistantId && git.files.length ? git : undefined} onOpenChanges={onOpenChanges} />
            : message.role === 'agent' ? <AgentMessage message={message} />
            : message.role === 'goal' ? <GoalMessage message={message} />
            : message.role === 'tool' || message.role === 'system' ? <ActivityMessage message={message} harness={harness} />
            : <div className={[`message message--${message.role}`, stylex.props(transcriptStyles.message, ((message.role === "user")) && transcriptStyles.messageUser, ((message.role === "steer-read")) && transcriptStyles.messageSteerRead, ((message.role === "assistant")) && transcriptStyles.messageAssistant, ((message.role === "activity")) && transcriptStyles.messageActivity, ((message.role === "agent")) && transcriptStyles.messageAgent, ((message.role === "goal")) && transcriptStyles.messageGoal, ((message.role === "user")) && [responsiveStyles.messageUser, responsiveLayoutStyles.messageUser]).className].filter(Boolean).join(' ')}>{message.parts.map((part, partIndex) => part.type === 'text' ? <span key={partIndex}>{part.text}</span> : null)}</div>}
          </ErrorBoundary>
        })}
        {active && !activeAssistantId ? <div className={`sr-only ${stylex.props(baseStyles.srOnly).className ?? ""}`} aria-live="polite">{workingName} is working</div> : null}
        <div />
      </div>
      <AnimatePresence initial={false}>
        {!hidden && !loading && !isPinned && visibleMessages.length > 0 ? (
          <motion.div
            key="jump-to-bottom"
            {...stylex.props(styles.jumpToBottomWrap)}
            initial={instant ? false : { opacity: 0, transform: 'translateY(8px) scale(0.95)' }}
            animate={{ opacity: 1, transform: 'translateY(0px) scale(1)', transition: instant ? { duration: 0 } : { duration: 0.15, ease: [0.23, 1, 0.32, 1] } }}
            exit={instant ? undefined : { opacity: 0, transform: 'translateY(6px) scale(0.96)', transition: { duration: 0.11, ease: [0.2, 0, 0, 1] } }}
          >
            <button
              type="button"
              {...stylex.props(styles.jumpToBottomButton)}
              aria-label="Scroll to bottom"
              onClick={() => scrollToBottom(instant ? 'auto' : 'smooth')}
            >
              <CaretDown size={12} aria-hidden="true" />
              <span>{active ? 'Latest output' : 'Bottom'}</span>
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
    {!hidden && !loading && !sessionActions && !externalScrollRef ? <TurnNavigator scrollRef={scrollRef} active={active} /> : null}
    {!hidden && showPinnedChanges && git.files.length ? <div className={`transcript-changes-pin ${stylex.props(workbenchStyles.transcriptChangesPin, transcriptStyles.transcriptChangesPin).className ?? ""}`}><ChangesCard git={git} onOpenChanges={onOpenChanges} /></div> : null}
  </SubagentContext.Provider></WorkspaceImageContext.Provider></BrowserReferenceContext.Provider>
})
