import type { CSSProperties } from 'react'
import type { PrimeContextUsage, SessionUsage } from '@/types/api'
import { contextDialLabel } from '@/lib/format-cost'

/** How much of the model's context the session has used, as a ring beside the send controls. */
export function ContextUsageRing({ contextUsage, sessionUsage }: { contextUsage?: PrimeContextUsage | null; sessionUsage?: SessionUsage | null }) {
  const percent = contextUsage?.percent === null || contextUsage?.percent === undefined ? null : Math.min(100, Math.max(0, contextUsage.percent))
  const label = contextDialLabel(contextUsage ?? undefined, sessionUsage ?? undefined)
  return (
    <span
      className={`context-usage-dial ${percent === null ? 'is-unavailable' : percent >= 95 ? 'is-critical' : percent >= 80 ? 'is-warning' : ''}`}
      role="meter"
      tabIndex={0}
      aria-label="Context usage"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent === null ? undefined : Math.round(percent)}
      aria-valuetext={label}
      title={label}
      data-tooltip={label}
      style={{ '--context-percent': `${percent ?? 0}%` } as CSSProperties}
    >
      <span>{percent === null ? '—' : Math.min(99, Math.round(percent))}</span>
    </span>
  )
}
