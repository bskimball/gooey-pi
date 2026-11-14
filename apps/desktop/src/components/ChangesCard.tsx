import { useState } from 'react'
import { CaretRight, FileCode, X } from './icons'
import type { GitStatus } from '@/types/api'

interface ChangesCardProps {
  git: GitStatus
  onOpenChanges(): void
  onClose?(): void
}

export function WorkspaceChangesCard({ git, cwd, enabled, onOpenChanges }: Omit<ChangesCardProps, 'onClose'> & { cwd?: string; enabled: boolean }) {
  const [dismissed, setDismissed] = useState<string | null>(null)
  const signature = JSON.stringify([cwd, git.files])
  if (!enabled || !git.files.length || dismissed === signature) return null
  return <ChangesCard git={git} onOpenChanges={onOpenChanges} onClose={() => setDismissed(signature)} />
}

export function ChangesCard({ git, onOpenChanges, onClose }: ChangesCardProps) {
  const additions = git.files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = git.files.reduce((sum, file) => sum + file.deletions, 0)
  return <div className="changes-card">
    <button type="button" className="changes-card__open" onClick={onOpenChanges}>
      <span className="changes-card__icon"><FileCode size={16} /></span>
      <span className="changes-card__text"><strong>{git.files.length} {git.files.length === 1 ? 'file' : 'files'} changed</strong><small>Review changes in the inspector</small></span>
      {git.lineCounts === false ? null : <><span className="diff-count diff-count--add">+{additions}</span><span className="diff-count diff-count--remove">−{deletions}</span></>}<CaretRight size={14} />
    </button>
    {onClose ? <button type="button" className="changes-card__close" aria-label="Dismiss file changes" title="Dismiss file changes" onClick={onClose}><X size={15} /></button> : null}
  </div>
}
