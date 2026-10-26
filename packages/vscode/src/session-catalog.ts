import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalSessionPath } from 'apex-core/session-paths'
import { createPiSessionMetadataReader, piSessionBucketDir, piSessionRoot, readPiTranscript } from 'apex-core/sessions/pi'
import type { SessionSummary, TranscriptOp } from './protocol'

export const sessionBucket = piSessionBucketDir

export async function listSessions(cwd: string, root = piSessionRoot()): Promise<SessionSummary[]> {
  const directory = sessionBucket(cwd, root)
  const readMetadata = createPiSessionMetadataReader()
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const summaries: SessionSummary[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const path = canonicalSessionPath(join(directory, entry.name))
    try {
      const metadata = await readMetadata(path, await stat(path))
      if (!metadata.projectPath || canonicalSessionPath(metadata.projectPath) !== canonicalSessionPath(cwd)) continue
      summaries.push({
        path,
        id: metadata.id,
        title: metadata.title,
        preview: metadata.firstUserPreview ?? metadata.preview ?? '',
        updatedAt: metadata.updatedAt,
        messageCount: metadata.messageCount ?? 0,
      })
    } catch {
      /* A concurrently removed or incomplete file is not a catalog entry. */
    }
  }
  return summaries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.path.localeCompare(b.path)).slice(0, 50)
}

/** Saved rows are already reduced; live events cannot represent their identity or timestamps. */
export async function sessionTranscriptOps(path: string): Promise<TranscriptOp[]> {
  return (await readPiTranscript(path, false)).map((message) => ({ kind: 'saved', message }))
}
