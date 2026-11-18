import * as stylex from '@stylexjs/stylex'
import type { ApexContextUsage, SessionUsage } from '@/types/api'
import { contextDialLabel } from '@/lib/format-cost'

const styles = stylex.create({
  dial: {
    position: 'relative',
    width: 26.4,
    height: 26.4,
    display: 'grid',
    placeItems: 'center',
    flex: '0 0 26.4px',
    borderRadius: '50%',
    color: 'var(--text-secondary)',
    cursor: 'help',
    fontVariantNumeric: 'tabular-nums',
    '::before': { content: '""', position: 'absolute', inset: 2.65, borderRadius: 'inherit', backgroundColor: 'var(--surface-raised)' },
    '::after': {
      content: 'attr(data-tooltip)',
      position: 'absolute',
      zIndex: 60,
      right: -10,
      bottom: 38,
      width: 'max-content',
      maxWidth: 250,
      paddingBlock: 5,
      paddingInline: 7,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: 'var(--border)',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--text)',
      backgroundColor: 'var(--surface-raised)',
      boxShadow: 'var(--shadow-popover)',
      fontSize: 'var(--fs-micro)',
      fontWeight: 400,
      lineHeight: 1.35,
      whiteSpace: 'nowrap',
      opacity: { default: 0, ':hover': 1, ':focus-visible': 1 },
      pointerEvents: 'none',
      transform: { default: 'translateY(2px)', ':hover': 'translateY(0)', ':focus-visible': 'translateY(0)', '@media (prefers-reduced-motion: reduce)': 'none' },
      transition: 'opacity 120ms ease-out, transform 120ms ease-out',
      transitionDelay: { default: '0ms', ':hover': '200ms' },
    },
  },
  fill: (percent: number, color: string) => ({ backgroundImage: `conic-gradient(${color} ${percent}%, var(--surface-selected) 0)` }),
  label: {
    position: 'absolute',
    zIndex: 1,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    padding: 0,
    fontSize: 'var(--fs-micro)',
    fontWeight: 600,
    lineHeight: 1,
    textAlign: 'center',
    transform: 'translateY(0.25px)',
  },
})

/** How much of the model's context the session has used, as a ring beside the send controls. */
export function ContextUsageRing({ contextUsage, sessionUsage }: { contextUsage?: ApexContextUsage | null; sessionUsage?: SessionUsage | null }) {
  const percent = contextUsage?.percent === null || contextUsage?.percent === undefined ? null : Math.min(100, Math.max(0, contextUsage.percent))
  const label = contextDialLabel(contextUsage ?? undefined, sessionUsage ?? undefined)
  const color = percent === null ? 'var(--text-tertiary)' : percent >= 95 ? 'var(--danger)' : percent >= 80 ? 'var(--warning)' : 'var(--apex)'
  const dialStyle = stylex.props(styles.dial, styles.fill(percent ?? 0, color))
  return (
    <span
      className={`context-usage-dial ${dialStyle.className}`}
      role="meter"
      tabIndex={0}
      aria-label="Context usage"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent === null ? undefined : Math.round(percent)}
      aria-valuetext={label}
      title={label}
      data-tooltip={label}
      style={dialStyle.style}
    >
      <span {...stylex.props(styles.label)}>{percent === null ? '—' : Math.min(99, Math.round(percent))}</span>
    </span>
  )
}
