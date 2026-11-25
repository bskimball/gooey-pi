import * as stylex from '@stylexjs/stylex'
import { styles } from 'apex-ui/styles/ask-user.stylex'
import { motion } from 'motion/react'
import { memo } from 'react'
import type { MessagePart } from '@/types/api'
import { boundText } from '@/lib/render-bounds'
import { ChatCircleDots, Check, PencilSimple, WarningCircle } from '../icons'
import { StatusMark } from '../activity/StatusMark'
import { arrivalMotionProps, MorphInline, useInstantMotion } from '../ContentMotion'

type ToolCall = Extract<MessagePart, { type: 'toolCall' }>
type ToolResult = Extract<MessagePart, { type: 'toolResult' }>

export interface AskUserItem {
  question: string
  answer?: string
  freeform?: boolean
  context?: string
}

export interface AskUserExchange {
  state: 'waiting' | 'answered' | 'dismissed' | 'failed'
  items: AskUserItem[]
  /** Result text shown when the answers could not be matched to the questions. */
  response?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function questionsFrom(args: unknown): string[] | undefined {
  const questions = parseRecord(args)?.questions
  if (!Array.isArray(questions) || !questions.length) return undefined
  const titles = questions.map((item) => (isRecord(item) ? text(item.question) : undefined))
  return titles.every((title): title is string => Boolean(title)) ? titles : undefined
}

function answersFromDetails(details: unknown): Array<Omit<AskUserItem, 'question'>> | undefined {
  const answers = parseRecord(details)?.answers
  if (!Array.isArray(answers) || !answers.length) return undefined
  return answers.map((entry) => (isRecord(entry) ? { answer: text(entry.answer), freeform: entry.answerSource === 'freeform', context: text(entry.context) } : {}))
}

/** Pi's ask_user result text: "1. The user selected: X\nAdditional context: Y", one block per question. */
const ANSWER_BLOCK = /^(\d+)\. The user (selected|answered): ([\s\S]*?)(?:\nAdditional context: ([\s\S]*))?$/

function answersFromText(resultText: string, count: number): Array<Omit<AskUserItem, 'question'>> | undefined {
  const answers: Array<Omit<AskUserItem, 'question'>> = Array.from({ length: count }, () => ({}))
  let matched = 0
  for (const block of resultText.trim().split(/\n\n(?=\d+\. The user )/)) {
    const match = ANSWER_BLOCK.exec(block.trim())
    const index = match ? Number(match[1]) - 1 : -1
    if (!match || index < 0 || index >= count) continue
    answers[index] = { answer: text(match[3]), freeform: match[2] === 'answered', context: text(match[4]) }
    matched += 1
  }
  return matched ? answers : undefined
}

/** Reads an ask-style tool call and its result as questions and answers; undefined when the call carries no questions. */
export function askUserExchange(call: ToolCall, result?: ToolResult): AskUserExchange | undefined {
  const questions = questionsFrom(call.args)
  if (!questions) return undefined
  const items = questions.map((question) => ({ question }))
  if (!result || result.streaming) return { state: 'waiting', items }
  if (result.isError) return { state: 'failed', items, response: text(result.text) }
  const answers = answersFromDetails(result.details) ?? answersFromText(result.text, questions.length)
  if (answers?.some((entry) => entry.answer)) return { state: 'answered', items: items.map((item, index) => ({ ...item, ...answers[index] })) }
  if (parseRecord(result.details)?.cancelled === true) return { state: 'dismissed', items }
  return { state: 'answered', items, response: text(result.text) }
}

const TITLES: Record<AskUserExchange['state'], (count: number) => string> = {
  waiting: (count) => (count === 1 ? 'Waiting for your answer' : `Waiting for your answers to ${count} questions`),
  answered: (count) => (count === 1 ? 'You answered a question' : `You answered ${count} questions`),
  dismissed: (count) => (count === 1 ? 'Question dismissed' : `${count} questions dismissed`),
  failed: () => 'Question failed',
}

export const AskUserCard = memo(function AskUserCard({ exchange, animateArrival = false }: { exchange: AskUserExchange; animateArrival?: boolean }) {
  const instant = useInstantMotion()
  const { state, items, response } = exchange
  const numbered = items.length > 1
  return (
    <motion.section
      className={`ask-user-card is-${state} ${stylex.props(
        styles.card,
        state === 'waiting' && styles.cardWaiting,
        state === 'answered' && styles.cardAnswered,
        state === 'dismissed' && styles.cardDismissed,
        state === 'failed' && styles.cardFailed,
      ).className ?? ''}`}
      aria-label={TITLES[state](items.length)}
      {...arrivalMotionProps(instant, animateArrival)}
    >
      <header {...stylex.props(styles.header)}>
        <span
          {...stylex.props(
            styles.icon,
            state === 'answered' && styles.iconAnswered,
            state === 'dismissed' && styles.iconDismissed,
            state === 'failed' && styles.iconFailed,
          )}
          aria-hidden="true"
        >
          {state === 'failed' ? <WarningCircle size={14} /> : state === 'answered' ? <Check size={14} weight="bold" /> : <ChatCircleDots size={14} />}
        </span>
        <span {...stylex.props(styles.title)}>{TITLES[state](items.length)}</span>
        <span
          {...stylex.props(
            styles.status,
            state === 'waiting' && styles.statusWaiting,
            state === 'answered' && styles.statusAnswered,
            state === 'failed' && styles.statusFailed,
          )}
        >
          <MorphInline morphKey={state} instant={instant}>
            {state === 'waiting' ? (
              <>
                <StatusMark state="running" size={11} /> needs input
              </>
            ) : state === 'failed' ? (
              <>
                <WarningCircle size={11} /> failed
              </>
            ) : state === 'dismissed' ? (
              'dismissed'
            ) : (
              <>
                <Check size={11} weight="bold" /> answered
              </>
            )}
          </MorphInline>
        </span>
      </header>
      <ol {...stylex.props(styles.list)}>
        {items.map((item, index) => (
          <li key={index} {...stylex.props(styles.item, index > 0 && styles.itemDivider)}>
            {numbered ? <span {...stylex.props(styles.index)}>{index + 1}</span> : null}
            <div {...stylex.props(styles.itemBody)}>
              <p {...stylex.props(styles.question)}>{item.question}</p>
              {item.answer ? (
                <div {...stylex.props(styles.answerRow)}>
                  <span {...stylex.props(styles.answer)}>
                    {item.freeform ? (
                      <PencilSimple size={12} {...stylex.props(styles.answerIcon)} aria-hidden="true" />
                    ) : (
                      <Check size={12} weight="bold" {...stylex.props(styles.answerIcon)} aria-hidden="true" />
                    )}
                    <span>{boundText(item.answer, 2_000, '…')}</span>
                  </span>
                  {item.freeform ? <span {...stylex.props(styles.answerSource)}>written answer</span> : null}
                </div>
              ) : (state === 'answered' && !response) || state === 'dismissed' ? (
                <span {...stylex.props(styles.missing)}>No answer</span>
              ) : null}
              {item.context ? <p {...stylex.props(styles.context)}>{boundText(item.context, 2_000, '…')}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      {response ? <p {...stylex.props(styles.response, state === 'failed' && styles.responseFailed)}>{boundText(response, 2_000, '…')}</p> : null}
    </motion.section>
  )
})
