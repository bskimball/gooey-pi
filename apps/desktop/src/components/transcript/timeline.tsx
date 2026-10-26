import { memo, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  Brain,
  CaretRight,
  ChatCircle,
  ChatCircleDots,
  Check,
  CircleNotch,
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
import { SyntaxText } from './syntax'
import { RECENT_TIMELINE_PAGES, TIMELINE_PAGE_SIZE, TimelinePage } from './TimelinePage'
import { diffCounts, EditDiff, editDiffLines, isEditTool } from './edit-diff'
import { isSubagentTool, pairSubagentCalls, SubagentLane, TodoStep, type SubagentPairs } from './subagent-lane'

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
const SEARCH_TOOLS = /^(?:ffgrep|fffind|grep|find|glob)$/i
const isExploreTool = (name: string) => READ_TOOLS.test(name) || SEARCH_TOOLS.test(name)

const plural = (count: number, noun: string, many = `${noun}s`) => `${count} ${count === 1 ? noun : many}`

interface RunMember { failed: boolean; search: boolean; label: string }

function exploreLabel(part: Extract<MessagePart, { type: 'toolCall' }>): string {
  const preview = toolPreview(part)
  return SEARCH_TOOLS.test(part.name) ? preview : preview.split(/[\\/]/).at(-1) ?? preview
}

function ToolRun({ members, children }: { members: RunMember[]; children: ReactElement[] }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const failed = members.filter((member) => member.failed).length
  const searches = members.filter((member) => member.search).length
  const reads = members.length - searches
  const label = reads ? `Read ${plural(reads, 'file')}${searches ? `, ${plural(searches, 'search', 'searches')}` : ''}` : `Ran ${plural(searches, 'search', 'searches')}`
  const names = members.map((member) => member.label).filter(Boolean)
  return (
    <div className={`activity-run activity-line--file ${failed ? 'is-error' : 'is-done'}`}>
      <button type="button" className="activity-run__summary" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => setOpen((value) => !value)}>
        <span className="activity-line__icon">{toolIcon('file')}</span>
        <span className="activity-run__label">{label}</span>
        {names.length ? <span className="activity-run__names">{names.slice(0, 3).join(', ')}{names.length > 3 ? '…' : ''}</span> : null}
        {failed ? <span className="activity-run__failed"><WarningCircle size={12} /> {failed} failed</span> : null}
        <CaretRight className="disclosure-caret" size={13} />
      </button>
      {open ? <div className="activity-run__items" id={bodyId}>{children}</div> : null}
    </div>
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

/** Reasoning stays readable while its turn runs; once the turn settles it folds to one quiet line. */
function ReasoningPart({ part, live = false }: { part: Extract<MessagePart, { type: 'thinking' }>; live?: boolean }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const body = <MarkdownText text={boundText(part.text, 40_000, '\n… [Reasoning truncated in the desktop view.]')} streaming={live} />
  if (live) return <div className="activity-line activity-line--reasoning">{body}</div>
  return <div className="activity-line activity-line--reasoning is-collapsed">
    <button type="button" className="activity-thought__summary" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => setOpen((value) => !value)}>
      <span className="activity-line__icon"><Brain size={14} /></span>
      <span className="activity-line__kind">Thought</span>
      <CaretRight className="disclosure-caret" size={13} />
    </button>
    {open ? <div className="activity-thought__body" id={bodyId}>{body}</div> : null}
  </div>
}

export function ThinkingDots({ labelled = false }: { labelled?: boolean }) {
  const clipId = `thinking-waterline-${useId().replace(/[^\w-]/g, '')}`
  // Seeded once per mount so concurrent indicators drift out of step and the fin's passes feel unscripted.
  const [fin] = useState(() => ({
    duration: `${(4.4 + Math.random() * 1.8).toFixed(2)}s`,
    delay: `${(-Math.random() * 4).toFixed(2)}s`,
    reverse: Math.random() < 0.3,
  }))
  return (
    <span className="thinking-dots" role={labelled ? 'status' : undefined} aria-label={labelled ? 'Pi is thinking' : undefined} aria-hidden={labelled ? undefined : true}>
      <svg width="24" height="10" viewBox="0 0 24 10" fill="none" aria-hidden="true" focusable="false">
        <defs><clipPath id={clipId}><rect x="-8" y="0" width="40" height="7" /></clipPath></defs>
        <g clipPath={`url(#${clipId})`}>
          <g transform={fin.reverse ? 'matrix(-1 0 0 1 24 0)' : undefined}>
            <path className="thinking-dots__fin" style={{ animationDuration: fin.duration, animationDelay: fin.delay }} d="M4.4 7.2C3 5.2 2 2.4 1.2 1.8C1.3 3.9 .9 5.6 0 7.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
        <path className="thinking-dots__wave" d="M0 7 Q2 4.75 4 7 T8 7 T12 7 T16 7 T20 7 T24 7 T28 7 T32 7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    </span>
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
  return <span className="live-elapsed" aria-hidden="true">{formatWorkedDuration(Math.max(0, now - startedAt))}</span>
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

const ToolPart = memo(function ToolPart({ part, result }: { part: Extract<MessagePart, { type: 'toolCall' }>; result?: Extract<MessagePart, { type: 'toolResult' }> }) {
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

  return (
    <div className={`activity-line activity-line--tool activity-line--${kind} is-${state}${command ? ' activity-line--shell' : ''}`}>
      <button type="button" className="activity-tool__summary" disabled={!canExpand} onClick={() => setToggled((value) => !value)} aria-expanded={canExpand ? open : undefined} aria-controls={canExpand && open ? detailsId : undefined}>
        <span className="activity-line__icon">{command ? <Terminal size={14} /> : toolIcon(kind)}</span>
        {command
          ? <code className="activity-tool__command" title={command}><span className="activity-tool__prompt" aria-hidden="true">$</span> {boundText(command.replace(/\s+/g, ' ').trim(), 180, '…')}</code>
          : <>
            <span className="activity-line__kind">{kind === 'question' ? 'Question' : part.name}</span>
            {preview ? <code className="activity-tool__preview"><SyntaxText text={preview} /></code> : null}
            {range ? <span className="activity-tool__range">{range}</span> : null}
          </>}
        {showDiff ? <span className="activity-tool__diff-counts"><span className="diff-count diff-count--add">+{additions}</span><span className="diff-count diff-count--remove">−{deletions}</span></span> : null}
        <span className="activity-tool__state">{failed ? <><WarningCircle size={12} /> failed</> : finished ? <><Check size={12} /> done</> : kind === 'question' ? 'needs input' : <><CircleNotch className="spin" size={12} /> running</>}</span>
        {canExpand ? <CaretRight className="disclosure-caret" size={13} /> : null}
      </button>
      {showDiff && open ? <EditDiff id={detailsId} diff={diff} /> : null}
      {(state === 'running' || state === 'error' && command) && !open && output.trim() ? <pre className={`activity-tool__tail${state === 'error' ? ' is-error' : ''}`}>{outputTail(output)}</pre> : null}
      {open && visibleOutput ? (
        <div className="activity-tool__details" id={detailsId}>
          <div className="activity-tool__details-toolbar">
            <button type="button" className="activity-tool__copy" aria-label={`${copied ? 'Copied' : 'Copy'} tool contents`} onClick={() => void copyContents()}>
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="activity-tool__contents"><SyntaxText text={visibleOutput} /></pre>
        </div>
      ) : null}
    </div>
  )
})

function StandaloneToolResult({ part }: { part: Extract<MessagePart, { type: 'toolResult' }> }) {
  return <div className={`activity-line activity-line--result ${part.isError ? 'is-error' : ''}`}><span className="activity-line__icon">{part.isError ? <WarningCircle size={13} /> : <Check size={13} />}</span><span>{boundText(part.text, 2_000, '…')}</span></div>
}

function AgentActivityPart({ part }: { part: Extract<MessagePart, { type: 'agentMessage' }> }) {
  const [open, setOpen] = useState(false)
  const canExpand = Boolean(part.text)
  return <div className="activity-line activity-line--agent">
    <button type="button" className="activity-tool__summary" disabled={!canExpand} onClick={() => setOpen((value) => !value)} aria-expanded={canExpand ? open : undefined}>
      <span className="activity-line__icon"><ChatCircle size={14} /></span>
      <span className="activity-line__kind">Message from agent</span>
      {part.agentName ? <span className="activity-agent__name">{part.agentName}</span> : null}
      {canExpand ? <CaretRight className="disclosure-caret" size={13} /> : null}
    </button>
    {open && part.text ? <div className="activity-agent__details"><MarkdownText text={boundText(part.text, 40_000, '\n… [Agent message truncated in the desktop view.]')} /></div> : null}
  </div>
}

function compactionReasonLabel(reason: Extract<MessagePart, { type: 'compaction' }>['reason']): string {
  if (reason === 'threshold') return 'automatic threshold'
  if (reason === 'overflow') return 'overflow recovery'
  if (reason === 'requested') return 'requested'
  if (reason === 'manual') return 'manual'
  return 'context'
}

function CompactionPart({ part }: { part: Extract<MessagePart, { type: 'compaction' }> }) {
  const [open, setOpen] = useState(false)
  const canExpand = Boolean(part.summary || part.error)
  const label = part.status === 'running'
    ? 'Compacting context'
    : part.status === 'done'
      ? 'Context compacted'
      : part.status === 'cancelled' ? 'Context compaction cancelled' : part.outcome === 'skipped' ? 'Context compaction skipped' : 'Context compaction failed'
  const state = part.status === 'running'
    ? <><CircleNotch className="spin" size={12} /> running</>
    : part.status === 'done'
      ? <><Check size={12} /> {part.willRetry ? 'continuing' : 'done'}</>
      : <><WarningCircle size={12} /> {part.status === 'cancelled' ? 'cancelled' : 'needs attention'}</>
  const details = part.error || part.summary
  const tokenLabel = part.tokensBefore === undefined ? '' : `${part.tokensBefore.toLocaleString()} tokens before`
  return <div className={`activity-line activity-line--compaction is-${part.status}`}>
    <button type="button" className="activity-tool__summary" disabled={!canExpand} onClick={() => setOpen((value) => !value)} aria-expanded={canExpand ? open : undefined}>
      <span className="activity-line__icon">{part.status === 'running' ? <CircleNotch className="spin" size={13} /> : part.status === 'done' ? <Stack size={13} /> : <WarningCircle size={13} />}</span>
      <span className="activity-line__kind">{label}</span>
      <span className="activity-compaction__reason">{compactionReasonLabel(part.reason)}</span>
      {tokenLabel ? <span className="activity-compaction__tokens">{tokenLabel}</span> : null}
      <span className="activity-tool__state">{state}</span>
      {canExpand ? <CaretRight className="disclosure-caret" size={13} /> : null}
    </button>
    {open && details ? <div className={`activity-compaction__details ${part.status === 'done' ? '' : 'is-error'}`}><MarkdownText text={boundText(details, 40_000, '\n… [Compaction details truncated in the desktop view.]')} /></div> : null}
  </div>
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
  const { followUps, absorbed } = subagents ?? pairSubagentCalls(parts)
  const pairedResults = new Set<number>()
  const pendingKeys = new Set<string>()
  const runMembers = new Map<string, RunMember>()
  const items = parts.map((part, index) => {
    const key = partKey(part, index)
    if (absorbed.has(part) || part.type === 'toolResult' && pairedResults.has(index)) return null
    if (part.type === 'compaction') {
      if (part.status === 'running') pendingKeys.add(key)
      return <CompactionPart key={key} part={part} />
    }
    if (part.type === 'thinking') return showReasoning ? <ReasoningPart key={key} part={part} live={streaming} /> : null
    if (part.type === 'toolCall') {
      if (!showTools) return null
      const next = parts[index + 1]
      if (next?.type === 'toolResult') pairedResults.add(index + 1)
      if (next?.type !== 'toolResult' || next.streaming) pendingKeys.add(key)
      const result = next?.type === 'toolResult' ? next : undefined
      if (part.name === 'todo_write') return <TodoStep key={key} part={part} />
      if (isSubagentTool(part.name)) return <SubagentLane key={key} part={part} result={result} followUps={followUps.get(part)} />
      if (result && !result.streaming && isExploreTool(part.name)) runMembers.set(key, { failed: Boolean(result.isError), search: SEARCH_TOOLS.test(part.name), label: exploreLabel(part) })
      return <ToolPart key={key} part={part} result={result} />
    }
    if (part.type === 'toolResult') return showTools ? <StandaloneToolResult key={key} part={part} /> : null
    if (part.type === 'agentMessage') return <AgentActivityPart key={key} part={part} />
    if (part.type === 'text') return <div className="activity-line activity-line--note" key={key}><MarkdownText text={part.text} streaming={streaming} /></div>
    return null
  }).filter((row) => row !== null)
  // Back-to-back settled reads and searches fold into a single row; edits, commands, plans, and agents stay in the stream.
  const rows: ReactElement[] = []
  for (let index = 0; index < items.length;) {
    let end = index
    while (end < items.length && runMembers.has(String(items[end].key))) end += 1
    if (end - index >= 2) {
      const members = items.slice(index, end)
      rows.push(<ToolRun key={`run:${String(items[index].key)}`} members={members.map((row) => runMembers.get(String(row.key))!)}>{members}</ToolRun>)
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
    pages.push(<TimelinePage key={page[0].key} recent={recent} start={start + 1} count={page.length}>{page}</TimelinePage>)
  }
  return <div className="work-timeline" id={id}>{pages}</div>
}

const THINKING_STATUS_VERBS = [
  'Thinking',
  'Sounding',
  'Charting',
  'Fathoming',
  'Scouting',
  'Wayfinding',
  'Reckoning',
] as const

const WORKING_STATUS_VERBS = [
  'Working',
  'Cresting',
  'Slicing',
  'Surging',
  'Tacking',
  'Navigating',
  'Forging',
] as const

const STREAMING_STATUS_VERBS = [
  'working',
  'cresting',
  'slicing',
  'charting',
  'surging',
  'sounding',
  'navigating',
  'tacking',
  'forging',
] as const

export function LiveWorkVerb({ mode, prefix = '' }: { mode: 'Thinking' | 'Working' | 'streaming'; prefix?: string }) {
  const verbs = mode === 'Thinking' ? THINKING_STATUS_VERBS : mode === 'Working' ? WORKING_STATUS_VERBS : STREAMING_STATUS_VERBS
  const [index, setIndex] = useState(0)
  useEffect(() => {
    setIndex(0)
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % verbs.length)
    }, 2_600)
    return () => window.clearInterval(id)
  }, [verbs])
  const word = verbs[index] ?? verbs[0]
  return <>
    <span className="sr-only">{`${prefix}${verbs[0]}`}</span>
    <span key={word} className="live-work-verb" aria-hidden="true">{`${prefix}${word}`}</span>
  </>
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

/** The live run ledger: the turn's chronological stream (`children`) with the status row beneath it. */
export function WorkDisclosure({ message, showReasoning, showTools, children }: { message: TranscriptMessage; showReasoning: boolean; showTools: boolean; children?: ReactNode }) {
  const activity = showTools ? activeWorkLabel(message.parts) : undefined
  return <section className="work-disclosure is-running" aria-label="Agent work activity">
    <div className="work-disclosure__live">
      {children}
      <div className="work-disclosure__status" role="status">
        {activity ? <span className="work-disclosure__activity" title={activity}>{activity}</span> : <LiveWorkVerb mode={liveWorkStatus(message.parts, showReasoning, showTools)} />}
        <LiveElapsed since={message.startedAt ?? message.timestamp} /><ThinkingDots />
      </div>
    </div>
  </section>
}
