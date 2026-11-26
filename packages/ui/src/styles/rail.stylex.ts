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
  menu: {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--edge)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-lg)',
    padding: '4px 0',
    minWidth: 160,
  },
  menuItem: {
    padding: '8px 12px',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    display: 'block',
    ':hover': { backgroundColor: 'var(--surface-hover)' },
  },
})
