import * as stylex from '@stylexjs/stylex'
import type { useTaskWorkflows } from '@/hooks/useTaskWorkflows'
import { ArrowUUpLeft, ChatCircleDots, CheckCircle } from './icons'
import { ApexButton } from './ui'

type Workflow = ReturnType<typeof useTaskWorkflows>

const SIDE_DISCLAIMER = 'A separate thread you control, not a specialist. Tool restrictions are not an OS sandbox.'

const styles = stylex.create({
  finished: {
    display: 'inline-flex', alignItems: 'center', gap: 3, height: 20, paddingInline: 6,
    borderRadius: 999, color: 'var(--text-secondary)', backgroundColor: 'var(--surface-subtle)',
    fontSize: 'var(--fs-micro)', fontWeight: 500, whiteSpace: 'nowrap',
  },
  notice: {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 32, paddingBlock: 4, paddingInline: 16,
    borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border-subtle)',
    color: 'var(--text-secondary)', fontSize: 'var(--fs-micro)',
  },
  sidePill: {
    display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, paddingInline: 7, borderRadius: 999,
    color: 'var(--text)', backgroundColor: 'var(--apex-soft)', fontWeight: 550, whiteSpace: 'nowrap',
  },
  muted: { color: 'var(--text-tertiary)' },
  spacer: { flexGrow: 1 },
  error: { color: 'var(--danger)', overflowWrap: 'anywhere' },
})

export function TaskWorkflowFinished({ workflow }: { workflow: Workflow }) {
  const sessionFile = workflow.context.sessionFile
  if (!sessionFile || !workflow.context.finished.has(sessionFile)) return null
  return <span role="status" title="Task finished" {...stylex.props(styles.finished)}><CheckCircle size={11} /> Finished</span>
}

/** A slim strip that only exists while a side conversation is open or a task action needs feedback. */
export function TaskWorkflowNotice({ workflow }: { workflow: Workflow }) {
  if (!workflow.context.sessionFile || (!workflow.side && !workflow.pending && !workflow.error)) return null
  return <div {...stylex.props(styles.notice)}>
    {workflow.side ? <>
      <span title={SIDE_DISCLAIMER} {...stylex.props(styles.sidePill)}><ChatCircleDots size={12} /> Side conversation · read/search-only tools<span className="sr-only">. {SIDE_DISCLAIMER}</span></span>
      <span {...stylex.props(styles.muted)}>Select a reply to bring it back.</span>
    </> : null}
    {workflow.pending ? <span role="status">Preparing task action…</span> : null}
    {workflow.error ? <span role="alert" {...stylex.props(styles.error)}>{workflow.error}</span> : null}
    <span {...stylex.props(styles.spacer)} />
    {workflow.side ? <ApexButton compact variant="quiet" icon={<ArrowUUpLeft size={12} />} disabled={workflow.pending} onClick={() => workflow.navigate(workflow.side!.parentSession)}>Open parent</ApexButton> : null}
  </div>
}
