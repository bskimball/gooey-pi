import * as stylex from '@stylexjs/stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
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

function useInstantMotion(): boolean {
  return (
    Boolean(useReducedMotion()) ||
    (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) ||
    Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)
  )
}

/** The settled turn's one closing line: outcome, scale of the work, what it left in the working tree, and copy. */
export function TurnReceipt({ duration, failed = false, agents, tools, git, onReviewChanges, copy }: TurnReceiptProps) {
  const [diffOpen, setDiffOpen] = useState(false)
  const instant = useInstantMotion()
  const diffId = useId()
  const files = git?.files ?? []
  const { additions, deletions } = changeTotals(files)
  const lineCounts = git?.lineCounts !== false
  const facts: Array<{ key: string; node: ReactNode }> = [
    { key: 'outcome', node: <span className={`turn-receipt__outcome ${stylex.props(transcriptStyles.turnReceiptOutcome).className ?? ""}`}>{failed ? <WarningCircle size={12} /> : <Check size={12} />}<span className={`sr-only ${stylex.props(baseStyles.srOnly).className ?? ""}`}>{failed ? 'Turn failed after' : 'Turn finished in'}</span> {duration}</span> },
  ]
  if (agents) facts.push({ key: 'agents', node: <span>{plural(agents, 'agent')}</span> })
  if (tools) facts.push({ key: 'tools', node: <span>{plural(tools, 'tool')}</span> })
  if (files.length) {
    facts.push({ key: 'diff', node: <span className={`turn-receipt__diff ${stylex.props(transcriptStyles.turnReceiptDiff).className ?? ""}`}>
      <button type="button" className={`turn-receipt__action turn-receipt__diff-summary ${stylex.props(transcriptStyles.turnReceiptAction, transcriptStyles.turnReceiptDiffSummary).className ?? ""}`} aria-expanded={diffOpen} aria-controls={diffOpen ? diffId : undefined} onClick={() => setDiffOpen((open) => !open)}>
        {filesChangedLabel(files.length)}
        {lineCounts ? <>
          <span className={`diff-count diff-count--add ${stylex.props(transcriptStyles.diffCount, transcriptStyles.diffCountAdd).className ?? ""}`}>+{additions}</span>
          <span className={`diff-count diff-count--remove ${stylex.props(transcriptStyles.diffCount, transcriptStyles.diffCountRemove).className ?? ""}`}>−{deletions}</span>
        </> : null}
        <CaretRight className={`disclosure-caret ${stylex.props(transcriptStyles.disclosureCaret).className ?? ""}`} size={11} />
      </button>
      {onReviewChanges ? <button type="button" className={`turn-receipt__action turn-receipt__review ${stylex.props(transcriptStyles.turnReceiptAction, transcriptStyles.turnReceiptReview).className ?? ""}`} onClick={onReviewChanges}>Review</button> : null}
    </span> })
  }
  if (copy) facts.push({ key: 'copy', node: copy })
  return <motion.div
    className={[failed ? 'turn-receipt is-failed' : 'turn-receipt', stylex.props(transcriptStyles.turnReceipt).className].filter(Boolean).join(' ')}
    initial={instant ? false : { opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={instant ? { duration: 0 } : { duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
  >
    <div className={`turn-receipt__line ${stylex.props(transcriptStyles.turnReceiptLine).className ?? ""}`}>
      {facts.map((fact, index) => <Fragment key={fact.key}>{index ? <span className={`turn-receipt__separator ${stylex.props(transcriptStyles.turnReceiptSeparator).className ?? ""}`} aria-hidden="true">·</span> : null}{fact.node}</Fragment>)}
    </div>
    <AnimatePresence initial={false}>
      {diffOpen ? (
        <motion.div
          key="diff-list"
          style={{ overflow: 'hidden' }}
          initial={instant ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={instant ? undefined : { height: 0, opacity: 0, transition: { duration: 0.13, ease: [0.2, 0, 0, 1] } }}
          transition={instant ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
        >
          <ChangedFilesList id={diffId} files={files} lineCounts={lineCounts} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  </motion.div>
}
