import { useId } from 'react'

export type StatusMarkState = 'pending' | 'running' | 'done' | 'failed' | 'stale'

export interface StatusMarkProps {
  state: StatusMarkState
  /** Square edge length in px. */
  size?: number
  className?: string
}

/**
 * Apex "crest" status marks, drawn from the logo's concentric rings. Each state has its own shape:
 * pending is a ring, stale a dashed ring, running three rings with a wave moving outward,
 * done a solid disc with a knocked-out check, failed a crossed ring.
 * Each state has a default color in styles/activity.css; contexts may override it via `color`.
 * Decorative only: nearby text or the container's aria-label carries the meaning.
 */
export function StatusMark({ state, size = 14, className }: StatusMarkProps) {
  const maskId = useId()
  const classes = `status-mark status-mark--${state}${className ? ` ${className}` : ''}`
  return (
    <svg className={classes} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      {state === 'running' ? (
        <>
          <circle cx="8" cy="8" r="2" fill="currentColor" />
          <circle cx="8" cy="8" r="4.25" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.25" />
        </>
      ) : state === 'done' ? (
        <>
          <mask id={maskId}>
            <rect width="16" height="16" fill="white" />
            <path d="M5 8.3l2 2 4-4.4" stroke="black" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </mask>
          <circle cx="8" cy="8" r="7" fill="currentColor" mask={`url(#${maskId})`} />
        </>
      ) : state === 'failed' ? (
        <>
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.25" />
          <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : (
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.25" strokeDasharray={state === 'stale' ? '2.4 2.2' : undefined} />
      )}
    </svg>
  )
}
