import { useState } from 'react'
import { click, type, modalRoot, openSchedule } from './interactions'
import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { ProjectsPage } from '../../apps/desktop/src/pages/ProjectsPage'
import { PluginsPage } from '../../apps/desktop/src/pages/PluginsPage'
import { ScheduledPage } from '../../apps/desktop/src/pages/ScheduledPage'
import { projects, sessions, skills, schedules, catalog, noop, succeed, pending, fixedClock } from './fixtures'

function Projects({ empty = false }: { empty?: boolean }) {
  const [items, setItems] = useState(empty ? [] : projects)
  const [opened, setOpened] = useState('')
  return (
    <>
      <ProjectsPage
        projects={items}
        sortMode="recent"
        onAdd={() => setItems(projects)}
        onOpen={(project) => setOpened(project.name)}
        onRemove={(project) => setItems(items.filter((item) => item.id !== project.id))}
        onTogglePin={(project) => setItems(items.map((item) => (item.id === project.id ? { ...item, pinned: !item.pinned } : item)))}
      />
      <output aria-live="polite">{opened && `Opened ${opened} in the fixture`}</output>
    </>
  )
}
const config = { title: 'Workspace/Pages', component: Projects, beforeEach: fixedClock, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof Projects>
export default config
type Story = StoryObj<typeof config>
export const ProjectCatalog: Story = {}
export const ProjectRemoveDialog: Story = { play: async ({ canvasElement }) => click(canvasElement, 'Remove apex') }
export const ProjectSearchEmpty: Story = { play: async ({ canvasElement }) => type(canvasElement, 'Search projects', 'no-such-workspace') }
export const ProjectsEmpty: Story = { args: { empty: true } }

function Plugins({ empty = false, loading = false, failure = false, saving = false }: { empty?: boolean; loading?: boolean; failure?: boolean; saving?: boolean }) {
  const [items, setItems] = useState(empty ? [] : skills)
  const [ask, setAsk] = useState(true)
  const [browser, setBrowser] = useState(true)
  const [computer, setComputer] = useState(false)
  const result = async () => ({ ok: !failure, output: failure ? 'Fixture install failed. Check the package source.' : 'Fixture installed. No host process was started.' })
  const install = saving ? pending<{ ok: boolean; output: string }> : result
  return (
    <PluginsPage
      harness="pi"
      skills={items}
      warnings={failure ? [{ scope: 'project', path: '/fixture/.pi/extensions', message: 'An extension could not be loaded.' }] : []}
      loading={loading}
      activeProjectPath={projects[0].path}
      onRefresh={succeed}
      askUserEnabled={ask}
      onSetAskUserEnabled={async (value) => setAsk(value)}
      browserEnabled={browser}
      onSetBrowserEnabled={async (value) => setBrowser(value)}
      computerUseEnabled={computer}
      onSetComputerUseEnabled={async (value) => setComputer(value)}
      onOpenExternal={noop}
      onInstall={install}
      onInstallExtension={install}
      onSetMcpSupport={install}
      onConnectMcp={install}
      onSetMcpEnabled={install}
      onMutateCapability={async (input) => {
        if (!failure) setItems((current) => current.map((item) => (item.name === input.name ? { ...item, enabled: input.action === 'enable' } : item)))
        return result()
      }}
    />
  )
}
export const PluginCatalog: Story = { render: () => <Plugins /> }
export const PluginAddDialog: Story = { render: () => <Plugins />, play: async ({ canvasElement }) => click(canvasElement, 'Add') }
export const PluginRemoveDialog: Story = { render: () => <Plugins />, play: async ({ canvasElement }) => click(canvasElement, 'Remove GitHub') }
export const PluginExtensionDialog: Story = {
  render: () => <Plugins />,
  play: async ({ canvasElement }) => {
    await click(canvasElement, 'Add')
    await click(modalRoot(canvasElement), /Add Extension/)
    await type(modalRoot(canvasElement), 'Extension file', '/fixture/extension.ts')
  },
}
export const PluginsEmpty: Story = { render: () => <Plugins empty /> }
export const PluginsLoading: Story = { render: () => <Plugins loading /> }
async function installExtension(canvasElement: HTMLElement) {
  await click(canvasElement, 'Add')
  const root = modalRoot(canvasElement)
  await click(root, /Add Extension/)
  await type(root, 'Extension file', '/fixture/extension.ts')
  await click(root, 'Install extension')
}
export const PluginWarningsAndInstallError: Story = { render: () => <Plugins failure />, play: async ({ canvasElement }) => installExtension(canvasElement) }
export const PluginInstallPending: Story = { render: () => <Plugins saving />, play: async ({ canvasElement }) => installExtension(canvasElement) }

function Scheduled({
  empty = false,
  failure = false,
  saving = false,
  unauthorized = false,
  history = false,
  variant = 'ready',
}: {
  empty?: boolean
  failure?: boolean
  saving?: boolean
  unauthorized?: boolean
  history?: boolean
  variant?: 'ready' | 'blocked' | 'once' | 'advanced'
}) {
  const [items, setItems] = useState(
    empty
      ? []
      : history
        ? schedules.map((schedule) => ({
            ...schedule,
            runs: [
              {
                id: 'run-success',
                taskId: schedule.id,
                taskRevision: 1,
                trigger: 'scheduled' as const,
                scheduledFor: '2026-08-06T09:00:00Z',
                queuedAt: '2026-08-06T09:00:00Z',
                finishedAt: '2026-08-06T09:02:00Z',
                status: 'succeeded' as const,
                execution: schedule.execution,
                sessionFile: sessions[0].filePath,
              },
              {
                id: 'run-failed',
                taskId: schedule.id,
                taskRevision: 1,
                trigger: 'manual' as const,
                scheduledFor: '2026-08-05T09:00:00Z',
                queuedAt: '2026-08-05T09:00:00Z',
                status: 'failed' as const,
                execution: schedule.execution,
                error: 'Model provider was unavailable.',
              },
            ],
          }))
        : schedules,
  )
  const [error, setError] = useState(failure ? 'Schedule refresh failed. Previously loaded schedules are shown.' : '')
  const mutate = async (action: () => void) => {
    if (saving) return pending<void>()
    if (failure) throw new Error('Fixture save failed. Your changes have not been saved.')
    action()
  }
  const props: ComponentProps<typeof ScheduledPage> = {
    harness: 'pi',
    schedules: items.map((item) =>
      variant === 'blocked'
        ? { ...item, status: 'blocked', blockedReason: 'The project folder is no longer authorized.' }
        : variant === 'once'
          ? { ...item, timing: { kind: 'once', at: '2026-08-07T09:00:00Z' } }
          : variant === 'advanced'
            ? { ...item, timing: { kind: 'rrule', dtstartLocal: '2026-08-07T09:00:00', timeZone: 'UTC', rrule: 'FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=7' } }
            : item,
    ),
    projects: unauthorized ? [] : projects,
    sessions,
    models: unauthorized ? [] : catalog.models,
    lastSelectedModel: catalog.models[0].key,
    error,
    onCreate: (input) => mutate(() => setItems((current) => [...current, { ...schedules[0], ...input, id: `story-${current.length}`, title: input.title || 'New schedule' }])),
    onUpdate: (id, patch) => mutate(() => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))),
    onPause: (id) => mutate(() => setItems((current) => current.map((item) => (item.id === id ? { ...item, status: 'paused' } : item)))),
    onResume: (id) => mutate(() => setItems((current) => current.map((item) => (item.id === id ? { ...item, status: 'active' } : item)))),
    onDelete: (id) => mutate(() => setItems((current) => current.filter((item) => item.id !== id))),
    onRunNow: async () => setError('Fixture run queued. No agent was launched.'),
    onPreview: async (timing) => ({ timing, occurrences: ['2026-08-07T09:00:00Z', '2026-08-10T09:00:00Z'] }),
    onOpenSession: noop,
  }
  return <ScheduledPage {...props} />
}
export const ScheduleBlocked: Story = {
  render: () => <Scheduled variant="blocked" />,
  play: async ({ canvasElement }) => {
    await click(canvasElement, 'Needs attention')
    await click(canvasElement, 'Open Morning issue triage')
    await expect(await within(canvasElement).findByText('The project folder is no longer authorized.')).toBeVisible()
  },
}
export const ScheduleOneTime: Story = { render: () => <Scheduled variant="once" />, play: async ({ canvasElement }) => openSchedule(canvasElement) }
export const ScheduleAdvanced: Story = { render: () => <Scheduled variant="advanced" />, play: async ({ canvasElement }) => openSchedule(canvasElement) }
export const ScheduleCatalog: Story = { render: () => <Scheduled /> }
export const ScheduleRunHistory: Story = { render: () => <Scheduled history />, play: async ({ canvasElement }) => click(canvasElement, 'Open Morning issue triage') }
export const SchedulesEmpty: Story = { render: () => <Scheduled empty /> }
export const ScheduleSaveError: Story = {
  render: () => <Scheduled failure />,
  play: async ({ canvasElement }) => {
    await openSchedule(canvasElement)
    await click(modalRoot(canvasElement), 'Save changes')
  },
}
export const ScheduleSavePending: Story = {
  render: () => <Scheduled saving />,
  play: async ({ canvasElement }) => {
    await openSchedule(canvasElement)
    await click(modalRoot(canvasElement), 'Save changes')
  },
}
export const ScheduleEditDialog: Story = { render: () => <Scheduled />, play: async ({ canvasElement }) => openSchedule(canvasElement) }
export const ScheduleCreateDialog: Story = { render: () => <Scheduled />, play: async ({ canvasElement }) => click(canvasElement, 'New schedule') }
export const ScheduleUnauthorized: Story = { render: () => <Scheduled empty unauthorized /> }
