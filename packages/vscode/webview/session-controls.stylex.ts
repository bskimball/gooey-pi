import * as stylex from '@stylexjs/stylex'

export const styles = stylex.create({
  chip: {
    minHeight: 28,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    paddingBlock: 0,
    paddingInline: 7,
    fontSize: 'var(--fs-meta)',
  },
})
