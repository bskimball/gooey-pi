import { assign, initialTransition, setup, transition, type SnapshotFrom } from 'xstate'
import type { ExtensionUiQuestion, ExtensionUiQuestionnaireRequest } from '@/lib/extension-ui'

export const OTHER_OPTION = 'Other (type your own answer)'

export function questionnaireAnswer(
  question: ExtensionUiQuestion,
  selectedIndex: number,
  contexts: Record<string, string>,
) {
  const selected = question.options[selectedIndex]
  const typed = contexts[question.id]?.trim()
  if (selected === OTHER_OPTION) {
    if (!typed) return undefined
    return {
      answer: typed,
      answerSource: 'freeform' as const,
    }
  }
  return {
    answer: selected,
    answerSource: 'option' as const,
    ...(typed ? { context: typed } : {}),
  }
}

interface QuestionnaireContext {
  requestId: string | undefined
  /** Whether the request has streamed in all of its questions. */
  complete: boolean
  questions: ExtensionUiQuestion[]
  /** Active question index; `questions.length` is the submit summary. */
  index: number
  selectedByQuestion: Record<string, number>
  answeredByQuestion: Record<string, boolean>
  contexts: Record<string, string>
}

export type QuestionnaireEvent =
  | { type: 'REQUEST'; requestId: string; complete: boolean; questions: ExtensionUiQuestion[] }
  | { type: 'SELECT'; index: number }
  | { type: 'TYPE_CONTEXT'; text: string }
  | { type: 'COMMIT'; index?: number }
  | { type: 'NAVIGATE'; index: number }
  | { type: 'SUBMIT' }
  | { type: 'RESPONDED' }

export type QuestionnaireSnapshot = SnapshotFrom<typeof extensionQuestionnaireMachine>

const emptyContext: QuestionnaireContext = {
  requestId: undefined,
  complete: false,
  questions: [],
  index: 0,
  selectedByQuestion: {},
  answeredByQuestion: {},
  contexts: {},
}

function activeQuestion(context: QuestionnaireContext): ExtensionUiQuestion | undefined {
  return context.questions[context.index]
}

function selectedFor(context: QuestionnaireContext, question: ExtensionUiQuestion): number {
  return context.selectedByQuestion[question.id] ?? 0
}

function boundedOption(question: ExtensionUiQuestion, index: number): number {
  return Math.max(0, Math.min(question.options.length - 1, index))
}

/** The single source of "can submit": streamed in fully and every question has a committed answer. */
export function selectQuestionnaireComplete(context: QuestionnaireContext): boolean {
  return context.complete
    && context.questions.length > 0
    && context.questions.every((question) => context.answeredByQuestion[question.id])
}

/** Answers keyed by question id as JSON, or undefined while any question is still unanswered. */
export function selectQuestionnaireValues(context: QuestionnaireContext): Record<string, string> | undefined {
  const values: Record<string, string> = {}
  for (const question of context.questions) {
    const answer = questionnaireAnswer(question, selectedFor(context, question), context.contexts)
    if (!answer) return undefined
    values[question.id] = JSON.stringify(answer)
  }
  return values
}

function navigateContext(context: QuestionnaireContext, index: number): Partial<QuestionnaireContext> {
  const question = activeQuestion(context)
  const answer = question ? questionnaireAnswer(question, selectedFor(context, question), context.contexts) : undefined
  return {
    index: Math.max(0, Math.min(context.questions.length, index)),
    ...(question ? { answeredByQuestion: { ...context.answeredByQuestion, [question.id]: Boolean(answer) } } : {}),
  }
}

export const extensionQuestionnaireMachine = setup({
  types: { context: {} as QuestionnaireContext, events: {} as QuestionnaireEvent },
  guards: {
    newRequest: ({ context, event }) => event.type === 'REQUEST' && event.requestId !== context.requestId,
    onSummary: ({ context }) => context.index >= context.questions.length,
    onQuestion: ({ context }) => context.index < context.questions.length,
    submittable: ({ context }) => selectQuestionnaireComplete(context),
  },
}).createMachine({
  id: 'extensionQuestionnaire',
  context: emptyContext,
  initial: 'answering',
  on: {
    // A new request resets the wizard; a refreshed request keeps answers and clamps the index.
    REQUEST: [
      {
        guard: 'newRequest',
        target: '.answering',
        actions: assign(({ event }) => ({ ...emptyContext, requestId: event.requestId, complete: event.complete, questions: event.questions })),
      },
      {
        actions: assign(({ context, event }) => ({
          complete: event.complete,
          questions: event.questions,
          index: Math.min(context.index, event.questions.length),
        })),
      },
    ],
  },
  states: {
    answering: {
      always: { guard: 'onSummary', target: 'reviewing' },
      on: {
        SUBMIT: { guard: 'submittable', target: 'submitting' },
        SELECT: {
          actions: assign(({ context, event }) => {
            const question = activeQuestion(context)
            if (!question) return {}
            return {
              selectedByQuestion: { ...context.selectedByQuestion, [question.id]: boundedOption(question, event.index) },
              answeredByQuestion: { ...context.answeredByQuestion, [question.id]: false },
            }
          }),
        },
        TYPE_CONTEXT: {
          actions: assign(({ context, event }) => {
            const question = activeQuestion(context)
            if (!question) return {}
            return {
              contexts: { ...context.contexts, [question.id]: event.text },
              answeredByQuestion: { ...context.answeredByQuestion, [question.id]: false },
            }
          }),
        },
        COMMIT: {
          actions: assign(({ context, event }) => {
            const question = activeQuestion(context)
            if (!question) return {}
            const bounded = boundedOption(question, event.index ?? selectedFor(context, question))
            const answer = questionnaireAnswer(question, bounded, context.contexts)
            return {
              selectedByQuestion: { ...context.selectedByQuestion, [question.id]: bounded },
              answeredByQuestion: { ...context.answeredByQuestion, [question.id]: Boolean(answer) },
              // An empty "Other" answer stays on the question so its context field can take focus.
              index: answer ? context.index + 1 : context.index,
            }
          }),
        },
        NAVIGATE: {
          actions: assign(({ context, event }) => navigateContext(context, event.index)),
        },
      },
    },
    reviewing: {
      always: { guard: 'onQuestion', target: 'answering' },
      on: {
        NAVIGATE: {
          actions: assign(({ context, event }) => navigateContext(context, event.index)),
        },
        SUBMIT: { guard: 'submittable', target: 'submitting' },
      },
    },
    submitting: {
      on: { RESPONDED: { target: 'done' } },
    },
    done: {},
  },
})

export function questionnaireRequestEvent(request: ExtensionUiQuestionnaireRequest): QuestionnaireEvent {
  return { type: 'REQUEST', requestId: request.id, complete: request.complete, questions: request.questions }
}

/** Starts a wizard already showing `request`, so the first render never flashes an empty summary. */
export function initialQuestionnaireSnapshot(request?: ExtensionUiQuestionnaireRequest): QuestionnaireSnapshot {
  const initial = initialTransition(extensionQuestionnaireMachine)[0]
  return request ? reduceQuestionnaire(initial, questionnaireRequestEvent(request)) : initial
}

/** Pure fold used as a React reducer; the machine has no invoked actors, so actions are not executed. */
export function reduceQuestionnaire(snapshot: QuestionnaireSnapshot, event: QuestionnaireEvent): QuestionnaireSnapshot {
  return transition(extensionQuestionnaireMachine, snapshot, event)[0]
}
