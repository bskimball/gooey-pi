import { ArrowLineDown, ArrowsClockwise, ArrowUUpLeft, CircleNotch, File, FileCode, GitBranch, Sparkle } from '../icons'
import { memo, useEffect, useRef } from 'react'
import { useMachine } from '@xstate/react'
import { errorMessage } from '@/lib/errors'
import type { GitStatus } from '@/types/api'
import { boundLines } from '@/lib/render-bounds'
import { Banner } from '@astryxdesign/core/Banner'
import { TextInput } from '@astryxdesign/core/TextInput'
import { EmptyState, ApexButton, IconButton, Modal, Segmented } from '../ui'
import { changesPanelMachine } from './changesPanelMachine'
import { ContextExcerpt } from '../ContextExcerpt'

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

const DiffView = memo(function DiffView({ text, path, scope }: { text: string; path?: string; scope: string }) {
  if (!text) return <div className="diff-placeholder"><FileCode size={22} /><span>Select a changed file to inspect its diff.</span></div>
  const { lines, truncated } = boundLines(text, MAX_RENDERED_DIFF_CHARACTERS, MAX_RENDERED_DIFF_LINES)
  return <ContextExcerpt key={`${path}:${scope}`} source={`Live ${scope} diff`} path={path} text={text}><pre className="diff-view">{lines.map((line, index) => <span key={index} data-context-line={index + 1} data-context-line-kind="diff display lines" className={line.startsWith('+') && !line.startsWith('+++') ? 'diff-line diff-line--add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-line diff-line--remove' : line.startsWith('@@') ? 'diff-line diff-line--hunk' : 'diff-line'}><i>{index + 1}</i><code>{line || ' '}</code></span>)}{truncated ? <span className="diff-line diff-line--truncated"><i>…</i><code>Diff truncated in the desktop view. Open the file or use Git for the complete diff.</code></span> : null}</pre></ContextExcerpt>
})

export function ChangesPanel({ cwd, git, readOnly = false, onGrantProject, onRefreshGit }: { cwd?: string; git: GitStatus; readOnly?: boolean; onGrantProject?(): Promise<void> | void; onRefreshGit(): Promise<void> | void }) {
  const [snapshot, send] = useMachine(changesPanelMachine, {
    input: { initialSelectedPath: git.files[0]?.path },
  })
  const { scope, selectedPath, diff, commitMessage, confirmUndoTarget, actionError } = snapshot.context
  const loading = snapshot.matches({ diffView: 'loading' })
  const commitOpen = snapshot.matches({ modal: 'commit' })
  const commitSubmitting = snapshot.matches({ modal: { commit: 'submitting' } })
  const confirmUndoOpen = snapshot.matches({ modal: 'confirmUndo' })
  const confirmUndoRestoring = snapshot.matches({ modal: { confirmUndo: 'restoring' } })
  const nextRequestIdRef = useRef(0)
  const visibleFiles = git.files.filter((file) => scope === 'staged' ? file.staged : !file.staged)
  const activeSelectedPath = visibleFiles.some((file) => file.path === selectedPath) ? selectedPath : undefined

  useEffect(() => {
    if (!visibleFiles.some((file) => file.path === selectedPath)) {
      const fallback = visibleFiles[0]?.path
      if (fallback !== selectedPath) {
        send({ type: 'SELECT_PATH', path: fallback })
      }
    }
  }, [git.files, scope, selectedPath, send])

  useEffect(() => {
    if (!cwd || !activeSelectedPath || !window.apex) {
      send({
        type: 'DIFF_SET_STATIC',
        diff: activeSelectedPath ? `diff --git a/${activeSelectedPath} b/${activeSelectedPath}
--- a/${activeSelectedPath}
+++ b/${activeSelectedPath}
@@ -18,3 +18,6 @@
 const workspace = createWorkspace()
+workspace.open()
+workspace.focus()
 return workspace` : '',
      })
      return
    }
    let cancelled = false
    nextRequestIdRef.current += 1
    const requestId = nextRequestIdRef.current
    send({ type: 'DIFF_LOAD_START', requestId })
    window.apex.git.diff(cwd, activeSelectedPath, scope === 'staged').then((value) => {
      if (!cancelled) send({ type: 'DIFF_LOAD_SUCCESS', requestId, diff: value.text })
    }).catch(() => {
      if (!cancelled) send({ type: 'DIFF_LOAD_ERROR', requestId })
    })
    return () => { cancelled = true }
  }, [cwd, activeSelectedPath, scope, send])

  const mutate = async (kind: 'stage' | 'unstage' | 'restore', paths: string[]): Promise<boolean> => {
    if (readOnly || !cwd || !window.apex) return false
    send({ type: 'MUTATE_START' })
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
      send({ type: 'MUTATE_ERROR', error: errorMessage(error) })
      return false
    }
  }

  const fillCommitSummary = () => {
    send({ type: 'FILL_COMMIT_SUMMARY', summary: generateCommitSummary(git.files) })
  }

  const commit = async () => {
    if (readOnly || !cwd || !commitMessage.trim() || !window.apex) return
    send({ type: 'COMMIT_SUBMIT' })
    try {
      const result = await window.apex.git.commit(cwd, commitMessage.trim())
      if (!result.ok) throw new Error(result.output || 'Git could not create the commit.')
      await onRefreshGit()
      send({ type: 'COMMIT_SUCCESS' })
    } catch (error) {
      send({ type: 'COMMIT_ERROR', error: errorMessage(error) })
    }
  }

  const confirmRestore = async () => {
    if (!confirmUndoTarget || readOnly || !cwd || !window.apex) return
    send({ type: 'CONFIRM_UNDO_SUBMIT' })
    try {
      const ok = await window.apex.git.restore(cwd, [confirmUndoTarget])
      if (!ok) throw new Error('Git could not restore the selected file.')
      await onRefreshGit()
      send({ type: 'CONFIRM_UNDO_SUCCESS' })
    } catch (error) {
      send({ type: 'CONFIRM_UNDO_ERROR', error: errorMessage(error) })
    }
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
        <Segmented value={scope} label="Diff scope" options={[{ value: 'unstaged', label: 'Unstaged' }, { value: 'staged', label: 'Staged' }]} onChange={(value) => { if (value === 'unstaged' || value === 'staged') send({ type: 'SET_SCOPE', scope: value }) }} />
        <ApexButton compact disabled={readOnly || !git.files.some((file) => file.staged)} onClick={() => send({ type: 'OPEN_COMMIT' })}>Commit</ApexButton>
        <IconButton label="Refresh changes" onClick={() => void onRefreshGit()}><ArrowsClockwise size={14} /></IconButton>
      </div>
      {readOnly ? <div className="changes-read-only" role="note"><span>This project is read-only because it was discovered from session history.</span>{onGrantProject ? <ApexButton compact onClick={() => void onGrantProject()}>Add project</ApexButton> : null}</div> : null}
      {actionError ? <Banner status="error" role="alert" title={actionError} /> : null}
      <div className="changes-body">
        <div className="file-changes scroll-area">
          <div className="file-changes__header"><span>{visibleFiles.length} changed {visibleFiles.length === 1 ? 'file' : 'files'}</span>{visibleFiles.length ? <ApexButton variant="quiet" compact disabled={readOnly} onClick={() => void mutate(scope === 'staged' ? 'unstage' : 'stage', visibleFiles.map((file) => file.path))}>{scope === 'staged' ? 'Unstage all' : 'Stage all'}</ApexButton> : null}</div>
          {visibleFiles.map((file) => <button type="button" key={file.path} className={selectedPath === file.path ? 'is-selected' : ''} onClick={() => send({ type: 'SELECT_PATH', path: file.path })}><File size={13} /><FilePathLabel path={file.path} /><small className="additions">+{file.additions}</small><small className="deletions">−{file.deletions}</small><span className="file-status">{file.status}</span></button>)}
          {visibleFiles.length === 0 ? <div className="compact-state"><EmptyState title={`No ${scope} changes.`}>{null}</EmptyState></div> : null}
        </div>
        <div className="diff-pane scroll-area">
          {selectedPath ? <div className="diff-header"><div><FileCode size={13} /><FilePathLabel path={selectedPath} /></div><div>{scope === 'unstaged' ? <ApexButton compact icon={<ArrowLineDown size={12} />} disabled={readOnly} onClick={() => void mutate('stage', [selectedPath])}>Stage</ApexButton> : <ApexButton compact icon={<ArrowUUpLeft size={12} />} disabled={readOnly} onClick={() => void mutate('unstage', [selectedPath])}>Unstage</ApexButton>}<ApexButton compact className="danger-action" icon={<ArrowUUpLeft size={12} />} disabled={readOnly} onClick={() => send({ type: 'OPEN_CONFIRM_UNDO', path: selectedPath })}>Undo changes</ApexButton></div></div> : null}
          {loading ? <div className="diff-loading" role="status"><CircleNotch className="spin" size={15} aria-hidden="true" /><div className="compact-state"><EmptyState title="Loading diff…">{null}</EmptyState></div></div> : <DiffView text={diff} path={activeSelectedPath} scope={scope} />}
        </div>
      </div>
      {commitOpen ? <Modal title="Commit staged changes" onClose={() => send({ type: 'CLOSE_MODAL' })} footer={<><ApexButton variant="quiet" onClick={() => send({ type: 'CLOSE_MODAL' })}>Cancel</ApexButton><ApexButton variant="primary" disabled={readOnly || !commitMessage.trim() || commitSubmitting} onClick={() => void commit()}>Commit changes</ApexButton></>}><label className="field"><span>Commit message</span><div className="commit-message-input"><TextInput label="Commit message" isLabelHidden hasAutoFocus value={commitMessage} onChange={(message) => send({ type: 'SET_COMMIT_MESSAGE', message })} placeholder="Describe this change" containerStyle={{ flex: 1, minWidth: 0 }} /><ApexButton compact icon={<Sparkle size={13} />} onClick={fillCommitSummary} title="Generate a summary from staged files">Generate summary</ApexButton></div></label><p className="muted-copy">This will commit all staged files on <code>{git.branch}</code>.</p></Modal> : null}
      {confirmUndoOpen && confirmUndoTarget ? <Modal title="Undo file changes?" onClose={() => send({ type: 'CLOSE_MODAL' })} footer={<><ApexButton variant="quiet" onClick={() => send({ type: 'CLOSE_MODAL' })}>Cancel</ApexButton><ApexButton variant="danger" disabled={readOnly || confirmUndoRestoring} onClick={() => void confirmRestore()}>Undo changes</ApexButton></>}><p>This discards the staged and unstaged changes to <code>{confirmUndoTarget}</code> and restores the file to its last commit. A new untracked file will be deleted.</p></Modal> : null}
    </div>
  )
}
