import { useMemo, useState } from 'react'
import { CircleNotch } from './icons'
import type { GitStatus, HarnessId, TranscriptMessage } from '@/types/api'
import { ChangesCard } from './ChangesCard'
import { ErrorBoundary } from './ErrorBoundary'
import { MarkdownText } from './MarkdownText'
import { HARNESS_SHORT_NAMES } from '@/lib/harness'
import { PiMark, PiWelcomeMark } from './ui'
import { ActivityMessage, AgentMessage, AssistantMessage, GoalMessage, SteerReadMarker, UserMessage, renderNarrative, renderNarrativeWithActivity, splitAssistantTurn } from './transcript/messages'
import { useTranscriptScroll } from './transcript/scroll'
import { createAssistantTurnCoalescer } from './transcript/grouping'
import { TurnNavigator } from './transcript/turn-navigator'
import { formatWorkedDuration, LiveElapsed, LiveWorkVerb, ThinkingDots, WorkDisclosure } from './transcript/timeline'

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
  /** Active harness; brands the assistant marks and working copy. */
  harness?: HarnessId
  loading?: boolean
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
  onOpenSessionReference?(sessionId: string, harness: HarnessId): void
}


const ASSISTANT_MARKS = { pi: PiMark } satisfies Record<HarnessId, unknown>
function AssistantMark({ harness, size = 24 }: { harness: HarnessId; size?: number }) {
  const Mark = ASSISTANT_MARKS[harness]
  return <Mark size={size} />
}

function ActiveAssistantMessage({ message, harness, showReasoning, showTools }: { message: TranscriptMessage; harness: HarnessId; showReasoning: boolean; showTools: boolean }) {
  const visibleActivity = message.parts.some((part) => part.type === 'thinking' && showReasoning || (part.type === 'toolCall' || part.type === 'toolResult') && showTools || part.type === 'agentMessage' || part.type === 'compaction')
  // The live turn uses the settled split, so finishing collapses the work instead of moving or restyling the answer.
  const { before, work, after } = splitAssistantTurn(message.parts)
  return (
    <article className="message message--assistant">
      <div className="assistant-mark"><AssistantMark harness={harness} /></div>
      <div className="message__content">
        {visibleActivity
          ? <>
            {renderNarrative(before, 'before')}
            <WorkDisclosure message={message} parts={work} showReasoning={showReasoning} showTools={showTools} running>{renderNarrativeWithActivity(after, 'after', showReasoning, showTools, true)}</WorkDisclosure>
          </>
          : <>
            {message.parts.map((part, index) => part.type === 'text' ? <MarkdownText key={index} text={part.text} streaming /> : null)}
            <div className="streaming-state" aria-live="polite"><ThinkingDots /> <LiveWorkVerb mode="streaming" prefix={`${HARNESS_SHORT_NAMES[harness]} is `} /> <LiveElapsed since={message.startedAt ?? message.timestamp} /></div>
          </>}
      </div>
    </article>
  )
}



export function Transcript({ messages, git, harness = 'pi', loading, active = false, showReasoning = true, showTools = true, onOpenChanges, onSuggestion, suggestionsDisabled, showPinnedChanges = true, bottomDockHasChanges = false, queuedMessageCount = 0, onOpenSessionReference }: TranscriptProps) {
  const [coalesce] = useState(createAssistantTurnCoalescer)
  const groupedMessages = useMemo(() => coalesce(messages), [coalesce, messages])
  const { announcement, hiddenCount, scrollRef, showEarlier, updatePinnedState, visibleMessages } = useTranscriptScroll(groupedMessages)
  const activeAssistantId = useMemo(() => active && groupedMessages.at(-1)?.role === 'assistant' ? groupedMessages.at(-1)?.id : undefined, [active, groupedMessages])
  // Workspace changes belong to the newest settled turn; older turns cannot claim the current working tree.
  const latestSettledAssistantId = useMemo(() => {
    for (let index = groupedMessages.length - 1; index >= 0; index -= 1) {
      const message = groupedMessages[index]
      if (message.role === 'assistant' && !message.streaming && message.id !== activeAssistantId) return message.id
    }
    return undefined
  }, [activeAssistantId, groupedMessages])
  const transcriptClasses = [
    'transcript',
    'scroll-area',
    showPinnedChanges && git.files.length ? 'has-pinned-changes' : '',
    bottomDockHasChanges ? 'has-docked-changes' : '',
    queuedMessageCount > 0 ? 'has-queued-messages' : '',
  ].filter(Boolean).join(' ')

  return <>
    <div ref={scrollRef} className={transcriptClasses} aria-busy={loading} onScroll={updatePinnedState}>
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
      <div className="transcript__inner">
        {loading ? <div className="transcript-loading"><CircleNotch className="spin" size={16} /> Loading session…</div> : null}
        {!loading && messages.length === 0 ? <div className="session-welcome">
          <PiWelcomeMark size={88} />
          <h1>What should we work on?</h1>
          <p>{HARNESS_SHORT_NAMES[harness]} can inspect this project, edit files, run tools, and keep working across sessions.</p>
          <div className="prompt-suggestions">
            <button type="button" disabled={suggestionsDisabled} onClick={() => onSuggestion('Summarize this project')}>Summarize this project</button>
            <button type="button" disabled={suggestionsDisabled} onClick={() => onSuggestion('Find a useful next task')}>Find a useful next task</button>
            <button type="button" disabled={suggestionsDisabled} onClick={() => onSuggestion('Run the test suite')}>Run the test suite</button>
          </div>
        </div> : null}
        {hiddenCount > 0 ? <button type="button" className="transcript__show-earlier" onClick={showEarlier}>Show {Math.min(250, hiddenCount)} earlier messages</button> : null}
        {visibleMessages.map((message, messageIndex) => {
          // The prompt line carries its turn's outcome, borrowed from every assistant segment
          // before the following prompt: steering and compaction can split one turn into several.
          let turnLabel: string | undefined
          let turnRunning = false
          let turnFailed = false
          if (message.role === 'user') {
            const segments: TranscriptMessage[] = []
            for (let index = messageIndex + 1; index < visibleMessages.length; index += 1) {
              const candidate = visibleMessages[index]
              if (candidate.role === 'user' && candidate.kind !== 'steer-read-marker') break
              if (candidate.role === 'assistant') segments.push(candidate)
            }
            const isLastPrompt = !visibleMessages.slice(messageIndex + 1).some((candidate) => candidate.role === 'user' && candidate.kind !== 'steer-read-marker')
            // An active session's last turn is still running even between segments (e.g. mid-compaction).
            turnRunning = segments.some((segment) => segment.streaming || segment.id === activeAssistantId) || (active && isLastPrompt)
            turnFailed = !turnRunning && segments.some((segment) => Boolean(segment.errorMessage))
            if (segments.length > 0 && !turnRunning) {
              const startedAt = timestampValue(segments[0].startedAt ?? segments[0].timestamp)
              const completedAt = timestampValue(segments.at(-1)?.completedAt)
              if (startedAt !== undefined && completedAt !== undefined && completedAt >= startedAt) turnLabel = formatWorkedDuration(completedAt - startedAt)
            }
          }
          return <ErrorBoundary key={message.id} fallback={<div className="message message--render-failure" role="note">This message could not be displayed.</div>}>
          {message.kind === 'steer-read-marker' ? <SteerReadMarker message={message} />
            : message.role === 'user' ? <UserMessage message={message} turnLabel={turnLabel} turnRunning={turnRunning} turnFailed={turnFailed} onOpenSessionReference={onOpenSessionReference} />
            : message.role === 'assistant' ? message.streaming || message.id === activeAssistantId
              ? <ActiveAssistantMessage message={message} harness={harness} showReasoning={showReasoning} showTools={showTools} />
              : <AssistantMessage message={message} harness={harness} showReasoning={showReasoning} showTools={showTools} git={message.id === latestSettledAssistantId && git.files.length ? git : undefined} />
            : message.role === 'agent' ? <AgentMessage message={message} />
            : message.role === 'goal' ? <GoalMessage message={message} />
            : message.role === 'tool' || message.role === 'system' ? <ActivityMessage message={message} harness={harness} />
            : <div className={`message message--${message.role}`}>{message.parts.map((part, partIndex) => part.type === 'text' ? <span key={partIndex}>{part.text}</span> : null)}</div>}
          </ErrorBoundary>
        })}
        {active && !activeAssistantId ? <article className="message message--assistant transcript-active-placeholder" aria-live="polite">
          <div className="assistant-mark"><AssistantMark harness={harness} /></div><div className="streaming-state"><ThinkingDots /> <LiveWorkVerb mode="streaming" prefix={`${HARNESS_SHORT_NAMES[harness]} is `} /></div>
        </article> : null}
        <div />
      </div>
    </div>
    {!loading ? <TurnNavigator scrollRef={scrollRef} active={active} /> : null}
    {showPinnedChanges && git.files.length ? <div className="transcript-changes-pin"><ChangesCard git={git} onOpenChanges={onOpenChanges} /></div> : null}
  </>
}
