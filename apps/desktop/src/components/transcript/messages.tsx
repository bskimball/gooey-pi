import { Fragment, memo, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CaretRight, Check, Copy, Crosshair, X } from '../icons'
import type { GitStatus, HarnessId, MessagePart, TranscriptMessage } from '@/types/api'
import { splitAnnotationBlock } from '@/lib/browser-annotations'
import { splitCapabilityRouting } from '@/lib/capability-mentions'
import { routedSessionReferences, splitSessionRouting, type RoutedSessionReference } from '@/lib/session-mentions'
import { splitTerminalContextBlock } from '@/lib/terminal-context'
import { writeClipboardText } from '@/lib/clipboard'
import { boundText } from '@/lib/render-bounds'
import { HARNESS_SHORT_NAMES } from '@/lib/harness'
import { MarkdownText } from '../MarkdownText'
import { PiMark } from '../ui'
import { InlineText } from './syntax'
import { TranscriptImage } from './TranscriptImage'
import { formatWorkedDuration, LiveWorkVerb, ThinkingDots, WorkDisclosure, WorkTimeline } from './timeline'
import { TurnReceipt, workCounts } from './turn-receipt'

function imageSource(part: Extract<MessagePart, { type: 'image' }>): string | undefined {
  if (part.dataTruncated || !part.data || !part.mimeType || !/^image\/(png|jpeg|gif|webp)$/i.test(part.mimeType) || !/^[a-z\d+/=\s]+$/i.test(part.data)) return undefined
  return `data:${part.mimeType};base64,${part.data.replace(/\s/g, '')}`
}

function renderImage(part: Extract<MessagePart, { type: 'image' }>, key: string) {
  const source = imageSource(part)
  return source ? (
    <TranscriptImage key={key} source={source} alt="User attachment" />
  ) : (
    <div key={key} className="image-part image-part--unavailable">
      Image attachment unavailable
    </div>
  )
}

export function renderNarrative(parts: MessagePart[], keyPrefix: string, streaming = false) {
  return parts.map((part, index) => {
    if (part.type === 'text') return <MarkdownText key={`${keyPrefix}-${index}`} text={part.text} streaming={streaming} />
    if (part.type === 'image') return renderImage(part, `${keyPrefix}-${index}`)
    return null
  })
}

export function renderNarrativeWithActivity(parts: MessagePart[], keyPrefix: string, showReasoning: boolean, showTools: boolean, streaming = false) {
  const groups: Array<{ activity: boolean; parts: MessagePart[] }> = []
  for (const part of parts) {
    const activity = part.type !== 'text' && part.type !== 'image'
    const current = groups.at(-1)
    if (current?.activity === activity) current.parts.push(part)
    else groups.push({ activity, parts: [part] })
  }
  return groups.map((group, index) =>
    group.activity ? (
      <WorkTimeline key={`${keyPrefix}-activity-${index}`} parts={group.parts} showReasoning={showReasoning} showTools={showTools} streaming={streaming} />
    ) : (
      <div key={`${keyPrefix}-narrative-${index}`}>{renderNarrative(group.parts, `${keyPrefix}-${index}`, streaming)}</div>
    ),
  )
}

function isNarrative(part: MessagePart): part is Extract<MessagePart, { type: 'text' | 'image' }> {
  return part.type === 'text' || part.type === 'image'
}

/**
 * Completed turns can receive lightweight activity after their final answer.
 * When no narrative follows the last activity, anchor the visible tail at the
 * most substantial narrative run, preferring the later run on ties, so the
 * answer is not lost behind trailing reasoning or tool calls.
 */
function primaryNarrativeStart(parts: MessagePart[], start: number): number {
  let bestStart = -1
  let bestScore = 0
  for (let index = start; index < parts.length;) {
    if (!isNarrative(parts[index])) {
      index += 1
      continue
    }
    const runStart = index
    let score = 0
    while (index < parts.length && isNarrative(parts[index])) {
      const part = parts[index]
      score += part.type === 'text' ? part.text.trim().length : 1
      index += 1
    }
    if (score > 0 && score >= bestScore) {
      bestStart = runStart
      bestScore = score
    }
  }
  return bestStart
}

const isActivity = (part: MessagePart) => part.type === 'thinking' || part.type === 'toolCall' || part.type === 'toolResult' || part.type === 'agentMessage' || part.type === 'compaction'

/**
 * Splits a turn into opening narrative, the work behind the disclosure, and the answer tail.
 * Live and settled turns share it so a finishing turn collapses its work in place.
 */
export function splitAssistantTurn(parts: MessagePart[]): { before: MessagePart[]; work: MessagePart[]; after: MessagePart[] } {
  const firstActivity = parts.findIndex(isActivity)
  if (firstActivity < 0) return { before: parts, work: [], after: [] }
  let lastActivity = -1
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (isActivity(parts[index])) {
      lastActivity = index
      break
    }
  }
  // Narrative after the last activity is the turn's outcome, however short; an earlier, longer run stays in the work log.
  const hasTrailingNarrative = parts.slice(lastActivity + 1).some((part) => part.type === 'image' || (part.type === 'text' && part.text.trim().length > 0))
  const finalNarrative = hasTrailingNarrative ? lastActivity + 1 : primaryNarrativeStart(parts, firstActivity + 1)
  const workEnd = finalNarrative >= 0 ? finalNarrative : lastActivity + 1
  return { before: parts.slice(0, firstActivity), work: parts.slice(firstActivity, workEnd), after: parts.slice(workEnd) }
}

function messageText(message: TranscriptMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

function MessageActions({ message, text: suppliedText }: { message: TranscriptMessage; text?: string }) {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<number | null>(null)
  const text = suppliedText ?? messageText(message)
  const role = message.role === 'assistant' ? 'assistant' : message.role === 'agent' ? 'agent' : 'user'

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
    },
    [],
  )

  if (!text) return null

  const copyMessage = async () => {
    try {
      await writeClipboardText(text)
      setCopied(true)
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="message-actions">
      <button type="button" disabled={!text} aria-label={`${copied ? 'Copied' : 'Copy'} ${role} message`} onClick={() => void copyMessage()}>
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

const HARNESS_MARKS = { pi: PiMark } satisfies Record<HarnessId, unknown>

function AssistantHarnessMark({ harness, size = 24 }: { harness: HarnessId; size?: number }) {
  const Mark = HARNESS_MARKS[harness]
  return <Mark size={size} />
}

function workedDuration(message: TranscriptMessage): string {
  const startedAt = timestampValue(message.startedAt ?? message.timestamp) ?? 0
  const completedAt = timestampValue(message.completedAt) ?? startedAt
  return formatWorkedDuration(Math.max(0, completedAt - startedAt))
}

function timestampValue(value?: string | number): number | undefined {
  if (value === undefined) return undefined
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const AssistantMessage = memo(
  function AssistantMessage({ message, harness = 'pi', showReasoning, showTools, git }: { message: TranscriptMessage; harness?: HarnessId; showReasoning: boolean; showTools: boolean; git?: GitStatus }) {
    const [logOpen, setLogOpen] = useState(false)
    const logId = useId()
    const { before, work, after } = splitAssistantTurn(message.parts)
    const counts = workCounts(message.parts)
    const showReceipt = !message.streaming && (counts.agents + counts.tools > 0 || Boolean(git?.files.length))
    const hasVisibleActivity = work.some(
      (part) => part.type === 'agentMessage' || part.type === 'compaction' || (part.type === 'thinking' && showReasoning) || ((part.type === 'toolCall' || part.type === 'toolResult') && showTools),
    )
    const hiddenMiddleNarrative = !hasVisibleActivity ? work.filter((part) => part.type === 'text' || part.type === 'image') : []
    const copyableNarrative = hasVisibleActivity ? [...before, ...after] : [...before, ...hiddenMiddleNarrative, ...after]
    const copyableText = copyableNarrative.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
    return (
      <article className="message message--assistant">
        <div className="assistant-mark">
          <AssistantHarnessMark harness={harness} />
        </div>
        <div className="message__content">
          {message.errorMessage ? <div className="activity-line activity-line--result is-error" role="alert">{message.errorMessage}</div> : null}
          {renderNarrative(before, 'before', message.streaming)}
          {hasVisibleActivity ? (
            <WorkDisclosure message={message} parts={work} showReasoning={showReasoning} showTools={showTools} open={logOpen} onOpenChange={setLogOpen} logId={logId} />
          ) : (
            renderNarrative(hiddenMiddleNarrative, 'middle', message.streaming)
          )}
          {renderNarrativeWithActivity(after, 'after', showReasoning, showTools, message.streaming)}
          {message.streaming && !hasVisibleActivity ? (
            <div className="streaming-state" aria-live="polite">
              <ThinkingDots /> <LiveWorkVerb mode="streaming" prefix={`${HARNESS_SHORT_NAMES[harness]} is `} />
            </div>
          ) : null}
          {showReceipt ? <TurnReceipt duration={workedDuration(message)} failed={Boolean(message.errorMessage)} agents={counts.agents} tools={counts.tools} git={git} logOpen={logOpen} logId={logId} onToggleLog={hasVisibleActivity ? () => setLogOpen((open) => !open) : undefined} /> : null}
          {!message.streaming ? <MessageActions message={message} text={copyableText} /> : null}
        </div>
      </article>
    )
  },
  (previous, next) => previous.message === next.message && previous.harness === next.harness && previous.showReasoning === next.showReasoning && previous.showTools === next.showTools && previous.git === next.git,
)

function SessionReferenceText({ text, references, onOpen }: { text: string; references: RoutedSessionReference[]; onOpen?(sessionId: string, harness: HarnessId): void }) {
  if (!references.length) return <InlineText text={text} />
  const ordered = [...references].sort((left, right) => right.label.length - left.label.length)
  const lines = text.split('\n')
  return <>{lines.map((line, lineIndex) => {
    const parts: ReactNode[] = []
    let cursor = 0
    while (cursor < line.length) {
      let foundIndex = -1
      let found: RoutedSessionReference | undefined
      for (let index = cursor; index < line.length; index += 1) {
        const before = line[index - 1]
        found = ordered.find((reference) => {
          const after = line[index + reference.label.length]
          return (before === undefined || /[\s([{"'`]/.test(before))
            && line.startsWith(reference.label, index)
            && (after === undefined || /[\s.,!?;:()[\]{}"'`]/.test(after))
        })
        if (found) { foundIndex = index; break }
      }
      if (!found || foundIndex < 0) { parts.push(line.slice(cursor)); break }
      if (foundIndex > cursor) parts.push(line.slice(cursor, foundIndex))
      const reference = found
      parts.push(<button
        type="button"
        key={`${reference.harness}:${reference.sessionId}:${foundIndex}`}
        className="session-reference"
        aria-label={`Open session ${reference.label.slice(1)}`}
        onClick={() => onOpen?.(reference.sessionId, reference.harness)}
      >{reference.label}</button>)
      cursor = foundIndex + reference.label.length
    }
    return <Fragment key={`${lineIndex}-${line.slice(0, 12)}`}>{parts}{lineIndex < lines.length - 1 ? <br /> : null}</Fragment>
  })}</>
}

function visibleUserText(text: string): string {
  const terminal = splitTerminalContextBlock(text)
  const annotations = splitAnnotationBlock(terminal.text)
  const capability = splitCapabilityRouting(annotations.text)
  return splitSessionRouting(capability.text).text
}

function UserText({ text, onOpenSessionReference }: { text: string; onOpenSessionReference?(sessionId: string, harness: HarnessId): void }) {
  // Sent prompts can carry verbose model-facing context blocks. Keep both
  // attachments collapsed and capability routing hidden while preserving the
  // user's own message.
  const terminal = splitTerminalContextBlock(text)
  const annotations = splitAnnotationBlock(terminal.text)
  const capability = splitCapabilityRouting(annotations.text)
  const sessions = splitSessionRouting(capability.text)
  const references = routedSessionReferences(sessions.block)
  if (!sessions.block && !capability.block && !annotations.block && !terminal.block) return <InlineText text={text} />
  return (
    <>
      {sessions.text && sessions.text !== '[Page annotations]' && sessions.text !== '[Terminal selection]' ? <SessionReferenceText text={sessions.text} references={references} onOpen={onOpenSessionReference} /> : null}
      {annotations.block ? (
        <details className="user-annotations">
          <summary>{annotations.count > 0 ? `${annotations.count} page annotation${annotations.count === 1 ? '' : 's'}` : 'Page annotations'}</summary>
          <pre>{annotations.block}</pre>
        </details>
      ) : null}
      {terminal.selection ? (
        <details className="user-annotations user-terminal-context">
          <summary>{`Selected text from ${terminal.label ?? 'terminal'}`}</summary>
          <pre>{terminal.selection}</pre>
        </details>
      ) : null}
    </>
  )
}

export const UserMessage = memo(function UserMessage({ message, turnLabel, turnRunning = false, turnFailed = false, onOpenSessionReference }: { message: TranscriptMessage; turnLabel?: string; turnRunning?: boolean; turnFailed?: boolean; onOpenSessionReference?(sessionId: string, harness: HarnessId): void }) {
  const copyableText = message.parts.filter((part) => part.type === 'text').map((part) => visibleUserText(part.text)).filter(Boolean).join('\n')
  const turnState = turnRunning ? 'running' : turnFailed ? 'failed' : turnLabel ? 'done' : undefined
  return (
    <article className="message message--user">
      <div className="user-bubble">
        {message.parts.map((part, index) => (part.type === 'text' ? <UserText key={index} text={part.text} onOpenSessionReference={onOpenSessionReference} /> : part.type === 'image' ? renderImage(part, `user-${index}`) : null))}
      </div>
      {turnState ? (
        <span className={`message__turn-status is-${turnState}`}>
          <span aria-hidden="true">{turnState === 'running' ? <><span className="message__turn-dot" /> running</> : turnState === 'failed' ? <><X size={11} /> failed</> : <><Check size={11} /> {turnLabel}</>}</span>
          <span className="sr-only">{turnState === 'running' ? 'Turn running' : turnState === 'failed' ? 'Turn failed' : `Turn took ${turnLabel}`}</span>
        </span>
      ) : null}
      {message.steerState ? <div className={`message__steer-state is-${message.steerState}`} role="status">{message.steerState === 'accepted' ? 'Accepted — waiting for the next safe steering point' : 'Read by agent'}</div> : null}
      <MessageActions message={message} text={copyableText} />
    </article>
  )
})

export const SteerReadMarker = memo(function SteerReadMarker({ message }: { message: TranscriptMessage }) {
  return <div className="message message--steer-read" role="status"><span>{messageText(message)}</span></div>
})

export const ActivityMessage = memo(function ActivityMessage({ message, harness = 'pi' }: { message: TranscriptMessage; harness?: HarnessId }) {
  const activityLabel = `${HARNESS_SHORT_NAMES[harness]} message`
  const sourceParts: MessagePart[] =
    message.role === 'system' && !message.parts.some((part) => part.type === 'compaction')
      ? [
          { type: 'toolCall', id: message.id, name: activityLabel },
          { type: 'toolResult', name: activityLabel, text: messageText(message), isError: true },
        ]
      : message.parts
  const parts = sourceParts.flatMap((part, index) =>
    part.type === 'toolResult' && sourceParts[index - 1]?.type !== 'toolCall' ? [{ type: 'toolCall' as const, id: `${message.id}-${index}`, name: part.name ?? 'Tool' }, part] : [part],
  )
  return (
    <article className="message message--activity">
      <WorkTimeline parts={parts} showReasoning showTools />
    </article>
  )
})

export const AgentMessage = memo(function AgentMessage({ message }: { message: TranscriptMessage }) {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const text = messageText(message)
  const label = message.agentName ? `Message from agent: ${message.agentName}` : 'Message from agent'
  return (
    <article className={`message message--agent ${open ? 'is-open' : ''}`}>
      <button type="button" className="agent-message__summary" aria-expanded={open} aria-controls={contentId} aria-label={label} onClick={() => setOpen((value) => !value)}>
        <PiMark size={18} />
        <span className="agent-message__label">Message from agent</span>
        {message.agentName ? <span className="agent-message__name">{message.agentName}</span> : null}
        <CaretRight className="agent-message__chevron disclosure-caret" size={13} />
      </button>
      {open ? (
        <div className="agent-message__content" id={contentId}>
          <MarkdownText text={boundText(text, 40_000, '\n… [Agent message truncated in the desktop view.]')} />
          <MessageActions message={message} />
        </div>
      ) : null}
    </article>
  )
})

export const GoalMessage = memo(function GoalMessage({ message }: { message: TranscriptMessage }) {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const text = messageText(message)
  return (
    <article className={`message message--goal ${open ? 'is-open' : ''}`}>
      <button type="button" className="goal-message__summary" aria-expanded={open} aria-controls={contentId} aria-label="Goal summary" onClick={() => setOpen((value) => !value)}>
        <span className="goal-message__icon">
          <Crosshair size={15} />
        </span>
        <span className="goal-message__label">Goal summary</span>
        <CaretRight className="goal-message__chevron disclosure-caret" size={13} />
      </button>
      {open ? (
        <div className="goal-message__content" id={contentId}>
          <MarkdownText text={boundText(text, 40_000, '\n… [Goal summary truncated in the desktop view.]')} />
        </div>
      ) : null}
    </article>
  )
})
