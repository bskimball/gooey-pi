import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { BrowserSelectionTray } from '../../apps/desktop/src/components/BrowserSelectionTray'
import { ExtensionStatusIndicator, ExtensionTabCard, ExtensionTabPill } from '../../apps/desktop/src/components/ExtensionTabControls'
import type { AgentBrowserExtensionStatus, AgentBrowserTabRecord, BrowserAnnotation } from '../../packages/core/src/types/api'
import { BrowserReferenceCards, BrowserReferenceContext } from '../../apps/desktop/src/components/transcript/BrowserReferenceCards'
import { annotation, image, noop, tab } from './data'

function BrowserAttachments({ offline = false, paused = false, processing = false, error = '' }) {
  const [currentTab, setTab] = useState<AgentBrowserTabRecord>({ ...tab, paused })
  const [annotations, setAnnotations] = useState<BrowserAnnotation[]>([
    annotation,
    { ...annotation, id: 'stale', stale: true, preview: undefined, comment: 'This capture predates the last navigation.' },
  ])
  const [action, setAction] = useState('')
  const status = { connected: !offline, extensionPath: '/sample/extension', bridgePort: null, activeSessionKey: tab.sessionFile, pairedTabCount: 1 } satisfies AgentBrowserExtensionStatus
  const extension = {
    status,
    setPaused: (_tab: AgentBrowserTabRecord, value: boolean) => setTab({ ...currentTab, paused: value }),
    setPicking: (_tab: AgentBrowserTabRecord, value: boolean) => setTab({ ...currentTab, picking: value }),
    focus: () => setAction('Focus requested for sample tab'),
    popOut: () => setAction('Pop out requested'),
  }
  return (
    <>
      <ExtensionStatusIndicator status={status} />
      <ExtensionTabCard tab={currentTab} extension={extension} />
      <ExtensionTabPill tab={currentTab} extension={extension} />
      <BrowserSelectionTray
        annotations={annotations}
        processing={processing}
        error={error}
        onRemove={(id) => setAnnotations(annotations.filter((entry) => entry.id !== id))}
        onClear={() => setAnnotations([])}
        onReveal={(reference) => setAction(`Reveal ${reference.selector}`)}
      />
      <BrowserReferenceContext.Provider value={(reference) => setAction(`Reveal ${reference.selector}`)}>
        <BrowserReferenceCards
          references={[
            { pageUrl: annotation.pageUrl, pageTitle: annotation.pageTitle, label: 'Send button', selector: '#send', comment: annotation.comment, imageIndex: 0 },
            { pageUrl: annotation.pageUrl, pageTitle: 'Sample chat', comment: '', label: 'Composer', selector: '.composer' },
          ]}
          images={[image]}
        />
      </BrowserReferenceContext.Provider>
      <output>{action}</output>
    </>
  )
}
const meta = { title: 'Chat/Browser attachments', component: BrowserAttachments } satisfies Meta<typeof BrowserAttachments>
export default meta
type Story = StoryObj<typeof meta>
export const Connected: Story = {}
export const Paused: Story = { args: { paused: true } }
export const Offline: Story = { args: { offline: true } }
export const Processing: Story = { args: { processing: true } }
export const CaptureFailure: Story = { args: { error: 'The selected element is no longer available.' } }
export const Empty: Story = { render: () => <BrowserSelectionTray annotations={[]} onClear={noop} onRemove={noop} /> }
