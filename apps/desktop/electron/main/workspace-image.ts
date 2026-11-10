import { open, realpath, stat as fileStat } from 'node:fs/promises'
import { extname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isPathWithin, requireString } from 'apex-core/validation'
import type { PromptImage } from '../../src/types/api'
import type { ProjectService } from './projects'

export const MAX_WORKSPACE_IMAGE_BYTES = 10 * 1024 * 1024

const MIME_BY_EXTENSION: Readonly<Record<string, PromptImage['mimeType']>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

function normalizeImagePath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (trimmed.startsWith('file:')) {
    try {
      return fileURLToPath(trimmed)
    } catch {
      throw new Error('The image URL is not a valid local file URL.')
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^[a-z]:[\\/]/i.test(trimmed)) {
    throw new Error('Remote or non-file image URLs are not supported.')
  }
  const withoutHashOrQuery = trimmed.replace(/[?#].*$/, '')
  try {
    const decoded = decodeURIComponent(withoutHashOrQuery)
    if (decoded.includes('\0')) throw new Error('The image path contains a NUL byte.')
    return decoded
  } catch (error) {
    if (error instanceof Error && error.message.includes('NUL')) throw error
    return withoutHashOrQuery
  }
}

/** Reads a raster image strictly within the active granted workspace. */
export async function readWorkspaceImage(projects: Pick<ProjectService, 'authorizeCwd'>, cwdValue: unknown, pathValue: unknown): Promise<PromptImage> {
  const cwd = await projects.authorizeCwd(requireString(cwdValue, 'workspace', { min: 1, max: 4096 }))
  const requested = normalizeImagePath(requireString(pathValue, 'image path', { min: 1, max: 4096 }))
  if (!requested) throw new Error('The image path is empty.')
  const candidate = isAbsolute(requested) ? requested : resolve(cwd, requested)
  if (!isPathWithin(cwd, candidate)) throw new Error('The image path is outside the active workspace.')
  const path = await realpath(candidate)
  if (!isPathWithin(cwd, path)) throw new Error('The image path resolves outside the active workspace.')
  const mimeType = MIME_BY_EXTENSION[extname(path).toLowerCase()]
  if (!mimeType) throw new Error('Unsupported workspace image extension.')
  if (!(await fileStat(path)).isFile()) throw new Error('The image path is not a regular file.')
  const file = await open(path, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new Error('The image path is not a regular file.')
    if (stat.size <= 0) throw new Error('The workspace image file is empty.')
    if (stat.size > MAX_WORKSPACE_IMAGE_BYTES) throw new Error('The workspace image is too large to display.')
    const buffer = Buffer.alloc(stat.size + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead !== stat.size) throw new Error('The workspace image changed while reading it.')
    return {
      type: 'image',
      mimeType,
      data: buffer.subarray(0, bytesRead).toString('base64'),
    }
  } finally {
    await file.close()
  }
}
