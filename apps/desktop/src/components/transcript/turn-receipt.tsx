import { useId, useState } from 'react'
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
  /** Present when the turn has a work log to reveal. */
  logOpen?: boolean
  logId?: string
  onToggleLog?(): void
  /** Workspace changes, shown on the latest settled turn only. */
  git?: GitStatus
}

/** The settled turn's closing line: outcome, scale of the work, and what it left in the working tree. */
export function TurnReceipt({ duration, failed = false, agents, tools, logOpen = false, logId, onToggleLog, git }: TurnReceiptProps) {
  const [diffOpen, setDiffOpen] = useState(false)
  const diffId = useId()
  const files = git?.files ?? []
  const { additions, deletions } = changeTotals(files)
  const facts = [duration, agents ? plural(agents, 'agent') : '', tools ? plural(tools, 'tool') : ''].filter(Boolean).join(' · ')
  return <div className={failed ? 'turn-receipt is-failed' : 'turn-receipt'}>
    <div className="turn-receipt__line">
      <span className="turn-receipt__outcome">{failed ? <WarningCircle size={12} /> : <Check size={12} />}<span className="sr-only">{failed ? 'Turn failed after' : 'Turn finished in'}</span> {facts}</span>
      {onToggleLog ? <button type="button" className="turn-receipt__action" aria-expanded={logOpen} aria-controls={logOpen ? logId : undefined} onClick={onToggleLog}>{logOpen ? 'Collapse log' : 'Expand log'}</button> : null}
    </div>
    {files.length ? <div className="turn-receipt__diff">
      <button type="button" className="turn-receipt__diff-summary" aria-expanded={diffOpen} aria-controls={diffOpen ? diffId : undefined} onClick={() => setDiffOpen((open) => !open)}>
        <span>{filesChangedLabel(files.length)}</span>
        <span className="diff-count diff-count--add">+{additions}</span>
        <span className="diff-count diff-count--remove">−{deletions}</span>
        <span className="turn-receipt__diff-toggle">{diffOpen ? 'Collapse' : 'Expand'}<CaretRight className="disclosure-caret" size={12} /></span>
      </button>
      {diffOpen ? <ChangedFilesList id={diffId} files={files} /> : null}
    </div> : null}
  </div>
}
