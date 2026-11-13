import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { isPathWithin, requireString } from 'apex-core/validation'
import type { ProjectService } from './projects'

export const MAX_WORKSPACE_TEXT_BYTES = 256 * 1024

/** Read a bounded current-file preview within the requested authorized workspace. */
export async function readWorkspaceText(projects: Pick<ProjectService, 'authorizeReadOnlyCwd'>, rootValue: unknown, pathValue: unknown): Promise<{ path: string; text: string; truncated: boolean }> {
  const root = await projects.authorizeReadOnlyCwd(requireString(rootValue, 'workspace', { min: 1, max: 4096 }))
  const requested = requireString(pathValue, 'file path', { min: 1, max: 4096 })
  if (requested.includes('\0')) throw new TypeError('File path contains a NUL byte')
  const candidate = isAbsolute(requested) ? resolve(requested) : resolve(root, requested)
  if (!isPathWithin(root, candidate)) throw new Error('File path is outside the active workspace')
  const target = await realpath(candidate)
  if (!isPathWithin(root, target)) throw new Error('File path resolves outside the active workspace')
  if (!(await stat(target)).isFile()) throw new Error('File path is not a regular file')
  const file = await open(target, 'r')
  try {
    const initial = await file.stat({ bigint: true })
    if (!initial.isFile()) throw new Error('File path is not a regular file')
    const verify = async (): Promise<void> => {
      const current = await realpath(candidate)
      if (!isPathWithin(root, current) || current !== target) throw new Error('File path changed while reading')
      const pathStat = await stat(current, { bigint: true })
      if (!pathStat.isFile() || initial.ino === 0n || pathStat.ino !== initial.ino || pathStat.dev !== initial.dev) throw new Error('File identity changed while reading')
      await projects.authorizeReadOnlyCwd(root)
    }
    await verify()
    const size = Number(initial.size > BigInt(MAX_WORKSPACE_TEXT_BYTES + 4) ? BigInt(MAX_WORKSPACE_TEXT_BYTES + 4) : initial.size)
    const buffer = Buffer.alloc(size)
    let length = 0
    while (length < size) {
      const { bytesRead } = await file.read(buffer, length, size - length, length)
      if (!bytesRead) throw new Error('File changed while reading')
      length += bytesRead
    }
    const final = await file.stat({ bigint: true })
    if (final.size !== initial.size || final.mtimeNs !== initial.mtimeNs) throw new Error('File changed while reading')
    await verify()
    if (buffer.includes(0)) throw new Error('Binary files cannot be previewed as text')
    try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer, { stream: initial.size > BigInt(length) }) }
    catch { throw new Error('File is not valid UTF-8 text') }
    const truncated = initial.size > BigInt(MAX_WORKSPACE_TEXT_BYTES)
    let end = Math.min(length, MAX_WORKSPACE_TEXT_BYTES)
    if (truncated && length > end && (buffer[end] & 0xc0) === 0x80) {
      while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--
    }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, end))
    const path = relative(root, candidate)
    return { path: process.platform === 'win32' ? path.split('\\').join('/') : path, text, truncated }
  } finally { await file.close() }
}
