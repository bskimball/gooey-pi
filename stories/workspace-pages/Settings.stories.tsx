import { useState } from 'react'
import { editDraft, type, click, modalRoot } from './interactions'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { SettingsPage } from '../../apps/desktop/src/pages/SettingsPage'
import type { SettingsSection } from '../../apps/desktop/src/pages/settings/contracts'
import { DEFAULT_SETTINGS } from '../../apps/desktop/src/lib/data'
import { DraftSettingField } from '../../apps/desktop/src/pages/settings/DraftSettingField'
import { SettingsToggle } from '../../apps/desktop/src/pages/settings/SettingsToggle'
import type { AppUpdatePhase } from '../../packages/core/src/types/api'
import { catalog, meta, noop, succeed, fail, pending, pets, voiceFixture, fixedClock } from './fixtures'

function Settings({
  section = 'general',
  failure = false,
  loading = false,
  update = 'idle',
  providerState = 'ready',
  credentialState = 'ready',
}: {
  section?: SettingsSection
  failure?: boolean
  loading?: boolean
  update?: AppUpdatePhase
  providerState?: 'ready' | 'warning' | 'empty'
  credentialState?: 'ready' | 'pending' | 'error'
}) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [providers, setProviders] = useState(
    providerState === 'empty'
      ? { ...catalog, providers: [], models: [] }
      : providerState === 'warning'
        ? { ...catalog, warning: 'Provider discovery was incomplete. Cached models are shown.' }
        : catalog,
  )
  const [voice] = useState(() => ({ ...voiceFixture(), ...(credentialState === 'pending' ? { saveApiKey: pending } : credentialState === 'error' ? { saveApiKey: fail } : {}) }))
  const action = failure ? fail : succeed
  return (
    <SettingsPage
      settings={settings}
      meta={failure ? { ...meta, harnesses: { pi: { path: null, version: null, problem: { path: '/fixture/pi', reason: 'Executable not found' } } } } : meta}
      initialSection={section}
      providerCatalog={loading ? null : providers}
      voice={failure ? { ...voice, credentialStatus: fail } : voice}
      pets={loading ? { ...pets, list: pending } : failure ? { ...pets, list: fail } : pets}
      updateState={{ phase: update, version: '1.1.0', percent: 42, message: failure ? 'Offline update check failed.' : undefined }}
      onUpdate={(patch) => setSettings((current) => ({ ...current, ...patch }))}
      onClose={noop}
      onCheckForUpdates={action}
      onResetBrowser={action}
      onOpenDocs={noop}
      onRefreshProviders={action}
      onRefreshHarnesses={action}
      onSetProviderEnabled={async (id, enabled) =>
        setProviders((current) => ({ ...current, providers: current.providers.map((provider) => (provider.id === id ? { ...provider, enabled } : provider)) }))
      }
      onSetAllProvidersEnabled={async () => setProviders((current) => ({ ...current, providers: current.providers.map((provider) => ({ ...provider, enabled: true })) }))}
      onSetAllProvidersDisabled={async () => setProviders((current) => ({ ...current, providers: current.providers.map((provider) => ({ ...provider, enabled: false })) }))}
      onSetModelEnabled={async (key, enabled) => setProviders((current) => ({ ...current, models: current.models.map((model) => (model.key === key ? { ...model, enabled } : model)) }))}
    />
  )
}
const config = {
  title: 'Workspace/Settings',
  component: Settings,
  beforeEach: fixedClock,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ height: '100dvh' }}><Story /></div>],
  args: { section: 'general', failure: false, loading: false, update: 'idle' },
  argTypes: {
    section: { control: 'select', options: ['general', 'appearance', 'agent', 'providers', 'voice', 'pets', 'browser', 'terminal', 'privacy', 'about'] },
    update: { control: 'select', options: ['idle', 'checking', 'available', 'downloading', 'downloaded', 'not-available', 'error', 'unsupported'] },
  },
} satisfies Meta<typeof Settings>
export default config
type Story = StoryObj<typeof config>
export const General: Story = {}
export const Appearance: Story = { args: { section: 'appearance' } }
export const Agent: Story = { args: { section: 'agent' } }
export const AgentUnavailable: Story = { args: { section: 'agent', failure: true } }
export const AgentRefreshError: Story = { args: { section: 'agent', failure: true }, play: async ({ canvasElement }) => click(canvasElement, 'Refresh harnesses') }
export const Providers: Story = { args: { section: 'providers' } }
export const ProvidersLoading: Story = { args: { section: 'providers', loading: true } }
export const ProvidersWarning: Story = { args: { section: 'providers', providerState: 'warning' } }
export const ProvidersEmpty: Story = { args: { section: 'providers', providerState: 'empty' } }
export const ProvidersError: Story = { args: { section: 'providers', failure: true }, play: async ({ canvasElement }) => click(canvasElement, 'Refresh providers') }
export const CredentialPending: Story = { args: { section: 'voice', credentialState: 'pending' }, play: async ({ canvasElement }) => saveCredential(canvasElement) }
export const CredentialError: Story = { args: { section: 'voice', credentialState: 'error' }, play: async ({ canvasElement }) => saveCredential(canvasElement) }
export const Voice: Story = { args: { section: 'voice' } }
export const VoiceError: Story = { args: { section: 'voice', failure: true } }
export const Pets: Story = { args: { section: 'pets' } }
export const PetsLoading: Story = { args: { section: 'pets', loading: true } }
export const PetsError: Story = { args: { section: 'pets', failure: true } }
export const Browser: Story = { args: { section: 'browser' } }
export const BrowserResetDialog: Story = { args: { section: 'browser' }, play: async ({ canvasElement }) => click(canvasElement, 'Clear data') }
export const BrowserResetError: Story = {
  args: { section: 'browser', failure: true },
  play: async ({ canvasElement }) => {
    await click(canvasElement, 'Clear data')
    await click(modalRoot(canvasElement), 'Clear browsing data')
  },
}
export const Terminal: Story = { args: { section: 'terminal' } }
export const Privacy: Story = { args: { section: 'privacy' } }
export const About: Story = { args: { section: 'about' } }
export const UpdateChecking: Story = { args: { section: 'about', update: 'checking' } }
export const UpdateAvailable: Story = { args: { section: 'about', update: 'available' } }
export const UpdateDownloading: Story = { args: { section: 'about', update: 'downloading' } }
export const UpdateDownloaded: Story = { args: { section: 'about', update: 'downloaded' } }
export const UpdateCurrent: Story = { args: { section: 'about', update: 'not-available' } }
export const UpdateError: Story = { args: { section: 'about', update: 'error', failure: true } }
export const UpdateUnsupported: Story = { args: { section: 'about', update: 'unsupported' } }
async function saveCredential(canvasElement: HTMLElement) {
  await click(canvasElement, 'Replace key')
  const root = modalRoot(canvasElement)
  await userEvent.type(await within(root).findByLabelText('API key'), 'offline-story-key')
  await click(root, 'Save API key')
}
function Fields({ rejected = false, saving = false }: { rejected?: boolean; saving?: boolean }) {
  const [value, setValue] = useState('http://localhost:3000')
  const [checked, setChecked] = useState(true)
  return (
    <div>
      <DraftSettingField
        id="story-home"
        label="Browser home"
        description="Edit the URL, blur to commit, or revert your changes."
        committedValue={value}
        validate={(text) => (/^https?:\/\//.test(text) ? '' : 'Use an HTTP or HTTPS URL.')}
        normalize={(text) => text.trim()}
        onCommit={rejected ? fail : saving ? pending : setValue}
      />
      <SettingsToggle checked={checked} onChange={setChecked} label="Keep project navigation visible" description="A controlled setting with a longer explanation that wraps in narrow panels." />
    </div>
  )
}
export const DraftAndToggle: Story = { render: () => <Fields /> }
const browserHomeName = /^Browser home(?: Browser home)?$/
export const DraftDirty: Story = {
  render: () => <Fields />,
  play: async ({ canvasElement }) => {
    await type(canvasElement, browserHomeName, 'https://example.test')
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: browserHomeName })).toHaveValue('https://example.test')
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled()
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument()
  },
}
export const DraftInvalid: Story = {
  render: () => <Fields />,
  play: async ({ canvasElement }) => {
    await type(canvasElement, browserHomeName, 'not-a-url')
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: browserHomeName })).toHaveAttribute('aria-invalid', 'true')
    await expect(canvas.getByRole('alert')).toHaveTextContent('Use an HTTP or HTTPS URL.')
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled()
  },
}
export const DraftRejected: Story = {
  render: () => <Fields rejected />,
  play: async ({ canvasElement }) => {
    await editDraft(canvasElement, 'https://example.test')
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Fixture operation failed. Retry to continue.')
    await expect(canvas.getByRole('textbox', { name: browserHomeName })).toHaveValue('https://example.test')
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled()
  },
}
export const DraftSaving: Story = {
  render: () => <Fields saving />,
  play: async ({ canvasElement }) => {
    await editDraft(canvasElement, 'https://example.test')
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    await expect(canvas.getByRole('textbox', { name: browserHomeName })).toHaveValue('https://example.test')
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument()
  },
}
