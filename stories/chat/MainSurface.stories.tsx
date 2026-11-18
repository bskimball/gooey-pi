import * as stylex from '@stylexjs/stylex'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState, type CSSProperties } from 'react'
import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { styles as workbenchStyles } from 'apex-ui/styles/workbench.stylex'
import { AppRail } from '../../apps/desktop/src/components/AppRail'
import { Sidebar } from '../../apps/desktop/src/components/Sidebar'
import { ResizeHandle } from '../../apps/desktop/src/components/ResizeHandle'
import { TitleToolbar } from '../../apps/desktop/src/components/TitleToolbar'
import { SessionControls } from '../../apps/desktop/src/components/SessionControls'
import { Transcript } from '../../apps/desktop/src/components/Transcript'
import { Composer } from '../../apps/desktop/src/components/Composer'
import { Inspector } from '../../apps/desktop/src/components/Inspector'
import { useBrowserAnnotations } from '../../apps/desktop/src/hooks/useBrowserAnnotations'
import type { InspectorTab, SessionRecord, TranscriptMessage, WorkspaceView } from '../../apps/desktop/src/types/api'
import { done, dirtyGit, project, sessions, specialists } from '../workspace-shell/fixtures'
import { installWorkspaceHost } from '../workspace-shell/host'
import { branches, history, live, model, models, noop, providers, queue, user } from './data'

/**
 * The composed main chat surface at desktop width, mirroring the session view in App.tsx:
 * rail + sidebar | title toolbar, transcript, docked composer | inspector.
 * Real components only; host calls resolve through the in-memory workspace fixture.
 */
const meta = {
  title: 'Chat/MainSurface',
  beforeEach: () => {
    installWorkspaceHost()
    // Sidebar persists project collapse state; expand the active project so its sessions show. The preview reset clears storage.
    localStorage.setItem('prime-work.sidebar-collapsed-projects', JSON.stringify({ [project.id]: false }))
  },
  parameters: { layout: 'fullscreen' },
  globals: { theme: 'dark', viewport: { value: 'wide', isRotated: false } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const settledMessages = history(24)
/** The live turn starts relative to mount so the running timer reads like a real turn (about 1m in), not the fixture's fixed date. */
const streamingMessages = (startedAt: string): TranscriptMessage[] => [
  ...history(8),
  { ...user, id: 'prompt-live', timestamp: startedAt, parts: [{ type: 'text', text: 'Compose the main chat surface at desktop width and have a reviewer check it.' }] },
  {
    ...live,
    startedAt,
    parts: [
      ...live.parts.slice(0, -2),
      {
        type: 'toolCall',
        id: 'review-live',
        name: 'task',
        args: { agent: 'Reviewer', prompt: 'Review the composed chat surface at desktop width. Check focus order between composer and inspector.' },
      },
      ...live.parts.slice(-2),
    ],
  },
]

type SurfaceProps = { streaming?: boolean; initialTab: InspectorTab }

function MainSurface({ streaming = false, initialTab }: SurfaceProps) {
  const [storySessions] = useState<SessionRecord[]>(() => sessions.map((item, index) => (index === 0 ? { ...item, title: 'Chat design review', status: streaming ? 'running' : 'idle' } : item)))
  const [selected, setSelected] = useState(storySessions[0]!)
  const [view, setView] = useState<WorkspaceView>('session')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(272)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [inspectorWidth, setInspectorWidth] = useState(400)
  const [tab, setTab] = useState<InspectorTab>(initialTab)
  const [specialist, setSpecialist] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState(model.key)
  const [git, setGit] = useState(dirtyGit)
  const [gitHost] = useState(() => window.apex.git)
  const annotations = useBrowserAnnotations('story-main-surface')
  const [liveMessages] = useState(() => streamingMessages(new Date(Date.now() - 72_000).toISOString()))
  const messages = streaming ? liveMessages : settledMessages
  const queued = streaming ? queue.slice(0, 1) : []
  const refreshGit = async () => setGit(await gitHost.status(project.path))
  useEffect(() => {
    let active = true
    void gitHost.status(project.path).then((status) => {
      if (active) setGit(status)
    })
    return () => {
      active = false
    }
  }, [gitHost])
  const openInspector = (next: InspectorTab) => {
    setTab(next)
    setInspectorOpen(true)
  }
  const openSpecialist = (id: string) => {
    setSpecialist(id)
    openInspector('specialists')
  }
  return (
    <div style={{ height: '100vh', minHeight: 640 }}>
      <div
        className={`app-shell ${stylex.props(workbenchStyles.appShell).className ?? ''}`}
        style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
        data-platform="win32"
        data-ready="true"
      >
        <AppRail
          platform="win32"
          view={view}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          voiceOpen={false}
          onToggleVoice={noop}
          onNavigate={setView}
          terminalOpen={false}
          onToggleTerminal={noop}
          vscodeProject={project}
          onOpenInVsCode={noop}
        />
        {sidebarOpen ? (
          <Sidebar
            projects={[project]}
            sessions={storySessions}
            activeProjectId={project.id}
            activeSessionId={selected.id}
            activeView={view}
            specialistRosters={streaming ? { [selected.filePath]: specialists } : {}}
            openSpecialistId={inspectorOpen && tab === 'specialists' ? specialist : null}
            onOpenSpecialist={(_, id) => openSpecialist(id)}
            onSelectProject={() => setView('session')}
            onSelectSession={setSelected}
            onNavigate={setView}
            onNewSession={noop}
            onAddProject={noop}
            onRemoveProject={noop}
            onClose={() => setSidebarOpen(false)}
            onOpenPalette={noop}
            onRenameSession={done}
            onArchiveSession={done}
            platform="win32"
          />
        ) : null}
        {sidebarOpen ? (
          <ResizeHandle
            orientation="vertical"
            edge="end"
            cssVariable="--sidebar-width"
            scopeSelector=".app-shell"
            label="Resize sidebar"
            value={sidebarWidth}
            min={220}
            max={400}
            defaultValue={272}
            onChange={setSidebarWidth}
          />
        ) : null}
        <div className={`workbench ${stylex.props(workbenchStyles.workbench).className ?? ''}`}>
          <TitleToolbar
            project={project}
            sessionTitle={selected.title}
            gitBranch={git.branch}
            view="session"
            inspectorOpen={inspectorOpen}
            onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
            platform="win32"
          />
          <div className={`workbench__content ${stylex.props(workbenchStyles.workbenchContent).className ?? ''}`}>
            <div className={`session-workspace ${stylex.props(workbenchStyles.sessionWorkspace).className ?? ''}`} style={{ '--inspector-width': `${inspectorWidth}px` } as CSSProperties}>
              <div className={`conversation-column ${stylex.props(workbenchStyles.conversationColumn).className ?? ''}`}>
                <main className={`conversation-pane ${stylex.props(workbenchStyles.conversationPane, [responsiveStyles.conversationPane, responsiveLayoutStyles.conversationPane]).className ?? ''}`}>
                  <Transcript
                    key={selected.id}
                    sessionActions={<SessionControls projects={[project]} sessions={storySessions} activeSessionId={selected.id} platform="win32" onNewSession={noop} onSelectSession={setSelected} />}
                    messages={messages}
                    git={git}
                    cwd={project.path}
                    active={streaming}
                    onOpenChanges={() => openInspector('changes')}
                    onOpenSpecialist={openSpecialist}
                    onSuggestion={noop}
                    showPinnedChanges={false}
                    queuedMessageCount={queued.length}
                  />
                  <div
                    className={`conversation-bottom-dock ${stylex.props(workbenchStyles.conversationBottomDock, [responsiveStyles.conversationBottomDock, responsiveLayoutStyles.conversationBottomDock]).className ?? ''}`}
                  >
                    <Composer
                      busy={streaming}
                      model={selectedModel}
                      effort="medium"
                      modelsByProvider={models}
                      providers={providers}
                      reasoningLevels={['off', 'medium', 'high']}
                      fast={false}
                      fastSupported
                      fastAvailable
                      imageInputSupported
                      skills={[{ id: 'review', name: 'review', description: 'Review UI consistency', kind: 'skill', location: 'project', enabled: true }]}
                      sessions={storySessions}
                      fileRoot={project.path}
                      isolatedDraft
                      queuedMessages={queued}
                      onSendQueuedMessage={noop}
                      onDeleteQueuedMessage={noop}
                      onEditQueuedMessage={noop}
                      contextUsage={streaming ? { tokens: 128000, contextWindow: 200000, percent: 64 } : { tokens: 76000, contextWindow: 200000, percent: 38 }}
                      checkoutCatalog={branches}
                      checkoutLabel={git.branch}
                      onExecuteCheckout={noop}
                      onModelChange={setSelectedModel}
                      onEffortChange={noop}
                      onFastChange={noop}
                      onSend={noop}
                      onStop={noop}
                    />
                  </div>
                </main>
              </div>
              {inspectorOpen ? <ResizeHandle orientation="vertical" label="Resize inspector" value={inspectorWidth} min={320} max={640} defaultValue={400} onChange={setInspectorWidth} /> : null}
              <Inspector
                visible={inspectorOpen}
                activeTab={tab}
                onTabChange={setTab}
                onClose={() => setInspectorOpen(false)}
                selectedSpecialistId={specialist}
                onSelectSpecialist={setSpecialist}
                project={project}
                cwd={project.path}
                messages={messages}
                git={git}
                automations={[]}
                onOpenAutomation={noop}
                browserHome="about:blank"
                browserAnnotations={annotations}
                agentBrowserTabs={[]}
                activeAgentTabId={null}
                agentPreviewSelected={false}
                onSelectAgentTab={noop}
                onCloseAgentTab={noop}
                onShowBrowserPreview={noop}
                onAgentSlotRect={noop}
                onPreviewContext={noop}
                previewPointerEvent={null}
                onNavigateAgentTab={noop}
                onRefreshGit={refreshGit}
                onOpenExternal={noop}
                onRevealPath={noop}
                onGrantProject={noop}
                browserActive={streaming}
                platform="win32"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Long settled history; inspector opens on Changes for review after the turn. */
export const Settled: Story = { render: () => <MainSurface initialTab="changes" /> }
/** Live turn: streaming tool output, running reviewer, busy composer with one queued follow-up; inspector on Agents. */
export const Streaming: Story = { render: () => <MainSurface streaming initialTab="specialists" /> }
