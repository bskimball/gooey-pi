import { readdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { compactText, textFromContent } from '../../../electron/main/sessions/transcript'
import { isRecord } from '../../../electron/main/validation'
import { join } from 'node:path'
import { createPiSessionMetadataReader, piSessionRoot, readPiTranscript } from '../../../electron/main/sessions/pi'
import { canonicalSessionPath } from '../../../electron/main/session-paths'
import type { SessionSummary, TranscriptOp } from './protocol'

export function sessionBucket(cwd: string, root = piSessionRoot()): string {
  return join(root, `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`)
}

export async function listSessions(cwd: string, root = piSessionRoot()): Promise<SessionSummary[]> {
  const directory = sessionBucket(cwd, root)
  const readMetadata = createPiSessionMetadataReader()
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) {
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
      let preview = ''
      let messageCount = 0
      const input = createReadStream(path, { encoding: 'utf8' })
      try {
        for await (const line of createInterface({ input, crlfDelay: Infinity })) {
          let entry: unknown
          try { entry = JSON.parse(line) } catch { continue }
          if (!isRecord(entry) || entry.type !== 'message' || !isRecord(entry.message)) continue
          messageCount += 1
          if (!preview && entry.message.role === 'user') preview = compactText(textFromContent(entry.message.content))
        }
      } finally { input.destroy() }
      summaries.push({ path, id: metadata.id, title: metadata.title, preview, updatedAt: metadata.updatedAt, messageCount })
    } catch { /* A concurrently removed or incomplete file is not a catalog entry. */ }
  }
  return summaries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.path.localeCompare(b.path)).slice(0, 50)
}

/** Saved rows are already reduced; live events cannot represent their identity or timestamps. */
export async function sessionTranscriptOps(path: string): Promise<TranscriptOp[]> {
  return (await readPiTranscript(path, false)).map(message => ({ kind: 'saved', message }))
}
