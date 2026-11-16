import * as stylex from '@stylexjs/stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex'
import type { ReactNode } from 'react'
import { useFocusTrap } from './ui'

export interface InspectorShellProps {
  visible: boolean
  overlay: boolean
  onClose(): void
  label: string
  children: ReactNode
}

export function InspectorShell({ visible, overlay, onClose, label, children }: InspectorShellProps) {
  const inspectorRef = useFocusTrap<HTMLElement>(overlay && visible, onClose)
  return (
    <aside
      ref={inspectorRef}
      className={`inspector ${stylex.props(inspectorStyles.inspector, [responsiveStyles.inspector, responsiveLayoutStyles.inspector], !visible && inspectorStyles.inspectorHidden).className ?? ''}`}
      hidden={!visible}
      inert={!visible}
      aria-label={label}
      tabIndex={overlay ? -1 : undefined}
    >
      {children}
    </aside>
  )
}
