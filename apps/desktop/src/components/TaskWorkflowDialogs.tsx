import { useEffect, useState } from 'react'
import type { RunHistoricalContent, RunHistoricalFile } from '@/types/api'
import type { useTaskWorkflows } from '@/hooks/useTaskWorkflows'
import { errorMessage } from '@/lib/errors'
import { boundLines } from '@/lib/render-bounds'
import { ApexButton, Modal } from './ui'
import { ContextExcerpt } from './ContextExcerpt'
import './task-workflows.css'

type Workflow = ReturnType<typeof useTaskWorkflows>
export function TaskWorkflowToolbar({ workflow }: { workflow: Workflow }) {
  if (!workflow.context.sessionFile) return null
  return <div className="task-workflow-toolbar">
    <div className="task-workflow-toolbar__actions" aria-label="Task actions">
      <ApexButton compact disabled={workflow.pending} onClick={() => workflow.createSide()}>Side conversation</ApexButton>
      <ApexButton compact disabled={!workflow.idle || workflow.pending} title={!workflow.idle ? 'Available when this saved Pi session is idle' : undefined} onClick={workflow.reviewFinish}>Finish task</ApexButton>
      {workflow.pending ? <span role="status">Preparing task action…</span> : null}
      {workflow.context.finished.has(workflow.context.sessionFile) ? <span role="status">Task finished</span> : null}
      {workflow.side ? <><span>Side conversation · read/search-only tools</span><ApexButton compact disabled={workflow.pending} onClick={() => workflow.navigate(workflow.side!.parentSession)}>Open parent</ApexButton></> : null}
      {workflow.children.length ? <details><summary>{workflow.children.length} side conversation{workflow.children.length === 1 ? '' : 's'}</summary><ul>{workflow.children.map((side, index) => <li key={side.sessionFile}><ApexButton compact disabled={workflow.pending} onClick={() => workflow.navigate(side.sessionFile)}>Open side conversation {index + 1}</ApexButton></li>)}</ul></details> : null}
    </div>
    {workflow.side ? <small>A separate thread you control, not a specialist. Tool restrictions are not an OS sandbox. Select a reply to bring it back.</small> : null}
    {workflow.error ? <p role="alert">{workflow.error}</p> : null}
  </div>
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
  return <Modal title={dialog.kind === 'rewind' ? 'Edit from here' : 'Finish task'} onClose={workflow.close} footer={<><ApexButton disabled={workflow.pending} onClick={workflow.close}>Cancel</ApexButton><ApexButton variant={restore && dialog.kind === 'rewind' ? 'danger' : 'primary'} disabled={!workflow.idle || workflow.pending} onClick={() => workflow.confirm(restore)}>{workflow.pending ? 'Working…' : dialog.kind === 'finish' ? 'Confirm finish task' : restore ? 'Fork and restore files' : 'Fork and keep files'}</ApexButton></>}>
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
        <p>Mark this task finished. This does not commit, merge, delete files, or stop a runtime.</p>
        <h3>Uncommitted files</h3>
        {dialog.review.git.status.error ? <p role="alert">{dialog.review.git.status.error}</p> : null}
        {dialog.review.git.status.error ? <p>Uncommitted file status is unknown.</p> : !dialog.review.git.status.isRepo ? <p>Not a Git repository.</p> : !dialog.review.git.status.files.length ? <p>No uncommitted files observed.</p> : <ul>{dialog.review.git.status.files.map((change, index) => <li key={`${change.path}:${index}`}><code>{change.path}</code> · {change.status}{change.staged ? ' · staged' : ''}</li>)}</ul>}
        {dialog.review.git.status.truncated ? <p>File list is incomplete.</p> : null}
        <h3>Integration</h3>
        {dialog.review.git.integration.kind === 'unknown' ? <p>Unknown: {dialog.review.git.integration.reason}</p> : <p>{dialog.review.git.integration.kind === 'integrated' ? 'Integrated' : 'Not integrated'} into <code>{dialog.review.git.integration.target}</code>.{dialog.review.git.integration.evidence ? ' Evidence uses the local cached remote-tracking ref, not a fresh remote check.' : ''}</p>}
        <h3>Worktree</h3><p>{dialog.review.worktree.kind} · {dialog.review.worktree.ownership}<br /><code>{dialog.review.worktree.root ?? dialog.review.cwd}</code><br />{dialog.review.worktree.head}<br />{dialog.review.worktree.ownershipReason}</p>
        <h3>Other uses</h3>{dialog.review.conflicts.length ? <ul>{dialog.review.conflicts.map((use, index) => <li key={index}>{use.kind}: {use.kind === 'agent' ? use.runtimeId : use.kind === 'terminal' ? use.terminalId : `${use.app} · ${use.label} · ${use.session}`}</li>)}</ul> : <p>No other local uses observed.</p>}
        <h3>Manual cleanup review</h3><p>{dialog.review.cleanup.eligible ? 'Candidate for manual review only.' : 'Not a cleanup candidate.'} The task runtime is still attached. Stop it before any manual cleanup.</p><ul>{dialog.review.cleanup.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <h3>Next actions</h3><ul>{dialog.review.nextActions.map((action) => <li key={action}>{action}</li>)}</ul><p>These are suggestions. No cleanup command has been executed.</p>
      </>}
    </div>
  </Modal>
}
