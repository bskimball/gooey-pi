import { installChatFixture } from './fixtures'
import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Composer } from '../../apps/desktop/src/components/Composer'
import { ComposerQueue } from '../../apps/desktop/src/components/ComposerQueue'
import { ComposerBusyIndicator } from '../../apps/desktop/src/components/ComposerBusyIndicator'
import { ModelPicker } from '../../apps/desktop/src/components/ModelPicker'
import { CheckoutPicker, CheckoutPickerFields, useCheckoutPickerController } from '../../apps/desktop/src/components/CheckoutPicker'
import { ChatSettings, ChatSettingsField, ChatSettingsSection, PiModeControl, PiModeFields, PiModeStatus, usePiModeController } from '../../apps/desktop/src/components/PiModeControl'
import { ContextUsageRing } from '../../apps/desktop/src/components/ContextUsageRing'
import { ExecutingModelChip } from '../../apps/desktop/src/components/ExecutingModelChip'
import { annotation, branches, model, models, noop, providers, queue, session, worktrees } from './data'

const base = {
  busy: false,
  model: model.key,
  effort: 'medium',
  modelsByProvider: models,
  providers,
  reasoningLevels: ['off', 'medium', 'high'],
  fast: false,
  fastSupported: true,
  fastAvailable: true,
  imageInputSupported: true,
  skills: [{ id: 'review', name: 'review', description: 'Review UI consistency', kind: 'skill', location: 'project', enabled: true }],
  sessions: [session],
  onModelChange: noop,
  onEffortChange: noop,
  onFastChange: noop,
  onSend: noop,
  onStop: noop,
  isolatedDraft: true,
  checkoutCatalog: branches,
  onExecuteCheckout: noop,
} satisfies ComponentProps<typeof Composer>
function ComposerDemo(props: Partial<ComponentProps<typeof Composer>>) {
  const [selected, setSelected] = useState(model.key)
  const [sent, setSent] = useState('')
  return (
    <>
      <Composer
        {...base}
        {...props}
        model={selected}
        onModelChange={setSelected}
        onSend={(text, _images, intent) => {
          setSent(`${intent}: ${text}`)
        }}
      />
      <output aria-live="polite">{sent}</output>
    </>
  )
}
const meta = { title: 'Chat/Composer', component: ComposerDemo, beforeEach: installChatFixture, parameters: { layout: 'padded' } } satisfies Meta<typeof ComposerDemo>
export default meta
type Story = StoryObj<typeof meta>
export const Empty: Story = {}
export const DraftAndAttachments: Story = {
  args: {
    insertDraft: { id: 1, text: 'Compare the selected button with the existing send action.' },
    annotations: [annotation],
    taskExcerpts: [{ id: 'excerpt', source: 'Assistant response', text: 'Preserve keyboard focus.' }],
    terminalSelection: { tabId: 'sample-terminal', label: 'Scoped check', text: '12 stories passed', truncated: false, cwd: '/sample/apex' },
  },
}
export const QueuedAndSteering: Story = {
  args: { busy: true, queuedMessages: queue, onSendQueuedMessage: noop, onDeleteQueuedMessage: noop, onEditQueuedMessage: noop, insertDraft: { id: 2, text: 'Keep the current scope.' } },
}
export const Admitting: Story = { args: { admitting: true, insertDraft: { id: 3, text: 'Review the controls.' } } }
export const Disabled: Story = { args: { disabled: true, loading: true } }
export const UnsupportedImages: Story = { args: { imageInputSupported: false, insertDraft: { id: 4, text: 'This model accepts text only.' } } }
export const BusyAndFallback: Story = {
  args: { busy: true, executingModel: { id: 'fallback', label: 'Fast model', isFallback: true }, contextUsage: { tokens: 190000, contextWindow: 200000, percent: 95 } },
}
export const FileMenu: Story = { args: { fileRoot: '/sample/apex', insertDraft: { id: 5, text: '@' } } }
export const SkillMenu: Story = { args: { insertDraft: { id: 6, text: '/review' } } }
export const CommandMenu: Story = { args: { insertDraft: { id: 7, text: '/' }, onCommand: noop } }
export const SessionMenu: Story = { args: { insertDraft: { id: 8, text: '@Chat' } } }
export const ConversationOnly: Story = { args: { conversationOnly: true } }

function QueueDemo() {
  const [items, setItems] = useState(queue)
  const [action, setAction] = useState('')
  return (
    <>
      <ComposerQueue
        queuedMessages={items}
        onSendNow={(item) => {
          setAction(`Sent: ${item.text}`)
          setItems(items.filter((entry) => entry.id !== item.id))
        }}
        onEdit={(item) => setAction(`Edit: ${item.text}`)}
        onDelete={(item) => setItems(items.filter((entry) => entry.id !== item.id))}
      />
      <output>{action}</output>
    </>
  )
}
export const QueueInteractions: Story = { render: () => <QueueDemo /> }
function Pickers() {
  const [value, setValue] = useState(model.key)
  const controller = useCheckoutPickerController()
  return (
    <ChatSettings>
      <ChatSettingsSection>
        <ChatSettingsField label="Model">
          <ModelPicker value={value} modelsByProvider={models} providers={providers} onChange={setValue} />
        </ChatSettingsField>
        <ModelPicker value="missing" unavailableLabel="Model removed" modelsByProvider={models} providers={providers} onChange={noop} />
        <ModelPicker value="" modelsByProvider={new Map()} providers={[]} onChange={noop} />
        <ModelPicker value={value} modelsByProvider={models} providers={providers} onChange={noop} disabled />
      </ChatSettingsSection>
      <ChatSettingsSection divider>
        <CheckoutPicker catalog={branches} onExecute={noop} />
        <CheckoutPickerFields catalog={worktrees} controller={controller} onExecute={noop} />
        <CheckoutPicker fallbackLabel="Resolving checkout" loading />
        <CheckoutPicker fallbackLabel="Detached HEAD" disabled />
      </ChatSettingsSection>
    </ChatSettings>
  )
}
export const ModelAndCheckoutPickers: Story = { render: () => <Pickers /> }
export const CheckoutFailure: Story = { render: () => <CheckoutPicker catalog={branches} onExecute={() => Promise.reject(new Error('Checkout blocked by sample unsaved changes'))} /> }
function Modes() {
  const controller = usePiModeController(noop, false)
  return (
    <ChatSettings>
      <PiModeControl disabled={false} modelsByProvider={models} providers={providers} onCommand={noop}>
        <ModelPicker value={model.key} modelsByProvider={models} providers={providers} onChange={noop} />
      </PiModeControl>
      <ChatSettingsSection divider>
        <PiModeFields controller={{ ...controller, mode: 'fusion', pair: null }} modelsByProvider={models} providers={providers} />
        <PiModeStatus controller={{ ...controller, mode: 'fusion', pair: null }} />
        <PiModeFields controller={{ ...controller, mode: 'hydra', hydraTier: 'standard' }} modelsByProvider={models} providers={providers} />
        <PiModeStatus controller={{ ...controller, pending: '/mode hydra sync', controlsDisabled: true }} />
      </ChatSettingsSection>
    </ChatSettings>
  )
}
export const ModeSettings: Story = { render: () => <Modes /> }
export const UsageAndExecution: Story = {
  render: () => (
    <>
      <ContextUsageRing />
      {[12, 82, 96, 110].map((percent) => (
        <ContextUsageRing
          key={percent}
          contextUsage={{ tokens: percent * 2000, contextWindow: 200000, percent }}
          sessionUsage={{ cost: 1.24, tokens: { input: 12000, output: 2400, cacheRead: 8000, cacheWrite: 0, total: 22400 } }}
        />
      ))}
      <ExecutingModelChip executingModel={null} />
      <ExecutingModelChip executingModel={{ id: 'fallback', label: 'Fast model', isFallback: true }} />
      <div style={{ position: 'relative', height: 80, overflow: 'hidden' }}>
        <ComposerBusyIndicator />
      </div>
    </>
  ),
}
