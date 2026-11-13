import { useId, useState } from 'react'
import { Brain, CaretRight, WarningCircle, Wrench } from '../icons'
import type { MessagePart } from '@/types/api'
import { StatusMark } from '../activity/StatusMark'
import { isEditTool } from './edit-diff'
import { ImageParts } from './TranscriptImage'
import { isSubagentTool, type SubagentPairs } from './subagent-lane'
import { classifyTool, isExploreTool, SEARCH_TOOLS, WorkTimeline } from './timeline'

type ToolCall = Extract<MessagePart, { type: 'toolCall' }>

interface WorkGroupProps {
  parts: MessagePart[]
  showReasoning: boolean
  showTools: boolean
  /** The turn is still running; pending calls keep their live state. */
  streaming: boolean
  /** This is the turn's newest work: show only the current step, newest replacing older. */
  live: boolean
  subagents: SubagentPairs
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

/**
 * One run of agent work between narrative. Live, it shows the step in progress (each new step replaces the
 * last) under a summary of the finished ones; settled, it is a single summary row that expands to the full timeline.
 */
export function WorkGroup({ parts, showReasoning, showTools, streaming, live, subagents }: WorkGroupProps) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const steps = stepIndices(parts, showReasoning, showTools, subagents.absorbed)
  const timeline = (slice: MessagePart[]) => <WorkTimeline parts={slice} showReasoning={showReasoning} showTools={showTools} streaming={streaming} subagents={subagents} />
  if (!steps.length) return timeline(parts)

  const current = live ? steps.at(-1) : undefined
  const summarized = current === undefined ? steps : steps.slice(0, -1)
  const summary = summarizeWork(parts, summarized, streaming)
  const state = summary.failed ? 'is-error' : summary.running ? 'is-running' : 'is-done'
  const currentSlice = current === undefined ? [] : parts.slice(current)
  const foldedImages = open ? [] : partImages(current === undefined ? parts : parts.slice(0, current))

  return <div className={`work-group ${state}${live ? ' is-live' : ''}`}>
    {summarized.length ? <button type="button" className="work-group__summary" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => setOpen((value) => !value)}>
      <span className="activity-line__icon">{summary.running ? <StatusMark state="running" size={14} /> : summary.thoughtsOnly ? <Brain size={14} /> : <Wrench size={14} />}</span>
      <span className="work-group__label">{summary.label}</span>
      {summary.failed ? <span className="work-group__failed"><WarningCircle size={12} /> {summary.failed} failed</span> : null}
      <CaretRight className="disclosure-caret" size={13} />
    </button> : null}
    {open ? <div className="work-group__body" id={bodyId}>{timeline(parts)}</div> : null}
    <ImageParts images={foldedImages} />
    {!open && currentSlice.length ? <div className="work-group__current">{timeline(currentSlice)}</div> : null}
  </div>
}
