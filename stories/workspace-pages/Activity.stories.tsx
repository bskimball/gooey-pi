import { useState } from 'react'
import { ExtensionUiModal, type ExtensionUiResponse } from '../../apps/desktop/src/components/ExtensionUiModal'
import { Banner } from '@astryxdesign/core/Banner'
import { expect, within } from 'storybook/test'
import { submitReply, click, modalRoot } from './interactions'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ActivityRow, type ActivitySectionKind } from '../../apps/desktop/src/components/activity/ActivityRow'
import { ActivityPeek } from '../../apps/desktop/src/components/activity/ActivityPeek'
import { ActivityQuestionCard } from '../../apps/desktop/src/components/activity/ActivityQuestionCard'
import { ActivityReplyBox } from '../../apps/desktop/src/components/activity/ActivityReplyBox'
import { ChiefOfStaffOpening } from '../../apps/desktop/src/components/activity/ChiefOfStaffOpening'
import { StatusMark, type StatusMarkState } from '../../apps/desktop/src/components/activity/StatusMark'
import type { ActivityRowItem, SessionLiveQuestion } from '../../apps/desktop/src/app/session-live'
import { now, sessions, messages, noop, succeed, fail, pending } from './fixtures'

const question: SessionLiveQuestion = {
  id: 'question',
  runtimeId: 'story-runtime',
  title: 'Which workspace should receive the update?',
  method: 'select',
  options: ['Current checkout', 'Separate worktree', 'Cancel the operation'],
  deadline: now + 60000,
}
function activityItem(section: ActivitySectionKind): ActivityRowItem {
  return {
    session: { ...sessions[0], status: section === 'running' ? 'running' : section === 'needs-you' ? 'waiting' : 'complete' },
    attention: section === 'needs-you' ? { kind: 'question', title: question.title, method: question.method } : section === 'review' ? { kind: 'review' } : null,
    live:
      section === 'running'
        ? { runtimeId: 'story-runtime', phase: 'tool', lastEventAt: now, runStartedAt: now - 120000, currentTool: { name: 'bash', summary: 'npm test', startedAt: now - 10000 } }
        : undefined,
  }
}
function Activity({
  section = 'running',
  transcript = 'ready',
  stopConfirmation = false,
  failed = false,
}: {
  section?: ActivitySectionKind
  transcript?: 'ready' | 'loading' | 'error' | 'empty'
  stopConfirmation?: boolean
  failed?: boolean
}) {
  const [item, setItem] = useState<ActivityRowItem | null>(() =>
    failed ? { ...activityItem(section), session: { ...sessions[0], status: 'failed' }, attention: { kind: 'failed', error: 'Review failed: provider unavailable.' } } : activityItem(section),
  )
  const [signal, setSignal] = useState(0)
  const [opened, setOpened] = useState(false)
  const stop = () => setItem((current) => (current ? { ...current, session: { ...current.session, status: 'complete' }, live: undefined } : null))
  const actions = { onOpen: () => setOpened(true), onClear: () => setItem(null), onStop: stop }
  return (
    <div>
      {item && <ActivityRow item={item} section={section} projectName="Apex" now={now} selected stopConfirmSignal={signal} {...actions} onSelect={() => setSignal((value) => value + 1)} />}
      {stopConfirmation && (
        <button type="button" onClick={() => setSignal((value) => value + 1)}>
          Request stop confirmation
        </button>
      )}
      <ActivityPeek
        item={item}
        section={item ? section : null}
        projectName="Apex"
        now={now}
        stopConfirmSignal={signal}
        readTranscript={transcript === 'loading' ? pending : transcript === 'error' ? fail : async () => (transcript === 'empty' ? [] : messages)}
        {...actions}
        questionSlot={section === 'needs-you' ? <ActivityQuestionCard question={question} now={now} onRespond={succeed} onOpenModal={noop} /> : undefined}
        replySlot={item && <ActivityReplyBox session={item.session} runtimeId="story-runtime" isRunning={section === 'running'} canFollowUp onSend={succeed} />}
      />
      <output>{opened ? 'Session opened in fixture' : ''}</output>
    </div>
  )
}
const config = {
  title: 'Workspace/Activity',
  component: Activity,
  args: { section: 'running', transcript: 'ready', stopConfirmation: false },
  argTypes: { section: { control: 'select', options: ['running', 'needs-you', 'review', 'recent'] }, transcript: { control: 'select', options: ['ready', 'loading', 'error', 'empty'] } },
} satisfies Meta<typeof Activity>
export default config
type Story = StoryObj<typeof config>
export const Running: Story = {}
export const NeedsYou: Story = { args: { section: 'needs-you' } }
export const Review: Story = { args: { section: 'review' } }
export const Recent: Story = { args: { section: 'recent' } }
export const TranscriptLoading: Story = { args: { transcript: 'loading' } }
export const TranscriptError: Story = { args: { transcript: 'error' } }
export const TranscriptEmpty: Story = { args: { transcript: 'empty' } }
export const StopConfirmation: Story = { args: { stopConfirmation: true }, play: async ({ canvasElement }) => click(canvasElement, 'Request stop confirmation') }
export const PeekEmpty: Story = { render: () => <ActivityPeek item={null} section={null} projectName="Apex" now={now} onOpen={noop} onClear={noop} /> }
export const Opening: Story = { render: () => <ChiefOfStaffOpening /> }
export const StatusGallery: Story = {
  render: () => (
    <>
      {(['pending', 'running', 'done', 'failed', 'stale'] satisfies StatusMarkState[]).map((state) => (
        <p key={state}>
          <StatusMark state={state} size={24} /> {state}
        </p>
      ))}
    </>
  ),
}
export const QuestionSelect: Story = { render: () => <ActivityQuestionCard question={question} now={now} onRespond={succeed} /> }
export const QuestionInput: Story = { render: () => <ActivityQuestionCard question={{ ...question, method: 'input', title: 'Name this worktree' }} now={now} onRespond={succeed} /> }
export const QuestionConfirm: Story = {
  render: () => <ActivityQuestionCard question={{ ...question, method: 'confirm', title: 'Continue with the selected branch?' }} now={now} onRespond={succeed} />,
}
function ModalQuestion() {
  const [open, setOpen] = useState(false)
  const [response, setResponse] = useState<ExtensionUiResponse>()
  return (
    <>
      <ActivityQuestionCard question={{ ...question, method: 'editor', title: 'Review the full proposal' }} now={now} onOpenModal={() => setOpen(true)} />
      {open && (
        <ExtensionUiModal
          request={{ id: question.id, method: 'editor', title: 'Review the full proposal', prefill: 'Review the tests before releasing.' }}
          onRespond={(value) => {
            setResponse(value)
            setOpen(false)
          }}
        />
      )}
      <output aria-label="Question response">{response ? JSON.stringify(response) : ''}</output>
    </>
  )
}
function ErrorQuestion() {
  const [error, setError] = useState('')
  return (
    <>
      <ActivityQuestionCard
        question={question}
        now={now}
        onRespond={async () => {
          try {
            await fail()
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason))
          }
        }}
      />
      {error && <Banner status="error" role="alert" title={error} />}
    </>
  )
}
export const Failed: Story = { args: { section: 'recent', failed: true } }
export const GroupedActivity: Story = {
  render: () => (
    <>
      {(['needs-you', 'running', 'review', 'recent'] satisfies ActivitySectionKind[]).map((section) => (
        <section key={section} aria-label={section}>
          <h2>{section}</h2>
          <Activity section={section} />
        </section>
      ))}
    </>
  ),
}
export const QuestionError: Story = {
  render: () => <ErrorQuestion />,
  play: async ({ canvasElement }) => {
    await click(canvasElement, 'Current checkout')
    await expect(await within(canvasElement).findByRole('alert')).toBeVisible()
  },
}
export const QuestionModal: Story = {
  render: () => <ModalQuestion />,
  play: async ({ canvasElement }) => {
    await click(canvasElement, 'Answer…')
    await expect(await within(modalRoot(canvasElement)).findByRole('dialog')).toBeVisible()
  },
}
export const QuestionModalResponse: Story = {
  render: () => <ModalQuestion />,
  play: async ({ canvasElement }) => {
    await click(canvasElement, 'Answer…')
    await click(modalRoot(canvasElement), 'Continue')
    await expect(within(canvasElement).getByLabelText('Question response')).toHaveTextContent('Review the tests before releasing.')
  },
}
export const QuestionExpired: Story = { render: () => <ActivityQuestionCard question={{ ...question, deadline: now - 1000 }} now={now} onRespond={succeed} /> }
export const QuestionPending: Story = {
  render: () => <ActivityQuestionCard question={question} now={now} onRespond={pending} />,
  play: async ({ canvasElement }) => click(canvasElement, 'Current checkout'),
}
export const ReplyFollowUp: Story = { render: () => <ActivityReplyBox session={sessions[0]} isRunning={false} canFollowUp onSend={succeed} /> }
export const ReplyDisabled: Story = { render: () => <ActivityReplyBox session={sessions[0]} isRunning={false} canFollowUp={false} /> }
export const ReplySending: Story = { render: () => <ActivityReplyBox session={sessions[0]} isRunning canFollowUp onSend={pending} />, play: async ({ canvasElement }) => submitReply(canvasElement) }
export const ReplyError: Story = { render: () => <ActivityReplyBox session={sessions[0]} isRunning canFollowUp onSend={fail} />, play: async ({ canvasElement }) => submitReply(canvasElement) }
