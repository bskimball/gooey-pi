import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useEffect, useState } from 'react'
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
    await userEvent.click(canvas.getByRole('button', { name: 'Staged' }))
    await waitFor(() => expect(canvas.getByText('2 changed files')).toBeVisible())
    await userEvent.click(await canvas.findByRole('button', { name: 'Unstage' }))
    await waitFor(() => expect(canvas.getByText('1 changed file')).toBeVisible())
    await userEvent.click(canvas.getByRole('button', { name: 'Unstaged' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: /navigation.tsx/ })).toBeVisible())
    await expect(canvas.getByText('1 changed file')).toBeVisible()
  },
}
export const Files: Story = { render: () => <InspectorStory initialTab="files" /> }
export const Agents: Story = { render: () => <InspectorStory initialTab="specialists" /> }
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
          { id: '2', content: 'Verify narrow shell', status: 'in_progress' },
          { id: '3', content: 'Await reviewer feedback', status: 'blocked', note: 'Review in progress' },
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
export const AgentOverflow: Story = { render: () => <SummaryAgentsSection specialists={[...specialists, ...specialists.map((s) => ({ ...s, id: `${s.id}-again` }))]} onOpenSpecialist={noop} /> }
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
