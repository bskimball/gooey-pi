import * as stylex from '@stylexjs/stylex'
import { styles as workbenchStyles } from 'apex-ui/styles/workbench.stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import type { GitFileChange } from '@/types/api'

export function changeTotals(files: GitFileChange[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const file of files) {
    additions += file.additions
    deletions += file.deletions
  }
  return { additions, deletions }
}

export function filesChangedLabel(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'} changed`
}

/** Status letters git reports, spelled out for the badge's accessible name. */
const STATUS_NAMES: Record<string, string> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflicted', '?': 'untracked' }

function statusBadge(status: string): { code: string; name: string } {
  const code = status.trim().charAt(0).toUpperCase() || 'M'
  return { code, name: STATUS_NAMES[code] ?? 'changed' }
}

/** Compact changed-file rows shared by the session header popover and the inline turn receipt. */
export function ChangedFilesList({ files, id, lineCounts = true }: { files: GitFileChange[]; id?: string; lineCounts?: boolean }) {
  return <ul className={`changed-files ${stylex.props(workbenchStyles.changedFiles).className ?? ""}`} id={id}>
    {files.map((file) => {
      const badge = statusBadge(file.status)
      return <li key={`${file.path}:${file.staged ? 's' : 'w'}`} className={`changed-files__row ${stylex.props(workbenchStyles.changedFilesRow).className ?? ""}`}>
        <span className={[`changed-files__status is-${badge.name}`, stylex.props(workbenchStyles.changedFilesStatus, ((badge.name === "added")) && workbenchStyles.changedFilesStatusIsAdded, ((badge.name === "untracked")) && workbenchStyles.changedFilesStatusIsUntracked, ((badge.name === "deleted")) && workbenchStyles.changedFilesStatusIsDeleted, ((badge.name === "conflicted")) && workbenchStyles.changedFilesStatusIsConflicted).className].filter(Boolean).join(' ')} title={badge.name} aria-label={badge.name}>{badge.code}</span>
        <span className={`changed-files__path ${stylex.props(workbenchStyles.changedFilesPath).className ?? ""}`} title={file.path}>{file.path}</span>
        {lineCounts ? <>
          <span className={`diff-count diff-count--add ${stylex.props(transcriptStyles.diffCount, transcriptStyles.diffCountAdd).className ?? ""}`}>+{file.additions}</span>
          <span className={`diff-count diff-count--remove ${stylex.props(transcriptStyles.diffCount, transcriptStyles.diffCountRemove).className ?? ""}`}>−{file.deletions}</span>
        </> : null}
      </li>
    })}
  </ul>
}
