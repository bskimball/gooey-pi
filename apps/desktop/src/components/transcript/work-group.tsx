import * as stylex from '@stylexjs/stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Brain, CaretRight, WarningCircle } from '../icons'
import type { MessagePart } from '@/types/api'
import { StatusMark } from '../activity/StatusMark'
import { isEditTool } from './edit-diff'
import { ImageParts } from './TranscriptImage'
import { isSubagentTool, type SubagentPairs } from './subagent-lane'
import { activeWorkLabel, classifyTool, isExploreTool, SEARCH_TOOLS, toolIcon, WorkTimeline } from './timeline'

type ToolCall = Extract<MessagePart, { type: 'toolCall' }>

interface WorkGroupProps {
  parts: MessagePart[]
  showReasoning: boolean
  showTools: boolean
  /** The turn is still running; pending calls keep their live state. */
  streaming: boolean
  /** This is the turn's newest work: summarize the current step without replacing narrative. */
  live: boolean
  subagents: SubagentPairs
  presentation?: 'summary' | 'current-step'
}

/** Indices of the parts that render as their own timeline row. */
function stepIndices(parts: MessagePart[], showReasoning: boolean, showTools: boolean, absorbed: Set<MessagePart>): number[] {
  const steps: number[] = []
  parts.forEach((part, index) => {
    if (absorbed.has(part)) return
    if (part.type === 'thinking') {
      if (showReasoning && part.text.trim()) steps.push(index)
    } else if (part.type === 'toolCall') {
      if (showTools) steps.push(index)
    } else if (part.type === 'toolResult') {
      if (showTools && parts[index - 1]?.type !== 'toolCall') steps.push(index)
    } else if (part.type === 'compaction' || part.type === 'agentMessage') steps.push(index)
  })
  return steps
}

/** Images stay in the chat when their steps fold away. */
function partImages(parts: MessagePart[]): Extract<MessagePart, { type: 'image' }>[] {
  return parts.flatMap((part) => part.type === 'image' ? [part] : part.type === 'toolResult' ? part.images ?? [] : [])
}

const plural = (count: number, noun: string, many = `${noun}s`) => `${count} ${count === 1 ? noun : many}`

function pathArg(part: ToolCall): string | undefined {
  const value = part.args && typeof part.args === 'object' ? (part.args as Record<string, unknown>).path : undefined
  return typeof value === 'string' ? value : undefined
}

interface WorkSummary { label: string; failed: number; running: boolean; thoughtsOnly: boolean }

function summarizeWork(parts: MessagePart[], steps: number[], streaming: boolean): WorkSummary {
  let thoughts = 0, searches = 0, commands = 0, tools = 0, questions = 0, messages = 0, compactions = 0, failed = 0
  let running = false
  const reads = new Set<string>()
  const edits = new Set<string>()
  for (const index of steps) {
    const part = parts[index]
    if (part.type === 'thinking') thoughts += 1
    else if (part.type === 'agentMessage') messages += 1
    else if (part.type === 'compaction') {
      compactions += 1
      if (part.status === 'running') running = true
      else if (part.status !== 'done') failed += 1
    } else if (part.type === 'toolResult') {
      tools += 1
      if (part.isError) failed += 1
    } else if (part.type === 'toolCall') {
      const next = parts[index + 1]
      const result = next?.type === 'toolResult' ? next : undefined
      if (result?.isError) failed += 1
      if (streaming && (!result || result.streaming)) running = true
      // Agent lanes render outside the group; a failed task_wait only adds to the failure count.
      if (isSubagentTool(part.name)) continue
      if (isEditTool(part.name)) edits.add(pathArg(part) ?? `${index}`)
      else if (isExploreTool(part.name)) {
        if (SEARCH_TOOLS.test(part.name)) searches += 1
        else reads.add(pathArg(part) ?? `${index}`)
      } else {
        const kind = classifyTool(part.name)
        if (kind === 'question') questions += 1
        else if (kind === 'terminal') commands += 1
        else tools += 1
      }
    }
  }
  const phrases: string[] = []
  if (thoughts) phrases.push('thought')
  if (reads.size) phrases.push(`read ${plural(reads.size, 'file')}`)
  if (searches) phrases.push(`ran ${plural(searches, 'search', 'searches')}`)
  if (edits.size) phrases.push(`edited ${plural(edits.size, 'file')}`)
  if (commands) phrases.push(`ran ${plural(commands, 'command')}`)
  if (tools) phrases.push(`used ${plural(tools, 'tool')}`)
  if (questions) phrases.push(`asked ${plural(questions, 'question')}`)
  if (messages) phrases.push(plural(messages, 'agent message'))
  if (compactions) phrases.push('compacted context')
  const sentence = phrases.join(', ') || 'worked'
  return { label: sentence[0].toUpperCase() + sentence.slice(1), failed, running, thoughtsOnly: thoughts > 0 && phrases.length === 1 }
}

/** Index of the pending tool call that activeWorkLabel describes; mirrors its scan. */
function activeToolIndex(parts: MessagePart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    const next = parts[index + 1]
    if (part.type === 'toolCall' && !(next?.type === 'toolResult' && !next.streaming)) return index
  }
  return -1
}

function useInstantMotion(): boolean {
  return (
    Boolean(useReducedMotion()) ||
    (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) ||
    Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)
  )
}

/** A tool-only disclosure between narrative boundaries; replies never enter its scroll region. */
export function WorkGroup({ parts, showReasoning, showTools, streaming, live, subagents, presentation = 'summary' }: WorkGroupProps) {
  const [open, setOpen] = useState(false)
  const instant = useInstantMotion()
  const bodyId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body || !open || presentation !== 'summary') return
    const follow = () => {
      if (following.current && live) body.scrollTop = body.scrollHeight
    }
    follow()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(follow)
    if (body.firstElementChild) observer.observe(body.firstElementChild)
    return () => observer.disconnect()
  }, [open, live, parts, presentation])
  const steps = stepIndices(parts, showReasoning, showTools, subagents.absorbed)
  const timeline = (slice: MessagePart[], foldPastThoughts = false) => <WorkTimeline parts={slice} showReasoning={showReasoning} showTools={showTools} streaming={foldPastThoughts ? live : streaming} subagents={subagents} foldPastThoughts={foldPastThoughts} />
  if (!steps.length) return timeline(parts)

  const current = presentation === 'current-step' && live ? steps.at(-1) : undefined
  const summarized = current === undefined ? steps : steps.slice(0, -1)
  const summary = summarizeWork(parts, summarized, streaming)
  const currentLabel = live && presentation === 'summary' ? activeWorkLabel(showTools ? parts : []) : undefined
  const latestStep = steps.at(-1)
  // Transition identity is the step, not its text: streamed args update the label in place.
  const labelKey = currentLabel !== undefined ? `tool-${activeToolIndex(parts)}` : live && latestStep !== undefined ? `step-${latestStep}` : 'settled'
  const label = currentLabel ?? (presentation === 'summary' && live && latestStep !== undefined && parts[latestStep].type === 'thinking' ? 'Thinking' : summary.label)
  const state = summary.failed ? 'is-error' : summary.running || live ? 'is-running' : 'is-done'
  const toolKinds = new Set(summarized.flatMap((index) => {
    const part = parts[index]
    if ((part.type === 'toolCall' || part.type === 'toolResult') && part.name) return [classifyTool(part.name)]
    return []
  }))
  const summaryKind = toolKinds.size === 1 ? [...toolKinds][0] : 'mcp'
  const iconKey = summary.running || live ? 'running' : summary.thoughtsOnly ? 'brain' : summaryKind
  const foldedImages = open ? [] : partImages(current === undefined ? parts : parts.slice(0, current))

  return <div className={[`work-group ${state}${live ? ' is-live' : ''}`, stylex.props(transcriptStyles.workGroup).className].filter(Boolean).join(' ')}>
    <AnimatePresence initial={false}>
      {summarized.length > 0 ? <motion.div
        key="summary"
        style={{ overflow: 'hidden' }}
        initial={instant ? false : { height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={instant ? undefined : { height: 0, opacity: 0, transition: { duration: 0.12, ease: [0.2, 0, 0, 1] } }}
        transition={instant ? { duration: 0 } : { duration: 0.17, ease: [0.23, 1, 0.32, 1] }}
      >
        <button type="button" className={`work-group__summary ${stylex.props(transcriptStyles.workGroupSummary).className ?? ""}`} aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => { following.current = true; setOpen((value) => !value) }}>
          <span className={`activity-line__icon ${stylex.props(transcriptStyles.activityLineIcon).className ?? ""}`}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={iconKey}
                style={{ display: 'inline-grid', placeItems: 'center' }}
                initial={instant ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={instant ? undefined : { opacity: 0, transition: { duration: 0.08, ease: [0.2, 0, 0, 1] } }}
                transition={instant ? { duration: 0 } : { duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
              >
                {summary.running || live ? <StatusMark state="running" size={14} /> : summary.thoughtsOnly ? <Brain size={14} /> : toolIcon(summaryKind)}
              </motion.span>
            </AnimatePresence>
          </span>
          <span style={{ position: 'relative', display: 'grid', minWidth: 0, overflow: 'hidden' }}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={labelKey}
                className={`work-group__label ${stylex.props(transcriptStyles.workGroupLabel).className ?? ""}`}
                title={label}
                initial={instant ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={instant ? undefined : { opacity: 0, y: -4, transition: { duration: 0.12, ease: [0.2, 0, 0, 1] } }}
                transition={instant ? { duration: 0 } : { duration: 0.17, ease: [0.23, 1, 0.32, 1] }}
              >
                {label}
              </motion.span>
            </AnimatePresence>
          </span>
          {summary.failed ? <span className={`work-group__failed ${stylex.props(transcriptStyles.workGroupFailed).className ?? ""}`}><WarningCircle size={12} /> {summary.failed} failed</span> : null}
          <CaretRight className={`disclosure-caret ${stylex.props(transcriptStyles.disclosureCaret).className ?? ""}`} size={13} />
        </button>
      </motion.div> : null}
    </AnimatePresence>
    <AnimatePresence initial={false}>
      {open ? <motion.div
        key="body"
        style={{ overflow: 'hidden' }}
        initial={instant ? false : { height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={instant ? undefined : { height: 0, opacity: 0, transition: { duration: 0.13, ease: [0.2, 0, 0, 1] } }}
        transition={instant ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
      >
        <div ref={bodyRef} className={`work-group__body ${stylex.props(transcriptStyles.workGroupBody, presentation === 'summary' && transcriptStyles.workGroupHistory).className ?? ""}`} data-tool-history={presentation === 'summary' ? '' : undefined} id={bodyId} role="region" aria-label="Tool activity history" tabIndex={0} onScroll={(event) => {
          const body = event.currentTarget
          following.current = body.scrollHeight - body.scrollTop - body.clientHeight <= 1
        }}>{timeline(parts, presentation === 'current-step' && showTools && parts.some((part) => part.type === 'toolCall' || part.type === 'toolResult'))}</div>
      </motion.div> : null}
    </AnimatePresence>
    <ImageParts images={foldedImages} />
    <AnimatePresence mode="popLayout" initial={false}>
      {!open && current !== undefined ? <motion.div
        key={`current-${current}`}
        className="work-group__current"
        style={{ overflow: 'hidden' }}
        initial={instant ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={instant ? undefined : { opacity: 0, y: -4, transition: { duration: 0.12, ease: [0.2, 0, 0, 1] } }}
        transition={instant ? { duration: 0 } : { duration: 0.17, ease: [0.23, 1, 0.32, 1] }}
      >
        {timeline(parts.slice(current))}
      </motion.div> : null}
    </AnimatePresence>
  </div>
}
