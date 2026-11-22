import type { Meta, StoryObj } from '@storybook/react-vite'
import { useRef, useState } from 'react'
import { AppRail } from '../../apps/desktop/src/components/AppRail'
import { TitleToolbar } from '../../apps/desktop/src/components/TitleToolbar'
import { SessionControls } from '../../apps/desktop/src/components/SessionControls'
import { Transcript } from '../../apps/desktop/src/components/Transcript'
import { TerminalDrawer } from '../../apps/desktop/src/components/TerminalDrawer'
import { Sidebar } from '../../apps/desktop/src/components/Sidebar'
import { SidebarAttentionGroups, SessionStatusGlyph, WorkingDot } from '../../apps/desktop/src/components/SidebarAttention'
import { SidebarSubagents } from '../../apps/desktop/src/components/SidebarSubagents'
import { CommandPalette } from '../../apps/desktop/src/components/CommandPalette'
import { ResizeHandle } from '../../apps/desktop/src/components/ResizeHandle'
import { InspectorShell } from '../../apps/desktop/src/components/InspectorShell'
import { ActivityWorkspace } from '../../apps/desktop/src/components/ActivityWorkspace'
import { AppToast } from '../../apps/desktop/src/components/AppToast'
import { NoHarnessPrompt } from '../../apps/desktop/src/components/NoHarnessPrompt'
import { RuntimeOwnerNotice } from '../../apps/desktop/src/components/RuntimeOwnerNotice'
import { WindowsAppMenu } from '../../apps/desktop/src/components/WindowsAppMenu'
import { ProjectRunControl } from '../../apps/desktop/src/components/ProjectRunControl'
import { ErrorBoundary } from '../../apps/desktop/src/components/ErrorBoundary'
import { ApexButton, EmptyState } from '../../apps/desktop/src/components/ui'
import type { SessionRecord, WorkspaceView } from '../../apps/desktop/src/types/api'
import { cleanGit, done, noop, project, session, sessions, specialists } from './fixtures'

import { installWorkspaceHost } from './host'

const meta = {
  title: 'Workspace/Shell',
  beforeEach: () => {
    installWorkspaceHost()
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Workspace({ narrow = false, loading = false, empty = false }: { narrow?: boolean; loading?: boolean; empty?: boolean }) {
  const [view, setView] = useState<WorkspaceView>('session')
  const [sidebar, setSidebar] = useState(true)
  const [inspector, setInspector] = useState(!narrow)
  const [palette, setPalette] = useState(false)
  const [selected, setSelected] = useState(session)
  const [notice, setNotice] = useState('')
  const [width, setWidth] = useState(280)
  const [terminal, setTerminal] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(240)
  const [storySessions, setStorySessions] = useState(sessions)
  const nextSample = useRef(0)
  const addSampleSession = () => {
    const index = nextSample.current++
    const stamp = new Date().toISOString()
    const sample: SessionRecord = { ...session, id: `story-sample-${index}`, filePath: `/story/sessions/sample-${index}.jsonl`, title: `Sample session ${index + 1}`, status: 'idle', unread: false, createdAt: stamp, updatedAt: stamp, lastUserMessageAt: stamp }
    setStorySessions((items) => [sample, ...items])
    setSelected(sample)
    setNotice(`Sample session ${index + 1} added in memory`)
  }
  const archiveSampleSession = async (target: SessionRecord) => {
    const remaining = storySessions.filter((item) => item.id !== target.id)
    setStorySessions(remaining)
    if (target.id === selected.id && remaining[0]) setSelected(remaining[0])
    setNotice(`Archived ${target.title} in memory`)
  }
  return (
    <div className="app-shell" style={{ display: 'flex', height: 720, maxWidth: narrow ? 440 : 1440, position: 'relative', overflow: 'hidden' }}>
      <AppRail
        platform="win32"
        view={view}
        sidebarOpen={sidebar}
        onToggleSidebar={() => setSidebar(!sidebar)}
        voiceOpen={false}
        onToggleVoice={() => setNotice('Voice belongs to the workspace pages inventory.')}
        onNavigate={setView}
        terminalOpen={terminal}
        onToggleTerminal={() => setTerminal(!terminal)}
        vscodeProject={project}
        onOpenInVsCode={() => setNotice('Editor handoff captured locally.')}
      />
      {sidebar && (
        <div style={{ width, flexShrink: 0 }}>
          <Sidebar
            projects={empty ? [] : [project]}
            sessions={empty ? [] : storySessions}
            loading={loading}
            activeProjectId={project.id}
            activeSessionId={selected.id}
            activeView={view}
            specialistRosters={{ [session.filePath]: specialists }}
            onOpenSpecialist={(_, id) => setNotice(`Selected ${id}`)}
            onSelectProject={() => setView('session')}
            onSelectSession={setSelected}
            onNavigate={setView}
            onNewSession={addSampleSession}
            onAddProject={() => setNotice('Project picker requested')}
            onRemoveProject={() => setNotice('Project removal captured')}
            onClose={() => setSidebar(false)}
            onOpenPalette={() => setPalette(true)}
            onRenameSession={done}
            onArchiveSession={archiveSampleSession}
            platform="win32"
          />
        </div>
      )}
      {sidebar && !narrow && <ResizeHandle orientation="vertical" label="Resize sidebar" value={width} min={220} max={400} defaultValue={280} onChange={setWidth} />}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TitleToolbar
          project={empty ? undefined : project}
          sessionTitle={selected.title}
          view={view}
          inspectorOpen={inspector}
          onToggleInspector={() => setInspector(!inspector)}
          sessionActions={
            <SessionControls
              projects={empty ? [] : [project]}
              sessions={empty ? [] : storySessions}
              activeSessionId={selected.id}
              platform="win32"
              onNewSession={addSampleSession}
              onSelectSession={setSelected}
            />
          }
        />
        <RuntimeOwnerNotice owner={{ app: 'vscode', label: 'VS Code · Atlas', sessions: [selected.filePath] }} />
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <Transcript
            messages={
              empty
                ? []
                : [
                    { id: 'request', role: 'user', parts: [{ type: 'text', text: 'Review the workspace navigation and keep keyboard focus intact.' }] },
                    {
                      id: 'reply',
                      role: 'assistant',
                      parts: [{ type: 'text', text: 'The sidebar and inspector are ready for review. I checked focus restoration and the narrow layout. The specialist review is still running.' }],
                    },
                  ]
            }
            git={cleanGit}
            loading={loading}
            onOpenChanges={() => setInspector(true)}
            onSuggestion={() => setNotice('Suggestion captured locally')}
          />
        </div>
        {terminal && (
          <TerminalDrawer
            cwd={project.path}
            sessionPath={selected.filePath}
            height={terminalHeight}
            minHeight={160}
            maxHeight={450}
            defaultHeight={240}
            onHeightChange={setTerminalHeight}
            onClose={() => setTerminal(false)}
          />
        )}
      </main>
      <InspectorShell visible={inspector} overlay={narrow} onClose={() => setInspector(false)} label="Workspace agents">
        <SidebarSubagents session={selected} specialists={specialists} selected onOpen={(_, id) => setNotice(`Selected ${id}`)} />
      </InspectorShell>
      <CommandPalette
        open={palette}
        harness="pi"
        platform="win32"
        projects={[project]}
        sessions={sessions}
        activeProject={project}
        onClose={() => setPalette(false)}
        onNavigate={setView}
        onNewSession={noop}
        onPreviousSession={noop}
        onToggleSidebar={() => setSidebar(!sidebar)}
        onToggleTerminal={noop}
        onOpenBrowser={() => setInspector(true)}
        onOpenInspectorTab={() => setInspector(true)}
        onSelectSession={setSelected}
        onSelectProject={noop}
      />
      {notice && <AppToast message={notice} onDismiss={() => setNotice('')} />}
    </div>
  )
}
export const Desktop: Story = { render: () => <Workspace /> }
export const Narrow: Story = { render: () => <Workspace narrow /> }
export const Loading: Story = { render: () => <Workspace loading empty /> }
export const Empty: Story = { render: () => <Workspace empty /> }
export const Dark: Story = { globals: { theme: 'dark' }, render: () => <Workspace /> }
export const AttentionAndSubagents: Story = {
  render: () => (
    <div style={{ width: 320 }}>
      <WorkingDot />
      {sessions.map((item) => (
        <div key={item.id}>
          {item.title}
          <SessionStatusGlyph session={item} attention />
        </div>
      ))}
      <SidebarAttentionGroups attention={sessions.slice(1, 3)} running={[session]} projects={[project]} activeView="session" onOpenSession={noop} />
      <SidebarSubagents session={session} specialists={specialists} selected onOpen={noop} />
      <SidebarSubagents session={session} specialists={specialists} selected collapsed onOpen={noop} />
    </div>
  ),
}
function Palette() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <ApexButton onClick={() => setOpen(true)}>Open palette</ApexButton>
      <CommandPalette
        open={open}
        harness="pi"
        projects={[project]}
        sessions={sessions}
        activeProject={project}
        onClose={() => setOpen(false)}
        onNavigate={noop}
        onNewSession={noop}
        onPreviousSession={noop}
        onToggleSidebar={noop}
        onToggleTerminal={noop}
        onOpenBrowser={noop}
        onOpenInspectorTab={noop}
        onSelectSession={noop}
        onSelectProject={noop}
        onOpenFile={noop}
      />
    </>
  )
}
export const PaletteSearch: Story = { render: () => <Palette /> }
function Notices() {
  const [open, setOpen] = useState(true)
  const [message, setMessage] = useState('The run stopped before checks completed. Your draft is preserved.')
  return (
    <>
      <ApexButton onClick={() => setOpen(true)}>Configure Pi</ApexButton>
      {open && (
        <NoHarnessPrompt
          onClose={() => setOpen(false)}
          onOpenHarnessSettings={() => {
            setOpen(false)
            setMessage('Pi settings requested')
          }}
        />
      )}
      {message && <AppToast message={message} onDismiss={() => setMessage('')} />}
    </>
  )
}
export const MissingHarnessAndToast: Story = { render: () => <Notices /> }
function RunControls() {
  const [running, setRunning] = useState(false)
  return (
    <>
      <WindowsAppMenu />
      <ProjectRunControl project={project} activeKind={running ? 'run' : undefined} onRun={() => setRunning(true)} onStop={() => setRunning(false)} />
    </>
  )
}
export const MenuAndProjectRun: Story = { render: () => <RunControls /> }
function ActivityLayout() {
  const rowRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(360)
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={{ height: 600 }}>
      <ActivityWorkspace
        rowRef={rowRef}
        inspectorVisible={open}
        compact={false}
        width={expanded ? 600 : width}
        maxWidth={650}
        defaultWidth={360}
        expanded={expanded}
        onWidthChange={setWidth}
        onToggleExpanded={() => setExpanded(!expanded)}
        onClose={() => setOpen(false)}
      >
        {(renderInspector) => (
          <>
            <SidebarAttentionGroups attention={sessions.slice(1, 3)} running={[session]} projects={[project]} activeView="activity" onOpenSession={noop} />
            {renderInspector(<SidebarSubagents session={session} specialists={specialists} selected onOpen={noop} />)}
          </>
        )}
      </ActivityWorkspace>
    </div>
  )
}
export const ActivityInspectorLayout: Story = { render: () => <ActivityLayout /> }
function FailedChild(): never {
  throw new Error('Deterministic render failure')
}
export const RootFailure: Story = {
  render: () => (
    <ErrorBoundary
      fallback={
        <EmptyState title="Apex could not render this workspace">
          <p>Your draft is preserved.</p>
          <ApexButton onClick={noop}>Reload Apex</ApexButton>
        </EmptyState>
      }
    >
      <FailedChild />
    </ErrorBoundary>
  ),
}
