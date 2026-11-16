import * as stylex from '@stylexjs/stylex'
import { Warning } from './icons'

const styles = stylex.create({
  chip: { maxWidth: 210, height: 26, display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, paddingBlock: 0, paddingInline: 8, overflow: 'hidden', borderWidth: 1, borderStyle: 'solid', borderColor: 'color-mix(in srgb, var(--warning) 42%, var(--border))', borderRadius: 999, color: 'var(--warning)', backgroundColor: 'var(--warning-soft)', fontSize: 'var(--fs-meta)', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
})
import type { RuntimeInfo } from '@/types/api'

export interface ExecutingModelChipProps {
  executingModel: RuntimeInfo['executingModel']
}

export function ExecutingModelChip({ executingModel }: ExecutingModelChipProps) {
  if (!executingModel?.isFallback) return null
  return (
    <span
      className={`model-fallback-chip ${stylex.props(styles.chip).className}`}
      role="status"
      title={`Provider fallback: running on ${executingModel.label} instead of the selected model.`}
    >
      <Warning size={12} /> Running on {executingModel.label}
    </span>
  )
}
