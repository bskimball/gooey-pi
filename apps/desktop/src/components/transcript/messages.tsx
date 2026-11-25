import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex';
import * as stylex from '@stylexjs/stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { AnimatePresence, motion } from 'motion/react'
import { Fragment, memo, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CaretRight, Check, Copy, Crosshair, PencilSimple, X } from '../icons'
import { collapseMotionProps, useInstantMotion } from '../ContentMotion'
import type { GitStatus, HarnessId, MessagePart, TranscriptMessage } from '@/types/api'
import { parseAnnotationReferences, splitAnnotationBlock } from '@/lib/browser-annotations'
import { BrowserReferenceCards } from './BrowserReferenceCards'
import { splitCapabilityRouting } from '@/lib/capability-mentions'
import { routedSessionReferences, splitSessionRouting, type RoutedSessionReference } from '@/lib/session-mentions'
import { splitTerminalContextBlock } from '@/lib/terminal-context'
import { writeClipboardText } from '@/lib/clipboard'
import { boundText } from '@/lib/render-bounds'
import { HARNESS_SHORT_NAMES } from '@/lib/harness'
import { MarkdownText } from '../MarkdownText'
import { PiMark } from '../ui'
import { InlineText } from './syntax'
import { ImageParts, imageRunAt } from './TranscriptImage'
import { isSubagentTool, pairSubagentCalls } from './subagent-lane'
import { WorkingDot } from '../SidebarAttention'
import { activeWorkLabel, classifyTool, formatWorkedDuration, liveWorkStatus, LiveElapsed, WorkTimeline } from './timeline'
import { TurnReceipt, workCounts } from './turn-receipt'
import { WorkGroup } from './work-group'
import { ContextExcerpt } from '../ContextExcerpt'
import { splitTaskContext, useTaskWorkflowContext } from '@/lib/task-context'

export function renderNarrative(parts: MessagePart[], keyPrefix: string, streaming = false, source = 'Assistant narrative') {
  return parts.map((part, index) => {
    if (part.type === 'text') {
      if (streaming && !part.text.trim()) return null
      return <ContextExcerpt key={`${keyPrefix}-${index}`} source={source} text={part.text}><MarkdownText text={part.text} streaming={streaming && index === parts.length - 1} /></ContextExcerpt>
    }
    if (part.type === 'image') return imageRunAt(parts, index, part.partId ?? `${keyPrefix}-${index}`)
    if (part.type === 'toolResult') return <ImageParts key={`${keyPrefix}-${index}`} images={part.images} />
    return null
  })
}

/** Plan updates and subagent lanes (a failed task_wait stays a plain tool row), with their results. */
function isPinnedPart(parts: MessagePart[], index: number): boolean {
  const callIndex = parts[index].type === 'toolResult' ? index - 1 : index
  const call = parts[callIndex]
  if (call?.type !== 'toolCall') return false
  if (call.name === 'todo_write' || classifyTool(call.name) === 'question') return true
  if (!isSubagentTool(call.name)) return false
  const result = parts[callIndex + 1]
  return !(call.name === 'task_wait' && result?.type === 'toolResult' && result.isError)
}

/**
 * The turn as it happened: narrative and work segments in order. Subagent follow-ups pair across the
 * whole turn; work stays live until the turn settles, and only the newest narrative streams.
 * `condensed` folds each work run into a WorkGroup summary so the chat reads as narrative; plan updates and
 * subagent lanes stay visible between them because they carry progress and the worker's status and report.
 */
export function renderNarrativeWithActivity(parts: MessagePart[], keyPrefix: string, showReasoning: boolean, showTools: boolean, streaming = false, condensed: boolean | 'current-step' = false, source = 'Assistant narrative') {
  const subagents = pairSubagentCalls(parts)
  const groups: Array<{ activity: boolean; pinned: boolean; parts: MessagePart[] }> = []
  parts.forEach((part, index) => {
    if (subagents.absorbed.has(part)) return
    const activity = part.type !== 'text' && part.type !== 'image'
    const pinned = condensed && isPinnedPart(parts, index)
    const current = groups.at(-1)
    if (current?.activity === activity && current.pinned === pinned) current.parts.push(part)
    else groups.push({ activity, pinned, parts: [part] })
  })
  return groups.map((group, index) => {
    if (group.activity && !group.pinned && condensed) {
      return <WorkGroup key={`${keyPrefix}-activity-${index}`} presentation={condensed === 'current-step' ? 'current-step' : 'summary'} parts={group.parts} showReasoning={showReasoning} showTools={showTools} streaming={streaming} live={streaming && index === groups.length - 1} subagents={subagents} />
    }
    // Models often emit bare newlines between tool calls; rendering them leaves an empty gap between work rows.
    if (!group.activity && group.parts.every((part) => part.type === 'text' && !part.text.trim())) return null
    return group.activity ? (
      <WorkTimeline key={`${keyPrefix}-activity-${index}`} parts={group.parts} showReasoning={showReasoning} showTools={showTools} streaming={streaming} subagents={subagents} />
    ) : (
      <div key={`${keyPrefix}-narrative-${index}`}>{renderNarrative(group.parts, `${keyPrefix}-${index}`, streaming && index === groups.length - 1, source)}</div>
    )
  })
}

function messageText(message: TranscriptMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

function CopyMessageButton({ message, text, className }: { message: TranscriptMessage; text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<number | null>(null)
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
    <button type="button" className={className} disabled={!text} aria-label={`${copied ? 'Copied' : 'Copy'} ${role} message`} onClick={() => void copyMessage()}>
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function MessageActions({ message, text = messageText(message), children }: { message: TranscriptMessage; text?: string; children?: ReactNode }) {
  return text || children ? <div className={`message-actions ${stylex.props(transcriptStyles.messageActions).className ?? ""}`}>{text ? <CopyMessageButton message={message} text={text} /> : null}{children}</div> : null
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

/** Settled frames stay in the tree as layout-neutral boxes so React keeps every descendant. */
function liveFrame(running: boolean, className: string): { className?: string; style?: CSSProperties } {
  return running ? { className } : { style: { display: 'contents' } }
}

function LiveWorkStatus({ parts, showReasoning, showTools }: { parts: MessagePart[]; showReasoning: boolean; showTools: boolean }) {
  const activity = showTools ? activeWorkLabel(parts) : undefined
  return <div className={`work-disclosure__status sr-only ${stylex.props(baseStyles.srOnly).className ?? ""}`} role="status">
    <span className={activity ? 'work-disclosure__activity' : 'work-disclosure__verb'} title={activity}>{activity ?? liveWorkStatus(parts, showReasoning, showTools)}</span>
  </div>
}

export const AssistantMessage = memo(
  function AssistantMessage({ message, live = Boolean(message.streaming), harness = 'pi', shortName = HARNESS_SHORT_NAMES[harness], showReasoning, showTools, git, onOpenChanges }: { message: TranscriptMessage; /** The session's running turn, even before `streaming` is set; the same article settles in place. */ live?: boolean; harness?: HarnessId; shortName?: string; showReasoning: boolean; showTools: boolean; git?: GitStatus; onOpenChanges?(): void }) {
    const counts = workCounts(message.parts)
    const hasVisibleActivity = message.parts.some(
      (part) => part.type === 'agentMessage' || part.type === 'compaction' || (part.type === 'thinking' && showReasoning) || ((part.type === 'toolCall' || part.type === 'toolResult') && showTools),
    )
    const showReceipt = !live && (counts.agents + counts.tools > 0 || hasVisibleActivity || Boolean(git?.files.length))
    const copyableText = messageText(message)
    const running = live && hasVisibleActivity
    return (
      <article className={`message message--assistant${live ? ' message--streaming' : ''} ${stylex.props(transcriptStyles.message, transcriptStyles.messageAssistant).className ?? ""}`}>
        <div className={`message__content ${stylex.props(transcriptStyles.messageContent).className ?? ""}`}>
          {message.errorMessage ? <div className={`activity-line activity-line--result is-error ${stylex.props(transcriptStyles.activityLine, transcriptStyles.activityLineResult, transcriptStyles.activityLineResultIsError).className ?? ""}`} role="alert">{message.errorMessage}</div> : null}
          <section {...liveFrame(running, `work-disclosure is-running ${stylex.props(transcriptStyles.workDisclosure, transcriptStyles.workDisclosureIsRunning).className ?? ""}`)} aria-label={running ? 'Agent work activity' : undefined}>
            <div {...liveFrame(running, `work-disclosure__live ${stylex.props(transcriptStyles.workDisclosureLive).className ?? ""}`)}>
              {renderNarrativeWithActivity(message.parts, 'turn', showReasoning, showTools, live, true, `Assistant response ${message.id}`)}
              {running ? <LiveWorkStatus parts={message.parts} showReasoning={showReasoning} showTools={showTools} /> : null}
            </div>
          </section>
          {live && !hasVisibleActivity ? (
            <div className={`sr-only ${stylex.props(baseStyles.srOnly).className ?? ""}`} aria-live="polite">{shortName} is working</div>
          ) : null}
          {/* Receipts already present on mount (loaded history) stay put; one inserted when a live turn settles grows in. */}
          <AnimatePresence mode="wait" initial={false}>
          {showReceipt ? (
            <TurnReceipt
              key="receipt"
              duration={workedDuration(message)}
              failed={Boolean(message.errorMessage)}
              agents={counts.agents}
              tools={counts.tools}
              git={git}
              onReviewChanges={onOpenChanges}
              copy={copyableText ? <CopyMessageButton className={`turn-receipt__action turn-receipt__copy ${stylex.props(transcriptStyles.turnReceiptAction, transcriptStyles.turnReceiptCopy).className ?? ""}`} message={message} text={copyableText} /> : undefined}
            />
          ) : !live ? <MessageActions key="actions" message={message} text={copyableText} /> : null}
          </AnimatePresence>
        </div>
      </article>
    )
  },
  (previous, next) => previous.message === next.message && previous.live === next.live && previous.harness === next.harness && previous.shortName === next.shortName && previous.showReasoning === next.showReasoning && previous.showTools === next.showTools && previous.git === next.git && previous.onOpenChanges === next.onOpenChanges,
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
        className={`session-reference ${stylex.props(transcriptStyles.sessionReference).className ?? ""}`}
        aria-label={`Open session ${reference.label.slice(1)}`}
        onClick={() => onOpen?.(reference.sessionId, reference.harness)}
      >{reference.label}</button>)
      cursor = foundIndex + reference.label.length
    }
    return <Fragment key={`${lineIndex}-${line.slice(0, 12)}`}>{parts}{lineIndex < lines.length - 1 ? <br /> : null}</Fragment>
  })}</>
}

function visibleUserText(text: string): string {
  const terminal = splitTerminalContextBlock(splitTaskContext(text).text)
  const annotations = splitAnnotationBlock(terminal.text)
  const capability = splitCapabilityRouting(annotations.text)
  return splitSessionRouting(capability.text).text
}

function UserText({ text, images, onOpenSessionReference }: { text: string; images: Extract<MessagePart, { type: 'image' }>[]; onOpenSessionReference?(sessionId: string, harness: HarnessId): void }) {
  // Sent prompts can carry verbose model-facing context blocks. Keep both
  // attachments collapsed and capability routing hidden while preserving the
  // user's own message.
  const task = splitTaskContext(text)
  const terminal = splitTerminalContextBlock(task.text)
  const annotations = splitAnnotationBlock(terminal.text)
  const capability = splitCapabilityRouting(annotations.text)
  const sessions = splitSessionRouting(capability.text)
  const references = routedSessionReferences(sessions.block)
  if (!task.block && !sessions.block && !capability.block && !annotations.block && !terminal.block) return <InlineText text={text} />
  return (
    <>
      {sessions.text && sessions.text !== '[Page annotations]' && sessions.text !== '[Terminal selection]' ? <SessionReferenceText text={sessions.text} references={references} onOpen={onOpenSessionReference} /> : null}
      {task.block ? <details className={`user-annotations ${stylex.props(transcriptStyles.userAnnotations).className ?? ""}`}><summary>Selected context</summary><pre>{task.block}</pre></details> : null}
      {annotations.block ? <BrowserReferenceCards references={parseAnnotationReferences(annotations.block)} images={images} /> : null}
      {annotations.block ? (
        <details className={`user-annotations ${stylex.props(transcriptStyles.userAnnotations).className ?? ""}`}>
          <summary>{annotations.count > 0 ? `${annotations.count} page annotation${annotations.count === 1 ? '' : 's'}` : 'Page annotations'}</summary>
          <pre>{annotations.block}</pre>
        </details>
      ) : null}
      {terminal.selection ? (
        <details className={`user-annotations user-terminal-context ${stylex.props(transcriptStyles.userAnnotations).className ?? ""}`}>
          <summary>{`Selected text from ${terminal.label ?? 'terminal'}`}</summary>
          <pre>{terminal.selection}</pre>
        </details>
      ) : null}
    </>
  )
}

function UserWorkflowActions({ messageId }: { messageId: string }) {
  const workflow = useTaskWorkflowContext()
  if (!workflow) return null
  const saved = workflow.persistedUserIds.has(messageId)
  const receipt = workflow.receipts.find((run) => run.anchorUserEntryId === messageId || run.memberUserEntryIds.includes(messageId))
  return (
    <>
      <button type="button" disabled={!workflow.idle || workflow.pending || !saved} title={!saved ? 'Waiting for the saved prompt entry' : !workflow.idle ? 'Available when this saved Pi session is idle' : undefined} onClick={() => workflow.edit(messageId)}><PencilSimple size={12} />Edit from here</button>
      {receipt && receipt.state !== 'open' ? <button type="button" onClick={() => workflow.review(receipt)}>Review run{receipt.state === 'incomplete' ? ' · incomplete' : ''}</button> : null}
    </>
  )
}

export const UserMessage = memo(function UserMessage({ message, turnLabel, turnSince, turnRunning = false, turnFailed = false, onOpenSessionReference }: { message: TranscriptMessage; turnLabel?: string; turnSince?: string | number; turnRunning?: boolean; turnFailed?: boolean; onOpenSessionReference?(sessionId: string, harness: HarnessId): void }) {
  const copyableText = message.parts.filter((part) => part.type === 'text').map((part) => visibleUserText(part.text)).filter(Boolean).join('\n')
  const turnState = turnRunning ? 'running' : turnFailed ? 'failed' : turnLabel ? 'done' : undefined
  const images = message.parts.filter((part): part is Extract<MessagePart, { type: 'image' }> => part.type === 'image')
  const referencedImages = new Set(message.parts.flatMap((part) => part.type === 'text' ? parseAnnotationReferences(splitAnnotationBlock(splitTerminalContextBlock(part.text).text).block ?? '').flatMap((reference) => reference.imageIndex === undefined ? [] : [reference.imageIndex]) : []))
  let imageIndex = 0
  const visibleParts = referencedImages.size
    ? message.parts.filter((part) => part.type !== 'image' || !referencedImages.has(imageIndex++))
    : message.parts
  return (
    <article className={`message message--user ${stylex.props(transcriptStyles.message, transcriptStyles.messageUser).className ?? ""}`}>
      <div className={`user-bubble ${stylex.props(transcriptStyles.userBubble).className ?? ""}`}>
        {visibleParts.map((part, index) => (part.type === 'text' ? <UserText key={index} text={part.text} images={images} onOpenSessionReference={onOpenSessionReference} /> : part.type === 'image' ? imageRunAt(visibleParts, index, part.partId ?? `user-${index}`) : null))}
      </div>
      {turnState ? (
        <span className={[`message__turn-status is-${turnState}`, stylex.props(transcriptStyles.messageTurnStatus, (turnState === 'done') && transcriptStyles.messageTurnStatusDone, (turnState === 'running') && transcriptStyles.messageTurnStatusRunning, (turnState === 'failed') && transcriptStyles.messageTurnStatusFailed).className].filter(Boolean).join(' ')}>
          <span aria-hidden="true">
            {turnState === 'running' ? (
              <><WorkingDot /> Running <LiveElapsed since={turnSince} /></>
            ) : turnState === 'failed' ? (
              <><X size={11} /> Turn failed</>
            ) : (
              <><Check size={11} /> {turnLabel}</>
            )}
          </span>
          <span className={`sr-only ${stylex.props(baseStyles.srOnly).className ?? ""}`}>{turnState === 'running' ? 'Turn running' : turnState === 'failed' ? 'Turn failed' : `Turn took ${turnLabel}`}</span>
        </span>
      ) : null}
      {message.steerState ? <div className={[`message__steer-state is-${message.steerState}`, stylex.props(transcriptStyles.messageSteerState, ((message.steerState === "read")) && transcriptStyles.messageSteerStateIsRead).className].filter(Boolean).join(' ')} role="status">{message.steerState === 'accepted' ? 'Accepted — waiting for the next safe steering point' : 'Read by agent'}</div> : null}
      {/* Workflow actions sit in the hover-revealed row beside Copy, styled like it. */}
      <MessageActions message={message} text={copyableText}>
        <UserWorkflowActions messageId={message.id} />
      </MessageActions>
    </article>
  )
})

export const SteerReadMarker = memo(function SteerReadMarker({ message }: { message: TranscriptMessage }) {
  return <div className={`message message--steer-read ${stylex.props(transcriptStyles.message, transcriptStyles.messageSteerRead).className ?? ""}`} role="status"><span>{messageText(message)}</span></div>
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
    <article className={`message message--activity ${stylex.props(transcriptStyles.message, transcriptStyles.messageActivity).className ?? ""}`}>
      <WorkTimeline parts={parts} showReasoning showTools />
    </article>
  )
})

export const AgentMessage = memo(function AgentMessage({ message }: { message: TranscriptMessage }) {
  const [open, setOpen] = useState(false)
  const [keyboardToggle, setKeyboardToggle] = useState(false)
  const instant = useInstantMotion() || keyboardToggle
  const contentId = useId()
  const text = messageText(message)
  const label = message.agentName ? `Message from agent: ${message.agentName}` : 'Message from agent'
  return (
    <article className={[`message message--agent ${open ? 'is-open' : ''}`, stylex.props(transcriptStyles.message, transcriptStyles.messageAgent).className].filter(Boolean).join(' ')}>
      <button type="button" className={`agent-message__summary ${stylex.props(transcriptStyles.agentMessageSummary, [responsiveStyles.agentMessageSummary, responsiveLayoutStyles.agentMessageSummary]).className ?? ""}`} aria-expanded={open} aria-controls={contentId} aria-label={label} onClick={(event) => { setKeyboardToggle(event.detail === 0); setOpen((value) => !value) }}>
        <PiMark size={18} />
        <span className={`agent-message__label ${stylex.props(transcriptStyles.agentMessageLabel).className ?? ""}`}>Message from agent</span>
        {message.agentName ? <span className={`agent-message__name ${stylex.props(transcriptStyles.agentMessageName).className ?? ""}`}>{message.agentName}</span> : null}
        <CaretRight className={`agent-message__chevron disclosure-caret ${stylex.props(transcriptStyles.agentMessageChevron, transcriptStyles.disclosureCaret).className ?? ""}`} size={13} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div {...collapseMotionProps(instant)}>
            <div className={`agent-message__content ${stylex.props(transcriptStyles.agentMessageContent).className ?? ""}`} id={contentId}>
              <MarkdownText variant="muted" text={boundText(text, 40_000, '\n… [Agent message truncated in the desktop view.]')} />
              <MessageActions message={message} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </article>
  )
})

export const GoalMessage = memo(function GoalMessage({ message }: { message: TranscriptMessage }) {
  const [open, setOpen] = useState(false)
  const [keyboardToggle, setKeyboardToggle] = useState(false)
  const instant = useInstantMotion() || keyboardToggle
  const contentId = useId()
  const text = messageText(message)
  return (
    <article className={[`message message--goal ${open ? 'is-open' : ''}`, stylex.props(transcriptStyles.message, transcriptStyles.messageGoal).className].filter(Boolean).join(' ')}>
      <button type="button" className={`goal-message__summary ${stylex.props(transcriptStyles.goalMessageSummary, [responsiveStyles.goalMessageSummary, responsiveLayoutStyles.agentMessageSummary]).className ?? ""}`} aria-expanded={open} aria-controls={contentId} aria-label="Goal summary" onClick={(event) => { setKeyboardToggle(event.detail === 0); setOpen((value) => !value) }}>
        <span className={`goal-message__icon ${stylex.props(transcriptStyles.goalMessageIcon).className ?? ""}`}>
          <Crosshair size={15} />
        </span>
        <span className={`goal-message__label ${stylex.props(transcriptStyles.goalMessageLabel).className ?? ""}`}>Goal summary</span>
        <CaretRight className={`goal-message__chevron disclosure-caret ${stylex.props(transcriptStyles.goalMessageChevron, transcriptStyles.disclosureCaret).className ?? ""}`} size={13} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div {...collapseMotionProps(instant)}>
            <div className={`goal-message__content ${stylex.props(transcriptStyles.goalMessageContent).className ?? ""}`} id={contentId}>
              <MarkdownText variant="muted" text={boundText(text, 40_000, '\n… [Goal summary truncated in the desktop view.]')} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </article>
  )
})
