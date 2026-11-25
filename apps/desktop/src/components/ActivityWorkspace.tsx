import * as stylex from '@stylexjs/stylex'
import { styles as workbenchStyles } from 'apex-ui/styles/workbench.stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { styles as overlaysStyles } from 'apex-ui/styles/overlays.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex'
import { useContext } from 'react'
import type { CSSProperties, ReactNode, Ref } from 'react'
import { ArrowsInSimple, ArrowsOutSimple, SidebarRight } from './icons'
import { AnimatePresence, motion } from 'motion/react'
import { InspectorWindowButton, InspectorWindowContext } from './InspectorWindow'
import { InspectorShell } from './InspectorShell'
import { ResizeHandle } from './ResizeHandle'
import { IconButton } from './ui'
import { INSPECTOR_MIN } from '@/hooks/usePanelLayout'

interface ActivityWorkspaceProps {
  rowRef: Ref<HTMLDivElement>
  inspectorVisible: boolean
  instant?: boolean
  compact: boolean
  width: number
  maxWidth: number
  defaultWidth: number
  expanded: boolean
  onWidthChange(value: number): void
  onToggleExpanded(): void
  onClose(): void
  children(renderInspector: (content: ReactNode) => ReactNode): ReactNode
}

const styles = stylex.create({ header: { alignItems: 'center', fontSize: 12 } })

export function ActivityWorkspace({ rowRef, inspectorVisible, instant = false, compact, width, maxWidth, defaultWidth, expanded, onWidthChange, onToggleExpanded, onClose, children }: ActivityWorkspaceProps) {
  const { popup } = useContext(InspectorWindowContext)
  const renderInspector = (content: ReactNode) => (
    <>
      {inspectorVisible && !popup && !compact ? <ResizeHandle orientation="vertical" label="Resize inspector" value={width} min={INSPECTOR_MIN} max={maxWidth} defaultValue={defaultWidth} onChange={onWidthChange} /> : null}
      <InspectorShell visible={inspectorVisible} instant={instant} overlay={compact && !popup} onClose={onClose} label="Space details">
        <div className={`inspector__tabs ${stylex.props(inspectorStyles.inspectorTabs, [responsiveStyles.inspectorTabs, responsiveLayoutStyles.inspectorTabs], styles.header).className ?? ''}`}>
          <strong>Space details</strong>
          <span className={`inspector__tab-spacer ${stylex.props(inspectorStyles.inspectorTabSpacer).className ?? ''}`} />
          <InspectorWindowButton />
          {!compact && !popup ? (
            <IconButton xstyle={inspectorStyles.inspectorHeaderButton} label={expanded ? 'Restore inspector width' : 'Expand inspector'} onClick={onToggleExpanded}>
              {expanded ? <ArrowsInSimple size={16} /> : <ArrowsOutSimple size={16} />}
            </IconButton>
          ) : null}
          {compact && !popup ? (
            <IconButton xstyle={inspectorStyles.inspectorHeaderButton} label="Close inspector" onClick={onClose}>
              <SidebarRight size={16} />
            </IconButton>
          ) : null}
        </div>
        <div className={`inspector__body ${stylex.props(inspectorStyles.inspectorBody).className ?? ''}`}>{content}</div>
      </InspectorShell>
      <AnimatePresence initial={false}>
        {inspectorVisible && !popup ? (
          <motion.button
            key="inspector-scrim"
            type="button"
            className={`panel-scrim panel-scrim--inspector ${stylex.props(overlaysStyles.panelScrim, [responsiveStyles.panelScrim, responsiveLayoutStyles.panelScrim], responsiveStyles.panelScrimInspector).className ?? ''}`}
            aria-label="Close inspector"
            onClick={onClose}
            initial={instant ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={instant ? undefined : { opacity: 0, transition: { duration: 0.12, ease: [0.2, 0, 0, 1] } }}
            transition={instant ? { duration: 0 } : { duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
          />
        ) : null}
      </AnimatePresence>
    </>
  )
  return (
    <div ref={rowRef} className={`session-workspace ${stylex.props(workbenchStyles.sessionWorkspace).className ?? ''}`} style={{ '--inspector-width': `${width}px` } as CSSProperties}>
      {children(renderInspector)}
    </div>
  )
}
