import type { Meta, StoryObj } from '@storybook/react-vite'
import { lazy, Suspense, useLayoutEffect, useState } from 'react'
import { createStoryMeta, createStorySettings } from '../../.storybook/fixture-data'
import { createApexStoryFixture, installHostFixture } from '../../.storybook/host-fixtures'
import { ApexButton } from '../../apps/desktop/src/components/ui'
import { SummaryPlan } from '../../apps/desktop/src/components/inspector/SummaryPlan'
import { TodoStep } from '../../apps/desktop/src/components/transcript/subagent-lane'
import { messages, projects, schedules, sessions, skills } from '../workspace-pages/fixtures'

const meta = {
  title: 'Workspace/Motion',
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const App = lazy(() => import('../../apps/desktop/src/App'))
function NavigationPreview({ reduced, theme, expandProjects = false }: { reduced: boolean; theme: 'light' | 'dark'; expandProjects?: boolean }) {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    if (expandProjects) localStorage.setItem('prime-work.sidebar-collapsed-projects', JSON.stringify(Object.fromEntries(projects.map((project) => [project.id, false]))))
    const chief = { ...sessions[0], id: 'chief', title: 'Chief of Staff', filePath: '/story/chief.jsonl' }
    installHostFixture(
      createApexStoryFixture(
        {
          app: { getMeta: async () => ({ ...createStoryMeta(), harnesses: { pi: { path: '/storybook/bin/pi', version: 'fixture' } } }) },
          projects: { list: async () => projects, touch: async () => true },
          sessions: {
            list: async () => sessions,
            read: async (filePath) => {
              const session = sessions.find((item) => item.filePath === filePath)
              if (!session) return []
              if (session === sessions[0]) return messages
              if (expandProjects && session === sessions[2]) await new Promise((resolve) => setTimeout(resolve, 400))
              return [
                { id: session.id + '-request', role: 'user', timestamp: Date.parse(session.createdAt), parts: [{ type: 'text', text: session.title }] },
                { id: session.id + '-reply', role: 'assistant', timestamp: Date.parse(session.updatedAt), parts: [{ type: 'text', text: session.preview ?? '' }] },
              ]
            },
            listFinishedTasks: async () => [],
          },
          schedules: { list: async () => schedules },
          plugins: { list: async () => ({ skills, warnings: [] }) },
          coordinator: {
            open: async () => ({
              attachmentId: 'story-chief',
              eventSequence: 0,
              session: chief,
              messages: [],
              pendingDialogs: [],
              runtime: { runtimeId: 'story-chief', harness: 'pi', cwd: chief.projectPath, isStreaming: false },
            }),
          },
        },
        { ...createStorySettings(), reduceMotion: reduced, theme },
      ),
    )
    setReady(true)
  }, [expandProjects, reduced, theme])
  return ready ? (
    <div style={{ height: '100dvh' }}>
      <Suspense>
        <App />
      </Suspense>
    </div>
  ) : null
}

export const Navigation: Story = {
  parameters: { layout: 'fullscreen' },
  render: (_, { globals }) => <NavigationPreview key={`${globals.motion}:${globals.theme}`} reduced={globals.motion !== 'full'} theme={globals.theme === 'dark' ? 'dark' : 'light'} />,
}

export const SessionNavigation: Story = {
  parameters: { layout: 'fullscreen' },
  render: (_, { globals }) => <NavigationPreview key={`${globals.motion}:${globals.theme}`} expandProjects reduced={globals.motion !== 'full'} theme={globals.theme === 'dark' ? 'dark' : 'light'} />,
}

const tasks = [
  { id: 'inspect', content: 'Inspect the workspace transitions' },
  { id: 'implement', content: 'Update the disclosure and selection controls' },
  { id: 'verify', content: 'Verify wrapped task labels in a narrow inspector' },
]
const stages = [
  ['pending', 'pending', 'pending'],
  ['in_progress', 'pending', 'pending'],
  ['completed', 'in_progress', 'pending'],
  ['completed', 'blocked', 'in_progress'],
  ['completed', 'completed', 'completed'],
]

function PlanDemo() {
  const [stage, setStage] = useState(0)
  const todos = tasks.map((task, index) => ({ ...task, status: stages[stage][index] }))
  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 340 }}>
      <SummaryPlan todos={todos} />
      <TodoStep part={{ type: 'toolCall', id: 'plan', name: 'todo_write', args: { todos } }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <ApexButton compact disabled={stage === 0} onClick={() => setStage(stage - 1)}>
          Previous update
        </ApexButton>
        <ApexButton compact onClick={() => setStage((stage + 1) % stages.length)}>
          {stage === stages.length - 1 ? 'Restart plan' : 'Next update'}
        </ApexButton>
      </div>
    </div>
  )
}

export const PlanUpdates: Story = { render: () => <PlanDemo /> }
