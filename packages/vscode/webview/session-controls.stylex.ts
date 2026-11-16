import * as stylex from '@stylexjs/stylex'

export const styles = stylex.create({
  chip: {
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    paddingBlock: 0,
    paddingInline: 7,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: 999,
    color: 'var(--text-secondary)',
    backgroundColor: 'var(--surface-subtle)',
    fontSize: 'var(--fs-meta)',
  },
})
