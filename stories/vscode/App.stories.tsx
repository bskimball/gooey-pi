import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { App } from '../../packages/vscode/webview/App'
import { editorFrame } from '../shared/frame'
import { installScenario } from './fixture'
import { browserMessage, conversation, editorFile, extensionMessage, messagesFor, readyState } from './scenarios'

const meta = {
  title: 'VS Code/App',
  component: App,
  decorators: [editorFrame],
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    installScenario(messagesFor())
  },
} satisfies Meta<typeof App>
export default meta
type Story = StoryObj<typeof meta>
export const ReadyStandalone = {} satisfies Story
export const NoHostState = {
  beforeEach: () => {
    installScenario()
  },
} satisfies Story
export const Starting = {
  beforeEach: () => {
    installScenario(messagesFor({ ...readyState, status: 'starting' }))
  },
} satisfies Story
export const Exited = {
  beforeEach: () => {
    installScenario(messagesFor({ ...readyState, status: 'exited', error: 'The runtime stopped unexpectedly. Your saved session is unchanged.' }))
  },
} satisfies Story
export const DesktopConnected = {
  beforeEach: () => {
    installScenario(messagesFor({ ...readyState, connection: 'desktop', pendingCount: 2 }))
  },
} satisfies Story
export const StreamingWithQueue = {
  beforeEach: () => {
    installScenario(
      messagesFor(
        {
          ...readyState,
          connection: 'desktop',
          pendingCount: 2,
          isStreaming: true,
          queued: [
            { id: 'queued-review', text: 'Also check the narrow editor layout.', intent: 'queue' },
            { id: 'steer-review', text: 'Keep the existing colors and spacing.', intent: 'steer' },
          ],
        },
        editorFile,
        true,
      ),
    )
  },
} satisfies Story
export const EditorFile = {
  beforeEach: () => {
    installScenario(messagesFor(readyState, { ...editorFile, dirty: false, selection: null }))
  },
} satisfies Story
export const DirtySelection = {
  beforeEach: () => {
    installScenario(messagesFor(readyState, editorFile))
  },
} satisfies Story
export const MultipleSelections = {
  beforeEach: () => {
    installScenario(messagesFor(readyState, { ...editorFile, selection: { startLine: 20, endLine: 85, count: 3 } }))
  },
} satisfies Story
export const SingleLineSelection = {
  beforeEach: () => {
    installScenario(messagesFor(readyState, { ...editorFile, selection: { startLine: 42, endLine: 42, count: 1 } }))
  },
} satisfies Story
export const EditorExcluded = {
  beforeEach: () => {
    installScenario(messagesFor(readyState, editorFile))
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await userEvent.click(await page.findByRole('button', { name: 'Include editor context' }))
    await expect(page.getByRole('button', { name: 'Include editor context' })).toHaveAttribute('aria-pressed', 'false')
  },
} satisfies Story
function agentsScenario() {
  installScenario([
    ...messagesFor(),
    {
      type: 'reset',
      ops: [
        ...conversation.map((message) => ({ kind: 'saved' as const, message })),
        {
          kind: 'saved',
          message: {
            id: 'delegation',
            role: 'assistant',
            parts: [
              {
                type: 'toolCall',
                id: 'reviewer-start',
                name: 'task_start',
                args: { agent: 'reviewer', prompt: 'Review SessionPicker keyboard navigation and focus restoration. Do not redesign the controls.' },
              },
              {
                type: 'toolResult',
                name: 'task_start',
                text: 'started task_review\nagent: reviewer',
                details: { worker: { id: 'task_review', agent: 'reviewer', model: 'fixture/reviewer', thinking: 'medium', lifecycle: 'running' } },
              },
            ],
          },
        },
      ],
    },
  ])
}
const openAgents = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  const page = within(canvasElement)
  await userEvent.click(await page.findByRole('button', { name: /^Sub-agents/ }))
  await expect(page.getByRole('button', { name: 'Back to chat' })).toBeVisible()
}
export const AgentsPane = { beforeEach: agentsScenario, play: openAgents } satisfies Story
export const ReturnToChat = {
  beforeEach: agentsScenario,
  play: async (context) => {
    await openAgents(context)
    const page = within(context.canvasElement)
    await userEvent.click(page.getByRole('button', { name: 'Back to chat' }))
    await expect(page.queryByRole('button', { name: 'Back to chat' })).not.toBeInTheDocument()
  },
} satisfies Story
export const ExtensionPrompt = {
  beforeEach: () => {
    installScenario([...messagesFor(), extensionMessage])
  },
} satisfies Story
export const ExtensionTab = {
  beforeEach: () => {
    installScenario([...messagesFor(), browserMessage])
  },
} satisfies Story
export const Dark = { globals: { theme: 'dark' } } satisfies Story
export const NarrowDesktopComposition = {
  globals: { viewport: { value: 'narrow', isRotated: false }, theme: 'dark' },
  beforeEach: () => {
    installScenario([
      ...messagesFor(
        { ...readyState, connection: 'desktop', pendingCount: 2, isStreaming: true, queued: [{ id: 'queue-narrow', text: 'Check keyboard navigation next.', intent: 'queue' }] },
        editorFile,
        true,
      ),
      browserMessage,
    ])
  },
} satisfies Story
