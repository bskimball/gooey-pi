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
export function ChangedFilesList({ files, id }: { files: GitFileChange[]; id?: string }) {
  return <ul className="changed-files" id={id}>
    {files.map((file) => {
      const badge = statusBadge(file.status)
      return <li key={`${file.path}:${file.staged ? 's' : 'w'}`} className="changed-files__row">
        <span className={`changed-files__status is-${badge.name}`} title={badge.name} aria-label={badge.name}>{badge.code}</span>
        <span className="changed-files__path" title={file.path}>{file.path}</span>
        <span className="diff-count diff-count--add">+{file.additions}</span>
        <span className="diff-count diff-count--remove">−{file.deletions}</span>
      </li>
    })}
  </ul>
}
