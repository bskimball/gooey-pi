import { memo, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
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
import { isSubagentTool, SubagentLane, TodoStep } from './subagent-lane'

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

/** Settled calls that read as one batch of work when they run back to back. */
type ToolRunKind = 'read' | 'edit' | 'terminal' | 'web' | 'git'

function toolRunKind(name: string): ToolRunKind | undefined {
  const kind = classifyTool(name)
  if (kind === 'terminal' || kind === 'web' || kind === 'git') return kind
  if (kind === 'file') return /write|edit|patch/i.test(name) ? 'edit' : 'read'
  if (kind === 'mcp' && /grep|find|glob|^ls$/i.test(name)) return 'read'
  return undefined
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

function toolRunLabel(kind: ToolRunKind, count: number): string {
  if (kind === 'read') return `Read ${plural(count, 'file')}`
  if (kind === 'edit') return `Edited ${plural(count, 'file')}`
  if (kind === 'terminal') return `Ran ${plural(count, 'command')}`
  if (kind === 'web') return plural(count, 'web lookup')
  return plural(count, 'git operation')
}

function ToolRun({ kind, failed, children }: { kind: ToolRunKind; failed: number; children: ReactElement[] }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  return (
    <div className={`activity-run activity-line--${kind === 'read' || kind === 'edit' ? 'file' : kind} ${failed ? 'is-error' : 'is-done'}`}>
      <button type="button" className="activity-run__summary" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => setOpen((value) => !value)}>
        <span className="activity-line__icon">{toolIcon(kind === 'read' || kind === 'edit' ? 'file' : kind)}</span>
        <span className="activity-run__label">{toolRunLabel(kind, children.length)}</span>
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

function ReasoningPart({ part, streaming = false }: { part: Extract<MessagePart, { type: 'thinking' }>; streaming?: boolean }) {
  return <div className="activity-line activity-line--reasoning"><MarkdownText text={boundText(part.text, 40_000, '\n… [Reasoning truncated in the desktop view.]')} streaming={streaming} /></div>
}

export function ThinkingDots({ labelled = false }: { labelled?: boolean }) {
  // One ink line, two periods wide, sliding one period per loop so the seam never shows.
  return (
    <span className="thinking-dots" role={labelled ? 'status' : undefined} aria-label={labelled ? 'Pi is thinking' : undefined} aria-hidden={labelled ? undefined : true}>
      <svg viewBox="0 0 18 8" fill="none" focusable="false" aria-hidden="true">
        <path d="M0 4 Q2.25 1 4.5 4 T9 4 T13.5 4 T18 4 T22.5 4 T27 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
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
function outputTail(output: string, lines = 4): string {
  return output.slice(-4_000).trimEnd().split('\n').slice(-lines).join('\n')
}

const ToolPart = memo(function ToolPart({ part, result }: { part: Extract<MessagePart, { type: 'toolCall' }>; result?: Extract<MessagePart, { type: 'toolResult' }> }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const resetCopiedTimerRef = useRef<number | null>(null)
  const failed = result?.isError
  const finished = result && !result.streaming
  const kind = classifyTool(part.name)
  const output = result?.text ?? ''
  const visibleOutput = useMemo(() => {
    if (!open) return ''
    const args = serialize(part.args, true)
    return boundText(`${args}${args && output ? '\n\n' : ''}${output}`, 200_000, '\n\n[Output truncated in the desktop view.]')
  }, [open, part.args, output])
  const canExpand = Boolean(output || part.args !== undefined && part.args !== '')
  const state = failed ? 'error' : finished ? 'done' : kind === 'question' ? 'waiting' : 'running'
  const preview = toolPreview(part)
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
    <div className={`activity-line activity-line--tool activity-line--${kind} is-${state}`}>
      <button type="button" className="activity-tool__summary" disabled={!canExpand} onClick={() => setOpen((value) => !value)} aria-expanded={canExpand ? open : undefined}>
        <span className="activity-line__icon">{toolIcon(kind)}</span>
        <span className="activity-line__kind">{kind === 'question' ? 'Question' : part.name}</span>
        {preview ? <code className="activity-tool__preview"><SyntaxText text={preview} /></code> : null}
        <span className="activity-tool__state">{failed ? <><WarningCircle size={12} /> failed</> : finished ? <><Check size={12} /> done</> : kind === 'question' ? 'needs input' : <><CircleNotch className="spin" size={12} /> running</>}</span>
        {canExpand ? <CaretRight className="disclosure-caret" size={13} /> : null}
      </button>
      {state === 'running' && !open && output.trim() ? <pre className="activity-tool__tail">{outputTail(output)}</pre> : null}
      {open && visibleOutput ? (
        <div className="activity-tool__details">
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

export function WorkTimeline({ id, parts, showReasoning, showTools, streaming = false }: { id?: string; parts: MessagePart[]; showReasoning: boolean; showTools: boolean; streaming?: boolean }) {
  const pairedResults = new Set<number>()
  const pendingKeys = new Set<string>()
  const runKinds = new Map<string, { kind: ToolRunKind; failed: boolean }>()
  const items = parts.map((part, index) => {
    const key = partKey(part, index)
    if (part.type === 'toolResult' && pairedResults.has(index)) return null
    if (part.type === 'compaction') {
      if (part.status === 'running') pendingKeys.add(key)
      return <CompactionPart key={key} part={part} />
    }
    if (part.type === 'thinking') return showReasoning ? <ReasoningPart key={key} part={part} streaming={streaming} /> : null
    if (part.type === 'toolCall') {
      if (!showTools) return null
      const next = parts[index + 1]
      if (next?.type === 'toolResult') pairedResults.add(index + 1)
      if (next?.type !== 'toolResult' || next.streaming) pendingKeys.add(key)
      const result = next?.type === 'toolResult' ? next : undefined
      if (part.name === 'todo_write') return <TodoStep key={key} part={part} />
      if (isSubagentTool(part.name)) return <SubagentLane key={key} part={part} result={result} />
      const runKind = result && !result.streaming ? toolRunKind(part.name) : undefined
      if (runKind) runKinds.set(key, { kind: runKind, failed: Boolean(result?.isError) })
      return <ToolPart key={key} part={part} result={result} />
    }
    if (part.type === 'toolResult') return showTools ? <StandaloneToolResult key={key} part={part} /> : null
    if (part.type === 'agentMessage') return <AgentActivityPart key={key} part={part} />
    if (part.type === 'text') return <div className="activity-line activity-line--note" key={key}><MarkdownText text={part.text} streaming={streaming} /></div>
    return null
  }).filter((row) => row !== null)
  // Back-to-back settled calls of one kind fold into a single row; running, question, plan, and subagent rows stay lifted out.
  const rows: ReactElement[] = []
  for (let index = 0; index < items.length;) {
    const run = runKinds.get(String(items[index].key))
    let end = index + 1
    while (run && end < items.length && runKinds.get(String(items[end].key))?.kind === run.kind) end += 1
    if (run && end - index >= 2) {
      const members = items.slice(index, end)
      const failed = members.filter((row) => runKinds.get(String(row.key))?.failed).length
      rows.push(<ToolRun key={`run:${String(items[index].key)}`} kind={run.kind} failed={failed}>{members}</ToolRun>)
    } else rows.push(...items.slice(index, end))
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

/**
 * The live run ledger. `children` is the answer streaming after the work; it renders between the timeline and the status row.
 * Settled turns hide the ledger behind their receipt instead.
 */
export function WorkDisclosure({ message, parts, showReasoning, showTools, children }: { message: TranscriptMessage; parts: MessagePart[]; showReasoning: boolean; showTools: boolean; children?: ReactNode }) {
  const activity = showTools ? activeWorkLabel(message.parts) : undefined
  return <section className="work-disclosure is-running" aria-label="Agent work activity">
    <span className="work-disclosure__rail" aria-hidden="true" />
    <div className="work-disclosure__live">
      <WorkTimeline parts={parts} showReasoning={showReasoning} showTools={showTools} streaming />
      {children}
      <div className="work-disclosure__status" role="status">
        {activity ? <span className="work-disclosure__activity" title={activity}>{activity}</span> : <LiveWorkVerb mode={liveWorkStatus(message.parts, showReasoning, showTools)} />}
        <LiveElapsed since={message.startedAt ?? message.timestamp} /><ThinkingDots />
      </div>
    </div>
  </section>
}
