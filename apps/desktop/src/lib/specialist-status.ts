import type { StatusMarkState } from '@/components/activity/StatusMark'
import { isLiveSpecialist, type SpecialistStatus } from 'apex-core/specialists/status'

export * from 'apex-core/specialists/status'

export function specialistMarkState(status: SpecialistStatus): StatusMarkState {
  if (isLiveSpecialist(status)) return 'running'
  if (status === 'done') return 'done'
  if (status === 'error') return 'failed'
  return 'stale'
}

/** Model ids arrive as `provider/model`; tabs and sidebar rows have room for the model alone. */
export function shortModelName(model: string | undefined): string | undefined {
  const name = model?.split('/').at(-1)?.trim()
  return name || undefined
}
