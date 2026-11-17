import type { Decorator } from '@storybook/react-vite'
import * as stylex from '@stylexjs/stylex'
const styles = stylex.create({
  frame: { width: '100%', minWidth: 0, color: 'var(--text)', backgroundColor: 'var(--canvas)' },
  narrow: { maxWidth: 360 },
  wide: { maxWidth: 960 },
  editor: { height: 760, position: 'relative', overflow: 'hidden' },
})
/** Content geometry only. The viewport addon controls the actual iframe dimensions. */
export const sharedFrame: Decorator = (Story, context) => (
  <div {...stylex.props(styles.frame, context.globals.viewport?.value === 'narrow' ? styles.narrow : styles.wide)}>
    <Story />
  </div>
)
export const editorFrame: Decorator = (Story, context) => (
  <div {...stylex.props(styles.frame, styles.editor, context.globals.viewport?.value === 'narrow' ? styles.narrow : styles.wide)}>
    <Story />
  </div>
)
