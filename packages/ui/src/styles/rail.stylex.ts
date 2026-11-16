import * as stylex from '@stylexjs/stylex'

export const styles = stylex.create({
  rail: {
    display: 'flex', flexDirection: 'column', flexShrink: 0,
    width: 50, height: '100%', minHeight: 0, boxSizing: 'border-box',
    paddingTop: 6, paddingBottom: 6, alignItems: 'center', gap: 14,
    borderRightWidth: 1, borderRightStyle: 'solid', borderRightColor: 'var(--edge)',
    backgroundColor: 'transparent',
    boxShadow: 'inset -1px 0 var(--edge-highlight)',
  },
  macRail: { paddingTop: 52 },
  group: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 },
  bottom: { marginTop: 'auto' },
  button: { width: 40, height: 40, flexShrink: 0 },
  active: { color: 'var(--text)', backgroundColor: 'var(--surface-hover)' },
})
