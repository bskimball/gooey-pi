import * as stylex from '@stylexjs/stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
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
  return <div className={`changes-card ${stylex.props(transcriptStyles.changesCard).className ?? ""}`}>
    <button type="button" className={`changes-card__open ${stylex.props(transcriptStyles.changesCardOpen).className ?? ""}`} onClick={onOpenChanges}>
      <span className={`changes-card__icon ${stylex.props(transcriptStyles.changesCardIcon).className ?? ""}`}><FileCode size={16} /></span>
      <span className={`changes-card__text ${stylex.props(transcriptStyles.changesCardText).className ?? ""}`}><strong>{git.files.length} {git.files.length === 1 ? 'file' : 'files'} changed</strong><small>Review changes in the inspector</small></span>
      {git.lineCounts === false ? null : <><span className={`diff-count diff-count--add ${stylex.props(transcriptStyles.diffCount, transcriptStyles.diffCountAdd).className ?? ""}`}>+{additions}</span><span className={`diff-count diff-count--remove ${stylex.props(transcriptStyles.diffCount, transcriptStyles.diffCountRemove).className ?? ""}`}>−{deletions}</span></>}<CaretRight size={14} />
    </button>
    {onClose ? <button type="button" className={`changes-card__close ${stylex.props(transcriptStyles.changesCardClose).className ?? ""}`} aria-label="Dismiss file changes" title="Dismiss file changes" onClick={onClose}><X size={15} /></button> : null}
  </div>
}
