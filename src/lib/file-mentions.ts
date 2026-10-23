import type { ProjectFileEntry } from '@/types/api'

const FILE_SUGGESTION_LIMIT = 20

/** Inserts a path the way Pi's TUI does: `@path`, quoted when it contains whitespace. */
export function formatFileMention(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`
}

/**
 * Reads the text after `@` as a file query. Unquoted queries stop at whitespace;
 * `@"` opens a quoted query that ends at its closing quote.
 */
export function parseFileMentionQuery(query: string): string | null {
  if (query.startsWith('"')) return query.includes('"', 1) ? null : query.slice(1)
  return /\s/.test(query) ? null : query
}

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const depth = (path: string): number => path.split('/').length - 1

function scoreEntry(entry: ProjectFileEntry, query: string): number {
  const name = basename(entry.path).toLowerCase()
  let score = 0
  if (name === query) score = 100
  else if (name.startsWith(query)) score = 80
  else if (name.includes(query)) score = 50
  else if (entry.path.toLowerCase().includes(query)) score = 30
  return entry.type === 'directory' && score > 0 ? score + 10 : score
}

/**
 * Ranks project files for an `@` query with the TUI's scoring. An empty query
 * lists the project root; a query ending in `/` lists that directory.
 */
export function rankFileEntries(entries: readonly ProjectFileEntry[], rawQuery: string, limit = FILE_SUGGESTION_LIMIT): ProjectFileEntry[] {
  const query = rawQuery.replaceAll('\\', '/').toLowerCase()
  const byPlace = (left: ProjectFileEntry, right: ProjectFileEntry) =>
    depth(left.path) - depth(right.path) || left.path.length - right.path.length || left.path.localeCompare(right.path)
  if (!query || query.endsWith('/')) {
    const directory = query.replace(/^\.\//, '')
    const childDepth = directory ? depth(directory) : 0
    return entries
      .filter((entry) => depth(entry.path) === childDepth && entry.path.toLowerCase().startsWith(directory))
      .sort((left, right) => Number(right.type === 'directory') - Number(left.type === 'directory') || byPlace(left, right))
      .slice(0, limit)
  }
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || byPlace(left.entry, right.entry))
    .slice(0, limit)
    .map(({ entry }) => entry)
}

/** Converts a dropped or picked file into a mention path, relative when it sits inside the project. */
export function mentionPathForFile(absolutePath: string, root: string | undefined): string {
  if (!root) return absolutePath
  const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '')
  const file = normalize(absolutePath)
  const base = normalize(root)
  const windows = /^[a-z]:\//i.test(base)
  const comparableFile = windows ? file.toLowerCase() : file
  const comparableBase = windows ? base.toLowerCase() : base
  return comparableFile.startsWith(`${comparableBase}/`) ? file.slice(base.length + 1) : absolutePath
}
