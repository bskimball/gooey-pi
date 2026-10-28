import type { MessagePart } from '@/types/api'

type ToolResult = Extract<MessagePart, { type: 'toolResult' }>
export type SpecialistStatus = 'running' | 'done' | 'error' | 'stopped' | 'closed'

export const specialistStatusLabel: Record<SpecialistStatus, string> = {
  running: 'Reported running', done: 'Finished', error: 'Failed', stopped: 'Stopped', closed: 'Closed',
}

export function specialistStepStatus(status: unknown): SpecialistStatus | undefined {
  if (status === 'completed' || status === 'done' || status === 'ok') return 'done'
  if (status === 'failed' || status === 'error' || status === 'timeout') return 'error'
  if (status === 'aborted' || status === 'cancelled') return 'stopped'
  if (status === 'running' || status === 'starting' || status === 'retrying') return 'running'
  return undefined
}

export function workerDetails(details: unknown): Record<string, unknown> | undefined {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined
  const record = details as Record<string, unknown>
  const worker = record.worker
  return worker && typeof worker === 'object' && !Array.isArray(worker) ? worker as Record<string, unknown> : record
}

export function specialistLifecycle(result: ToolResult): string | undefined {
  const worker = workerDetails(result.details)
  return typeof worker?.lifecycle === 'string' ? worker.lifecycle.toLowerCase()
    : /\blifecycle[:=]\s*([a-z_]+)\b/i.exec(result.text)?.[1]?.toLowerCase()
}

/** Lifecycle receipts describe the worker process; closing it does not establish a successful outcome. */
export function specialistOutcome({ previous, tool, result, startsGeneration = false }: {
  previous: SpecialistStatus
  tool: string
  result?: ToolResult
  startsGeneration?: boolean
}): SpecialistStatus {
  if (!result) return previous
  const lifecycle = specialistLifecycle(result)
  const running = lifecycle === 'running' || lifecycle === 'starting' || lifecycle === 'retrying'
  if (result.streaming) return running ? 'running' : previous
  if (lifecycle === 'failed') return 'error'
  if (lifecycle === 'aborted') return 'stopped'
  if (result.isError && ['task_send', 'task_status', 'task_close', 'task_abort'].includes(tool)) return previous
  const worker = workerDetails(result.details)
  const killReason = worker?.killReason || /^kill_reason:\s*\S+/m.test(result.text)
  if (result.isError || (killReason && !running && !startsGeneration)) return 'error'
  if (tool === 'task_abort') return previous === 'error' ? previous : 'stopped'
  if (lifecycle === 'closed' || tool === 'task_close') return previous === 'running' ? 'closed' : previous
  if (running || startsGeneration) return 'running'
  if (lifecycle === 'settled' || /^task_\d+\s+(?:already\s+)?settled\b/im.test(result.text)) {
    return previous === 'error' || previous === 'stopped' ? previous : 'done'
  }
  return previous
}
