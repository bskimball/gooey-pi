import { useRef, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Transcript } from '../../apps/desktop/src/components/Transcript'
import { AssistantMessage, UserMessage, SteerReadMarker, ActivityMessage, AgentMessage, GoalMessage } from '../../apps/desktop/src/components/transcript/messages'
import { WorkTimeline, WorkDisclosure, LiveElapsed } from '../../apps/desktop/src/components/transcript/timeline'
import { WorkGroup } from '../../apps/desktop/src/components/transcript/work-group'
import { pairSubagentCalls } from '../../apps/desktop/src/components/transcript/subagent-lane'
import { TimelinePage } from '../../apps/desktop/src/components/transcript/TimelinePage'
import { TurnNavigator } from '../../apps/desktop/src/components/transcript/turn-navigator'
import { TurnReceipt } from '../../apps/desktop/src/components/transcript/turn-receipt'
import { EditDiff } from '../../apps/desktop/src/components/transcript/edit-diff'
import { SyntaxText, InlineText } from '../../apps/desktop/src/components/transcript/syntax'
import { assistant, cleanGit, failed, git, history, live, noop, user, work } from './data'

function Thread(props: Partial<ComponentProps<typeof Transcript>>) {
  return (
    <div style={{ height: 680, display: 'flex', flexDirection: 'column' }}>
      <Transcript messages={[user, assistant]} git={git} onOpenChanges={noop} onSuggestion={noop} {...props} />
    </div>
  )
}
const meta = { title: 'Chat/Transcript', component: Thread } satisfies Meta<typeof Thread>
export default meta
type Story = StoryObj<typeof meta>
export const Settled: Story = {}
export const Welcome: Story = { args: { messages: [], git: cleanGit } }
export const Loading: Story = { args: { messages: [], loading: true } }
export const Streaming: Story = { args: { messages: [user, live], active: true } }
export const Failed: Story = { args: { messages: [user, failed] } }
export const NarrowConversation: Story = { args: { variant: 'chat', messages: [user, assistant] }, globals: { viewport: { value: 'narrow', isRotated: false } } }
export const LongHistory: Story = { args: { messages: history(70) } }
export const MessageKinds: Story = {
  render: () => (
    <>
      <UserMessage message={user} turnLabel="1m12s" />
      <UserMessage message={{ ...user, id: 'steer', steerState: 'accepted' }} turnFailed />
      <AssistantMessage message={assistant} showReasoning showTools git={git} onOpenChanges={noop} />
      <SteerReadMarker message={{ ...user, parts: [{ type: 'text', text: 'Steer read by agent' }] }} />
      <ActivityMessage message={{ id: 'system', role: 'system', parts: [{ type: 'text', text: 'Provider switched to the configured fallback.' }] }} />
      <AgentMessage message={{ id: 'agent', role: 'agent', agentName: 'Reviewer', parts: [{ type: 'text', text: 'No keyboard regressions found.' }] }} />
      <GoalMessage message={{ id: 'goal', role: 'goal', parts: [{ type: 'text', text: 'Keep the real chat components consistent.' }] }} />
    </>
  ),
}
export const TimelineStates: Story = {
  render: () => (
    <>
      <WorkTimeline
        parts={[
          ...work,
          { type: 'toolResult', name: 'standalone', text: 'A standalone diagnostic result.' },
          { type: 'agentMessage', agentName: 'Reviewer', text: 'The toolbar retains its focus order.' },
          { type: 'compaction', status: 'done', reason: 'threshold', tokensBefore: 185000, summary: 'Retained the active task and validation results.' },
          { type: 'compaction', status: 'failed', reason: 'overflow', error: 'Sample compaction failure' },
          { type: 'compaction', status: 'cancelled', reason: 'manual' },
        ]}
        showReasoning
        showTools
      />
      <WorkDisclosure message={live} showReasoning showTools>
        <WorkTimeline parts={live.parts} showReasoning showTools streaming />
      </WorkDisclosure>
      <WorkTimeline parts={[{ type: 'compaction', status: 'running', reason: 'requested' }]} showReasoning showTools />
      <LiveElapsed since="2099-01-01T00:00:00Z" />
    </>
  ),
}
export const WorkGroups: Story = {
  render: () => (
    <>
      <WorkGroup parts={work} showReasoning showTools streaming={false} live={false} subagents={pairSubagentCalls(work)} />
      <WorkGroup parts={live.parts} showReasoning showTools streaming live subagents={pairSubagentCalls(live.parts)} presentation="current-step" />
    </>
  ),
}
export const DeferredHistory: Story = {
  render: () => (
    <>
      <TimelinePage recent={false} start={1} count={50}>
        <WorkTimeline parts={work} showReasoning showTools />
      </TimelinePage>
      <TimelinePage recent start={51} count={10}>
        <WorkTimeline parts={work} showReasoning showTools />
      </TimelinePage>
    </>
  ),
}
function NavigatorDemo() {
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <>
      <TurnNavigator scrollRef={scrollRef} active inline />
      <div ref={scrollRef} className="scroll-area" style={{ height: 420, overflowY: 'auto' }}>
        {Array.from({ length: 8 }, (_, index) => (
          <section key={index}>
            <UserMessage message={{ ...user, id: `nav-${index}`, parts: [{ type: 'text', text: `Review step ${index + 1}` }] }} />
            <AssistantMessage message={assistant} showReasoning showTools />
          </section>
        ))}
      </div>
    </>
  )
}
export const TurnNavigation: Story = { render: () => <NavigatorDemo /> }
export const Receipts: Story = {
  render: () => (
    <>
      <TurnReceipt duration="1m12s" agents={2} tools={8} git={git} onReviewChanges={noop} />
      <TurnReceipt duration="8s" failed agents={0} tools={1} />
      <TurnReceipt duration="3s" agents={0} tools={0} />
    </>
  ),
}
export const DiffAndSyntax: Story = {
  render: () => (
    <>
      <EditDiff
        id="sample-diff"
        diff={[
          { kind: 'context', text: 'export function Chat() {' },
          { kind: 'remove', text: '  return null' },
          { kind: 'add', text: '  return <Composer />' },
          { kind: 'gap', text: '@@ next section @@' },
          ...Array.from({ length: 24 }, (_, index) => ({ kind: 'add' as const, text: `const state${index} = true` })),
        ]}
      />
      <SyntaxText text={'const result = await read("src/Chat.tsx"); // existing UI'} />
      <InlineText text={'Review `src/Chat.tsx`, **preserve focus**, and keep the current API.'} />
    </>
  ),
}
