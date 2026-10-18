import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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

function toolPreview(part: Extract<MessagePart, { type: 'toolCall' }>): string {
  const raw = part.args
  if (raw && typeof raw === 'object') {
    const args = raw as Record<string, unknown>
    if (part.name === 'todo_write' && Array.isArray(args.todos)) {
      const total = args.todos.length
      const done = args.todos.filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).status === 'completed').length
      const active = args.todos.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).status === 'in_progress') as Record<string, unknown> | undefined
      const label = typeof active?.content === 'string' ? ` · ${active.content}` : ''
      return boundText(`${done}/${total} done${label}`.replace(/\s+/g, ' ').trim(), 180, '…')
    }
    if ((part.name === 'task' || part.name === 'task_start') && typeof args.agent === 'string') {
      const promptText = typeof args.prompt === 'string' ? `: ${args.prompt}` : ''
      return boundText(`${args.agent}${promptText}`.replace(/\s+/g, ' ').trim(), 180, '…')
    }
    if (part.name === 'task_chain' && Array.isArray(args.steps)) {
      const steps = args.steps.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).agent === 'string'))
      if (steps.length > 0) {
        const agents = steps.map((step) => String(step.agent)).join(' → ')
        const firstPrompt = typeof steps[0]?.prompt === 'string' ? `: ${steps[0].prompt}` : ''
        return boundText(`${agents}${firstPrompt}`.replace(/\s+/g, ' ').trim(), 180, '…')
      }
    }
    if (part.name === 'task_send' && typeof args.id === 'string') {
      const mode = typeof args.mode === 'string' ? ` (${args.mode})` : ''
      const messageText = typeof args.message === 'string' ? `: ${args.message}` : ''
      return boundText(`${args.id}${mode}${messageText}`.replace(/\s+/g, ' ').trim(), 180, '…')
    }
    const preferred = args.question ?? args.command ?? args.query ?? args.pattern ?? args.url ?? args.path ?? args.operation ?? args.id ?? args.action ?? args.code ?? args.cwd
    if (typeof preferred === 'string') return boundText(preferred.replace(/\s+/g, ' ').trim(), 180, '…')
  }
  return boundText(serialize(raw).replace(/\s+/g, ' ').trim(), 180, '…')
}

function ReasoningPart({ part, streaming = false }: { part: Extract<MessagePart, { type: 'thinking' }>; streaming?: boolean }) {
  return <div className="activity-line activity-line--reasoning"><MarkdownText text={boundText(part.text, 40_000, '\n… [Reasoning truncated in the desktop view.]')} streaming={streaming} /></div>
}

export function ThinkingDots({ labelled = false }: { labelled?: boolean }) {
  // Option 2 ("Woodblock Breaking Curl" + cruising shark fin):
  // Layered Ukiyo-e asymmetric breaking waves in the palette of PiWelcomeMark,
  // with a dorsal fin that periodically surfaces and glides between the swells.
  const [sharkPass, setSharkPass] = useState<{ key: number; top: number; durationMs: number; reverse: boolean } | null>(null)
  useEffect(() => {
    let activeTimer: number | undefined
    let nextTimer: number | undefined
    const scheduleNext = (initial = false) => {
      const delayMs = initial ? 450 + Math.floor(Math.random() * 900) : 2_400 + Math.floor(Math.random() * 3_400)
      nextTimer = window.setTimeout(() => {
        const durationMs = 2_200 + Math.floor(Math.random() * 900)
        const top = Number((-0.7 + Math.random() * 1.4).toFixed(2))
        const reverse = Math.random() < 0.28
        setSharkPass((previous) => ({ key: (previous?.key ?? 0) + 1, top, durationMs, reverse }))
        activeTimer = window.setTimeout(() => {
          setSharkPass(null)
          scheduleNext(false)
        }, durationMs)
      }, delayMs)
    }
    scheduleNext(true)
    return () => {
      if (nextTimer !== undefined) window.clearTimeout(nextTimer)
      if (activeTimer !== undefined) window.clearTimeout(activeTimer)
    }
  }, [])
  return (
    <span className="thinking-dots" role={labelled ? 'status' : undefined} aria-label={labelled ? 'Prime is thinking' : undefined} aria-hidden={labelled ? undefined : true}>
      <svg className="thinking-dots__wave" viewBox="0 0 32 18" fill="none" focusable="false" aria-hidden="true">
        {/* Back horizon woodblock swell (period = 16) */}
        <g className="thinking-dots__wave-swell">
          <path
            className="thinking-dots__mound-fill"
            d="M-16 11.2 C-12.5 11.2 -10.2 6.2 -6.5 6.2 C-3.2 6.2 -2.2 11.2 0 11.2 C3.5 11.2 5.8 6.2 9.5 6.2 C12.8 6.2 13.8 11.2 16 11.2 C19.5 11.2 21.8 6.2 25.5 6.2 C28.8 6.2 29.8 11.2 32 11.2 C35.5 11.2 37.8 6.2 41.5 6.2 C44.8 6.2 45.8 11.2 48 11.2 L48 20 L-16 20 Z"
          />
          <path
            className="thinking-dots__ring-back-outer"
            d="M-16 11.2 C-12.5 11.2 -10.2 6.2 -6.5 6.2 C-3.2 6.2 -2.2 11.2 0 11.2 C3.5 11.2 5.8 6.2 9.5 6.2 C12.8 6.2 13.8 11.2 16 11.2 C19.5 11.2 21.8 6.2 25.5 6.2 C28.8 6.2 29.8 11.2 32 11.2 C35.5 11.2 37.8 6.2 41.5 6.2 C44.8 6.2 45.8 11.2 48 11.2"
          />
          <path
            className="thinking-dots__ring-inner"
            d="M-16 13.1 C-12.5 13.1 -10.2 8.3 -6.5 8.3 C-3.2 8.3 -2.2 13.1 0 13.1 C3.5 13.1 5.8 8.3 9.5 8.3 C12.8 8.3 13.8 13.1 16 13.1 C19.5 13.1 21.8 8.3 25.5 8.3 C28.8 8.3 29.8 13.1 32 13.1 C35.5 13.1 37.8 8.3 41.5 8.3 C44.8 8.3 45.8 13.1 48 13.1"
          />
        </g>

        {/* Dorsal fin that randomly surfaces and slices across the water */}
        <g
          key={sharkPass?.key ?? 0}
          className={`thinking-dots__shark ${sharkPass ? (sharkPass.reverse ? 'is-cruising-reverse' : 'is-cruising') : ''}`}
          style={sharkPass ? { animationDuration: `${sharkPass.durationMs}ms`, '--shark-y': `${sharkPass.top}px` } as CSSProperties : undefined}
        >
          <path
            className="thinking-dots__fin"
            d="M-5.5 14.2 C-4.4 9.2 -1.6 5.2 2.8 3.5 C1.3 6.3 1.0 9.1 2.1 11.8 L-5.5 14.2 Z"
          />
          <path
            className="thinking-dots__fin-bevel"
            d="M-3.5 12.6 C-2.6 9.2 -0.5 6.2 2.0 4.5"
          />
        </g>

        {/* Foreground woodblock breaking wave with layered contour ribs (period = 16) */}
        <g className="thinking-dots__wave-main">
          <path
            className="thinking-dots__mound-fill"
            d="M-16 14.2 C-12.0 14.2 -9.4 7.6 -5.0 7.6 C-1.8 7.6 -1.4 14.2 0 14.2 C4.0 14.2 6.6 7.6 11.0 7.6 C14.2 7.6 14.6 14.2 16 14.2 C20.0 14.2 22.6 7.6 27.0 7.6 C30.2 7.6 30.6 14.2 32 14.2 C36.0 14.2 38.6 7.6 43.0 7.6 C46.2 7.6 46.6 14.2 48 14.2 L48 22 L-16 22 Z"
          />
          <path
            className="thinking-dots__ring-crest"
            d="M-16 14.2 C-12.0 14.2 -9.4 7.6 -5.0 7.6 C-1.8 7.6 -1.4 14.2 0 14.2 C4.0 14.2 6.6 7.6 11.0 7.6 C14.2 7.6 14.6 14.2 16 14.2 C20.0 14.2 22.6 7.6 27.0 7.6 C30.2 7.6 30.6 14.2 32 14.2 C36.0 14.2 38.6 7.6 43.0 7.6 C46.2 7.6 46.6 14.2 48 14.2"
          />
          <path
            className="thinking-dots__ring-mid"
            d="M-16 16.2 C-12.0 16.2 -9.4 9.8 -5.0 9.8 C-1.8 9.8 -1.4 16.2 0 16.2 C4.0 16.2 6.6 9.8 11.0 9.8 C14.2 9.8 14.6 16.2 16 16.2 C20.0 16.2 22.6 9.8 27.0 9.8 C30.2 9.8 30.6 16.2 32 16.2 C36.0 16.2 38.6 9.8 43.0 9.8 C46.2 9.8 46.6 16.2 48 16.2"
          />
          <path
            className="thinking-dots__ring-inner"
            d="M-16 18.1 C-12.0 18.1 -9.4 12.0 -5.0 12.0 C-1.8 12.0 -1.4 18.1 0 18.1 C4.0 18.1 6.6 12.0 11.0 12.0 C14.2 12.0 14.6 18.1 16 18.1 C20.0 18.1 22.6 12.0 27.0 12.0 C30.2 12.0 30.6 18.1 32 18.1 C36.0 18.1 38.6 12.0 43.0 12.0 C46.2 12.0 46.6 18.1 48 18.1"
          />
        </g>

        {/* Ukiyo-e foam hooks & sea-spray droplets along the breaking crests (period = 16) */}
        <g className="thinking-dots__wave-crest">
          {[-5, 11, 27, 43].map((cx) => (
            <g key={`spray-${cx}`}>
              <circle className="thinking-dots__spray-bright" cx={cx + 1.9} cy="6.3" r="0.7" />
              <circle className="thinking-dots__spray-cyan" cx={cx + 3.2} cy="7.6" r="0.52" />
            </g>
          ))}
        </g>
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

export function WorkTimeline({ parts, showReasoning, showTools, streaming = false }: { parts: MessagePart[]; showReasoning: boolean; showTools: boolean; streaming?: boolean }) {
  const pairedResults = new Set<number>()
  const pendingKeys = new Set<string>()
  const rows = parts.map((part, index) => {
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
      return <ToolPart key={key} part={part} result={next?.type === 'toolResult' ? next : undefined} />
    }
    if (part.type === 'toolResult') return showTools ? <StandaloneToolResult key={key} part={part} /> : null
    if (part.type === 'agentMessage') return <AgentActivityPart key={key} part={part} />
    if (part.type === 'text') return <div className="activity-line activity-line--note" key={key}><MarkdownText text={part.text} streaming={streaming} /></div>
    return null
  }).filter((row) => row !== null)
  const pages = []
  const pageCount = Math.ceil(rows.length / TIMELINE_PAGE_SIZE)
  for (let index = 0; index < pageCount; index++) {
    const start = index * TIMELINE_PAGE_SIZE
    const page = rows.slice(start, start + TIMELINE_PAGE_SIZE)
    const recent = index >= pageCount - RECENT_TIMELINE_PAGES || page.some((row) => row.key !== null && pendingKeys.has(String(row.key)))
    pages.push(<TimelinePage key={page[0].key} recent={recent} start={start + 1} count={page.length}>{page}</TimelinePage>)
  }
  return <div className="work-timeline">{pages}</div>
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

/** `children` is the live answer streaming after the work; it renders between the timeline and the status row. */
export function WorkDisclosure({ message, parts, showReasoning, showTools, running = message.streaming, children }: { message: TranscriptMessage; parts: MessagePart[]; showReasoning: boolean; showTools: boolean; running?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (running) {
    const status = liveWorkStatus(message.parts, showReasoning, showTools)
    return <section className="work-disclosure is-running" aria-label="Agent work activity">
      <span className="work-disclosure__rail" aria-hidden="true" />
      <div className="work-disclosure__live">
        <WorkTimeline parts={parts} showReasoning={showReasoning} showTools={showTools} streaming />
        {children}
        <div className="work-disclosure__status" role="status"><LiveWorkVerb mode={status} /><LiveElapsed since={message.startedAt ?? message.timestamp} /><ThinkingDots /></div>
      </div>
    </section>
  }
  const startedAt = timestamp(message.startedAt ?? message.timestamp) ?? 0
  const completedAt = timestamp(message.completedAt) ?? startedAt
  const duration = formatWorkedDuration(Math.max(0, completedAt - startedAt))
  const steps = parts.filter((part) => (part.type === 'toolCall' && showTools) || part.type === 'agentMessage' || part.type === 'compaction').length
  return (
    <section className="work-disclosure">
      <button type="button" className="work-disclosure__button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <CaretRight className="disclosure-caret" size={13} /><span>Worked for {duration}{steps > 0 ? ` · ${steps} step${steps === 1 ? '' : 's'}` : ''}</span>
      </button>
      {open ? <WorkTimeline parts={parts} showReasoning={showReasoning} showTools={showTools} /> : null}
    </section>
  )
}
