import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { restrictedGitEnvironment } from './process-utils'

// These are observations of the checkout, not a record of edits by an agent.
export type SnapshotEntry = { kind: 'file'; data: string; mode: number } | { kind: 'symlink'; target: string }
export interface SnapshotChange { path: string; kind: 'added' | 'deleted' | 'modified' }
export interface RestorePreview { snapshotId: string; fingerprint: string; changes: SnapshotChange[] }
interface Snapshot { version: 1; root: string; entries: Record<string, SnapshotEntry> }
const MAX_BYTES = 64 * 1024 * 1024
const MAX_PATH_BYTES = 8 * 1024 * 1024

function git(root: string, args: string[]): Buffer {
  const result = spawnSync('git', ['--no-pager', '-c', 'core.fsmonitor=false', ...args], {
    cwd: root, env: restrictedGitEnvironment(), encoding: 'buffer', maxBuffer: MAX_PATH_BYTES, timeout: 30_000, windowsHide: true,
  })
  if (result.error || result.status !== 0) throw new Error(`Snapshot git command failed: ${result.error?.message ?? result.stderr.toString('utf8')}`)
  return result.stdout
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}
function pathAt(root: string, path: string): string {
  if (!path || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw new Error(`Unsafe snapshot path: ${path}`)
  const full = resolve(root, ...path.split('/'))
  if (!inside(root, full) || full === root) throw new Error(`Snapshot path outside checkout: ${path}`)
  return full
}
function statOrMissing(path: string) {
  try { return lstatSync(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
function checkParents(root: string, path: string): void {
  const parts = path.split('/').slice(0, -1)
  let current = root
  for (const part of parts) {
    current = join(current, part)
    const stat = statOrMissing(current)
    if (!stat) return
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe snapshot parent: ${path}`)
  }
}
function entryEqual(a: SnapshotEntry | undefined, b: SnapshotEntry | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
function changes(oldEntries: Record<string, SnapshotEntry>, newEntries: Record<string, SnapshotEntry>): SnapshotChange[] {
  return [...new Set([...Object.keys(oldEntries), ...Object.keys(newEntries)])].sort().flatMap((path) => {
    const oldEntry = Object.hasOwn(oldEntries, path) ? oldEntries[path] : undefined
    const newEntry = Object.hasOwn(newEntries, path) ? newEntries[path] : undefined
    if (entryEqual(oldEntry, newEntry)) return []
    return [{ path, kind: !oldEntry ? 'added' : !newEntry ? 'deleted' : 'modified' } satisfies SnapshotChange]
  })
}
function fingerprint(snapshot: Snapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

export class CheckoutSnapshotStore {
  private readonly directory: string
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.directory = realpathSync(directory)
  }
  private observe(checkout: string): Snapshot {
    const root = realpathSync(checkout)
    const gitRoot = realpathSync(git(root, ['rev-parse', '--show-toplevel']).toString('utf8').trim())
    if (root !== gitRoot) throw new Error('Snapshot checkout must be the repository root')
    if (inside(root, this.directory) || inside(this.directory, root)) throw new Error('Snapshot storage must be outside the checkout')
    const output = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    const text = output.toString('utf8')
    if (!Buffer.from(text).equals(output)) throw new Error('Snapshot paths are not valid UTF-8')
    const entries: Record<string, SnapshotEntry> = Object.create(null)
    let total = 0
    for (const path of [...new Set(text.split('\0').filter(Boolean))].sort()) {
      const full = pathAt(root, path)
      checkParents(root, path)
      const stat = statOrMissing(full)
      if (!stat) continue
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(full)
        total += Buffer.byteLength(target)
        entries[path] = { kind: 'symlink', target }
      } else if (stat.isFile()) {
        total += stat.size
        if (total > MAX_BYTES) throw new Error('Snapshot exceeds size limit')
        const content = readFileSync(full)
        if (content.length !== stat.size) throw new Error(`File changed during snapshot: ${path}`)
        entries[path] = { kind: 'file', data: content.toString('base64'), mode: stat.mode & 0o777 }
      } else throw new Error(`Unsupported snapshot entry: ${path}`)
      if (total > MAX_BYTES) throw new Error('Snapshot exceeds size limit')
    }
    return { version: 1, root, entries }
  }
  private load(id: string): Snapshot {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid snapshot id')
    const snapshot: Snapshot = JSON.parse(readFileSync(join(this.directory, `${id}.json`), 'utf8'))
    if (snapshot.version !== 1 || typeof snapshot.root !== 'string' || !snapshot.entries || typeof snapshot.entries !== 'object') throw new Error('Invalid snapshot')
    return snapshot
  }
  capture(checkout: string): string {
    const snapshot = this.observe(checkout)
    const id = randomUUID()
    const temp = join(this.directory, `${id}.tmp`)
    try {
      writeFileSync(temp, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 })
      renameSync(temp, join(this.directory, `${id}.json`))
    } finally { rmSync(temp, { force: true }) }
    return id
  }
  diff(oldId: string, newId: string): SnapshotChange[] {
    const oldSnapshot = this.load(oldId); const newSnapshot = this.load(newId)
    if (oldSnapshot.root !== newSnapshot.root) throw new Error('Snapshots belong to different checkouts')
    return changes(oldSnapshot.entries, newSnapshot.entries)
  }
  content(id: string, path: string): SnapshotEntry | undefined {
    const snapshot = this.load(id)
    pathAt(snapshot.root, path)
    return Object.hasOwn(snapshot.entries, path) ? snapshot.entries[path] : undefined
  }
  previewRestore(checkout: string, snapshotId: string): RestorePreview {
    const target = this.load(snapshotId); const current = this.observe(checkout)
    if (target.root !== current.root) throw new Error('Snapshot belongs to a different checkout')
    const diff = changes(current.entries, target.entries)
    // An ignored file or directory must never be overwritten by a historical path.
    for (const change of diff) {
      const full = pathAt(current.root, change.path)
      checkParents(current.root, change.path)
      if (!Object.hasOwn(current.entries, change.path)) {
        if (statOrMissing(full)) throw new Error(`Restore path is occupied by an unrelated or ignored entry: ${change.path}`)
        const ignored = spawnSync('git', ['--no-pager', '-c', 'core.fsmonitor=false', 'check-ignore', '-q', '--', `./${change.path}`], { cwd: current.root, env: { ...restrictedGitEnvironment(), GIT_LITERAL_PATHSPECS: '0' }, timeout: 30_000, windowsHide: true })
        if (ignored.error || (ignored.status !== 0 && ignored.status !== 1)) throw new Error(`Unable to check ignored restore path: ${change.path}: ${ignored.error?.message ?? ignored.stderr?.toString()}`)
        if (ignored.status === 0) throw new Error(`Restore path is ignored: ${change.path}`)
      }
    }
    return { snapshotId, fingerprint: fingerprint(current), changes: diff }
  }
  restore(checkout: string, preview: RestorePreview, confirmation: 'restore'): void {
    if (confirmation !== 'restore') throw new Error('Restore requires confirmation')
    const fresh = this.previewRestore(checkout, preview.snapshotId)
    if (fresh.fingerprint !== preview.fingerprint || JSON.stringify(fresh.changes) !== JSON.stringify(preview.changes)) throw new Error('Stale restore preview')
    const target = this.load(preview.snapshotId)
    for (const change of fresh.changes) {
      const full = pathAt(target.root, change.path)
      checkParents(target.root, change.path)
      const entry = Object.hasOwn(target.entries, change.path) ? target.entries[change.path] : undefined
      const existing = statOrMissing(full)
      if (existing) {
        if (!existing.isFile() && !existing.isSymbolicLink()) throw new Error(`Restore path is not a file: ${change.path}`)
        rmSync(full)
      }
      if (entry) {
        mkdirSync(dirname(full), { recursive: true })
        if (entry.kind === 'symlink') symlinkSync(entry.target, full)
        else { writeFileSync(full, Buffer.from(entry.data, 'base64'), { flag: 'wx', mode: entry.mode }); chmodSync(full, entry.mode) }
      }
    }
  }
}
