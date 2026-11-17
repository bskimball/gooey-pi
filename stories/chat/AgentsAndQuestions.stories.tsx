import type { Meta, StoryObj } from '@storybook/react-vite'
import { AskUserCard, type AskUserExchange } from '../../apps/desktop/src/components/transcript/ask-user-card'
import { SubagentLane, SubagentContext, TodoStep, MorphInline } from '../../apps/desktop/src/components/transcript/subagent-lane'
import type { ComponentProps } from 'react'
import { noop } from './data'

const meta = { title: 'Chat/Agents and questions' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
const questions: AskUserExchange[] = [
  { state: 'waiting', items: [{ question: 'Should the checkout stay on the current branch?', context: 'There are unsaved local changes.' }] },
  {
    state: 'answered',
    items: [
      { question: 'Which layout should be reviewed first?', answer: 'Narrow conversation' },
      { question: 'Any additional constraints?', answer: 'Keep the existing controls.', freeform: true, context: 'Design consistency only.' },
    ],
  },
  { state: 'dismissed', items: [{ question: 'Open the review?' }] },
  { state: 'failed', items: [{ question: 'Which model should be used?' }], response: 'The request expired.' },
  { state: 'answered', items: [{ question: 'Which branch?' }], response: 'Use the branch already checked out.' },
]
export const QuestionStates: Story = {
  render: () => (
    <>
      {questions.map((exchange, index) => (
        <AskUserCard key={index} exchange={exchange} />
      ))}
    </>
  ),
}
const statuses: Array<ComponentProps<typeof SubagentContext.Provider>['value']['specialists'][number]['status']> = ['running', 'waiting', 'done', 'error', 'stopped', 'closed']
export const SpecialistStates: Story = {
  render: () => (
    <>
      {statuses.map((status) => (
        <SubagentContext.Provider
          key={status}
          value={{
            specialists: [
              {
                id: `task-${status}`,
                agent: 'reviewer',
                mission: 'Review the chat component contracts',
                status,
                activity: status === 'running' ? 'Inspecting composer controls' : undefined,
                model: 'Sample reasoner',
                thinking: 'high',
              },
            ],
            onOpen: noop,
          }}
        >
          <SubagentLane
            part={{ type: 'toolCall', id: `task-${status}`, name: 'task', args: { agent: 'reviewer', prompt: 'Review the chat component contracts' } }}
            result={status === 'running' || status === 'waiting' ? undefined : { type: 'toolResult', text: 'Outcome: catalog contracts reviewed.', isError: status === 'error' }}
          />
        </SubagentContext.Provider>
      ))}
    </>
  ),
}
export const ChainAndFollowUps: Story = {
  render: () => (
    <>
      <SubagentLane
        part={{
          type: 'toolCall',
          id: 'chain',
          name: 'task_chain',
          args: {
            steps: [
              { agent: 'scout', prompt: 'Inspect current props' },
              { agent: 'reviewer', prompt: 'Check story coverage' },
            ],
          },
        }}
        result={{ type: 'toolResult', text: 'Both steps complete.' }}
      />
      <SubagentLane
        part={{ type: 'toolCall', id: 'start', name: 'task_start', args: { agent: 'reviewer', prompt: 'Review transcript states' } }}
        result={{ type: 'toolResult', text: 'id: task-review' }}
        followUps={[
          { call: { type: 'toolCall', name: 'task_wait', args: { id: 'task-review' } }, result: { type: 'toolResult', text: '--- result ---\nAll transcript states covered.' } },
          { call: { type: 'toolCall', name: 'task_send', args: { id: 'task-review', message: 'Also check narrow layouts' } } },
        ]}
      />
    </>
  ),
}
export const TodoStates: Story = {
  render: () => (
    <>
      <TodoStep
        part={{
          type: 'toolCall',
          name: 'todo_write',
          args: {
            todos: [
              { content: 'Read current props', status: 'completed' },
              { content: 'Build real component stories', status: 'in_progress' },
              { content: 'Validate scoped types', status: 'pending' },
              { content: 'Redesign controls', status: 'cancelled' },
            ],
          },
        }}
      />
      <TodoStep part={{ type: 'toolCall', name: 'todo_write', args: { todos: [{ content: 'Review complete', status: 'completed' }] } }} />
      <MorphInline morphKey="done" instant>
        Review complete
      </MorphInline>
    </>
  ),
}
