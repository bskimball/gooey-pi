import * as stylex from '@stylexjs/stylex'

export const selectionDetailsMarker = stylex.defineMarker()

export const styles = stylex.create({
  connectedDot: {
    backgroundColor: 'var(--success)', backgroundImage: 'none', backgroundPosition: '0% 0%',
    backgroundSize: 'auto auto', backgroundRepeat: 'repeat', backgroundAttachment: 'scroll',
    backgroundOrigin: 'padding-box', backgroundClip: 'border-box', opacity: 1,
  },
  pausedDot: {
    backgroundColor: 'var(--warning)', backgroundImage: 'none', backgroundPosition: '0% 0%',
    backgroundSize: 'auto auto', backgroundRepeat: 'repeat', backgroundAttachment: 'scroll',
    backgroundOrigin: 'padding-box', backgroundClip: 'border-box',
  },
  cardState: { marginTop: 10, color: 'var(--text-secondary)', fontSize: 'var(--fs-meta)' },
  cardDot: {
    '::after': {
      animationName: 'none', animationDuration: '0s', animationDelay: '0s', animationTimingFunction: 'ease',
      animationIterationCount: 1, animationDirection: 'normal', animationFillMode: 'none', animationPlayState: 'running',
    },
  },
  selectionLabel: { color: 'var(--text-tertiary)', fontSize: 'var(--fs-micro)', fontWeight: 600, letterSpacing: '.02em', textTransform: 'uppercase' },
  selectionTitle: { maxWidth: '100%', overflowX: 'hidden', overflowY: 'hidden', color: 'var(--text)', fontWeight: 600, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  selectionDetails: { maxWidth: '100%' },
  selectionSummary: { cursor: 'pointer', fontSize: 'var(--fs-meta)' },
  selectionCode: {
    maxWidth: '100%', overflowX: 'hidden', overflowY: 'hidden', color: 'var(--text-tertiary)',
    fontSize: 10.5, lineHeight: 1.4, fontFamily: '"SFMono-Regular", Menlo, monospace',
    fontStyle: 'normal', fontWeight: 'normal', fontStretch: 'normal', fontVariantCaps: 'normal', textOverflow: 'ellipsis',
    whiteSpace: { default: 'nowrap', [stylex.when.ancestor('[open]', selectionDetailsMarker)]: 'normal' },
    display: { default: null, [stylex.when.ancestor('[open]', selectionDetailsMarker)]: 'block' },
    marginTop: { default: null, [stylex.when.ancestor('[open]', selectionDetailsMarker)]: 4 },
    overflowWrap: { default: null, [stylex.when.ancestor('[open]', selectionDetailsMarker)]: 'anywhere' },
  },
  pressedButton: {
    color: 'var(--apex)', backgroundColor: 'var(--apex-soft)', backgroundImage: 'none', backgroundPosition: '0% 0%',
    backgroundSize: 'auto auto', backgroundRepeat: 'repeat', backgroundAttachment: 'scroll', backgroundOrigin: 'padding-box', backgroundClip: 'border-box',
  },
  actionButton: { minHeight: 32, fontSize: 'var(--fs-ui)' },
  captureLabel: { color: 'var(--text-tertiary)', fontSize: 'var(--fs-meta)' },
  capturePreview: { maxWidth: '100%' },
})
