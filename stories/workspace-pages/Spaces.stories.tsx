import { useState } from 'react'
import { expect, within, waitFor } from 'storybook/test'
import { click, type } from './interactions'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ActivityPage } from '../../apps/desktop/src/pages/ActivityPage'
import { SpacesPage } from '../../apps/desktop/src/components/activity/SpacesPage'
import { ActivityCoordinator } from '../../apps/desktop/src/components/activity/ActivityCoordinator'
import type { ApexApi, CoordinatorAttachment, SpaceRecord } from '../../packages/core/src/types/api'
import { createApexStoryFixture, createStoryEvents, installHostFixture, registerStoryCleanup } from '../../.storybook/host-fixtures'
import { catalog, projects, sessions, messages, timestamp, pets, voiceFixture, pending, fail, fixedClock } from './fixtures'

type Mode = 'ready' | 'empty' | 'loading' | 'error' | 'busy' | 'question' | 'list-error' | 'list-loading' | 'refresh-error' | 'deleted' | 'disconnected'
function createBridge(mode: Mode): ApexApi {
  let records: SpaceRecord[] = [
    {
      id: 'review',
      name: 'Release readiness',
      objective: 'Review release risks and assign follow-up work.',
      projectId: projects[0].id,
      sessionIds: [sessions[0].id],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]
  const events = createStoryEvents<Parameters<Parameters<ApexApi['agent']['onEvent']>[0]>[0]>()
  registerStoryCleanup(events.reset)
  let sequence = 0
  let listCalls = 0
  let attachment: CoordinatorAttachment = {
    attachmentId: 'story-attachment',
    eventSequence: 0,
    session: sessions[0],
    runtime: {
      runtimeId: 'story-chief',
      harness: 'pi',
      sessionFile: sessions[0].filePath,
      cwd: projects[0].path,
      isStreaming: mode === 'busy',
      model: { provider: 'fixture', id: 'reviewer', name: 'Review model' },
      thinkingLevel: 'medium',
      availableThinkingLevels: ['off', 'medium', 'high'],
      imageInputSupported: true,
    },
    messages: mode === 'empty' ? [] : messages,
    pendingDialogs:
      mode === 'question'
        ? [{ type: 'extension_ui_request', id: 'story-question', method: 'confirm', title: 'Start the release review?', message: 'Use the current project checkout for this review.' }]
        : [],
  }
  const bridge = createApexStoryFixture({
    spaces: {
      list:
        mode === 'list-error'
          ? fail
          : mode === 'list-loading'
            ? pending
            : async () => {
                listCalls += 1
                if (listCalls > 1 && mode === 'refresh-error') return fail()
                if (listCalls > 1 && mode === 'deleted') return []
                return records
              },
      create: async (input) => {
        const space = { ...input, id: `space-${records.length}`, sessionIds: input.sessionIds ?? [], createdAt: timestamp, updatedAt: timestamp }
        records = [...records, space]
        return space
      },
      update: async (id, input) => {
        const existing = records.find((space) => space.id === id)
        if (!existing) throw new Error('Space was deleted')
        const updated = {
          ...existing,
          name: input.name ?? existing.name,
          objective: input.objective ?? existing.objective,
          sessionIds: input.sessionIds ?? [...existing.sessionIds, ...(input.addSessionIds ?? [])].filter((session) => !input.removeSessionIds?.includes(session)),
        }
        records = records.map((space) => (space.id === id ? updated : space))
        return updated
      },
    },
    coordinator: {
      open: mode === 'loading' ? pending : mode === 'error' ? fail : async () => attachment,
      close: async () => true,
      reset: async () => {
        attachment = { ...attachment, messages: [] }
        return true
      },
    },
    agent: {
      list: async () => [attachment.runtime],
      onEvent: events.subscribe,
      command: async (_runtimeId, command) => {
        if (command.type === 'abort') attachment = { ...attachment, runtime: { ...attachment.runtime, isStreaming: false } }
        sequence += 1
        events.emit({ runtimeId: attachment.runtime.runtimeId, sequence, event: { type: 'agent_end' } })
        return { success: true }
      },
    },
    providers: { catalog: async () => catalog },
    projects: { list: async () => projects },
    sessions: { list: async () => sessions, read: async () => messages },
    pets,
    voice: voiceFixture(),
  })
  return bridge
}
function Spaces({ mode = 'ready', direct = false, coordinatorOnly = false }: { mode?: Mode; direct?: boolean; coordinatorOnly?: boolean }) {
  const [bridge] = useState(() => {
    const fixture = createBridge(mode)
    installHostFixture(fixture)
    return fixture
  })
  if (coordinatorOnly) return <ActivityCoordinator bridge={bridge} showReasoning showTools projectName="Apex" />
  const props = { bridge: mode === 'disconnected' ? null : bridge, projects, sessions, showReasoning: true, showTools: true }
  return direct ? <SpacesPage {...props} /> : <ActivityPage {...props} />
}
const config = {
  title: 'Workspace/Spaces',
  component: Spaces,
  beforeEach: fixedClock,
  parameters: { layout: 'fullscreen' },
  args: { mode: 'ready', direct: false, coordinatorOnly: false },
  argTypes: { mode: { control: 'select', options: ['ready', 'empty', 'loading', 'error', 'busy', 'question', 'list-error', 'list-loading', 'refresh-error', 'deleted', 'disconnected'] } },
} satisfies Meta<typeof Spaces>
export default config
type Story = StoryObj<typeof config>
export const ActivityPageReady: Story = {}
export const SpacesRefreshFailure: Story = {
  args: { mode: 'refresh-error', direct: true },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/Spaces could not refresh:/)).toBeVisible()
    await expect(within(canvasElement).getByRole('button', { name: 'Release readiness' })).toBeVisible()
  },
}
export const SpacesDeletedSelection: Story = {
  args: { mode: 'deleted', direct: true },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(within(canvasElement).queryByText('Loading spaces...')).not.toBeInTheDocument())
    await waitFor(() => expect(within(canvasElement).queryByRole('button', { name: 'Release readiness' })).not.toBeInTheDocument())
    await expect(within(canvasElement).getByRole('heading', { name: 'Global Chief of Staff' })).toBeVisible()
  },
  beforeEach: () => {
    const key = 'apex.activity.selected-space'
    const previous = localStorage.getItem(key)
    localStorage.setItem(key, 'review')
    return () => {
      if (previous === null) localStorage.removeItem(key)
      else localStorage.setItem(key, previous)
    }
  },
}
export const SpacesDisconnected: Story = { args: { mode: 'disconnected', direct: true } }
export const SpacesReady: Story = { args: { direct: true } }
export const CreateSpace: Story = {
  play: async ({ canvasElement }) => {
    await click(canvasElement, 'New space')
    await type(canvasElement, /^Name(?: Required)?$/, 'Search redesign')
    await type(canvasElement, 'Objective', 'Review keyboard access and search ranking.')
    await expect(within(canvasElement).getByRole('textbox', { name: /^Name(?: Required)?$/ })).toHaveValue('Search redesign')
    await expect(within(canvasElement).getByRole('textbox', { name: 'Objective' })).toHaveValue('Review keyboard access and search ranking.')
  },
}
export const EditObjective: Story = { play: async ({ canvasElement }) => click(canvasElement, 'Edit objective') }
export const ClearCoordinatorDialog: Story = { args: { coordinatorOnly: true }, play: async ({ canvasElement }) => click(canvasElement, 'Clear chat') }
export const SpacesLoading: Story = { args: { mode: 'list-loading' } }
export const SpacesError: Story = { args: { mode: 'list-error' } }
export const CoordinatorReady: Story = { args: { coordinatorOnly: true } }
export const CoordinatorEmpty: Story = { args: { coordinatorOnly: true, mode: 'empty' } }
export const CoordinatorOpening: Story = { args: { coordinatorOnly: true, mode: 'loading' } }
export const CoordinatorError: Story = { args: { coordinatorOnly: true, mode: 'error' } }
export const CoordinatorBusy: Story = { args: { coordinatorOnly: true, mode: 'busy' } }
export const CoordinatorQuestion: Story = { args: { coordinatorOnly: true, mode: 'question' } }
