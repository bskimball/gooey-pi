import { sharedFrame } from './frame'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { ApexButton, BrowserGlobe, EmptyState, IconButton, Segmented, SelectControl } from '../../packages/ui/src/ui'
import { ArrowRight, Folder, Plus, Warning } from '../../packages/ui/src/icons'

function Buttons() {
  const [count, setCount] = useState(0)
  return (
    <section aria-label="Button states">
      <p>Activated {count} times. Tab through the controls to inspect focus.</p>
      {(['secondary', 'primary', 'danger', 'quiet'] as const).map((variant) => (
        <div key={variant}>
          <h3>{variant}</h3>
          <ApexButton variant={variant} onClick={() => setCount(count + 1)}>
            Continue
          </ApexButton>{' '}
          <ApexButton variant={variant} compact icon={<Plus />} endIcon={<ArrowRight />} onClick={() => setCount(count + 1)}>
            Add project
          </ApexButton>{' '}
          <ApexButton variant={variant} disabled>
            Unavailable
          </ApexButton>
        </div>
      ))}
      <h3>Icon buttons</h3>
      <IconButton label="Add item" onClick={() => setCount(count + 1)}>
        <Plus />
      </IconButton>
      <IconButton label="Small add item" size="small" onClick={() => setCount(count + 1)}>
        <Plus />
      </IconButton>
      <IconButton label="Unavailable add item" disabled>
        <Plus />
      </IconButton>
      <h3>Long label</h3>
      <ApexButton>Continue with the selected workspace and preserve the current conversation</ApexButton>
      <h3>Browser globe</h3>
      {[14, 18, 32].map((size) => (
        <BrowserGlobe key={size} size={size} />
      ))}
    </section>
  )
}
function Selection() {
  const [value, setValue] = useState('main')
  const [tab, setTab] = useState('chat')
  return (
    <section className="conversation-pane" aria-label="Selection controls">
      <p>Open the selectors; use arrows, Enter and Escape. Selected: {value}.</p>
      {(['below', 'above'] as const).map((placement) => (
        <div key={placement}>
          <h3>Opens {placement}</h3>
          <SelectControl
            label={`Branch ${placement}`}
            value={value}
            placement={placement}
            fullWidth={placement === 'below'}
            compact={placement === 'above'}
            onChange={(event) => setValue(event.target.value)}
            icon={<Folder />}
          >
            <option value="main">main</option>
            <option value="feature">feature/improve-keyboard-navigation-and-preserve-focus</option>
            <option value="locked" disabled>
              release (locked)
            </option>
          </SelectControl>
        </div>
      ))}
      <SelectControl label="Disabled branch" value="main" disabled>
        <option value="main">main</option>
      </SelectControl>
      <Segmented
        label="Workspace view"
        value={tab}
        options={[
          { value: 'chat', label: 'Chat' },
          { value: 'changes', label: 'Changes' },
          { value: 'agents', label: 'Agents' },
        ]}
        onChange={setTab}
      />
      <p role="status">Current view: {tab}</p>
    </section>
  )
}
function EmptyPanels() {
  const [retried, setRetried] = useState(false)
  return (
    <>
      <EmptyState icon={<Folder />} title="No saved sessions" action={<ApexButton onClick={() => setRetried(true)}>Start a session</ApexButton>}>
        Choose a workspace to begin.
      </EmptyState>
      <EmptyState role="alert" icon={<Warning />} title={retried ? 'Ready to retry' : 'Could not load sessions'} action={<ApexButton onClick={() => setRetried(true)}>Retry</ApexButton>}>
        <p>Your saved conversations are unchanged.</p>
        <p>Try loading the catalog again.</p>
      </EmptyState>
    </>
  )
}
const meta = { decorators: [sharedFrame], title: 'Shared/Controls', component: Buttons } satisfies Meta<typeof Buttons>
export default meta
type Story = StoryObj<typeof meta>
export const ButtonStates = {} satisfies Story
export const SelectAndSegmented = { render: () => <Selection /> } satisfies Story
export const ActionableEmptyStates = { render: () => <EmptyPanels /> } satisfies Story
export const Dark = { globals: { theme: 'dark' } } satisfies Story
export const Narrow = { globals: { viewport: { value: 'narrow', isRotated: false } } } satisfies Story
export const ControlComposition = {
  render: () => (
    <>
      <Buttons />
      <Selection />
      <EmptyPanels />
    </>
  ),
} satisfies Story
export const OpenSelector = {
  render: () => <Selection />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(await page.findByRole('combobox', { name: 'Branch below' }))
    await expect(page.getByRole('listbox')).toBeVisible()
  },
} satisfies Story
export const KeyboardFocus = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const first = page.getAllByRole('button', { name: 'Continue' })[0]
    first?.focus()
    await userEvent.keyboard('{Tab}')
    await expect(page.getAllByRole('button', { name: 'Add project' })[0]).toHaveFocus()
  },
} satisfies Story
