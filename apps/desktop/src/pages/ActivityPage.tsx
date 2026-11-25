import * as stylex from '@stylexjs/stylex'
import type { ReactNode, Ref } from 'react'
import { SpacesPage } from '@/components/activity/SpacesPage'
import type { ActivityControls } from '@/hooks/useActivityControls'
import type { ApexApi, MessageEnterAction, ProjectRecord, SessionRecord } from '@/types/api'

export interface ActivityPageProps {
  renderInspector?(content: ReactNode): ReactNode
  contentRef?: Ref<HTMLDivElement>
  contentInert?: boolean
  bridge?: ApexApi | null
  sessions: SessionRecord[]
  projects: ProjectRecord[]
  controls?: ActivityControls
  showReasoning?: boolean
  showTools?: boolean
  messageEnterAction?: MessageEnterAction
}

const styles = stylex.create({ content: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 } })

export function ActivityPage(props: ActivityPageProps) {
  if (!props.bridge?.spaces) return <><div ref={props.contentRef} className={`activity-main ${stylex.props(styles.content).className ?? ''}`} inert={props.contentInert}><p>Spaces require a connection to the desktop app.</p></div>{props.renderInspector?.(<p>Spaces require a connection to the desktop app.</p>)}</>
  return <SpacesPage {...props} />
}
