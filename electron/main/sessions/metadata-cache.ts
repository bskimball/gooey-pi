import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isRecord } from '../validation'
import type { SessionMetadata } from './metadata'

const MAX_CACHE_BYTES = 32 * 1024 * 1024
const CACHE_SCHEMA_VERSION = 2

function parseMetadata(value: unknown): SessionMetadata | undefined {
  if (!isRecord(value)) return undefined
  const { id, filePath, projectPath, title, createdAt, updatedAt, status, depth } = value
  if (typeof id !== 'string' || typeof filePath !== 'string' || typeof projectPath !== 'string'
    || typeof title !== 'string' || typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))
    || typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))
    || (status !== 'idle' && status !== 'running' && status !== 'waiting' && status !== 'complete' && status !== 'failed' && status !== 'unknown')
    || typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0) return undefined
  const metadata: SessionMetadata = { id, filePath, projectPath, title, createdAt, updatedAt, status, depth }
  for (const key of ['model', 'provider', 'thinkingLevel', 'behaviorMode', 'sessionName', 'preview', 'lastUserMessageAt'] as const) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'string') return undefined
    metadata[key] = value[key]
  }
  for (const key of ['pinned', 'unread', 'archived'] as const) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'boolean') return undefined
    metadata[key] = value[key]
  }
  return metadata
}

/** Disposable metadata only. Filesystem discovery and authorization remain in the catalog. */
export class PersistentMetadataCache {
  private loaded: Promise<Map<string, SessionMetadata>> | undefined
  private pending: string | undefined
  private writing: Promise<void> | undefined

  constructor(private readonly path: string, private readonly limit: number) {}

  load(): Promise<Map<string, SessionMetadata>> {
    this.loaded ??= this.read()
    return this.loaded
  }

  private async read(): Promise<Map<string, SessionMetadata>> {
    const entries = new Map<string, SessionMetadata>()
    try {
      if ((await stat(this.path)).size > MAX_CACHE_BYTES) return entries
      const value: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      if (!isRecord(value) || value.version !== CACHE_SCHEMA_VERSION || !Array.isArray(value.entries)) return entries
      for (const entry of value.entries.slice(0, this.limit)) {
        if (!isRecord(entry) || typeof entry.fingerprint !== 'string') continue
        const metadata = parseMetadata(entry.metadata)
        if (metadata && entry.fingerprint.startsWith(`${metadata.filePath}\0`)) entries.set(entry.fingerprint, metadata)
      }
    } catch { /* Missing or corrupt disposable caches are cold starts. */ }
    return entries
  }

  save(entries: ReadonlyMap<string, SessionMetadata>): Promise<void> {
    const data = JSON.stringify({ version: CACHE_SCHEMA_VERSION, entries: [...entries].slice(0, this.limit).map(([fingerprint, metadata]) => ({ fingerprint, metadata })) })
    if (Buffer.byteLength(data) > MAX_CACHE_BYTES) return Promise.resolve()
    this.pending = data
    this.writing ??= this.drain().finally(() => { this.writing = undefined })
    return this.writing
  }

  private async drain(): Promise<void> {
    while (this.pending !== undefined) {
      const data = this.pending
      this.pending = undefined
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        await mkdir(dirname(this.path), { recursive: true })
        await writeFile(temporary, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        await rename(temporary, this.path)
      } catch { /* Cache failures must never fail session discovery. */ }
      finally { await rm(temporary, { force: true }).catch(() => undefined) }
    }
  }
}
