import { useState } from 'react'
import type { MessagePart } from '@/types/api'

type ToolCall = Extract<MessagePart, { type: 'toolCall' }>
type ToolResult = Extract<MessagePart, { type: 'toolResult' }>

export interface DiffLine { kind: 'add' | 'remove' | 'context' | 'gap'; text: string }

const PREVIEW_LINES = 10
/** Bounds the DOM for very large writes; the line counts still cover the whole change. */
const MAX_RENDERED_LINES = 1_000

export const isEditTool = (name: string) => /^(?:edit|write)$/i.test(name)

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

const lines = (value: string) => value.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')

/** Parses a unified diff string, dropping file headers; hunk markers read as gaps. */
function parseDiff(diff: string): DiffLine[] {
  return lines(diff).flatMap((line): DiffLine[] => {
    if (line.startsWith('+++') || line.startsWith('---')) return []
    if (line.startsWith('@@')) return [{ kind: 'gap', text: line }]
    if (line.startsWith('+')) return [{ kind: 'add', text: line.slice(1) }]
    if (line.startsWith('-')) return [{ kind: 'remove', text: line.slice(1) }]
    return [{ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line }]
  })
}

/** Line diff of one replacement: shared head and tail collapse to one line of context on each side. */
function replacementDiff(oldText: string, newText: string): DiffLine[] {
  const before = oldText ? lines(oldText) : []
  const after = newText ? lines(newText) : []
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1
  let tail = 0
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1
  return [
    ...(head ? [{ kind: 'context' as const, text: before[head - 1] }] : []),
    ...before.slice(head, before.length - tail).map((text) => ({ kind: 'remove' as const, text })),
    ...after.slice(head, after.length - tail).map((text) => ({ kind: 'add' as const, text })),
    ...(tail ? [{ kind: 'context' as const, text: before[before.length - tail] }] : []),
  ]
}

/** The change an edit or write call made, from the tool's own diff when it reported one, else from its arguments. */
export function editDiffLines(part: ToolCall, result?: ToolResult): DiffLine[] {
  const diff = record(result?.details)?.diff
  if (typeof diff === 'string' && diff.trim()) return parseDiff(diff)
  const args = record(part.args)
  if (!args) return []
  if (/^write$/i.test(part.name)) return typeof args.content === 'string' ? replacementDiff('', args.content) : []
  const edits = Array.isArray(args.edits) ? args.edits.map(record) : [args]
  return edits.flatMap((edit, index) => {
    if (typeof edit?.oldText !== 'string' || typeof edit.newText !== 'string') return []
    const change = replacementDiff(edit.oldText, edit.newText)
    return index && change.length ? [{ kind: 'gap' as const, text: '⋯' }, ...change] : change
  })
}

export function diffCounts(diff: DiffLine[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of diff) {
    if (line.kind === 'add') additions += 1
    else if (line.kind === 'remove') deletions += 1
  }
  return { additions, deletions }
}

const SIGNS: Record<DiffLine['kind'], string> = { add: '+', remove: '−', context: ' ', gap: ' ' }

export function EditDiff({ diff, id }: { diff: DiffLine[]; id?: string }) {
  const [expanded, setExpanded] = useState(false)
  const shown = diff.slice(0, expanded ? MAX_RENDERED_LINES : PREVIEW_LINES)
  return <div className="activity-edit-diff" id={id}>
    <pre className="activity-edit-diff__lines">
      {shown.map((line, index) => <span key={index} className={`activity-edit-diff__line is-${line.kind}`}>
        <span className="activity-edit-diff__sign" aria-hidden="true">{SIGNS[line.kind]}</span>
        <span className="sr-only">{line.kind === 'add' ? 'added: ' : line.kind === 'remove' ? 'removed: ' : ''}</span>
        {line.text || ' '}
      </span>)}
    </pre>
    {diff.length > PREVIEW_LINES && !expanded ? <button type="button" className="activity-edit-diff__more" onClick={() => setExpanded(true)}>Show all {diff.length} diff lines ▸</button> : null}
    {expanded && diff.length > MAX_RENDERED_LINES ? <p className="activity-edit-diff__note">{diff.length - MAX_RENDERED_LINES} more lines not shown</p> : null}
  </div>
}
