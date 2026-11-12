import { errorMessage } from '@/lib/errors'
import type { ProjectRecord, SessionRecord } from '@/types/api'

export interface WorkspaceSnapshot {
  generation: number
  project?: ProjectRecord
  session?: SessionRecord
  cwd?: string
  sessionFile?: string
}

export const cleanRequestErrorDetail = (error: unknown): string =>
  (error instanceof Error || typeof error === 'string' ? errorMessage(error) : '')
    .replace(/^Error invoking remote method '[^']+':\s*(?:(?:TypeError|Error):\s*)?/i, '')
    .trim()
    .slice(0, 1_000)

export const requestFailureMessage = (error: unknown) => {
  const detail = cleanRequestErrorDetail(error)
  return detail ? `Request failed: ${detail}` : 'The request could not be processed.'
}
