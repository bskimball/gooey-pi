import * as stylex from '@stylexjs/stylex'

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)'
const shimmer = stylex.keyframes({ from: { backgroundPosition: '150% 0' }, to: { backgroundPosition: '-50% 0' } })
const breathe = stylex.keyframes({
  '0%, 100%': { boxShadow: '0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent)' },
  '50%': { boxShadow: '0 0 0 6px color-mix(in srgb, var(--accent) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--accent) 45%, var(--border))' },
})
const enter = stylex.keyframes({ from: { opacity: 0, transform: 'translateY(4px)' } })

// The opening placeholder and the ready empty state share one layout, so the title and copy
// fade in where the skeleton stood instead of replacing a spinner.
export const styles = stylex.create({
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, width: '100%', maxWidth: 440, boxSizing: 'border-box', marginInline: 'auto', marginBlock: 0, padding: 24, textAlign: 'center' },
  emptyIcon: { display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 12, border: '1px solid var(--border)', color: 'var(--accent)', backgroundColor: 'var(--surface-subtle)', marginBottom: 4 },
  emptyTitle: { margin: 0, fontSize: 20, fontWeight: 550, letterSpacing: '-0.025em', lineHeight: 1.3, color: 'var(--text)' },
  emptyCopy: { margin: 0, maxWidth: 340, fontSize: 13, lineHeight: 1.65, color: 'var(--text-secondary)', textWrap: 'pretty' },
  enter: { animationName: { default: enter, [REDUCED_MOTION]: 'none' }, animationDuration: '260ms', animationTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)', animationFillMode: 'both' },
  openingIcon: { animationName: { default: breathe, [REDUCED_MOTION]: 'none' }, animationDuration: '1.8s', animationTimingFunction: 'ease-in-out', animationIterationCount: 'infinite' },
  openingTitle: { width: 220, maxWidth: '80%', height: 14, marginBlock: 6, borderRadius: 7, backgroundImage: 'linear-gradient(90deg, var(--surface-subtle) 0%, color-mix(in srgb, var(--text) 9%, var(--surface-subtle)) 50%, var(--surface-subtle) 100%)', backgroundSize: '200% 100%', animationName: { default: shimmer, [REDUCED_MOTION]: 'none' }, animationDuration: '1.6s', animationTimingFunction: 'linear', animationIterationCount: 'infinite' },
  // Two lines tall, like the ready copy it gives way to.
  openingCopy: { minHeight: '3.3em', color: 'transparent', backgroundImage: 'linear-gradient(90deg, var(--text-tertiary) 0%, var(--text-tertiary) 40%, var(--text) 50%, var(--text-tertiary) 60%, var(--text-tertiary) 100%)', backgroundSize: '200% 100%', backgroundClip: 'text', WebkitBackgroundClip: 'text', animationName: { default: shimmer, [REDUCED_MOTION]: 'none' }, animationDuration: '1.6s', animationTimingFunction: 'linear', animationIterationCount: 'infinite' },
})
