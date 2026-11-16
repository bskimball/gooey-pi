import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex';
import * as stylex from '@stylexjs/stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { AnimatePresence, motion } from 'motion/react'
import { Fragment, memo, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  Brain,
  CaretRight,
  ChatCircle,
  ChatCircleDots,
  Check,
  Copy,
  FileCode,
  GitFork,
  Globe,
  Stack,
  Terminal,
  TerminalWindow,
  WarningCircle,
  Wrench,
} from '../icons'
import type { MessagePart, TranscriptMessage } from '@/types/api'
import { writeClipboardText } from '@/lib/clipboard'
import { boundText } from '@/lib/render-bounds'
import { MarkdownText } from '../MarkdownText'
import { ImageParts } from './TranscriptImage'
import { StatusMark } from '../activity/StatusMark'
import { SyntaxText } from './syntax'
import { RECENT_TIMELINE_PAGES, TIMELINE_PAGE_SIZE, TimelinePage } from './TimelinePage'
import { diffCounts, EditDiff, editDiffLines, isEditTool } from './edit-diff'
import {
  arrivalMotionProps,
  collapseMotionProps,
  isSubagentTool,
  MorphInline,
  pairSubagentCalls,
  SubagentLane,
  TodoStep,
  useInstantMotion,
  type SubagentPairs,
} from './subagent-lane'

function timestamp(value?: string | number): number | undefined {
  if (value === undefined) return undefined
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function formatWorkedDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000))
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes === 0) return `${seconds}s`
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  if (hours === 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`
  return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`
}

export type ToolKind = 'question' | 'terminal' | 'web' | 'git' | 'file' | 'mcp'

export function classifyTool(name: string): ToolKind {
  if (/ask[_\s.-]?user|ask\s+(?:a\s+)?question|ui\.select|request[_\s.-]?input/i.test(name)) return 'question'
  if (/bash|shell|terminal|command|exec|process/i.test(name)) return 'terminal'
  if (/github|\bgit\b|commit|branch|pull[_\s-]?request/i.test(name)) return 'git'
  if (/browser|web[_\s.-]?search|search[_\s.-]?web|fetch|https?|url|globe/i.test(name)) return 'web'
  if (/read|write|edit|file|path|directory|patch/i.test(name)) return 'file'
  return 'mcp'
}

function toolIcon(kind: ToolKind): ReactNode {
  if (kind === 'question') return <ChatCircleDots size={14} />
  if (kind === 'terminal') return <TerminalWindow size={14} />
  if (kind === 'web') return <Globe size={14} />
  if (kind === 'git') return <GitFork size={14} />
  if (kind === 'file') return <FileCode size={14} />
  return <Wrench size={14} />
}

function serialize(value: unknown, pretty = false): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, pretty ? 2 : undefined) } catch { return String(value) }
}

/** Settled file reads and searches fold into one row when they run back to back; edits, commands, and agents stay visible. */
const READ_TOOLS = /^(?:read|read_file|ls)$/i
export const SEARCH_TOOLS = /^(?:ffgrep|fffind|grep|find|glob)$/i
export const isExploreTool = (name: string) => READ_TOOLS.test(name) || SEARCH_TOOLS.test(name)

const plural = (count: number, noun: string, many = `${noun}s`) => `${count} ${count === 1 ? noun : many}`

interface RunMember { failed: boolean; running: boolean; search: boolean; label: string }

function exploreLabel(part: Extract<MessagePart, { type: 'toolCall' }>): string {
  const preview = toolPreview(part)
  return SEARCH_TOOLS.test(part.name) ? preview : preview.split(/[\\/]/).at(-1) ?? preview
}

function ToolRun({ members, children, animateArrival = false }: { members: RunMember[]; children: ReactElement[]; animateArrival?: boolean }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const instant = useInstantMotion()
  const failed = members.filter((member) => member.failed).length
  const running = members.some((member) => member.running)
  const searches = members.filter((member) => member.search).length
  const reads = members.length - searches
  const label = reads ? `Read ${plural(reads, 'file')}${searches ? `, ${plural(searches, 'search', 'searches')}` : ''}` : `Ran ${plural(searches, 'search', 'searches')}`
  const names = members.map((member) => member.label).filter(Boolean)
  return (
    <motion.div className={[`activity-run activity-line--file ${failed ? 'is-error' : running ? 'is-running' : 'is-done'}`, stylex.props(transcriptStyles.activityRun).className].filter(Boolean).join(' ')} {...arrivalMotionProps(instant, animateArrival)}>
      <button type="button" className={`activity-run__summary ${stylex.props(transcriptStyles.activityRunSummary).className ?? ""}`} aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => setOpen((value) => !value)}>
        <span className={`activity-line__icon ${stylex.props(transcriptStyles.activityLineIcon).className ?? ""}`}>
          <MorphInline morphKey={running ? 'running' : 'done'} instant={instant}>{running ? <StatusMark state="running" size={14} /> : toolIcon('file')}</MorphInline>
        </span>
        <span className={`activity-run__label ${stylex.props(transcriptStyles.activityRunLabel).className ?? ""}`}>
          <MorphInline morphKey={label} instant={instant}>{label}</MorphInline>
        </span>
        {names.length ? <span className={`activity-run__names ${stylex.props(transcriptStyles.activityRunNames).className ?? ""}`}>{names.slice(0, 3).join(', ')}{names.length > 3 ? '…' : ''}</span> : null}
        {failed ? <span className={`activity-run__failed ${stylex.props(transcriptStyles.activityRunFailed).className ?? ""}`}><WarningCircle size={12} /> {failed} failed</span> : null}
        <CaretRight className={`disclosure-caret ${stylex.props(transcriptStyles.disclosureCaret).className ?? ""}`} size={13} />
      </button>
      <AnimatePresence initial={false}>
        {open ? <motion.div key="run-items" className={`activity-run__items ${stylex.props(transcriptStyles.activityRunItems).className ?? ""}`} id={bodyId} {...collapseMotionProps(instant)}>{children}</motion.div> : null}
      </AnimatePresence>
    </motion.div>
  )
}

export function toolPreview(part: Extract<MessagePart, { type: 'toolCall' }>): string {
  const raw = part.args
  if (raw && typeof raw === 'object') {
    const args = raw as Record<string, unknown>
    // Plan updates and subagent calls render as TodoStep and SubagentLane rows instead.
    const preferred = args.question ?? args.command ?? args.query ?? args.pattern ?? args.url ?? args.path ?? args.operation ?? args.id ?? args.action ?? args.code ?? args.cwd
    if (typeof preferred === 'string') return boundText(preferred.replace(/\s+/g, ' ').trim(), 180, '…')
  }
  return boundText(serialize(raw).replace(/\s+/g, ' ').trim(), 180, '…')
}

/** Reasoning stays readable while its turn runs and after it settles; a Thought header lets you fold it away. */
function ReasoningPart({ part, live = false, streaming = false, animateArrival = false }: { part: Extract<MessagePart, { type: 'thinking' }>; live?: boolean; streaming?: boolean; animateArrival?: boolean }) {
  const [open, setOpen] = useState(true)
  const bodyId = useId()
  const instant = useInstantMotion()
  if (live && !part.text.trim()) return null
  const body = <MarkdownText variant="reasoning" text={boundText(part.text, 40_000, '\n… [Reasoning truncated in the desktop view.]')} streaming={streaming} />
  const bodyCollapse = collapseMotionProps(instant)
  const summaryCollapse = collapseMotionProps(instant)
  return (
    <motion.div
      className={[
        `activity-line activity-line--reasoning${live ? '' : ' is-settled'}`,
        stylex.props(
          transcriptStyles.activityLine,
          transcriptStyles.activityLineReasoning,
          !live && transcriptStyles.activityLineReasoningIsSettled,
        ).className,
      ].filter(Boolean).join(' ')}
      {...arrivalMotionProps(instant, animateArrival)}
    >
      <AnimatePresence initial={false}>
        {!live ? (
          <motion.button
            key="thought-summary"
            type="button"
            className={`activity-thought__summary ${stylex.props(transcriptStyles.activityThoughtSummary).className ?? ""}`}
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            onClick={() => setOpen((value) => !value)}
            {...summaryCollapse}
            transition={instant ? { duration: 0 } : { duration: 0.17, ease: [0.23, 1, 0.32, 1] }}
          >
            <span className={`activity-line__icon ${stylex.props(transcriptStyles.activityLineIcon).className ?? ""}`}><Brain size={14} /></span>
            <span className={`activity-line__kind ${stylex.props(transcriptStyles.activityLineKind).className ?? ""}`}>Thought</span>
            <CaretRight className={`disclosure-caret ${stylex.props(transcriptStyles.disclosureCaret).className ?? ""}`} size={13} />
          </motion.button>
        ) : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {live || open ? (
          <motion.div
            key="thought-body"
            className={live ? undefined : `activity-thought__body ${stylex.props(transcriptStyles.activityThoughtBody).className ?? ""}`}
            id={live ? undefined : bodyId}
            {...bodyCollapse}
          >
            {body}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}

/**
 * Self-ticking elapsed clock for a live work phase. The timer lives inside
 * this leaf component so only the small label re-renders every second, not
 * the whole transcript row. `aria-hidden` keeps the 1-second churn out of
 * screen-reader announcements; the neighbouring state text already carries
 * the semantic (thinking/working), the duration is decorative.
 */
export function LiveElapsed({ since }: { since?: string | number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])
  const startedAt = timestamp(since)
  if (startedAt === undefined) return null
  return <span className={`live-elapsed ${stylex.props(transcriptStyles.liveElapsed).className ?? ""}`} aria-hidden="true">{formatWorkedDuration(Math.max(0, now - startedAt))}</span>
}

/** The last few lines of streamed output, shown under a running command like a terminal's live scrollback. */
const TAIL_LINES = 5
function outputTail(output: string, lines = TAIL_LINES): string {
  return output.slice(-4_000).trimEnd().split('\n').slice(-lines).join('\n')
}

function stringArg(part: Extract<MessagePart, { type: 'toolCall' }>, key: string): string | undefined {
  const value = part.args && typeof part.args === 'object' ? (part.args as Record<string, unknown>)[key] : undefined
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** `:offset–end` for a ranged read, in the editor's 1-based lines. */
function readRange(part: Extract<MessagePart, { type: 'toolCall' }>): string | undefined {
  if (!READ_TOOLS.test(part.name) || !part.args || typeof part.args !== 'object') return undefined
  const { offset, limit } = part.args as { offset?: unknown; limit?: unknown }
  const start = typeof offset === 'number' && offset > 0 ? offset : undefined
  const count = typeof limit === 'number' && limit > 0 ? limit : undefined
  if (start === undefined && count === undefined) return undefined
  const first = start ?? 1
  return count === undefined ? `:${first}` : `:${first}–${first + count - 1}`
}

const ToolPart = memo(function ToolPart({ part, result, animateArrival = false }: { part: Extract<MessagePart, { type: 'toolCall' }>; result?: Extract<MessagePart, { type: 'toolResult' }>; animateArrival?: boolean }) {
  const instant = useInstantMotion()
  const failed = result?.isError
  const finished = result && !result.streaming
  const kind = classifyTool(part.name)
  const diff = useMemo(() => isEditTool(part.name) ? editDiffLines(part, result) : [], [part, result])
  const showDiff = diff.length > 0
  // Edits start open on their diff and other rows closed; a click flips either.
  const [toggled, setToggled] = useState(false)
  const open = showDiff !== toggled
  const [copied, setCopied] = useState(false)
  const resetCopiedTimerRef = useRef<number | null>(null)
  const detailsId = useId()
  const output = result?.text ?? ''
  const command = kind === 'terminal' ? stringArg(part, 'command') : undefined
  const visibleOutput = useMemo(() => {
    if (!open || showDiff) return ''
    const args = command ? '' : serialize(part.args, true)
    return boundText(`${args}${args && output ? '\n\n' : ''}${output}`, 200_000, '\n\n[Output truncated in the desktop view.]')
  }, [open, showDiff, command, part.args, output])
  const canExpand = showDiff || Boolean(output || !command && part.args !== undefined && part.args !== '')
  const state = failed ? 'error' : finished ? 'done' : kind === 'question' ? 'waiting' : 'running'
  const preview = toolPreview(part)
  const range = readRange(part)
  const { additions, deletions } = diffCounts(diff)
  useEffect(
    () => () => {
      if (resetCopiedTimerRef.current !== null) window.clearTimeout(resetCopiedTimerRef.current)
    },
    [],
  )

  const copyContents = async () => {
    try {
      await writeClipboardText(visibleOutput)
      setCopied(true)
      if (resetCopiedTimerRef.current !== null) window.clearTimeout(resetCopiedTimerRef.current)
      resetCopiedTimerRef.current = window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }

  const collapse = collapseMotionProps(instant)

  return (
    <><motion.div className={[`activity-line activity-line--tool activity-line--${kind} is-${state}${command ? ' activity-line--shell' : ''}`, stylex.props(transcriptStyles.activityLine, transcriptStyles.activityLineTool, classifyTool(part.name) === "question" && transcriptStyles.activityLineQuestion).className].filter(Boolean).join(' ')} {...arrivalMotionProps(instant, animateArrival)}>
      <button type="button" className={`activity-tool__summary ${stylex.props(transcriptStyles.activityToolSummary, [responsiveStyles.activityToolSummary, responsiveLayoutStyles.activityToolSummary]).className ?? ""}`} disabled={!canExpand} onClick={() => setToggled((value) => !value)} aria-expanded={canExpand ? open : undefined} aria-controls={canExpand && open ? detailsId : undefined}>
        <span className={`activity-line__icon ${stylex.props(transcriptStyles.activityLineIcon).className ?? ""}`}>{command ? <Terminal size={14} /> : toolIcon(kind)}</span>
        {command
          ? <code className={`activity-tool__command ${stylex.props(transcriptStyles.activityToolCommand).className ?? ""}`} title={command}><span className={`activity-tool__prompt ${stylex.props(transcriptStyles.activityToolPrompt).className ?? ""}`} aria-hidden="true">$</span> {boundText(command.replace(/\s+/g, ' ').trim(), 180, '…')}</code>
          : <>
            <span className={`activity-line__kind ${stylex.props(transcriptStyles.activityLineKind).className ?? ""}`}>{kind === 'question' ? 'Question' : part.name}</span>
            {preview ? <code className={`activity-tool__preview ${stylex.props(transcriptStyles.activityToolPreview).className ?? ""}`}><SyntaxText text={preview} /></code> : null}
            {range ? <span className={`activity-tool__range ${stylex.props(transcriptStyles.activityToolRange).className ?? ""}`}>{range}</span> : null}
          </>}
        {showDiff ? <span className={`activity-tool__diff-counts ${stylex.props(transcriptStyles.activityToolDiffCounts).className ?? ""}`}><span className={`diff-count diff-count--add ${stylex.props(transcriptStyles.diffCount, transcriptStyles.diffCountAdd).className ?? ""}`}>+{additions}</span><span className={`diff-count diff-count--remove ${stylex.props(transcriptStyles.diffCount, transcriptStyles.diffCountRemove).className ?? ""}`}>−{deletions}</span></span> : null}
        <span className={`activity-tool__state ${stylex.props(transcriptStyles.activityToolState, [responsiveStyles.activityToolState, responsiveLayoutStyles.activityToolState]).className ?? ""}`}>
          <MorphInline morphKey={state} instant={instant}>
            {failed ? <><WarningCircle size={12} /> failed</> : finished ? <><Check size={12} /> done</> : kind === 'question' ? 'needs input' : <><StatusMark state="running" size={12} /> running</>}
          </MorphInline>
        </span>
        {canExpand ? <CaretRight className={`disclosure-caret ${stylex.props(transcriptStyles.disclosureCaret).className ?? ""}`} size={13} /> : null}
      </button>
      <AnimatePresence initial={false}>
        {showDiff && open ? <motion.div key="edit-diff" {...collapse}><EditDiff id={detailsId} diff={diff} /></motion.div> : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {(state === 'running' || state === 'error' && command) && !open && output.trim() ? <motion.pre key="tool-tail" className={[`activity-tool__tail${state === 'error' ? ' is-error' : ''}`, stylex.props(transcriptStyles.activityToolTail).className].filter(Boolean).join(' ')} {...collapse}>{outputTail(output)}</motion.pre> : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {open && visibleOutput ? (
          <motion.div key="tool-details" className={`activity-tool__details ${stylex.props(transcriptStyles.activityToolDetails).className ?? ""}`} id={detailsId} {...collapse}>
            <div className={`activity-tool__details-toolbar ${stylex.props(transcriptStyles.activityToolDetailsToolbar).className ?? ""}`}>
              <button type="button" className={`activity-tool__copy ${stylex.props(transcriptStyles.activityToolCopy).className ?? ""}`} aria-label={`${copied ? 'Copied' : 'Copy'} tool contents`} onClick={() => void copyContents()}>
                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className={`activity-tool__contents ${stylex.props(transcriptStyles.activityToolContents).className ?? ""}`}><SyntaxText text={visibleOutput} /></pre>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
    <ImageParts images={result?.images} /></>
  )
})

function StandaloneToolResult({ part, animateArrival = false }: { part: Extract<MessagePart, { type: 'toolResult' }>; animateArrival?: boolean }) {
  const instant = useInstantMotion()
  return <><motion.div className={[`activity-line activity-line--result ${part.isError ? 'is-error' : ''}`, stylex.props(transcriptStyles.activityLine, transcriptStyles.activityLineResult, (part.isError) && transcriptStyles.activityLineResultIsError).className].filter(Boolean).join(' ')} {...arrivalMotionProps(instant, animateArrival)}><span className={`activity-line__icon ${stylex.props(transcriptStyles.activityLineIcon).className ?? ""}`}>{part.isError ? <WarningCircle size={13} /> : <Check size={13} />}</span><span>{boundText(part.text, 2_000, '…')}</span></motion.div><ImageParts images={part.images} /></>
}

function AgentActivityPart({ part, animateArrival = false }: { part: Extract<MessagePart, { type: 'agentMessage' }>; animateArrival?: boolean }) {
  const [open, setOpen] = useState(false)
  const instant = useInstantMotion()
  const canExpand = Boolean(part.text)
  return <motion.div className={`activity-line activity-line--agent ${stylex.props(transcriptStyles.activityLine, transcriptStyles.activityLineAgent).className ?? ""}`} {...arrivalMotionProps(instant, animateArrival)}>
    <button type="button" className={`activity-tool__summary ${stylex.props(transcriptStyles.activityToolSummary, [responsiveStyles.activityToolSummary, responsiveLayoutStyles.activityToolSummary]).className ?? ""}`} disabled={!canExpand} onClick={() => setOpen((value) => !value)} aria-expanded={canExpand ? open : undefined}>
      <span className={`activity-line__icon ${stylex.props(transcriptStyles.activityLineIcon).className ?? ""}`}><ChatCircle size={14} /></span>
      <span className={`activity-line__kind ${stylex.props(transcriptStyles.activityLineKind).className ?? ""}`}>Message from agent</span>
      {part.agentName ? <span className={`activity-agent__name ${stylex.props(transcriptStyles.activityAgentName).className ?? ""}`}>{part.agentName}</span> : null}
      {canExpand ? <CaretRight className={`disclosure-caret ${stylex.props(transcriptStyles.disclosureCaret).className ?? ""}`} size={13} /> : null}
    </button>
    <AnimatePresence initial={false}>
      {open && part.text ? <motion.div key="agent-details" className={`activity-agent__details ${stylex.props(transcriptStyles.activityAgentDetails).className ?? ""}`} {...collapseMotionProps(instant)}><MarkdownText variant="compact" text={boundText(part.text, 40_000, '\n… [Agent message truncated in the desktop view.]')} /></motion.div> : null}
    </AnimatePresence>
  </motion.div>
}

function compactionReasonLabel(reason: Extract<MessagePart, { type: 'compaction' }>['reason']): string {
  if (reason === 'threshold') return 'automatic threshold'
  if (reason === 'overflow') return 'overflow recovery'
  if (reason === 'requested') return 'requested'
  if (reason === 'manual') return 'manual'
  return 'context'
}

function CompactionPart({ part, animateArrival = false }: { part: Extract<MessagePart, { type: 'compaction' }>; animateArrival?: boolean }) {
  const [open, setOpen] = useState(false)
  const instant = useInstantMotion()
  const canExpand = Boolean(part.summary || part.error)
  const label = part.status === 'running'
    ? 'Compacting context'
    : part.status === 'done'
      ? 'Context compacted'
      : part.status === 'cancelled' ? 'Context compaction cancelled' : part.outcome === 'skipped' ? 'Context compaction skipped' : 'Context compaction failed'
  const stateKey = part.status === 'running' ? 'running' : part.status === 'done' ? (part.willRetry ? 'continuing' : 'done') : part.status
  const state = part.status === 'running'
    ? <><StatusMark state="running" size={12} /> running</>
    : part.status === 'done'
      ? <><Check size={12} /> {part.willRetry ? 'continuing' : 'done'}</>
      : <><WarningCircle size={12} /> {part.status === 'cancelled' ? 'cancelled' : 'needs attention'}</>
  const details = part.error || part.summary
  const tokenLabel = part.tokensBefore === undefined ? '' : `${part.tokensBefore.toLocaleString()} tokens before`
  const iconKey = part.status === 'running' || part.status === 'done' ? 'stack' : 'warn'
  return <motion.div className={[`activity-line activity-line--compaction is-${part.status}`, stylex.props(transcriptStyles.activityLine, transcriptStyles.activityLineCompaction, ((part.status === "running")) && transcriptStyles.activityLineCompactionIsRunning).className].filter(Boolean).join(' ')} {...arrivalMotionProps(instant, animateArrival)}>
    <button type="button" className={`activity-tool__summary ${stylex.props(transcriptStyles.activityToolSummary, [responsiveStyles.activityToolSummary, responsiveLayoutStyles.activityToolSummary]).className ?? ""}`} disabled={!canExpand} onClick={() => setOpen((value) => !value)} aria-expanded={canExpand ? open : undefined}>
      <span className={`activity-line__icon ${stylex.props(transcriptStyles.activityLineIcon).className ?? ""}`}>
        <MorphInline morphKey={iconKey} instant={instant}>{part.status === 'running' || part.status === 'done' ? <Stack size={13} /> : <WarningCircle size={13} />}</MorphInline>
      </span>
      <span className={`activity-line__kind ${stylex.props(transcriptStyles.activityLineKind).className ?? ""}`}>
        <MorphInline morphKey={label} instant={instant}>{label}</MorphInline>
      </span>
      <span className={`activity-compaction__reason ${stylex.props(transcriptStyles.activityCompactionReason).className ?? ""}`}>{compactionReasonLabel(part.reason)}</span>
      {tokenLabel ? <span className={`activity-compaction__tokens ${stylex.props(transcriptStyles.activityCompactionTokens).className ?? ""}`}>{tokenLabel}</span> : null}
      <span className={`activity-tool__state ${stylex.props(transcriptStyles.activityToolState, [responsiveStyles.activityToolState, responsiveLayoutStyles.activityToolState]).className ?? ""}`}>
        <MorphInline morphKey={stateKey} instant={instant}>{state}</MorphInline>
      </span>
      {canExpand ? <CaretRight className={`disclosure-caret ${stylex.props(transcriptStyles.disclosureCaret).className ?? ""}`} size={13} /> : null}
    </button>
    <AnimatePresence initial={false}>
      {open && details ? <motion.div key="compaction-details" className={[`activity-compaction__details ${part.status === 'done' ? '' : 'is-error'}`, stylex.props(transcriptStyles.activityCompactionDetails, !(part.status === 'done') && transcriptStyles.activityCompactionDetailsIsError).className].filter(Boolean).join(' ')} {...collapseMotionProps(instant)}><MarkdownText variant="compact" text={boundText(details, 40_000, '\n… [Compaction details truncated in the desktop view.]')} /></motion.div> : null}
    </AnimatePresence>
  </motion.div>
}

/**
 * Streaming reducers splice tool results into the middle of a part list, so
 * index keys detach expanded panels mid-stream. Key on the part's stable id
 * (a tool call keeps its semantic tool id); parts loaded from disk without an
 * id fall back to a type-scoped index, which is stable for static lists.
 */
function partKey(part: MessagePart, index: number): string {
  if (part.type === 'toolCall' && part.id) return part.id
  return part.partId ?? `${part.type}:${index}`
}

export function WorkTimeline({ id, parts, showReasoning, showTools, streaming = false, subagents }: { id?: string; parts: MessagePart[]; showReasoning: boolean; showTools: boolean; streaming?: boolean; subagents?: SubagentPairs }) {
  const instant = useInstantMotion()
  const { followUps, absorbed } = subagents ?? pairSubagentCalls(parts)
  const pairedResults = new Set<number>()
  const pendingKeys = new Set<string>()
  const runMembers = new Map<string, RunMember>()
  const items = parts.map((part, index) => {
    const key = partKey(part, index)
    const isTailPart = streaming && index === parts.length - 1
    if (absorbed.has(part) || part.type === 'toolResult' && pairedResults.has(index)) return null
    if (part.type === 'compaction') {
      if (part.status === 'running') pendingKeys.add(key)
      return <CompactionPart key={key} part={part} animateArrival={streaming} />
    }
    if (part.type === 'thinking') return showReasoning ? <ReasoningPart key={key} part={part} live={streaming} streaming={isTailPart} animateArrival={streaming} /> : null
    if (part.type === 'toolCall') {
      if (!showTools) return null
      const next = parts[index + 1]
      if (next?.type === 'toolResult') pairedResults.add(index + 1)
      if (next?.type !== 'toolResult' || next.streaming) pendingKeys.add(key)
      const result = next?.type === 'toolResult' ? next : undefined
      if (part.name === 'todo_write') return <TodoStep key={key} part={part} animateArrival={streaming} />
      if (isSubagentTool(part.name) && !(part.name === 'task_wait' && result?.isError)) return <Fragment key={key}><SubagentLane part={part} result={result} followUps={followUps.get(part)} animateArrival={streaming} /><ImageParts images={result?.images} /></Fragment>
      if (isExploreTool(part.name)) {
        const running = streaming && (!result || Boolean(result.streaming))
        runMembers.set(key, { failed: Boolean(result?.isError), running, search: SEARCH_TOOLS.test(part.name), label: exploreLabel(part) })
      }
      return <ToolPart key={key} part={part} result={result} animateArrival={streaming} />
    }
    if (part.type === 'toolResult') return showTools ? <StandaloneToolResult key={key} part={part} animateArrival={streaming} /> : <ImageParts key={key} images={part.images} />
    if (part.type === 'image') return <ImageParts key={key} images={[part]} />
    if (part.type === 'agentMessage') return <AgentActivityPart key={key} part={part} animateArrival={streaming} />
    if (part.type === 'text') return part.text.trim() || !streaming ? <motion.div className={`activity-line activity-line--note ${stylex.props(transcriptStyles.activityLine, transcriptStyles.activityLineNote).className ?? ""}`} key={key} {...arrivalMotionProps(instant, streaming)}><MarkdownText variant="note" text={part.text} streaming={isTailPart} /></motion.div> : null
    return null
  }).filter((row) => row !== null)
  // Back-to-back reads and searches fold into a single row; edits, commands, plans, and agents stay in the stream.
  const rows: ReactElement[] = []
  for (let index = 0; index < items.length;) {
    let end = index
    while (end < items.length && runMembers.has(String(items[end].key))) end += 1
    if (end - index >= 2) {
      const members = items.slice(index, end)
      const runKey = `run:${String(items[index].key)}`
      if (members.some((row) => row.key !== null && pendingKeys.has(String(row.key)))) pendingKeys.add(runKey)
      rows.push(<ToolRun key={runKey} members={members.map((row) => runMembers.get(String(row.key))!)} animateArrival={streaming}>{members}</ToolRun>)
    } else {
      end = Math.max(end, index + 1)
      rows.push(...items.slice(index, end))
    }
    index = end
  }
  const pages = []
  const pageCount = Math.ceil(rows.length / TIMELINE_PAGE_SIZE)
  for (let index = 0; index < pageCount; index++) {
    const start = index * TIMELINE_PAGE_SIZE
    const page = rows.slice(start, start + TIMELINE_PAGE_SIZE)
    const recent = index >= pageCount - RECENT_TIMELINE_PAGES || page.some((row) => row.key !== null && pendingKeys.has(String(row.key)))
    pages.push(<TimelinePage key={`page:${start}`} recent={recent} start={start + 1} count={page.length}>{page}</TimelinePage>)
  }
  return <div className={`work-timeline ${stylex.props(transcriptStyles.workTimeline).className ?? ""}`} id={id}>{pages}</div>
}


/** What the live turn is waiting on right now, named from the newest unsettled tool call. */
export function activeWorkLabel(parts: MessagePart[]): string | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    const next = parts[index + 1]
    if (part.type !== 'toolCall' || (next?.type === 'toolResult' && !next.streaming)) continue
    if (part.name === 'todo_write') return 'Updating the plan'
    if (classifyTool(part.name) === 'question') return 'Waiting for your answer'
    const args = (part.args && typeof part.args === 'object' ? part.args : {}) as { agent?: unknown; steps?: unknown }
    if (isSubagentTool(part.name)) {
      const roles = Array.isArray(args.steps) ? args.steps.flatMap((step) => typeof step?.agent === 'string' ? [step.agent] : []) : typeof args.agent === 'string' ? [args.agent] : []
      return `Running ${roles.length ? roles.join(' → ') : part.name}`
    }
    const preview = toolPreview(part)
    return `Running ${part.name}${preview ? `: ${boundText(preview, 60, '…')}` : ''}`
  }
  return undefined
}

function liveWorkStatus(parts: MessagePart[], showReasoning: boolean, showTools: boolean): 'Thinking' | 'Working' {
  let status: 'Thinking' | 'Working' | undefined
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    const next = parts[index + 1]
    if (part.type === 'toolCall' && (next?.type !== 'toolResult' || next.streaming)) return 'Working'
    if (status || part.type === 'image') continue
    if (part.type === 'thinking') status = showReasoning ? 'Thinking' : undefined
    else if (showTools || part.type !== 'toolCall' && part.type !== 'toolResult') status = 'Working'
  }
  return status ?? 'Working'
}

/**
 * The live run ledger: the turn's chronological stream (`children`). The user turn header already shows
 * "Running" with elapsed time and the work group names the live step, so the status is screen-reader only.
 */
export function WorkDisclosure({ message, showReasoning, showTools, children }: { message: TranscriptMessage; showReasoning: boolean; showTools: boolean; children?: ReactNode }) {
  const activity = showTools ? activeWorkLabel(message.parts) : undefined
  const statusText = activity ?? liveWorkStatus(message.parts, showReasoning, showTools)
  return <section className={`work-disclosure is-running ${stylex.props(transcriptStyles.workDisclosure, transcriptStyles.workDisclosureIsRunning).className ?? ""}`} aria-label="Agent work activity">
    <div className={`work-disclosure__live ${stylex.props(transcriptStyles.workDisclosureLive).className ?? ""}`}>
      {children}
      <div className={`work-disclosure__status sr-only ${stylex.props(baseStyles.srOnly).className ?? ""}`} role="status">
        <span className={activity ? 'work-disclosure__activity' : 'work-disclosure__verb'} title={activity}>{statusText}</span>
      </div>
    </div>
  </section>
}
