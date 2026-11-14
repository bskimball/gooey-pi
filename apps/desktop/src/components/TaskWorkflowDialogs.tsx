import { useEffect, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { FinishReview, RunHistoricalContent, RunHistoricalFile } from '@/types/api'
import type { useTaskWorkflows } from '@/hooks/useTaskWorkflows'
import { errorMessage } from '@/lib/errors'
import { boundLines } from '@/lib/render-bounds'
import { ApexButton, Modal } from './ui'
import { ContextExcerpt } from './ContextExcerpt'

type Workflow = ReturnType<typeof useTaskWorkflows>
type Tone = 'ok' | 'attention' | 'unknown'

const styles = stylex.create({
  intro: { color: 'var(--text-secondary)' },
  headline: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 },
  rows: {
    display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) minmax(0, 1fr)', columnGap: 16, margin: 0,
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border-subtle)', borderRadius: 'var(--radius-md)',
  },
  row: {
    display: 'contents',
  },
  label: {
    display: 'flex', alignItems: 'baseline', gap: 8, paddingBlock: 8, paddingInlineStart: 12,
    color: 'var(--text-secondary)', fontSize: 'var(--fs-ui)', fontWeight: 550, whiteSpace: 'nowrap',
  },
  value: { minWidth: 0, margin: 0, paddingBlock: 8, paddingInlineEnd: 12, fontSize: 'var(--fs-ui)', overflowWrap: 'anywhere' },
  divided: { borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border-subtle)' },
  dot: { flexShrink: 0, width: 7, height: 7, borderRadius: 999, transform: 'translateY(-1px)' },
  ok: { backgroundColor: 'var(--success)' },
  attention: { backgroundColor: 'var(--warning)' },
  unknown: { backgroundColor: 'var(--text-tertiary)' },
  note: { color: 'var(--text-tertiary)', fontSize: 'var(--fs-micro)' },
  list: { display: 'grid', gap: 2, marginBlock: 4, marginInline: 0, paddingInlineStart: 16 },
  callout: {
    paddingBlock: 8, paddingInline: 12, borderRadius: 'var(--radius-md)',
    color: 'var(--text)', backgroundColor: 'var(--surface-subtle)', fontSize: 'var(--fs-ui)',
  },
  section: { display: 'grid', gap: 4 },
  sectionTitle: { color: 'var(--text-secondary)', fontSize: 'var(--fs-ui)', fontWeight: 600 },
  disclosure: { color: 'var(--text-secondary)', fontSize: 'var(--fs-ui)' },
  summary: { minHeight: 28, paddingBlock: 4, cursor: 'pointer' },
  inlineSummary: { cursor: 'pointer' },
  details: { display: 'grid', gap: 6, paddingBlockStart: 6, paddingInlineStart: 16 },
})

function Row({ label, tone, first = false, children }: { label: string; tone?: Tone; first?: boolean; children: ReactNode }) {
  return <div {...stylex.props(styles.row)}>
    <dt {...stylex.props(styles.label, !first && styles.divided)}>{tone ? <span aria-hidden="true" {...stylex.props(styles.dot, styles[tone])} /> : null}{label}</dt>
    <dd {...stylex.props(styles.value, !first && styles.divided)}>{children}</dd>
  </div>
}

function FinishSummary({ review }: { review: FinishReview }) {
  const { status, integration } = review.git
  const filesTone: Tone = status.error || !status.isRepo ? 'unknown' : status.files.length ? 'attention' : 'ok'
  const integrationTone: Tone = integration.kind === 'unknown' ? 'unknown' : integration.kind === 'integrated' ? 'ok' : 'attention'
  const usesTone: Tone = review.conflicts.length ? 'attention' : 'ok'
  const tones = [filesTone, integrationTone, usesTone]
  const attention = tones.filter((tone) => tone === 'attention').length
  const headline = attention ? `${attention} item${attention === 1 ? '' : 's'} to review before finishing` : tones.includes('unknown') ? 'Some status could not be determined' : 'No blockers observed'
  const staged = status.files.filter((change) => change.staged).length
  return <>
    <p {...stylex.props(styles.intro)}>Mark this task finished. This does not commit, merge, delete files, or stop a runtime.</p>
    <p {...stylex.props(styles.headline)}><span aria-hidden="true" {...stylex.props(styles.dot, styles[attention ? 'attention' : tones.includes('unknown') ? 'unknown' : 'ok'])} />{headline}</p>
    <dl {...stylex.props(styles.rows)}>
      <Row first label="Uncommitted files" tone={filesTone}>
        {status.error ? <><span role="alert">{status.error}</span> <span>Uncommitted file status is unknown.</span></>
          : !status.isRepo ? 'Not a Git repository.'
          : !status.files.length ? 'No uncommitted files observed.'
          : <details><summary {...stylex.props(styles.inlineSummary)}>{status.files.length} file{status.files.length === 1 ? '' : 's'}{staged ? ` · ${staged} staged` : ''}</summary><ul {...stylex.props(styles.list)}>{status.files.map((change, index) => <li key={`${change.path}:${index}`}><code>{change.path}</code> · {change.status}{change.staged ? ' · staged' : ''}</li>)}</ul></details>}
        {status.truncated ? <div {...stylex.props(styles.note)}>File list is incomplete.</div> : null}
      </Row>
      <Row label="Integration" tone={integrationTone}>
        {integration.kind === 'unknown' ? <>Unknown: {integration.reason}</> : <>{integration.kind === 'integrated' ? 'Integrated' : 'Not integrated'} into <code>{integration.target}</code></>}
        {integration.kind !== 'unknown' && integration.evidence ? <div {...stylex.props(styles.note)}>Evidence uses the local cached remote-tracking ref, not a fresh remote check.</div> : null}
      </Row>
      <Row label="Other uses" tone={usesTone}>
        {review.conflicts.length ? <ul {...stylex.props(styles.list)}>{review.conflicts.map((use, index) => <li key={index}>{use.kind}: {use.kind === 'agent' ? use.runtimeId : use.kind === 'terminal' ? use.terminalId : `${use.app} · ${use.label} · ${use.session}`}</li>)}</ul> : 'No other local uses observed.'}
      </Row>
      <Row label="Cleanup">{review.cleanup.eligible ? 'Candidate for manual review only.' : 'Not a cleanup candidate.'}</Row>
    </dl>
    <p role="note" {...stylex.props(styles.callout)}>The task runtime is still attached. Stop it before any manual cleanup.</p>
    {review.nextActions.length ? <section {...stylex.props(styles.section)}>
      <h3 {...stylex.props(styles.sectionTitle)}>Next actions</h3>
      <ul {...stylex.props(styles.list)}>{review.nextActions.map((action) => <li key={action}>{action}</li>)}</ul>
      <p {...stylex.props(styles.note)}>These are suggestions. No cleanup command has been executed.</p>
    </section> : <p {...stylex.props(styles.note)}>No cleanup command has been executed.</p>}
    <details {...stylex.props(styles.disclosure)}>
      <summary {...stylex.props(styles.summary)}>Worktree and cleanup details</summary>
      <div {...stylex.props(styles.details)}>
        <div>Worktree: {review.worktree.kind} · {review.worktree.ownership}</div>
        <div><code>{review.worktree.root ?? review.cwd}</code></div>
        {review.worktree.head ? <div>HEAD <code>{review.worktree.head}</code></div> : null}
        <div>{review.worktree.ownershipReason}</div>
        {review.cleanup.reasons.length ? <div>Manual cleanup review:<ul {...stylex.props(styles.list)}>{review.cleanup.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div> : null}
      </div>
    </details>
  </>
}

function HistoricalContent({ content, path, version, runId }: { content: RunHistoricalContent; path: string; version: string; runId: string }) {
  if (content === null) return <p>{version}: file absent</p>
  if (content.kind === 'symlink') return <p>{version}: symlink → <code>{content.target}</code></p>
  if (content.binary) return <p>{version}: binary file · {content.size.toLocaleString()} bytes</p>
  const text = new TextDecoder().decode(Uint8Array.from(atob(content.base64), (character) => character.charCodeAt(0)))
  const { lines, truncated } = boundLines(text, 2 * 1024 * 1024, 4_000)
  return <section><h4>{version}</h4><ContextExcerpt key={`${path}:${version}`} source={`Run ${runId} · ${version}`} path={path} text={lines.join('\n')}><pre className="task-history-code">{lines.map((line, index) => <span key={index} data-context-line={index + 1}>{line}{'\n'}</span>)}</pre></ContextExcerpt>{truncated ? <p>File view truncated.</p> : null}</section>
}

export function TaskWorkflowDialogs({ workflow }: { workflow: Workflow }) {
  const { dialog } = workflow
  const [restore, setRestore] = useState(false)
  const [path, setPath] = useState('')
  const [file, setFile] = useState<RunHistoricalFile>()
  const [fileError, setFileError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => { setRestore(false); setPath(''); setFile(undefined); setFileError('') }, [dialog])
  useEffect(() => {
    if (dialog?.kind !== 'history' || !path || !dialog.receipt.anchorUserEntryId) return
    let current = true
    setLoading(true); setFile(undefined); setFileError('')
    void window.apex.sessions.readRunFile(dialog.sessionFile, dialog.receipt.anchorUserEntryId, path).then((value) => { if (current) setFile(value) }, (reason: unknown) => { if (current) setFileError(errorMessage(reason)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [dialog, path])
  if (!dialog) return null
  if (dialog.kind === 'history') return <Modal title="Changes observed during this run" onClose={workflow.close} footer={<ApexButton onClick={workflow.close}>Close</ApexButton>}>
    <div className="task-review">
      <p>Saved checkout snapshots, not current Git changes. These can include your edits and other processes, not only the agent's work.</p>
      <p>{new Date(dialog.receipt.startedAt).toLocaleString()} · {dialog.receipt.state}</p>
      {dialog.receipt.state === 'incomplete' ? <p role="alert">Incomplete snapshot: {dialog.receipt.error ?? 'The run did not finish recording its checkout.'}</p> : null}
      {!dialog.receipt.changes?.length ? <p>{dialog.receipt.state === 'complete' ? 'No file changes observed.' : 'No saved changes available.'}</p> : null}
      <ul>{dialog.receipt.changes?.map((change) => <li key={change.path}><ApexButton compact disabled={!dialog.receipt.anchorUserEntryId} onClick={() => setPath(change.path)}>{change.path} · {change.kind}</ApexButton></li>)}</ul>
      {path ? <h3>{path}</h3> : null}
      {loading ? <p role="status">Loading saved file…</p> : null}
      {fileError ? <p role="alert">{fileError}</p> : null}
      {file ? <><HistoricalContent content={file.before} path={path} version="Before run" runId={dialog.receipt.id} /><HistoricalContent content={file.after} path={path} version="After run" runId={dialog.receipt.id} /></> : null}
    </div>
  </Modal>
  return <Modal title={dialog.kind === 'rewind' ? 'Edit from here' : 'Finish task'} onClose={workflow.close} footer={<><ApexButton variant="quiet" disabled={workflow.pending} onClick={workflow.close}>Cancel</ApexButton><ApexButton variant={restore && dialog.kind === 'rewind' ? 'danger' : 'primary'} disabled={!workflow.idle || workflow.pending} onClick={() => workflow.confirm(restore)}>{workflow.pending ? 'Working…' : dialog.kind === 'finish' ? 'Confirm finish task' : restore ? 'Fork and restore files' : 'Fork and keep files'}</ApexButton></>}>
    <div className="task-review">
      {workflow.error ? <p role="alert">{workflow.error}</p> : null}
      {dialog.kind === 'rewind' ? <>
        <p>Create a separate conversation from this prompt. The original conversation remains available. Nothing is sent automatically.</p>
        {dialog.preview.rewindToRunStart ? <p role="note">This input was queued or steered into a run. Editing it rewinds to that run's starting prompt.</p> : null}
        <details open><summary>Recovered prompt</summary><pre>{dialog.preview.prompt}</pre></details>
        <p>{dialog.preview.warning}</p><p>Restoring files includes your own changes. External actions are not undone.</p>
        <p>Checkout: <code>{dialog.preview.checkout}</code> · {dialog.preview.worktree.primary ? 'primary' : dialog.preview.worktree.linked ? 'linked worktree' : 'unknown worktree'}</p>
        {dialog.preview.restore.available ? <label className="task-review__checkbox"><input type="checkbox" checked={restore} onChange={(event) => setRestore(event.target.checked)} /> Restore files to the run start</label> : <p>Restore unavailable: {dialog.preview.restore.reason ?? 'No restore checkpoint is available.'}</p>}
        <p>{restore ? 'These paths will be restored:' : 'Files will be kept. Paths that a restore would change:'}</p>
        <ul>{dialog.preview.restore.changes.map((change) => <li key={change.path}><code>{change.path}</code> · {change.kind}</li>)}</ul>
      </> : <>
        <FinishSummary review={dialog.review} />
      </>}
    </div>
  </Modal>
}
