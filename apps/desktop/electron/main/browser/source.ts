import { open, realpath, stat as fileStat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBrowserSourceHint, type BrowserSourceResult } from 'apex-core/browser/source'
import { isPathWithin, requireString } from 'apex-core/validation'
import type { ProjectService } from '../projects'

/** Checks the reported location, not the page's claim that this file produced the element. */
export async function resolveBrowserSource(projects: Pick<ProjectService, 'authorizeCwd'>, cwdValue: unknown, hintValue: unknown): Promise<BrowserSourceResult> {
  const hint = parseBrowserSourceHint(hintValue)
  if (!hint) return { kind: 'unknown', reason: 'No usable original-source metadata was reported by this element.' }
  try {
    const cwd = await projects.authorizeCwd(requireString(cwdValue, 'workspace', { min: 1, max: 4096 }))
    let requested = hint.path
    if (requested.startsWith('file:')) requested = fileURLToPath(requested)
    else if (/^[a-z][a-z\d+.-]*:/i.test(requested) && !/^[a-z]:[\\/]/i.test(requested)) {
      return { kind: 'unknown', reason: 'The page reported a URL, not an original local source path.' }
    }
    const candidate = isAbsolute(requested) ? requested : resolve(cwd, requested)
    if (!isPathWithin(cwd, candidate)) return { kind: 'unknown', reason: 'The reported source is outside the active workspace.' }
    const path = await realpath(candidate)
    if (!isPathWithin(cwd, path)) return { kind: 'unknown', reason: 'The reported source is outside the active workspace.' }
    if (!(await fileStat(path)).isFile()) return { kind: 'unknown', reason: 'The reported source is not a regular file.' }
    const file = await open(path, 'r')
    try {
      const stat = await file.stat()
      if (!stat.isFile()) return { kind: 'unknown', reason: 'The reported source is not a regular file.' }
      if (hint.line !== undefined) {
        if (stat.size > 2 * 1024 * 1024) return { kind: 'unknown', reason: 'The source file is too large to validate its reported line.' }
        const buffer = Buffer.alloc(stat.size + 1)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        if (bytesRead !== stat.size) return { kind: 'unknown', reason: 'The source changed while checking it. Select the element again.' }
        const text = buffer.subarray(0, bytesRead).toString('utf8')
        if (text.includes('\0') || hint.line > text.split(/\r\n|\n|\r/).length) {
          return { kind: 'unknown', reason: 'The reported line is not valid in the local source file.' }
        }
      }
    } finally {
      await file.close()
    }
    return { kind: 'resolved', path, ...(hint.line !== undefined ? { line: hint.line } : {}), evidence: hint.kind }
  } catch {
    return { kind: 'unknown', reason: 'The reported source is unavailable in the active granted workspace.' }
  }
}
