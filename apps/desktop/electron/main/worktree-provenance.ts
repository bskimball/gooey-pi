import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function canonical(path: string): string {
  const value = realpathSync(path)
  return process.platform === 'win32' ? value.toLowerCase() : value
}
function identity(path: string, directory: boolean): string {
  const info = lstatSync(path, { bigint: true })
  if ((directory ? !info.isDirectory() : !info.isFile()) || info.isSymbolicLink() || info.ino === 0n) throw new Error('Worktree identity is unavailable')
  return `${info.dev}:${info.ino}:${info.birthtimeNs}`
}

/** App-owned creation evidence, bound to the actual directory and Git link file. */
export class WorktreeProvenance {
  constructor(private readonly directory: string) { mkdirSync(directory, { recursive: true, mode: 0o700 }) }
  private path(root: string): string { return join(this.directory, `${createHash('sha256').update(root).digest('hex')}.json`) }
  private evidence(path: string) {
    const root = canonical(path)
    const gitFile = join(root, '.git')
    return { root, directoryIdentity: identity(root, true), gitFileIdentity: identity(gitFile, false), gitLink: readFileSync(gitFile, 'utf8') }
  }
  recordCreated(path: string): void {
    const evidence = this.evidence(path)
    const destination = this.path(evidence.root); const temporary = `${destination}.${randomUUID()}.tmp`
    try { writeFileSync(temporary, JSON.stringify(evidence), { flag: 'wx', mode: 0o600 }); renameSync(temporary, destination) }
    finally { rmSync(temporary, { force: true }) }
  }
  isCreated(path: string): boolean {
    try {
      const evidence = this.evidence(path)
      const recorded: unknown = JSON.parse(readFileSync(this.path(evidence.root), 'utf8'))
      return JSON.stringify(recorded) === JSON.stringify(evidence)
    } catch { return false }
  }
}
