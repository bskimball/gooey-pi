import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useEffect, useState } from 'react'
import { createApexStoryFixture } from '../../.storybook/apex-fixture'
import { installHostFixture } from '../../.storybook/host-fixtures'
import { Inspector } from '../../apps/desktop/src/components/Inspector'
import { SummaryPanel } from '../../apps/desktop/src/components/inspector/SummaryPanel'
import { SummaryAgentsSection } from '../../apps/desktop/src/components/inspector/SummaryAgentsSection'
import { RunConfigSection } from '../../apps/desktop/src/components/inspector/RunConfigSection'
import { SpecialistsPanel } from '../../apps/desktop/src/components/inspector/SpecialistsPanel'
import { SpecialistFiles } from '../../apps/desktop/src/components/inspector/SpecialistMatrix'
import { ChangesPanel } from '../../apps/desktop/src/components/inspector/ChangesPanel'
import { FilesPanel } from '../../apps/desktop/src/components/inspector/FilesPanel'
import { useBrowserAnnotations } from '../../apps/desktop/src/hooks/useBrowserAnnotations'
import type { InspectorTab, TranscriptMessage } from '../../apps/desktop/src/types/api'
import { cleanGit, dirtyGit, noop, project, specialists } from './fixtures'
import { installWorkspaceHost } from './host'

const meta = {
  title: 'Workspace/Inspector',
  beforeEach: () => {
    installWorkspaceHost()
  },
  decorators: [
    (Story) => (
      <div style={{ width: 560, height: 700, position: 'relative', overflow: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
const evidence: TranscriptMessage[] = [
  {
    id: 'tools',
    role: 'assistant',
    parts: [
      { type: 'toolCall', id: 'read-1', name: 'read', args: { path: '/story/atlas/src/navigation.tsx', offset: 1, limit: 20 } },
      { type: 'toolResult', name: 'read', text: 'export function navigationLabel() {}' },
    ],
  },
]
const workerMessages: TranscriptMessage[] = [
  {
    id: 'delegation',
    role: 'assistant',
    parts: [
      { type: 'toolCall', id: 'builder', name: 'task', args: { agent: 'Builder', prompt: 'Implement keyboard navigation. Preserve focus after closing the inspector.', cwd: project.path } },
      {
        type: 'toolResult',
        name: 'task',
        text: 'Implemented keyboard focus restoration. All scoped checks pass.',
        details: { model: 'claude-sonnet-4-5', finalReport: '## Result\nNavigation now restores focus.\n\n- Added keyboard coverage\n- Preserved existing shortcuts' },
      },
      { type: 'toolCall', id: 'reviewer', name: 'task', args: { agent: 'Reviewer', prompt: 'Review the narrow shell and keyboard paths.' } },
    ],
  },
]
function InspectorStory({ initialTab = 'summary', narrow = false, empty = false }: { initialTab?: InspectorTab; narrow?: boolean; empty?: boolean }) {
  const [git, setGit] = useState(cleanGit)
  const [gitHost] = useState(() => window.apex.git)
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
  const [tab, setTab] = useState<InspectorTab>(initialTab)
  const [selected, setSelected] = useState<string | null>(null)
  const [visible, setVisible] = useState(true)
  const annotations = useBrowserAnnotations('story-inspector')
  return (
    <Inspector
      activeTab={tab}
      onTabChange={setTab}
      onClose={() => setVisible(false)}
      selectedSpecialistId={selected}
      onSelectSpecialist={setSelected}
      project={empty ? undefined : project}
      cwd={empty ? undefined : project.path}
      messages={empty ? [] : workerMessages}
      git={empty ? { isRepo: false, files: [] } : git}
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
      visible={visible}
      overlay={narrow}
    />
  )
}
export const Overview: Story = { render: () => <InspectorStory /> }
export const Changes: Story = { render: () => <InspectorStory initialTab="changes" /> }
export const StageAndUnstage: Story = {
  render: () => <InspectorStory initialTab="changes" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Stage' }))
    await waitFor(() => expect(canvas.getByText('No unstaged changes.')).toBeVisible())
    await userEvent.click(canvas.getByRole('radio', { name: 'Staged' }))
    await waitFor(() => expect(canvas.getByText('2 changed files')).toBeVisible())
    await userEvent.click(await canvas.findByRole('button', { name: 'Unstage' }))
    await waitFor(() => expect(canvas.getByText('1 changed file')).toBeVisible())
    await userEvent.click(canvas.getByRole('radio', { name: 'Unstaged' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: /navigation.tsx/ })).toBeVisible())
    await expect(canvas.getByText('1 changed file')).toBeVisible()
  },
}
export const Files: Story = { render: () => <InspectorStory initialTab="files" /> }
export const Agents: Story = { render: () => <InspectorStory initialTab="specialists" /> }
export const AgentToolHistory: Story = {
  beforeEach: () => {
    const transcript: TranscriptMessage[] = [{
      id: 'investigation', role: 'assistant', parts: [
        { type: 'thinking', text: 'Check where the inspector sends focus when it closes.' },
        { type: 'toolCall', id: 'read-source', name: 'read', args: { path: 'src/navigation.tsx', offset: 12, limit: 5 } },
        { type: 'toolResult', name: 'read', text: 'triggerRef.current?.focus()' },
        { type: 'toolCall', id: 'run-test', name: 'bash', args: { command: 'npm test -- navigation' } },
        { type: 'toolResult', name: 'bash', text: 'Expected the trigger to have focus. Received document.body.', isError: true },
        { type: 'text', text: 'The trigger loses focus when the inspector closes.' },
      ],
    }]
    installHostFixture(createApexStoryFixture({ sessions: { read: async () => transcript } }))
  },
  render: () => <div style={{ width: 340 }}><SpecialistsPanel messages={[{
    id: 'parent', role: 'assistant', parts: [
      { type: 'toolCall', name: 'task', id: 'review', args: { agent: 'Reviewer', prompt: 'Check keyboard focus restoration.' } },
      { type: 'toolResult', name: 'task', text: 'The trigger loses focus when the inspector closes.', details: { sessionFile: '/story/review.jsonl' } },
    ],
  }]} selectedId="review" onSelect={noop} /></div>,
}
export const Browser: Story = { render: () => <InspectorStory initialTab="browser" /> }
export const NarrowOverlay: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
  render: () => <InspectorStory narrow />,
}
export const NoProject: Story = { render: () => <InspectorStory empty initialTab="files" /> }
export const SummaryReadiness: Story = {
  render: () => (
    <SummaryPanel
      summary={{
        toolCount: 18,
        todos: [
          { id: '1', content: 'Implement focus restoration', status: 'completed' },
          { id: '2', content: 'Audit transcript scroll anchoring across narrow viewports', status: 'completed' },
          { id: '3', content: 'Verify narrow shell', status: 'in_progress' },
          { id: '4', content: 'Stabilize compact plan toggle alignment and overflow wrapping at 340px width', status: 'in_progress', note: 'Checking stylex layers' },
          { id: '5', content: 'Await reviewer feedback', status: 'blocked', note: 'Review in progress' },
          { id: '6', content: 'Confirm blocked task overflow cap', status: 'blocked', note: '4th active/blocked item' },
          { id: '7', content: 'Validate keyboard tab order and list scrolling', status: 'pending' },
          { id: '8', content: 'Reset expansion state on session change', status: 'pending' },
          { id: '9', content: 'Drop deprecated inline plan badge experiment', status: 'cancelled' },
          { id: '10', content: 'Verify Storybook readiness snapshot', status: 'pending' },
          { id: '11', content: 'Check dark and light contrast tokens', status: 'pending' },
          { id: '12', content: 'Sign off inspector closeout checklist', status: 'pending' },
        ],
        specialists,
      }}
      readiness={{
        lastEditIndex: 2,
        checks: [
          { kind: 'test', outcome: 'passed', changesSince: 0 },
          { kind: 'lint', outcome: 'failed', changesSince: 0 },
          { kind: 'typecheck', outcome: 'running', changesSince: 0 },
          { kind: 'build', outcome: 'unknown', changesSince: 1 },
        ],
        reviews: [{ agent: 'oracle', verdict: 'PASS', changesSince: 1 }],
      }}
      cwd={project.path}
      git={dirtyGit}
      automations={[]}
      onOpenAutomation={noop}
      onOpenSpecialist={noop}
    />
  ),
}
function AgentOverflowStory() {
  // Local sample data: three copies of the fixture so finished agents exceed the 8-token limit and show +N.
  const overflow = [0, 1, 2].flatMap((copy) => specialists.map((s) => ({ ...s, id: `${s.id}-${copy}` })))
  const [opened, setOpened] = useState<string | null>(null)
  return (
    <div style={{ width: 340 }}>
      <SummaryAgentsSection specialists={overflow} onOpenSpecialist={setOpened} />
      <output aria-label="Opened agent">{opened ? `Opened ${opened}` : 'No agent opened'}</output>
    </div>
  )
}
export const AgentOverflow: Story = { render: () => <AgentOverflowStory /> }
export const RunConfiguration: Story = { render: () => <RunConfigSection cwd={project.path} behaviorMode="Fusion" /> }
export const RunConfigurationLoading: Story = {
  beforeEach: () => {
    installWorkspaceHost('loading')
  },
  render: () => <RunConfigSection cwd={project.path} sessionKey="loading" />,
}
export const RunConfigurationFailure: Story = {
  beforeEach: () => {
    installWorkspaceHost('failure')
  },
  render: () => <RunConfigSection cwd={project.path} sessionKey="failure" />,
}
export const EmptyAgents: Story = { render: () => <SpecialistsPanel messages={[]} selectedId={null} onSelect={noop} /> }
export const ObservedSpecialistFiles: Story = { render: () => <SpecialistFiles messages={evidence} cwd={project.path} /> }
export const SourceNavigationFailure: Story = {
  beforeEach: () => {
    installWorkspaceHost('failure')
  },
  render: () => <SpecialistFiles messages={evidence} cwd={project.path} />,
}
export const CleanChanges: Story = { render: () => <ChangesPanel cwd={project.path} git={cleanGit} onRefreshGit={noop} /> }
export const UnauthorizedChanges: Story = { render: () => <ChangesPanel git={{ isRepo: false, files: [], error: 'Project access is required' }} onGrantProject={noop} onRefreshGit={noop} /> }
export const ChangesLoading: Story = {
  beforeEach: () => {
    installWorkspaceHost('loading')
  },
  render: () => <InspectorStory initialTab="changes" />,
}
export const ChangesFailure: Story = {
  beforeEach: () => {
    installWorkspaceHost('failure')
  },
  render: () => <InspectorStory initialTab="changes" />,
}
export const FilesLoading: Story = {
  beforeEach: () => {
    installWorkspaceHost('loading')
  },
  render: () => <InspectorStory initialTab="files" />,
}
export const FilesFailure: Story = {
  beforeEach: () => {
    installWorkspaceHost('failure')
  },
  render: () => <InspectorStory initialTab="files" />,
}
export const EmptyFiles: Story = {
  beforeEach: () => {
    installWorkspaceHost('empty')
  },
  render: () => <InspectorStory initialTab="files" />,
}
export const MultiRootFiles: Story = { render: () => <FilesPanel project={{ ...project, folders: [project.path, '/story/shared'] }} git={dirtyGit} onReveal={noop} onOpen={noop} /> }
