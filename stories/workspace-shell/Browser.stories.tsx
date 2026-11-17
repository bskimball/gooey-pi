import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { BrowserPanel } from '../../apps/desktop/src/components/inspector/BrowserPanel'
import { BrowserAnnotationPopover } from '../../apps/desktop/src/components/inspector/BrowserAnnotationPopover'
import { AgentBrowserLayer, AgentCursorOverlay } from '../../apps/desktop/src/components/AgentBrowserLayer'
import { useBrowserAnnotations } from '../../apps/desktop/src/hooks/useBrowserAnnotations'
import type { StampedPointerEvent } from '../../apps/desktop/src/hooks/useAgentBrowserTabs'
import type { AgentBrowserTabRecord, BrowserAnnotationElement } from '../../apps/desktop/src/types/api'
import { ApexButton } from '../../apps/desktop/src/components/ui'
import { noop, session } from './fixtures'
import { installWorkspaceHost } from './host'

const meta = {
  title: 'Workspace/Browser',
  beforeEach: () => {
    installWorkspaceHost()
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
const element: BrowserAnnotationElement = {
  selector: 'button.continue',
  tagName: 'BUTTON',
  id: 'continue',
  classes: ['continue'],
  text: 'Continue to workspace',
  rect: { x: 40, y: 60, width: 180, height: 40 },
}
const tab: AgentBrowserTabRecord = {
  tabId: 'story-extension',
  backend: 'extension',
  sessionFile: session.filePath,
  url: 'https://example.invalid/workspace',
  title: 'Atlas workspace · Shared Chrome tab',
  attached: true,
  active: true,
  canGoBack: true,
  canGoForward: false,
  pairedByUser: true,
  selection: element,
}
function SharedBrowser({ disconnected = false, empty = false }: { disconnected?: boolean; empty?: boolean }) {
  const annotations = useBrowserAnnotations('story-browser')
  const [paused, setPaused] = useState(false)
  const [picking, setPicking] = useState(false)
  const [closed, setClosed] = useState(empty)
  const [notice, setNotice] = useState('')
  return (
    <div style={{ height: 650, maxWidth: 780, position: 'relative' }}>
      <BrowserPanel
        home="about:blank"
        annotations={annotations}
        agentTabs={closed ? [] : [{ ...tab, paused, picking }]}
        activeAgentTabId={closed ? null : tab.tabId}
        previewSelected={false}
        onOpenExternal={() => setNotice('Open external captured locally')}
        onSelectAgentTab={noop}
        onCloseAgentTab={() => setClosed(true)}
        onShowPreview={() => setClosed(true)}
        onAgentSlotRect={noop}
        onPreviewContext={noop}
        onNavigateAgentTab={(_, action) => setNotice(`Navigation captured: ${action}`)}
        extension={{
          status: { connected: !disconnected, extensionPath: '/story/extension', bridgePort: null, activeSessionKey: session.filePath, pairedTabCount: closed ? 0 : 1 },
          setPaused: (_, value) => setPaused(value),
          setPicking: (_, value) => setPicking(value),
          focus: () => setNotice('Focus shared tab captured locally'),
          popOut: noop,
        }}
      />
      <output>{notice}</output>
      <AgentBrowserLayer tabs={closed ? [] : [tab]} visibleTabId={closed ? null : tab.tabId} rect={null} pointerEvent={null} onAttach={noop} />
    </div>
  )
}
export const SharedExtensionTab: Story = { render: () => <SharedBrowser /> }
export const DisconnectedExtension: Story = { render: () => <SharedBrowser disconnected /> }
export const EmptyBrowserChrome: Story = { render: () => <SharedBrowser empty /> }
export const NarrowBrowserChrome: Story = {
  render: () => (
    <div style={{ width: 360 }}>
      <SharedBrowser />
    </div>
  ),
}
function Annotation({ source = false }: { source?: boolean }) {
  const [text, setText] = useState('Keep the primary action visible on narrow screens.')
  const [open, setOpen] = useState(true)
  const [message, setMessage] = useState('')
  return (
    <div style={{ height: 600, position: 'relative' }}>
      <ApexButton onClick={() => setOpen(true)}>Comment on element</ApexButton>
      {open && (
        <BrowserAnnotationPopover
          element={source ? { ...element, sourceHint: { kind: 'explicit', path: 'src/navigation.tsx', line: 12 } } : element}
          cwd={source ? '/story/atlas' : undefined}
          index={1}
          platform="win32"
          text={text}
          onTextChange={setText}
          onCancel={() => setOpen(false)}
          onSave={() => {
            setMessage('Annotation saved locally')
            setOpen(false)
            return true
          }}
          onRequestSend={() => setMessage('Send requested locally')}
        />
      )}
      <output>{message}</output>
    </div>
  )
}
export const AnnotationUnknownSource: Story = { render: () => <Annotation /> }
export const AnnotationValidatedSource: Story = { render: () => <Annotation source /> }
export const AnnotationSourceFailure: Story = {
  beforeEach: () => {
    installWorkspaceHost('failure')
  },
  render: () => <Annotation source />,
}
function Cursor() {
  const [pointer, setPointer] = useState<StampedPointerEvent | null>(null)
  return (
    <div style={{ width: 600, height: 400, position: 'relative' }}>
      <ApexButton
        onClick={() =>
          setPointer((previous) => ({
            tabId: tab.tabId,
            sessionFile: session.filePath,
            seq: (previous?.seq ?? 0) + 1,
            from: { x: 80, y: 100 },
            to: { x: 380, y: 220 },
            action: 'click',
            durationMs: 450,
          }))
        }
      >
        Replay agent click
      </ApexButton>
      <AgentCursorOverlay pointerEvent={pointer} />
      <AgentBrowserLayer tabs={[tab]} visibleTabId={tab.tabId} rect={{ left: 0, top: 50, width: 600, height: 350 }} pointerEvent={pointer} onAttach={noop} />
    </div>
  )
}
export const AgentCursorAndLayer: Story = { globals: { motion: 'full' }, render: () => <Cursor /> }
