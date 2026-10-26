import { Fragment, useId, useState, type ReactNode } from 'react'
import { CaretRight, Check, WarningCircle } from '../icons'
import type { GitStatus, MessagePart } from '@/types/api'
import { ChangedFilesList, changeTotals, filesChangedLabel } from '../ChangedFiles'
import { isSubagentTool } from './subagent-lane'

export function workCounts(parts: MessagePart[]): { agents: number; tools: number } {
  let agents = 0
  let tools = 0
  for (const part of parts) {
    if (part.type !== 'toolCall') continue
    if (part.name === 'task' || part.name === 'task_start') agents += 1
    else if (part.name === 'task_chain') {
      const steps = (part.args as { steps?: unknown } | undefined)?.steps
      agents += Array.isArray(steps) ? steps.length : 1
    } else if (!isSubagentTool(part.name)) tools += 1
  }
  return { agents, tools }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

interface TurnReceiptProps {
  duration: string
  failed?: boolean
  agents: number
  tools: number
  /** Workspace changes, shown on the latest settled turn only. */
  git?: GitStatus
  onReviewChanges?(): void
  /** The turn's copy control, kept on the receipt line instead of a separate row. */
  copy?: ReactNode
}

/** The settled turn's one closing line: outcome, scale of the work, what it left in the working tree, and copy. */
export function TurnReceipt({ duration, failed = false, agents, tools, git, onReviewChanges, copy }: TurnReceiptProps) {
  const [diffOpen, setDiffOpen] = useState(false)
  const diffId = useId()
  const files = git?.files ?? []
  const { additions, deletions } = changeTotals(files)
  const facts: Array<{ key: string; node: ReactNode }> = [
    { key: 'outcome', node: <span className="turn-receipt__outcome">{failed ? <WarningCircle size={12} /> : <Check size={12} />}<span className="sr-only">{failed ? 'Turn failed after' : 'Turn finished in'}</span> {duration}</span> },
  ]
  if (agents) facts.push({ key: 'agents', node: <span>{plural(agents, 'agent')}</span> })
  if (tools) facts.push({ key: 'tools', node: <span>{plural(tools, 'tool')}</span> })
  if (files.length) {
    facts.push({ key: 'diff', node: <span className="turn-receipt__diff">
      <button type="button" className="turn-receipt__action turn-receipt__diff-summary" aria-expanded={diffOpen} aria-controls={diffOpen ? diffId : undefined} onClick={() => setDiffOpen((open) => !open)}>
        {filesChangedLabel(files.length)}
        <span className="diff-count diff-count--add">+{additions}</span>
        <span className="diff-count diff-count--remove">−{deletions}</span>
        <CaretRight className="disclosure-caret" size={11} />
      </button>
      {onReviewChanges ? <button type="button" className="turn-receipt__action turn-receipt__review" onClick={onReviewChanges}>Review</button> : null}
    </span> })
  }
  if (copy) facts.push({ key: 'copy', node: copy })
  return <div className={failed ? 'turn-receipt is-failed' : 'turn-receipt'}>
    <div className="turn-receipt__line">
      {facts.map((fact, index) => <Fragment key={fact.key}>{index ? <span className="turn-receipt__separator" aria-hidden="true">·</span> : null}{fact.node}</Fragment>)}
    </div>
    {diffOpen ? <ChangedFilesList id={diffId} files={files} /> : null}
  </div>
}
