import * as stylex from '@stylexjs/stylex'
import { StatusMark } from './activity/StatusMark'
import { MorphInline } from './ContentMotion'
import { Pause } from './icons'

const styles = stylex.create({
  mark: { position: 'relative', display: 'inline-grid', flexShrink: 0, alignSelf: 'center' },
  blocked: { color: 'var(--warning)' },
})

export function PlanStatusMark({ status, instant, size = 14 }: { status: string; instant: boolean; size?: number }) {
  const state = status === 'completed' ? 'done' : status === 'in_progress' ? 'running' : status === 'cancelled' ? 'stale' : 'pending'
  return (
    <span aria-hidden="true" {...stylex.props(styles.mark)} style={{ width: size, height: size }}>
      <MorphInline morphKey={status} instant={instant}>
        {status === 'blocked' ? <Pause {...stylex.props(styles.blocked)} size={size} weight="bold" /> : <StatusMark state={state} size={size} />}
      </MorphInline>
    </span>
  )
}
