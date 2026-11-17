import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { SessionPicker } from '../../packages/vscode/webview/SessionPicker'
import { sharedFrame } from '../shared/frame'
import { installScenario } from './fixture'

function Picker() {
  const [notice, setNotice] = useState('')
  return (
    <>
      <SessionPicker status="ready" busy={false} onNotice={setNotice} />
      <p role="status">{notice}</p>
    </>
  )
}
const open = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  const page = within(canvasElement)
  await userEvent.click(await page.findByRole('button', { name: /^Sessions:/ }))
  await expect(page.getByRole('listbox', { name: 'Sessions' })).toBeVisible()
}
const meta = {
  title: 'VS Code/Session picker',
  component: Picker,
  decorators: [sharedFrame],
  beforeEach: () => {
    installScenario()
  },
} satisfies Meta<typeof Picker>
export default meta
type Story = StoryObj<typeof meta>
export const Closed = {} satisfies Story
export const ActiveOwnedAndLongTitles = { play: open } satisfies Story
export const Loading = {
  beforeEach: () => {
    installScenario([], 'loading')
  },
  play: open,
} satisfies Story
export const Empty = {
  beforeEach: () => {
    installScenario([], 'empty')
  },
  play: open,
} satisfies Story
export const CatalogError = {
  beforeEach: () => {
    installScenario([], 'error')
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const trigger = await page.findByRole('button', { name: /^Sessions:/ })
    await userEvent.click(trigger)
    // A failed refresh closes the production picker and reports through onNotice.
    await waitFor(() => expect(page.getByRole('status')).toHaveTextContent('The saved session catalog could not be read. Try again.'))
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(page.queryByRole('listbox', { name: 'Sessions' })).not.toBeInTheDocument()
  },
} satisfies Story
export const SwitchError = {
  beforeEach: () => {
    installScenario([], 'switch-error')
  },
  play: async (context) => {
    await open(context)
    const page = within(context.canvasElement)
    await userEvent.click(await page.findByRole('option', { name: /Desktop implementation/ }))
    await expect(page.getByRole('status')).toHaveTextContent('owned by another editor')
  },
} satisfies Story
export const SwitchSession = {
  play: async (context) => {
    await open(context)
    const page = within(context.canvasElement)
    await userEvent.click(await page.findByRole('option', { name: /Review provider settings/ }))
    await expect(page.getByRole('button', { name: /Sessions: Review provider settings/ })).toBeVisible()
  },
} satisfies Story
export const KeyboardNavigation = {
  play: async (context) => {
    await open(context)
    const page = within(context.canvasElement)
    await userEvent.keyboard('{ArrowDown}{End}')
    await expect(page.getByRole('option', { name: /Desktop implementation/ })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    await expect(page.getByRole('option', { name: /Keyboard navigation review/ })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect(page.getByRole('button', { name: /^Sessions:/ })).toHaveFocus()
  },
} satisfies Story
export const Dark = { globals: { theme: 'dark' }, play: open } satisfies Story
export const Narrow = { globals: { viewport: { value: 'narrow', isRotated: false } }, play: open } satisfies Story
