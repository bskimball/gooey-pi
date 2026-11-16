import * as stylex from '@stylexjs/stylex'
import { ChatCircleDots } from '@/components/icons'
import { styles } from './chief-of-staff.stylex'

/** Shown from the Activity switch until Chief of Staff is ready: chunk load, Spaces list, and runtime attach. */
export function ChiefOfStaffOpening() {
  return <div className={`activity-coordinator__loading ${stylex.props(styles.empty).className ?? ''}`} role="status">
    <span {...stylex.props(styles.emptyIcon, styles.openingIcon)}><ChatCircleDots size={22} aria-hidden="true" /></span>
    <span {...stylex.props(styles.openingTitle)} aria-hidden="true" />
    <p {...stylex.props(styles.emptyCopy, styles.openingCopy)}>Opening Chief of Staff…</p>
  </div>
}
