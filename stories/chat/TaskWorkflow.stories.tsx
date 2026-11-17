import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ContextExcerpt } from '../../apps/desktop/src/components/ContextExcerpt'
import { TaskWorkflowContext } from '../../apps/desktop/src/lib/task-context'
import { TaskWorkflowFinished, TaskWorkflowNotice } from '../../apps/desktop/src/components/TaskWorkflowChrome'
import { TaskWorkflowDialogs } from '../../apps/desktop/src/components/TaskWorkflowDialogs'
import { ChangedFilesList } from '../../apps/desktop/src/components/ChangedFiles'
import { ChangesCard, WorkspaceChangesCard } from '../../apps/desktop/src/components/ChangesCard'
import type { FinishReview as FinishReviewData, RewindPreview, RunReceipt } from '../../packages/core/src/types/api'
import { cleanGit, git, noop, session } from './data'
import { installChatFixture } from './fixtures'

type Workflow = ComponentProps<typeof TaskWorkflowDialogs>['workflow']
type Dialog = Workflow['dialog']
const receipt: RunReceipt = {
  id: 'sample-run',
  sessionId: session.id,
  startedAt: '2026-01-01T12:00:00Z',
  state: 'complete',
  anchorUserEntryId: 'sample-prompt',
  memberUserEntryIds: ['sample-prompt'],
  inputs: [{ kind: 'prompt', disposition: 'handled' }],
  attribution: 'observed-checkout',
  changes: ['src/Chat.tsx', 'binary.png', 'missing.txt', 'loading.txt', 'large.txt', 'link'].map((path) => ({ path, kind: 'modified' })),
}
const rewind: RewindPreview = {
  token: 'sample-token',
  selectedUserEntryId: 'sample-prompt',
  anchorUserEntryId: 'sample-prompt',
  prompt: 'Review the current chat controls.',
  rewindToRunStart: true,
  checkout: '/sample/apex',
  worktree: { primary: true, linked: false },
  restore: { available: true, fingerprint: 'sample-fingerprint', changes: [{ path: 'src/Chat.tsx', kind: 'modified' }] },
  warning: 'This preview only represents the saved sample checkout.',
}
const review: FinishReviewData = {
  token: 'sample-finish',
  expiresAt: '2099-01-01T00:00:00Z',
  sessionFile: session.filePath,
  cwd: '/sample/apex',
  git: { status: git, integration: { kind: 'unknown', reason: 'No remote status requested by this story.' } },
  worktree: { root: '/sample/apex', kind: 'primary', ownership: 'unknown', ownershipReason: 'Sample checkout, not a real worktree.' },
  conflicts: [{ kind: 'terminal', terminalId: 'sample-terminal' }],
  cleanup: { eligible: false, reasons: ['Primary checkout is retained.'] },
  nextActions: ['Review uncommitted changes.'],
}
function WorkflowDemo({
  initialDialog = null,
  side = false,
  pending = false,
  error = '',
  finished = false,
}: {
  initialDialog?: Dialog
  side?: boolean
  pending?: boolean
  error?: string
  finished?: boolean
}) {
  const [dialog, setDialog] = useState(initialDialog)
  const [action, setAction] = useState('')
  const [excerpts, setExcerpts] = useState<Workflow['context']['excerpts']>([])
  const createSide = (text?: string) => setAction(`Side conversation: ${text ?? ''}`)
  const workflow: Workflow = {
    context: {
      sessionFile: session.filePath,
      excerpts,
      attach: (excerpt) => setExcerpts((items) => [...items, { ...excerpt, id: `excerpt-${items.length}` }]),
      remove: (ids) => setExcerpts((items) => items.filter((item) => !ids.includes(item.id))),
      receipts: [receipt],
      persistedUserIds: new Set(['sample-prompt']),
      idle: !pending,
      pending,
      edit: () => setDialog({ kind: 'rewind', preview: rewind, sessionFile: session.filePath, runtimeId: 'sample-runtime' }),
      review: (value) => setDialog({ kind: 'history', receipt: value, sessionFile: session.filePath }),
      createSide,
      bringBack: (text) => setAction(`Bring back: ${text}`),
      isSide: side,
      finished: new Set(finished ? [session.filePath] : []),
    },
    side: side ? { parentSession: '/sample/parent.jsonl', sessionFile: session.filePath, cwd: '/sample/apex', createdAt: session.createdAt, policy: 'read-only-tools' } : null,
    children: [],
    dialog,
    pending,
    error,
    idle: !pending,
    createSide,
    reviewFinish: () => setDialog({ kind: 'finish', review, runtimeId: 'sample-runtime', sessionFile: session.filePath }),
    confirm: (restore) => {
      setAction(restore ? 'Sample fork and restore requested; no files changed' : 'Sample confirmation; no host action')
      setDialog(null)
    },
    navigate: (file) => setAction(`Open ${file}`),
    close: () => setDialog(null),
    insertDraft: undefined,
    draftInserted: noop,
  }
  const text = 'Preserve keyboard focus.\nKeep the existing composer controls.'
  return (
    <TaskWorkflowContext.Provider value={workflow.context}>
      <TaskWorkflowFinished workflow={workflow} />
      <TaskWorkflowNotice workflow={workflow} />
      <ContextExcerpt source="Assistant response" path="src/Chat.tsx" range="lines 1–2" text={text} plainText>
        <pre>{text}</pre>
      </ContextExcerpt>
      <p>Select text above or use Select excerpt. Only exact excerpts are accepted.</p>
      <button onClick={() => workflow.context.review(receipt)}>Review run</button>
      <button onClick={() => workflow.context.edit('sample-prompt')}>Edit from here</button>
      <button onClick={workflow.reviewFinish}>Finish task</button>
      <ul>
        {excerpts.map((excerpt) => (
          <li key={excerpt.id}>
            {excerpt.source}: {excerpt.text}
            <button onClick={() => workflow.context.remove([excerpt.id])}>Remove excerpt</button>
          </li>
        ))}
      </ul>
      <output aria-live="polite">{action}</output>
      <TaskWorkflowDialogs workflow={workflow} />
    </TaskWorkflowContext.Provider>
  )
}
const meta = { title: 'Chat/Task workflow', component: WorkflowDemo, beforeEach: installChatFixture } satisfies Meta<typeof WorkflowDemo>
export default meta
type Story = StoryObj<typeof meta>
export const ExcerptSelection: Story = {}
export const SideConversation: Story = { args: { side: true } }
export const Finished: Story = { args: { finished: true } }
export const PendingNotice: Story = { args: { side: true, pending: true } }
export const ErrorNotice: Story = { args: { side: true, error: 'Sample task action could not complete.' } }
export const NoProviderExcerpt: Story = {
  render: () => (
    <ContextExcerpt source="Assistant" text="Unwrapped content">
      Unwrapped content without task actions
    </ContextExcerpt>
  ),
}
export const History: Story = { args: { initialDialog: { kind: 'history', receipt, sessionFile: session.filePath } } }
export const HistoryIncomplete: Story = {
  args: { initialDialog: { kind: 'history', receipt: { ...receipt, state: 'incomplete', error: 'Snapshot interrupted', changes: [] }, sessionFile: session.filePath } },
}
export const HistoryNoChanges: Story = { args: { initialDialog: { kind: 'history', receipt: { ...receipt, changes: [] }, sessionFile: session.filePath } } }
export const Rewind: Story = { args: { initialDialog: { kind: 'rewind', preview: rewind, runtimeId: 'sample-runtime', sessionFile: session.filePath } } }
export const RewindUnavailable: Story = {
  args: {
    initialDialog: { kind: 'rewind', preview: { ...rewind, restore: { available: false, reason: 'Checkpoint expired', changes: [] } }, runtimeId: 'sample-runtime', sessionFile: session.filePath },
  },
}
export const FinishReview: Story = { args: { initialDialog: { kind: 'finish', review, runtimeId: 'sample-runtime', sessionFile: session.filePath } } }
export const FinishPending: Story = { args: { ...FinishReview.args, pending: true } }
export const FinishFailure: Story = { args: { ...FinishReview.args, error: 'Sample review expired. Request a new review.' } }
function Changes() {
  const [action, setAction] = useState('')
  return (
    <>
      <ChangedFilesList files={[...git.files, ...['R', 'C', 'U', '?', 'X'].map((status) => ({ path: `src/${status}/sample.ts`, status, staged: false, additions: 1, deletions: 2 }))]} />
      <ChangedFilesList files={git.files} lineCounts={false} />
      <ChangesCard git={git} onOpenChanges={() => setAction('Review changes requested')} />
      <ChangesCard git={{ ...git, truncated: true, lineCounts: false }} onOpenChanges={() => setAction('Review incomplete changes requested')} />
      <WorkspaceChangesCard git={git} cwd="/sample/apex" enabled onOpenChanges={() => setAction('Review workspace requested')} />
      <WorkspaceChangesCard git={cleanGit} enabled onOpenChanges={noop} />
      <WorkspaceChangesCard git={git} enabled={false} onOpenChanges={noop} />
      <output>{action}</output>
    </>
  )
}
export const ChangedFilesAndCards: Story = { render: () => <Changes /> }
