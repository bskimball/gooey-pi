import * as stylex from '@stylexjs/stylex'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { AskUserCard, type AskUserExchange } from '../../apps/desktop/src/components/transcript/ask-user-card'
import { SubagentLane, SubagentContext, TodoStep } from '../../apps/desktop/src/components/transcript/subagent-lane'
import { MorphInline } from '../../apps/desktop/src/components/ContentMotion'
import { StatusMark } from '../../apps/desktop/src/components/activity/StatusMark'
import { ArrowUpRight, CaretRight, MagnifyingGlass, ShieldCheck, SidebarRight } from '../../packages/ui/src/icons'
import { useId, useState, type ComponentProps } from 'react'
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

interface SampleAgentCard {
  id: string
  role: string
  model: string
  mission: string
  status: 'running' | 'completed'
  detail: string
  context: string
}

const SAMPLE_AGENTS: readonly SampleAgentCard[] = [
  {
    id: 'sample-reviewer',
    role: 'reviewer',
    model: 'Reasoner · high',
    mission: 'Verify subagent card contrast and focus rings across narrow widths',
    status: 'running',
    detail: 'Inspecting StyleX border tokens and keyboard focus states in light and dark themes.',
    context: 'Agents sidebar · active preview',
  },
  {
    id: 'sample-scout',
    role: 'scout',
    model: 'Fast · medium',
    mission: 'Check restrained gradient, canvas ring, and shadow tokens in agents.stylex.ts',
    status: 'completed',
    detail: 'Confirmed 72% horizontal status wash, 1.5px canvas ring, and shallow hover shadow.',
    context: 'Agents sidebar · settled preview',
  },
] as const

type OptionId = 'compact-row' | 'agent-tile' | 'activity-strip'

const OPTION_LABEL: Record<OptionId, string> = {
  'compact-row': 'Option 1 · Compact row',
  'agent-tile': 'Option 2 · Agent tile',
  'activity-strip': 'Option 3 · Inline activity strip',
}

const optionStyles = stylex.create({
  root: {
    width: '100%',
    maxWidth: '1200px',
    minWidth: 0,
    display: 'grid',
    rowGap: '14px',
    color: 'var(--text)',
  },
  header: {
    minWidth: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: '12px',
    rowGap: '8px',
    paddingBottom: '10px',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--border-subtle)',
  },
  titleGroup: {
    minWidth: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: '8px',
    rowGap: '4px',
  },
  heading: {
    margin: 0,
    fontSize: 'var(--fs-body)',
    fontWeight: 600,
    color: 'var(--text)',
  },
  sampleTag: {
    display: 'inline-flex',
    alignItems: 'center',
    height: '20px',
    paddingInline: '7px',
    borderRadius: '999px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    backgroundColor: 'var(--surface-subtle)',
    color: 'var(--text-tertiary)',
    fontSize: 'var(--fs-micro)',
    fontWeight: 550,
    whiteSpace: 'nowrap',
  },
  previewBanner: {
    minWidth: 0,
    maxWidth: '100%',
    display: 'inline-flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: '8px',
    rowGap: '4px',
    paddingBlock: '4px',
    paddingInline: '9px',
    borderRadius: 'var(--radius-sm)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border-subtle)',
    backgroundColor: 'var(--surface-subtle)',
    color: 'var(--text-secondary)',
    fontSize: 'var(--fs-meta)',
  },
  previewBannerActive: {
    borderColor: 'color-mix(in srgb, var(--apex) 36%, var(--border))',
    backgroundColor: 'color-mix(in srgb, var(--apex-soft) 55%, var(--surface-raised))',
    color: 'var(--text)',
  },
  resetButton: {
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: 'var(--radius-xs)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    backgroundColor: { default: 'var(--surface-raised)', ':hover': 'var(--surface-hover)' },
    color: 'var(--text-secondary)',
    fontSize: 'var(--fs-micro)',
    cursor: 'pointer',
    outlineWidth: { default: null, ':focus-visible': '2px' },
    outlineStyle: { default: null, ':focus-visible': 'solid' },
    outlineColor: { default: null, ':focus-visible': 'var(--focus)' },
    outlineOffset: { default: null, ':focus-visible': '1px' },
  },
  columns: {
    minWidth: 0,
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(3, minmax(0, 1fr))',
      '@media (max-width: 959px)': 'minmax(0, 1fr)',
    },
    columnGap: '16px',
    rowGap: '18px',
    alignItems: 'start',
  },
  column: {
    minWidth: 0,
    display: 'grid',
    rowGap: '10px',
  },
  columnHeader: {
    minWidth: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: '8px',
    rowGap: '4px',
  },
  columnTitleRow: {
    minWidth: 0,
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: '6px',
  },
  columnTitle: {
    margin: 0,
    fontSize: 'var(--fs-ui)',
    fontWeight: 600,
    color: 'var(--text)',
  },
  columnMeta: {
    fontSize: 'var(--fs-micro)',
    color: 'var(--text-tertiary)',
    whiteSpace: 'nowrap',
  },
  choiceBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    height: '18px',
    paddingInline: '6px',
    borderRadius: '999px',
    backgroundColor: 'var(--apex-soft)',
    color: 'var(--apex)',
    fontSize: 'var(--fs-micro)',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  stack: {
    minWidth: 0,
    display: 'grid',
    rowGap: '8px',
  },
  caretButton: {
    width: '28px',
    height: '28px',
    display: 'inline-grid',
    placeItems: 'center',
    flexShrink: 0,
    borderRadius: 'var(--radius-sm)',
    backgroundColor: { default: 'transparent', ':hover': 'var(--surface-hover)' },
    color: { default: 'var(--text-tertiary)', ':hover': 'var(--text)' },
    cursor: 'pointer',
    transition: 'background-color var(--fast), color var(--fast)',
    outlineWidth: { default: null, ':focus-visible': '2px' },
    outlineStyle: { default: null, ':focus-visible': 'solid' },
    outlineColor: { default: null, ':focus-visible': 'var(--focus)' },
    outlineOffset: { default: null, ':focus-visible': '1px' },
  },
  caretIcon: {
    transition: {
      default: 'transform 160ms var(--ease-out)',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  caretIconOpen: {
    transform: 'rotate(90deg)',
  },
  statusRunning: {
    color: 'var(--apex)',
  },
  statusCompleted: {
    color: 'var(--success)',
  },

  /* Option 1: Compact row (~52px) */
  rowShell: {
    minWidth: 0,
    minHeight: '52px',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    borderRadius: 'var(--radius-md)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { default: 'var(--border-subtle)', ':hover': 'var(--border)' },
    backgroundColor: {
      default: 'color-mix(in srgb, var(--surface) 78%, transparent)',
      ':hover': 'var(--surface-hover)',
    },
    transition: 'background-color var(--fast), border-color var(--fast)',
  },
  rowShellSelected: {
    borderColor: 'color-mix(in srgb, var(--apex) 42%, var(--border))',
    backgroundColor: 'color-mix(in srgb, var(--apex-soft) 50%, var(--surface))',
  },
  rowMainButton: {
    minWidth: 0,
    width: '100%',
    minHeight: '50px',
    display: 'flex',
    alignItems: 'center',
    columnGap: '10px',
    paddingBlock: '7px',
    paddingLeft: '10px',
    paddingRight: '8px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    outlineWidth: { default: null, ':focus-visible': '2px' },
    outlineStyle: { default: null, ':focus-visible': 'solid' },
    outlineColor: { default: null, ':focus-visible': 'var(--focus)' },
    outlineOffset: { default: null, ':focus-visible': '-2px' },
  },
  rowText: {
    minWidth: 0,
    flexGrow: 1,
    display: 'grid',
    rowGap: '2px',
  },
  rowTop: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'baseline',
    columnGap: '6px',
  },
  rowRole: {
    flexShrink: 0,
    fontSize: 'var(--fs-ui)',
    fontWeight: 600,
    color: 'var(--text)',
    lineHeight: 1.3,
  },
  rowModel: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--chat-mono)',
    fontSize: 'var(--fs-micro)',
    color: 'var(--text-tertiary)',
  },
  rowMission: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 'var(--fs-meta)',
    color: 'var(--text-secondary)',
    lineHeight: 1.35,
  },
  rowTrailing: {
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: '5px',
    fontSize: 'var(--fs-micro)',
    fontWeight: 550,
    whiteSpace: 'nowrap',
  },
  rowCaretWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    paddingRight: '6px',
    paddingLeft: '4px',
    borderLeftWidth: '1px',
    borderLeftStyle: 'solid',
    borderLeftColor: 'var(--border-subtle)',
  },
  rowDetails: {
    gridColumn: '1 / -1',
    paddingTop: '7px',
    paddingRight: '10px',
    paddingBottom: '9px',
    paddingLeft: '34px',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'var(--border-subtle)',
    display: 'grid',
    rowGap: '3px',
    fontSize: 'var(--fs-meta)',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },

  /* Option 2: Agent tile (~80px, Agents gradient fading 72%, border, canvas ring, shallow shadow) */
  tileShell: {
    position: 'relative',
    minWidth: 0,
    minHeight: '80px',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'start',
    borderRadius: 'var(--radius-lg)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: 'var(--border)',
      ':hover': 'var(--border-strong)',
    },
    backgroundColor: 'var(--surface-raised)',
    boxShadow: {
      default: '0 1px 2px color-mix(in srgb, var(--color-shadow, rgba(9, 20, 36, 0.12)) 50%, transparent), 0 0 0 1.5px var(--canvas)',
      ':hover': '0 3px 8px color-mix(in srgb, var(--color-shadow, rgba(9, 20, 36, 0.2)) 70%, transparent), 0 0 0 1.5px var(--canvas)',
    },
    transform: {
      default: null,
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover': 'translateY(-1px)',
      },
    },
    transition: 'border-color var(--fast), box-shadow 160ms var(--ease-out), transform 160ms var(--ease-out)',
  },
  tileShellRunning: {
    borderColor: {
      default: 'color-mix(in srgb, var(--apex) 36%, var(--border))',
      ':hover': 'color-mix(in srgb, var(--apex) 54%, var(--border-strong))',
    },
    backgroundImage: 'linear-gradient(to right, color-mix(in srgb, var(--apex) 14%, transparent), transparent 72%)',
  },
  tileShellCompleted: {
    borderColor: {
      default: 'color-mix(in srgb, var(--success) 26%, var(--border))',
      ':hover': 'color-mix(in srgb, var(--success) 42%, var(--border-strong))',
    },
    backgroundImage: 'linear-gradient(to right, color-mix(in srgb, var(--success) 10%, transparent), transparent 72%)',
  },
  tileShellSelected: {
    borderColor: 'var(--apex)',
    boxShadow: '0 3px 8px color-mix(in srgb, var(--color-shadow, rgba(9, 20, 36, 0.2)) 70%, transparent), 0 0 0 1.5px var(--canvas)',
  },
  tileMainButton: {
    minWidth: 0,
    width: '100%',
    minHeight: '78px',
    display: 'flex',
    alignItems: 'flex-start',
    columnGap: '10px',
    paddingTop: '10px',
    paddingBottom: '10px',
    paddingLeft: '12px',
    paddingRight: '6px',
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    outlineWidth: { default: null, ':focus-visible': '2px' },
    outlineStyle: { default: null, ':focus-visible': 'solid' },
    outlineColor: { default: null, ':focus-visible': 'var(--focus)' },
    outlineOffset: { default: null, ':focus-visible': '-2px' },
  },
  tileAvatar: {
    width: '30px',
    height: '30px',
    flexShrink: 0,
    marginTop: '1px',
    display: 'grid',
    placeItems: 'center',
    borderRadius: 'var(--radius-md)',
    borderWidth: '1px',
    borderStyle: 'solid',
  },
  tileAvatarRunning: {
    backgroundColor: 'var(--apex-soft)',
    borderColor: 'color-mix(in srgb, var(--apex) 30%, var(--border))',
    color: 'var(--apex)',
  },
  tileAvatarCompleted: {
    backgroundColor: 'var(--success-soft)',
    borderColor: 'color-mix(in srgb, var(--success) 28%, var(--border))',
    color: 'var(--success)',
  },
  tileBody: {
    minWidth: 0,
    flexGrow: 1,
    display: 'grid',
    rowGap: '4px',
  },
  tileTopRow: {
    minWidth: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: '6px',
    rowGap: '3px',
  },
  tileRole: {
    fontSize: 'var(--fs-ui)',
    fontWeight: 600,
    color: 'var(--text)',
    lineHeight: 1.25,
  },
  tileStatusPill: {
    height: '19px',
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: '4px',
    paddingInline: '6px',
    borderRadius: '999px',
    fontSize: 'var(--fs-micro)',
    fontWeight: 550,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  },
  tileStatusRunning: {
    color: 'var(--apex)',
    backgroundColor: 'var(--apex-soft)',
  },
  tileStatusCompleted: {
    color: 'var(--success)',
    backgroundColor: 'var(--success-soft)',
  },
  tileActionCue: {
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: '3px',
    fontSize: 'var(--fs-micro)',
    color: 'var(--text-tertiary)',
    whiteSpace: 'nowrap',
  },
  tileMission: {
    fontSize: 'var(--fs-meta)',
    lineHeight: 1.38,
    color: 'var(--text-secondary)',
    overflowWrap: 'anywhere',
  },
  tileMetaRow: {
    minWidth: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: '6px',
    rowGap: '2px',
    fontSize: 'var(--fs-micro)',
    color: 'var(--text-tertiary)',
  },
  tileModel: {
    fontFamily: 'var(--chat-mono)',
  },
  tileCaretSlot: {
    paddingTop: '8px',
    paddingRight: '8px',
  },
  tileCaretButton: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { default: 'transparent', ':hover': 'var(--border-subtle)' },
  },
  tileDetails: {
    gridColumn: '1 / -1',
    marginTop: 0,
    marginRight: '10px',
    marginBottom: '10px',
    marginLeft: '10px',
    paddingBlock: '8px',
    paddingInline: '10px',
    borderRadius: 'var(--radius-md)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border-subtle)',
    backgroundColor: 'var(--surface-subtle)',
    display: 'grid',
    rowGap: '3px',
    fontSize: 'var(--fs-meta)',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },

  /* Option 3: Inline activity strip (low-chrome timeline with node + short connector) */
  stripList: {
    minWidth: 0,
    display: 'grid',
    rowGap: 0,
  },
  stripItem: {
    minWidth: 0,
    display: 'grid',
    gridTemplateColumns: '20px minmax(0, 1fr) auto',
    columnGap: '6px',
    alignItems: 'start',
  },
  stripRail: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingTop: '7px',
  },
  stripNode: {
    width: '18px',
    height: '18px',
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    borderRadius: '999px',
    borderWidth: '1px',
    borderStyle: 'solid',
    backgroundColor: 'var(--canvas)',
  },
  stripNodeRunning: {
    borderColor: 'color-mix(in srgb, var(--apex) 45%, var(--border))',
    color: 'var(--apex)',
  },
  stripNodeCompleted: {
    borderColor: 'color-mix(in srgb, var(--success) 38%, var(--border))',
    color: 'var(--success)',
  },
  stripConnector: {
    width: '1.5px',
    flexGrow: 1,
    minHeight: '14px',
    marginTop: '3px',
    borderRadius: '999px',
    backgroundColor: 'var(--border)',
  },
  stripConnectorRunning: {
    backgroundColor: 'color-mix(in srgb, var(--apex) 36%, var(--border))',
  },
  stripConnectorTail: {
    maxHeight: '12px',
  },
  stripMainButton: {
    minWidth: 0,
    width: '100%',
    textAlign: 'left',
    paddingBlock: '5px',
    paddingInline: '8px',
    marginBottom: '4px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: {
      default: 'transparent',
      ':hover': 'color-mix(in srgb, var(--surface-hover) 75%, transparent)',
    },
    cursor: 'pointer',
    transition: 'background-color var(--fast)',
    outlineWidth: { default: null, ':focus-visible': '2px' },
    outlineStyle: { default: null, ':focus-visible': 'solid' },
    outlineColor: { default: null, ':focus-visible': 'var(--focus)' },
    outlineOffset: { default: null, ':focus-visible': '1px' },
  },
  stripMainSelected: {
    backgroundColor: 'color-mix(in srgb, var(--apex-soft) 50%, transparent)',
  },
  stripTopLine: {
    minWidth: 0,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: '6px',
    rowGap: '2px',
  },
  stripRole: {
    fontSize: 'var(--fs-ui)',
    fontWeight: 600,
    color: 'var(--text)',
  },
  stripState: {
    fontSize: 'var(--fs-micro)',
    fontWeight: 550,
  },
  stripModel: {
    fontFamily: 'var(--chat-mono)',
    fontSize: 'var(--fs-micro)',
    color: 'var(--text-tertiary)',
  },
  stripOpenCue: {
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: '2px',
    fontSize: 'var(--fs-micro)',
    color: 'var(--text-tertiary)',
    whiteSpace: 'nowrap',
  },
  stripMission: {
    marginTop: '2px',
    fontSize: 'var(--fs-meta)',
    lineHeight: 1.38,
    color: 'var(--text-secondary)',
    overflowWrap: 'anywhere',
  },
  stripCaretWrap: {
    paddingTop: '4px',
  },
  stripDetails: {
    gridColumn: '2 / 4',
    marginLeft: '8px',
    marginBottom: '8px',
    paddingLeft: '10px',
    borderLeftWidth: '2px',
    borderLeftStyle: 'solid',
    borderLeftColor: 'var(--border)',
    display: 'grid',
    rowGap: '3px',
    fontSize: 'var(--fs-meta)',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },
  detailHint: {
    fontSize: 'var(--fs-micro)',
    color: 'var(--text-tertiary)',
  },
})

function SubagentCardDesignOptions() {
  const baseId = useId()
  const [selected, setSelected] = useState<{ option: OptionId; agent: SampleAgentCard } | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const toggleDetails = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <section aria-label="Subagent card design options" {...stylex.props(optionStyles.root)}>
      <header {...stylex.props(optionStyles.header)}>
        <div {...stylex.props(optionStyles.titleGroup)}>
          <h2 {...stylex.props(optionStyles.heading)}>Subagent card options</h2>
          <span {...stylex.props(optionStyles.sampleTag)}>Sample data · preview-only</span>
        </div>
        <div role="status" aria-live="polite" {...stylex.props(optionStyles.previewBanner, selected && optionStyles.previewBannerActive)}>
          <span>
            {selected
              ? `Preview: ${OPTION_LABEL[selected.option]} → ${selected.agent.role} (${selected.agent.status}) · opens Agents sidebar (not wired)`
              : 'Click a card to preview opening Agents sidebar · caret toggles inline details'}
          </span>
          {selected ? (
            <button type="button" {...stylex.props(optionStyles.resetButton)} onClick={() => setSelected(null)}>
              Clear
            </button>
          ) : null}
        </div>
      </header>

      <div {...stylex.props(optionStyles.columns)}>
        {/* Option 1: Compact row (~52px) */}
        <div {...stylex.props(optionStyles.column)}>
          <div {...stylex.props(optionStyles.columnHeader)}>
            <div {...stylex.props(optionStyles.columnTitleRow)}>
              <h3 {...stylex.props(optionStyles.columnTitle)}>1 · Compact row</h3>
              <span {...stylex.props(optionStyles.choiceBadge)}>Selected</span>
            </div>
            <span {...stylex.props(optionStyles.columnMeta)}>~52px · quiet ledger</span>
          </div>
          <div {...stylex.props(optionStyles.stack)}>
            {SAMPLE_AGENTS.map((agent) => {
              const key = `compact-${agent.id}`
              const isOpen = Boolean(expanded[key])
              const isSelected = selected?.option === 'compact-row' && selected.agent.id === agent.id
              const detailId = `${baseId}-${key}`
              const running = agent.status === 'running'
              return (
                <div key={agent.id} {...stylex.props(optionStyles.rowShell, isSelected && optionStyles.rowShellSelected)}>
                  <button
                    type="button"
                    aria-label={`View ${agent.role} (${agent.status}) in Agents sidebar (sample preview)`}
                    {...stylex.props(optionStyles.rowMainButton)}
                    onClick={() => setSelected({ option: 'compact-row', agent })}
                  >
                    <span {...stylex.props(running ? optionStyles.statusRunning : optionStyles.statusCompleted)} aria-hidden="true">
                      <StatusMark state={running ? 'running' : 'done'} size={14} />
                    </span>
                    <span {...stylex.props(optionStyles.rowText)}>
                      <span {...stylex.props(optionStyles.rowTop)}>
                        <span {...stylex.props(optionStyles.rowRole)}>{agent.role}</span>
                        <span {...stylex.props(optionStyles.rowModel)}>{agent.model}</span>
                      </span>
                      <span {...stylex.props(optionStyles.rowMission)}>{agent.mission}</span>
                    </span>
                    <span {...stylex.props(optionStyles.rowTrailing, running ? optionStyles.statusRunning : optionStyles.statusCompleted)}>
                      <span>{agent.status}</span>
                      <ArrowUpRight size={11} />
                    </span>
                  </button>
                  <span {...stylex.props(optionStyles.rowCaretWrap)}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? detailId : undefined}
                      aria-label={`Toggle inline details for ${agent.role} in compact row`}
                      {...stylex.props(optionStyles.caretButton)}
                      onClick={() => toggleDetails(key)}
                    >
                      <CaretRight size={12} {...stylex.props(optionStyles.caretIcon, isOpen && optionStyles.caretIconOpen)} />
                    </button>
                  </span>
                  {isOpen ? (
                    <div id={detailId} {...stylex.props(optionStyles.rowDetails)}>
                      <span>{agent.detail}</span>
                      <span {...stylex.props(optionStyles.detailHint)}>{agent.context}</span>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        {/* Option 2: Agent tile (~80px, recommended) */}
        <div {...stylex.props(optionStyles.column)}>
          <div {...stylex.props(optionStyles.columnHeader)}>
            <div {...stylex.props(optionStyles.columnTitleRow)}>
              <h3 {...stylex.props(optionStyles.columnTitle)}>2 · Agent tile</h3>
            </div>
            <span {...stylex.props(optionStyles.columnMeta)}>~80px · Agents tint</span>
          </div>
          <div {...stylex.props(optionStyles.stack)}>
            {SAMPLE_AGENTS.map((agent) => {
              const key = `tile-${agent.id}`
              const isOpen = Boolean(expanded[key])
              const isSelected = selected?.option === 'agent-tile' && selected.agent.id === agent.id
              const detailId = `${baseId}-${key}`
              const running = agent.status === 'running'
              return (
                <div key={agent.id} {...stylex.props(optionStyles.tileShell, running ? optionStyles.tileShellRunning : optionStyles.tileShellCompleted, isSelected && optionStyles.tileShellSelected)}>
                  <button
                    type="button"
                    aria-label={`View ${agent.role} (${agent.status}) in Agents sidebar (sample preview)`}
                    {...stylex.props(optionStyles.tileMainButton)}
                    onClick={() => setSelected({ option: 'agent-tile', agent })}
                  >
                    <span {...stylex.props(optionStyles.tileAvatar, running ? optionStyles.tileAvatarRunning : optionStyles.tileAvatarCompleted)} aria-hidden="true">
                      {agent.role === 'reviewer' ? <ShieldCheck size={16} /> : <MagnifyingGlass size={16} />}
                    </span>
                    <span {...stylex.props(optionStyles.tileBody)}>
                      <span {...stylex.props(optionStyles.tileTopRow)}>
                        <span {...stylex.props(optionStyles.tileRole)}>{agent.role}</span>
                        <span {...stylex.props(optionStyles.tileStatusPill, running ? optionStyles.tileStatusRunning : optionStyles.tileStatusCompleted)}>
                          <StatusMark state={running ? 'running' : 'done'} size={10} />
                          <span>{agent.status}</span>
                        </span>
                        <span {...stylex.props(optionStyles.tileActionCue)}>
                          <SidebarRight size={12} />
                          <span>Agents</span>
                          <ArrowUpRight size={11} />
                        </span>
                      </span>
                      <span {...stylex.props(optionStyles.tileMission)}>{agent.mission}</span>
                      <span {...stylex.props(optionStyles.tileMetaRow)}>
                        <span {...stylex.props(optionStyles.tileModel)}>{agent.model}</span>
                        <span aria-hidden="true">·</span>
                        <span>Sample subagent</span>
                      </span>
                    </span>
                  </button>
                  <span {...stylex.props(optionStyles.tileCaretSlot)}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? detailId : undefined}
                      aria-label={`Toggle inline details for ${agent.role} in agent tile`}
                      {...stylex.props(optionStyles.caretButton, optionStyles.tileCaretButton)}
                      onClick={() => toggleDetails(key)}
                    >
                      <CaretRight size={12} {...stylex.props(optionStyles.caretIcon, isOpen && optionStyles.caretIconOpen)} />
                    </button>
                  </span>
                  {isOpen ? (
                    <div id={detailId} {...stylex.props(optionStyles.tileDetails)}>
                      <span>{agent.detail}</span>
                      <span {...stylex.props(optionStyles.detailHint)}>{agent.context}</span>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        {/* Option 3: Inline activity strip (low-chrome timeline) */}
        <div {...stylex.props(optionStyles.column)}>
          <div {...stylex.props(optionStyles.columnHeader)}>
            <div {...stylex.props(optionStyles.columnTitleRow)}>
              <h3 {...stylex.props(optionStyles.columnTitle)}>3 · Activity strip</h3>
            </div>
            <span {...stylex.props(optionStyles.columnMeta)}>Low-chrome · chains</span>
          </div>
          <div {...stylex.props(optionStyles.stripList)}>
            {SAMPLE_AGENTS.map((agent, index) => {
              const key = `strip-${agent.id}`
              const isOpen = Boolean(expanded[key])
              const isSelected = selected?.option === 'activity-strip' && selected.agent.id === agent.id
              const detailId = `${baseId}-${key}`
              const running = agent.status === 'running'
              const isLast = index === SAMPLE_AGENTS.length - 1
              return (
                <div key={agent.id} {...stylex.props(optionStyles.stripItem)}>
                  <div {...stylex.props(optionStyles.stripRail)} aria-hidden="true">
                    <span {...stylex.props(optionStyles.stripNode, running ? optionStyles.stripNodeRunning : optionStyles.stripNodeCompleted)}>
                      <StatusMark state={running ? 'running' : 'done'} size={11} />
                    </span>
                    <span {...stylex.props(optionStyles.stripConnector, running && optionStyles.stripConnectorRunning, isLast && optionStyles.stripConnectorTail)} />
                  </div>
                  <button
                    type="button"
                    aria-label={`View ${agent.role} (${agent.status}) in Agents sidebar (sample preview)`}
                    {...stylex.props(optionStyles.stripMainButton, isSelected && optionStyles.stripMainSelected)}
                    onClick={() => setSelected({ option: 'activity-strip', agent })}
                  >
                    <div {...stylex.props(optionStyles.stripTopLine)}>
                      <span {...stylex.props(optionStyles.stripRole)}>{agent.role}</span>
                      <span {...stylex.props(optionStyles.stripState, running ? optionStyles.statusRunning : optionStyles.statusCompleted)}>{agent.status}</span>
                      <span {...stylex.props(optionStyles.stripModel)}>{agent.model}</span>
                      <span {...stylex.props(optionStyles.stripOpenCue)}>
                        <span>Agents</span>
                        <ArrowUpRight size={10} />
                      </span>
                    </div>
                    <div {...stylex.props(optionStyles.stripMission)}>{agent.mission}</div>
                  </button>
                  <span {...stylex.props(optionStyles.stripCaretWrap)}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? detailId : undefined}
                      aria-label={`Toggle inline details for ${agent.role} in activity strip`}
                      {...stylex.props(optionStyles.caretButton)}
                      onClick={() => toggleDetails(key)}
                    >
                      <CaretRight size={12} {...stylex.props(optionStyles.caretIcon, isOpen && optionStyles.caretIconOpen)} />
                    </button>
                  </span>
                  {isOpen ? (
                    <div id={detailId} {...stylex.props(optionStyles.stripDetails)}>
                      <span>{agent.detail}</span>
                      <span {...stylex.props(optionStyles.detailHint)}>{agent.context}</span>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

export const CardDesignOptions: Story = {
  render: () => <SubagentCardDesignOptions />,
}
