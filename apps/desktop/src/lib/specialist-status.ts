import type { MessagePart } from '@/types/api'
import type { StatusMarkState } from '@/components/activity/StatusMark'
import { applySpecialistEvents, isLiveSpecialist, type SpecialistEvent, type SpecialistStatus } from './specialistMachine'

export { isLiveSpecialist, type SpecialistStatus } from './specialistMachine'

type ToolResult = Extract<MessagePart, { type: 'toolResult' }>

export const specialistStatusLabel: Record<SpecialistStatus, string> = {
  running: 'Reported running', waiting: 'Waiting for input', done: 'Finished', error: 'Failed', stopped: 'Stopped', closed: 'Closed',
}

export function specialistMarkState(status: SpecialistStatus): StatusMarkState {
  if (isLiveSpecialist(status)) return 'running'
  if (status === 'done') return 'done'
  if (status === 'error') return 'failed'
  return 'stale'
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

/** The worker's pending UI dialogs, when the receipt reports them. */
export function uiRequestsEvent(details: unknown): SpecialistEvent[] {
  const requests = workerDetails(details)?.waiting_ui_requests
  return Array.isArray(requests) ? [{ type: 'UI_REQUESTS', waiting: requests.length > 0 }] : []
}

/** Translates one task_* receipt into its outcome event. Lifecycle receipts describe the worker process; closing it does not establish a successful outcome. */
function outcomeEvent(tool: string, result: ToolResult, startsGeneration: boolean): SpecialistEvent | undefined {
  const lifecycle = specialistLifecycle(result)
  const running = lifecycle === 'running' || lifecycle === 'starting' || lifecycle === 'retrying'
  if (result.streaming) return running ? { type: 'RUNNING' } : undefined
  if (lifecycle === 'failed') return { type: 'FAILED' }
  if (lifecycle === 'aborted') return { type: 'ABORTED' }
  if (result.isError && ['task_send', 'task_status', 'task_close', 'task_abort'].includes(tool)) return undefined
  const killReason = workerDetails(result.details)?.killReason || /^kill_reason:\s*\S+/m.test(result.text)
  if (result.isError || (killReason && !running && !startsGeneration)) return { type: 'FAILED' }
  if (tool === 'task_abort') return { type: 'ABORTED' }
  if (lifecycle === 'closed' || tool === 'task_close') return { type: 'CLOSED' }
  if (running || startsGeneration) return { type: 'RUNNING' }
  if (lifecycle === 'settled' || /^task_\d+\s+(?:already\s+)?settled\b/im.test(result.text)) return { type: 'SETTLED' }
  return undefined
}

export function specialistOutcome({ previous, tool, result, startsGeneration = false }: {
  previous: SpecialistStatus
  tool: string
  result?: ToolResult
  startsGeneration?: boolean
}): SpecialistStatus {
  if (!result) return previous
  const outcome = outcomeEvent(tool, result, startsGeneration)
  return applySpecialistEvents(previous, [...(outcome ? [outcome] : []), ...uiRequestsEvent(result.details)])
}
