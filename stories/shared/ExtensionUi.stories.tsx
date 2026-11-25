import { sharedFrame } from './frame'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { ExtensionUiModal, type ExtensionUiResponse } from '../../packages/ui/src/ExtensionUiModal'
import { ApexButton } from '../../packages/ui/src/ui'
import type { ExtensionUiRequest } from '../../apps/desktop/src/lib/extension-ui'

const requests = {
  confirm: { method: 'confirm', id: 'confirm', title: 'Apply reviewed changes?', message: 'Update the session picker keyboard handling. No files are modified by this story.' },
  input: { method: 'input', id: 'input', title: 'Name this session', placeholder: 'Keyboard navigation review' },
  editor: {
    method: 'editor',
    id: 'editor',
    title: 'Review the implementation brief',
    prefill: 'Preserve focus after closing the session picker.\nSupport Arrow keys, Home, End and Escape.\nKeep the existing Apex design.',
  },
  select: { method: 'select', id: 'select', title: 'Choose the next step', options: ['Review changes', 'Run focused tests', 'Keep editing'] },
  searchable: {
    method: 'select',
    id: 'searchable',
    title: 'Choose a workspace',
    options: [
      'Apex desktop',
      'Apex VS Code',
      'Shared components',
      'Browser extension',
      'Session catalog',
      'Provider settings',
      'Activity coordinator',
      'Terminal integration',
      'Keyboard navigation',
      'Release verification',
      'A very long workspace title that must remain readable in a narrow panel',
    ],
  },
  questionnaire: {
    method: 'questionnaire',
    id: 'questionnaire',
    title: 'Plan the change',
    total: 2,
    complete: true,
    questions: [
      { id: 'scope', title: 'Which clients should receive the update?', options: ['Desktop and VS Code', 'Desktop only', 'VS Code only', 'Other (type your own answer)'], index: 0 },
      { id: 'validation', title: 'How should we validate?', options: ['Focused tests and manual review', 'Manual keyboard review'], index: 1 },
    ],
  },
  richQuestionnaire: {
    method: 'questionnaire',
    id: 'rich-questionnaire',
    title: 'Design the main-thread rollout',
    total: 3,
    complete: true,
    timeout: 180_000,
    questions: [
      {
        id: 'surface',
        title: 'Which question surfaces should share the new visual language?',
        options: ['Inline panel + transcript AskUserCard', 'All three including Activity cards', 'Inline panel only', 'Other (type your own answer)'],
        index: 0,
      },
      {
        id: 'widgets',
        title: 'Which native React widget should we prioritize first in main-thread responses?',
        options: ['Comparison & tradeoff cards', 'Metrics & KPI grids', 'Interactive checklists & step pipelines', 'Other (type your own answer)'],
        index: 1,
      },
      {
        id: 'verification',
        title: 'How should we verify before merging?',
        options: ['Storybook visual pass + Vitest + typecheck', 'Full Electron e2e suite'],
        index: 2,
      },
    ],
  },
} satisfies Record<string, ExtensionUiRequest>
type Props = Pick<ComponentProps<typeof ExtensionUiModal>, 'request' | 'presentation' | 'deadline'>
function RequestDemo({ request, presentation = 'modal', deadline }: Props) {
  const [response, setResponse] = useState<ExtensionUiResponse | null>(null)
  const [attempt, setAttempt] = useState(0)
  return (
    <section aria-label="Extension request fixture">
      <p>Respond, cancel, or use the keyboard. Responses stay in this story.</p>
      <ApexButton
        onClick={() => {
          setResponse(null)
          setAttempt(attempt + 1)
        }}
      >
        Restart request
      </ApexButton>
      {response ? (
        <pre role="status">{JSON.stringify(response, null, 2)}</pre>
      ) : (
        <ExtensionUiModal key={attempt} request={request} presentation={presentation} deadline={deadline} platform="win32" onRespond={setResponse} />
      )}
    </section>
  )
}
const meta = { decorators: [sharedFrame], title: 'Shared/Extension UI', component: RequestDemo, args: { request: requests.confirm } } satisfies Meta<typeof RequestDemo>
export default meta
type Story = StoryObj<typeof meta>
export const Confirm = {} satisfies Story
export const BlankInput = { args: { request: requests.input } } satisfies Story
export const PrefilledEditor = { args: { request: requests.editor } } satisfies Story
export const EmptyEditor = { args: { request: { ...requests.editor, prefill: '' } } } satisfies Story
export const Select = { args: { request: requests.select } } satisfies Story
export const SearchableSelect = { args: { request: requests.searchable } } satisfies Story
export const MultiQuestionFlow = { args: { request: requests.questionnaire } } satisfies Story
export const InlineQuestionnaire = { args: { request: requests.questionnaire, presentation: 'inline' } } satisfies Story
export const ReviewAnswers = {
  args: { request: requests.questionnaire, presentation: 'inline' },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await userEvent.click(await page.findByRole('option', { name: 'Desktop and VS Code' }))
    await userEvent.click(await page.findByRole('option', { name: 'Focused tests and manual review' }))
    await expect(page.getByRole('button', { name: 'Submit answers' })).toBeEnabled()
  },
} satisfies Story
export const RichInlineQuestionnaire = { args: { request: requests.richQuestionnaire, presentation: 'inline' } } satisfies Story
export const RichInlineQuestionnaireDark = { args: { request: requests.richQuestionnaire, presentation: 'inline' }, globals: { theme: 'dark' } } satisfies Story
export const WaitingForQuestions = {
  args: { request: { ...requests.questionnaire, complete: false, questions: requests.questionnaire.questions.slice(0, 1) }, presentation: 'inline' },
} satisfies Story
export const Expired = { args: { request: requests.questionnaire, deadline: 1, presentation: 'inline' } } satisfies Story
export const InlineConfirm = { args: { presentation: 'inline' } } satisfies Story
export const InlineInput = { args: { request: requests.input, presentation: 'inline' } } satisfies Story
export const InlineEditor = { args: { request: requests.editor, presentation: 'inline' } } satisfies Story
export const InlineSelect = { args: { request: requests.searchable, presentation: 'inline' } } satisfies Story
export const DarkQuestionnaire = { args: { request: requests.questionnaire }, globals: { theme: 'dark' } } satisfies Story
export const NarrowQuestionnaire = { args: { request: requests.questionnaire }, globals: { viewport: { value: 'narrow', isRotated: false } } } satisfies Story
export const ValidInput = {
  args: { request: requests.input },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.type(await page.findByRole('textbox', { name: 'Response' }), 'Keyboard review')
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled()
  },
} satisfies Story
export const FilteredOptions = {
  args: { request: requests.searchable },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.type(await page.findByPlaceholderText('Type to filter'), 'keyboard')
    await expect(page.getByRole('option', { name: /Keyboard navigation/ })).toBeVisible()
  },
} satisfies Story
export const Cancelled = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(await page.findByRole('button', { name: 'Cancel' }))
    await expect(page.getByRole('status')).toHaveTextContent('cancelled')
  },
} satisfies Story
export const FreeformAnswer = {
  args: { request: requests.questionnaire, presentation: 'inline' },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await userEvent.click(await page.findByRole('option', { name: /Other \(type your own answer\)/ }))
    await userEvent.type(await page.findByRole('textbox', { name: 'Your answer' }), 'Shared controls first, then both clients')
  },
} satisfies Story
