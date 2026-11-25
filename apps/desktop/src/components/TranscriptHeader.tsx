import * as stylex from '@stylexjs/stylex'
import type { ReactNode, RefObject } from 'react'
import { TurnNavigator } from './transcript/turn-navigator'

const styles = stylex.create({
  header: {
    position: 'relative', zIndex: 20, width: '100%', flexShrink: 0,
    backgroundColor: 'var(--canvas)', boxShadow: '0 6px 16px -8px rgb(0 0 0 / 0.45)',
  },
  inner: {
    width: '100%', maxWidth: 'var(--transcript-measure)', marginInline: 'auto', display: 'flex', alignItems: 'center',
    gap: 12, paddingInline: { default: 24, '@media (max-width: 720px)': 18 }, paddingBlock: 4, minHeight: 36,
  },
  currentTurn: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden' },
})

export function TranscriptHeader({ scrollRef, active, loading, children }: {
  scrollRef: RefObject<HTMLDivElement | null>
  active: boolean
  loading?: boolean
  children: ReactNode
}) {
  return (
    <div {...stylex.props(styles.header)}>
      <div {...stylex.props(styles.inner)}>
        <div {...stylex.props(styles.currentTurn)}>{!loading && <TurnNavigator scrollRef={scrollRef} active={active} inline />}</div>
        {children}
      </div>
    </div>
  )
}
