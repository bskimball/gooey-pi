import { ArrowLineDown, ArrowsClockwise, ArrowUUpLeft, CircleNotch, File, FileCode, GitBranch, Sparkle } from '../icons'
import { memo, useEffect, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import type { GitStatus } from '@/types/api'
import { boundLines } from '@/lib/render-bounds'
import { Banner } from '@astryxdesign/core/Banner'
import { TextInput } from '@astryxdesign/core/TextInput'
import { EmptyState, ApexButton, IconButton, Modal, Segmented } from '../ui'

const MAX_RENDERED_DIFF_CHARACTERS = 2 * 1024 * 1024
const MAX_RENDERED_DIFF_LINES = 4_000

function generateCommitSummary(files: GitStatus['files']): string {
  const staged = files.filter((file) => file.staged)
  if (!staged.length) return ''
  const verbs = new Set(staged.map((file) => file.status[0]))
  const verb = verbs.size === 1 && verbs.has('A') ? 'Add' : verbs.size === 1 && verbs.has('D') ? 'Remove' : 'Update'
  const names = staged.map((file) => file.path)
  const description = names.length <= 3 ? names.join(', ').replace(/, ([^,]*)$/, names.length === 2 ? ' and $1' : ', and $1') : `${names.length} files`
  return `${verb} ${description}`
}

function splitFilePath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? { dir: '', name: path } : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) }
}

function FilePathLabel({ path }: { path: string }) {
  const { dir, name } = splitFilePath(path)
  return <span className="changes-file-path" title={path}>{dir ? <i>{dir}</i> : null}<b>{name}</b></span>
}

const DiffView = memo(function DiffView({ text }: { text: string }) {
  if (!text) return <div className="diff-placeholder"><FileCode size={22} /><span>Select a changed file to inspect its diff.</span></div>
  const { lines, truncated } = boundLines(text, MAX_RENDERED_DIFF_CHARACTERS, MAX_RENDERED_DIFF_LINES)
  return <pre className="diff-view">{lines.map((line, index) => <span key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'diff-line diff-line--add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-line diff-line--remove' : line.startsWith('@@') ? 'diff-line diff-line--hunk' : 'diff-line'}><i>{index + 1}</i><code>{line || ' '}</code></span>)}{truncated ? <span className="diff-line diff-line--truncated"><i>…</i><code>Diff truncated in the desktop view. Open the file or use Git for the complete diff.</code></span> : null}</pre>
})

export function ChangesPanel({ cwd, git, readOnly = false, onGrantProject, onRefreshGit }: { cwd?: string; git: GitStatus; readOnly?: boolean; onGrantProject?(): Promise<void> | void; onRefreshGit(): Promise<void> | void }) {
  const [scope, setScope] = useState<'unstaged' | 'staged'>('unstaged')
  const [selectedPath, setSelectedPath] = useState<string | undefined>(git.files[0]?.path)
  const [diff, setDiff] = useState('')
  const [loading, setLoading] = useState(false)
  const [commitOpen, setCommitOpen] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const visibleFiles = git.files.filter((file) => scope === 'staged' ? file.staged : !file.staged)
  const activeSelectedPath = visibleFiles.some((file) => file.path === selectedPath) ? selectedPath : undefined

  useEffect(() => {
    if (!visibleFiles.some((file) => file.path === selectedPath)) setSelectedPath(visibleFiles[0]?.path)
  }, [git.files, scope, selectedPath])

  useEffect(() => {
    if (!cwd || !activeSelectedPath || !window.apex) {
      setDiff(activeSelectedPath ? `diff --git a/${activeSelectedPath} b/${activeSelectedPath}
--- a/${activeSelectedPath}
+++ b/${activeSelectedPath}
@@ -18,3 +18,6 @@
 const workspace = createWorkspace()
+workspace.open()
+workspace.focus()
 return workspace` : '')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    window.apex.git.diff(cwd, activeSelectedPath, scope === 'staged').then((value) => { if (!cancelled) setDiff(value.text) }).catch(() => { if (!cancelled) setDiff('Unable to load this diff.') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cwd, activeSelectedPath, scope])

  const mutate = async (kind: 'stage' | 'unstage' | 'restore', paths: string[]): Promise<boolean> => {
    if (readOnly || !cwd || !window.apex) return false
    setActionError('')
    try {
      const ok = kind === 'stage'
        ? await window.apex.git.stage(cwd, paths)
        : kind === 'unstage'
          ? await window.apex.git.unstage(cwd, paths)
          : await window.apex.git.restore(cwd, paths)
      if (!ok) throw new Error(`Git could not ${kind} the selected ${paths.length === 1 ? 'file' : 'files'}.`)
      await onRefreshGit()
      return true
    } catch (error) {
      setActionError(errorMessage(error))
      return false
    }
  }

  const fillCommitSummary = () => {
    setActionError('')
    setCommitMessage(generateCommitSummary(git.files))
  }

  const commit = async () => {
    if (readOnly || !cwd || !commitMessage.trim() || !window.apex) return
    setActionError('')
    try {
      const result = await window.apex.git.commit(cwd, commitMessage.trim())
      if (!result.ok) throw new Error(result.output || 'Git could not create the commit.')
      setCommitOpen(false); setCommitMessage(''); await onRefreshGit()
    } catch (error) { setActionError(errorMessage(error)) }
  }

  if (!git.isRepo) return <EmptyState icon={<GitBranch size={24} />} title="No Git repository">Open a project backed by Git to review, stage, and commit changes.</EmptyState>
  if (git.error) {
    return <EmptyState
      icon={<GitBranch size={24} />}
      title="Git status unavailable"
      action={<ApexButton icon={<ArrowsClockwise size={13} />} onClick={() => void onRefreshGit()}>Try again</ApexButton>}
    >{git.error}</EmptyState>
  }
  return (
    <div className="changes-panel">
      <div className="changes-toolbar">
        <div className="changes-toolbar__branch" title={`${git.branch ?? 'Repository'}${git.ahead ? ` · ${git.ahead} ahead` : ''}`}><GitBranch size={13} /><strong>{git.branch ?? 'Repository'}</strong>{git.ahead ? <small>{git.ahead} ahead</small> : null}</div>
        <Segmented value={scope} label="Diff scope" options={[{ value: 'unstaged', label: 'Unstaged' }, { value: 'staged', label: 'Staged' }]} onChange={(value) => { if (value === 'unstaged' || value === 'staged') { setActionError(''); setScope(value) } }} />
        <ApexButton compact disabled={readOnly || !git.files.some((file) => file.staged)} onClick={() => setCommitOpen(true)}>Commit</ApexButton>
        <IconButton label="Refresh changes" onClick={() => void onRefreshGit()}><ArrowsClockwise size={14} /></IconButton>
      </div>
      {readOnly ? <div className="changes-read-only" role="note"><span>This project is read-only because it was discovered from session history.</span>{onGrantProject ? <ApexButton compact onClick={() => void onGrantProject()}>Add project</ApexButton> : null}</div> : null}
      {actionError ? <Banner status="error" role="alert" title={actionError} /> : null}
      <div className="changes-body">
        <div className="file-changes scroll-area">
          <div className="file-changes__header"><span>{visibleFiles.length} changed {visibleFiles.length === 1 ? 'file' : 'files'}</span>{visibleFiles.length ? <ApexButton variant="quiet" compact disabled={readOnly} onClick={() => void mutate(scope === 'staged' ? 'unstage' : 'stage', visibleFiles.map((file) => file.path))}>{scope === 'staged' ? 'Unstage all' : 'Stage all'}</ApexButton> : null}</div>
          {visibleFiles.map((file) => <button type="button" key={file.path} className={selectedPath === file.path ? 'is-selected' : ''} onClick={() => setSelectedPath(file.path)}><File size={13} /><FilePathLabel path={file.path} /><small className="additions">+{file.additions}</small><small className="deletions">−{file.deletions}</small><span className="file-status">{file.status}</span></button>)}
          {visibleFiles.length === 0 ? <p className="file-changes__empty">No {scope} changes.</p> : null}
        </div>
        <div className="diff-pane scroll-area">
          {selectedPath ? <div className="diff-header"><div><FileCode size={13} /><FilePathLabel path={selectedPath} /></div><div>{scope === 'unstaged' ? <ApexButton compact icon={<ArrowLineDown size={12} />} disabled={readOnly} onClick={() => void mutate('stage', [selectedPath])}>Stage</ApexButton> : <ApexButton compact icon={<ArrowUUpLeft size={12} />} disabled={readOnly} onClick={() => void mutate('unstage', [selectedPath])}>Unstage</ApexButton>}<ApexButton compact className="danger-action" icon={<ArrowUUpLeft size={12} />} disabled={readOnly} onClick={() => setConfirmUndo(selectedPath)}>Undo changes</ApexButton></div></div> : null}
          {loading ? <div className="diff-loading"><CircleNotch className="spin" size={15} /> Loading diff…</div> : <DiffView text={diff} />}
        </div>
      </div>
      {commitOpen ? <Modal title="Commit staged changes" onClose={() => setCommitOpen(false)} footer={<><ApexButton onClick={() => setCommitOpen(false)}>Cancel</ApexButton><ApexButton variant="primary" disabled={readOnly || !commitMessage.trim()} onClick={() => void commit()}>Commit changes</ApexButton></>}><label className="field"><span>Commit message</span><div className="commit-message-input"><TextInput label="Commit message" isLabelHidden hasAutoFocus value={commitMessage} onChange={setCommitMessage} placeholder="Describe this change" containerStyle={{ flex: 1, minWidth: 0 }} /><ApexButton compact icon={<Sparkle size={13} />} onClick={fillCommitSummary} title="Generate a summary from staged files">Generate summary</ApexButton></div></label><p className="muted-copy">This will commit all staged files on <code>{git.branch}</code>.</p></Modal> : null}
      {confirmUndo ? <Modal title="Undo file changes?" onClose={() => setConfirmUndo(null)} footer={<><ApexButton onClick={() => setConfirmUndo(null)}>Cancel</ApexButton><ApexButton variant="danger" disabled={readOnly} onClick={() => { const path = confirmUndo; void mutate('restore', [path]).then((ok) => { if (ok) setConfirmUndo(null) }) }}>Undo changes</ApexButton></>}><p>This discards the staged and unstaged changes to <code>{confirmUndo}</code> and restores the file to its last commit. A new untracked file will be deleted.</p></Modal> : null}
    </div>
  )
}
