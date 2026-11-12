/**
 * Apex questionnaire tool.
 *
 * Loaded explicitly for every pi runtime started by the desktop
 * app. The extension is self-contained because it is loaded
 * directly from app resources. In RPC mode, the marker option lets Apex
 * combine the individual select requests into one multi-question modal.
 *
 * Schema builders come from the injected `pi.typebox` shim when the host
 * provides one; base pi injects no shim, so builders resolve from the
 * `typebox` package via the host's extension loader. The import uses a
 * runtime specifier inside try/catch so neither host hard-fails at load.
 */

interface ApexSchemaOptions {
  description?: string
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
}

interface ApexTypebox {
  Object(properties: Record<string, unknown>, options?: ApexSchemaOptions): unknown
  String(options?: ApexSchemaOptions): unknown
  Array(items: unknown, options?: ApexSchemaOptions): unknown
}

interface AskQuestion {
  question: string
  options: string[]
}

interface EncodedAnswer {
  answer: string
  answerSource: 'option' | 'freeform'
  context?: string
}

interface ApexExtensionContext {
  hasUI: boolean
  ui: {
    select(title: string, options: string[], settings?: { signal?: AbortSignal }): Promise<string | undefined>
  }
}

interface ApexToolResult {
  content: Array<{ type: 'text'; text: string }>
  details: Record<string, unknown>
}

interface ApexToolDefinition<Params> {
  name: string
  label: string
  description: string
  parameters: unknown
  executionMode: 'sequential'
  execute(
    toolCallId: string,
    params: Params,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    context: ApexExtensionContext,
  ): Promise<ApexToolResult>
}

export interface ApexExtensionApi {
  typebox?: { Type: ApexTypebox }
  registerTool<Params>(tool: ApexToolDefinition<Params>): void
}

async function importHostModule(specifier: string): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import(specifier)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

async function resolveHostTypebox(): Promise<ApexTypebox> {
  const hostType = (await importHostModule('typebox'))?.Type as ApexTypebox | undefined
  if (hostType) {
    return {
      Object: (properties, options) => hostType.Object(properties, options),
      String: (options) => hostType.String(options),
      Array: (items, options) => hostType.Array(items, options),
    }
  }
  // Last resort: plain JSON Schema builders covering exactly this file's usage.
  return {
    Object: (properties, options) => ({ type: 'object', properties, required: Object.keys(properties), ...(options ?? {}) }),
    String: (options) => ({ type: 'string', ...(options ?? {}) }),
    Array: (items, options) => ({ type: 'array', items, ...(options ?? {}) }),
  }
}

const ASK_USER_RPC_MARKER = '__apex_ask_user__'
const OTHER_OPTION = 'Other (type your own answer)'
const MAX_QUESTION_LENGTH = 4_000
const MAX_OPTION_LENGTH = 500
const MAX_ANSWER_LENGTH = 8_000
const MAX_CONTEXT_LENGTH = 8_000
const NO_ANSWER_GUIDANCE = 'No answer given. Continue forward with your best judgment unless it is unsafe to take further action without user input.'

function trimmed(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim().slice(0, maxLength)
  return result || undefined
}

function isOtherOption(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === 'other'
    || normalized.startsWith('other (')
    || normalized.startsWith('other:')
    || normalized === 'something else'
    || normalized.startsWith('something else (')
    || normalized === 'something different'
    || normalized.startsWith('something different (')
    || normalized === 'none of the above'
    || normalized === 'freeform'
}

function normalizeQuestions(value: unknown): AskQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) throw new TypeError('questions must contain one to five items')
  return value.map((raw, questionIndex) => {
    if (!raw || typeof raw !== 'object') throw new TypeError(`questions[${questionIndex}] must be an object`)
    const question = trimmed((raw as Record<string, unknown>).question, MAX_QUESTION_LENGTH)
    const rawOptions = (raw as Record<string, unknown>).options
    if (!question) throw new TypeError(`questions[${questionIndex}].question is required`)
    if (!Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > 12) {
      throw new TypeError(`questions[${questionIndex}].options must contain two to twelve items`)
    }
    const options: string[] = []
    let hasOther = false
    for (const rawOption of rawOptions) {
      const option = trimmed(rawOption, MAX_OPTION_LENGTH)
      if (!option) throw new TypeError(`questions[${questionIndex}].options must contain non-empty strings`)
      if (isOtherOption(option)) {
        if (!hasOther) options.push(OTHER_OPTION)
        hasOther = true
      } else {
        options.push(option)
      }
    }
    if (!hasOther) options.push(OTHER_OPTION)
    return { question, options }
  })
}

function decodeAnswer(value: string, question: AskQuestion): EncodedAnswer {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const answer = trimmed(record.answer, MAX_ANSWER_LENGTH)
      const answerSource = record.answerSource === 'option' || record.answerSource === 'freeform' ? record.answerSource : undefined
      const context = trimmed(record.context, MAX_CONTEXT_LENGTH)
      if (answer && answerSource) return { answer, answerSource, ...(context ? { context } : {}) }
    }
  } catch {
    // Generic RPC clients and terminal UIs return the selected label directly.
  }
  const answer = trimmed(value, MAX_ANSWER_LENGTH) ?? ''
  return {
    answer,
    answerSource: question.options.includes(answer) && answer !== OTHER_OPTION ? 'option' : 'freeform',
  }
}

function groupId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export default function (pi: ApexExtensionApi): void | Promise<void> {
  // A host that injects a TypeBox shim may call the factory without awaiting it, so
  // that path must stay fully synchronous; base pi awaits the factory, so the
  // fallback may resolve builders asynchronously before registering.
  const injected = pi.typebox?.Type
  if (injected) {
    registerTools(pi, injected)
    return
  }
  return resolveHostTypebox().then((hostType) => { registerTools(pi, hostType) })
}

function registerTools(pi: ApexExtensionApi, Type: ApexTypebox): void {
  const question = Type.Object({
    question: Type.String({ description: 'The question to ask the user', minLength: 1, maxLength: MAX_QUESTION_LENGTH }),
    options: Type.Array(Type.String({ minLength: 1, maxLength: MAX_OPTION_LENGTH }), {
      description: 'The choices to present for this question',
      minItems: 2,
      maxItems: 12,
    }),
  })

  pi.registerTool<{ questions: AskQuestion[] }>({
    name: 'ask_user',
    label: 'Ask user',
    description: 'Ask one to five focused multiple-choice questions in one questionnaire. Use this when the user must choose among concrete options before work can continue. The user can add context or provide a free-form answer.',
    parameters: Type.Object({
      questions: Type.Array(question, {
        description: 'One to five questions to ask in a single questionnaire',
        minItems: 1,
        maxItems: 5,
      }),
    }),
    executionMode: 'sequential',
    async execute(_toolCallId, params, signal, _onUpdate, context) {
      const questions = normalizeQuestions(params.questions)
      if (!context.hasUI) {
        return {
          content: [{ type: 'text', text: 'The user-question UI is not available in this mode.' }],
          details: { questions, answers: [], cancelled: true },
        }
      }

      const id = groupId()
      const values = await Promise.all(questions.map((item, index) => context.ui.select(
        item.question,
        [`${ASK_USER_RPC_MARKER}${id}:${index}:${questions.length}`, ...item.options],
        { signal },
      )))
      if (values.some((value) => value === undefined)) {
        return {
          content: [{ type: 'text', text: NO_ANSWER_GUIDANCE }],
          details: { questions, answers: [], cancelled: true },
        }
      }

      const answers = values.map((value, index) => ({
        question: questions[index].question,
        ...decodeAnswer(value as string, questions[index]),
      }))
      const text = answers.map((answer, index) => {
        const label = answer.answerSource === 'freeform' ? 'The user answered' : 'The user selected'
        const contextText = answer.context ? `\nAdditional context: ${answer.context}` : ''
        return `${index + 1}. ${label}: ${answer.answer}${contextText}`
      }).join('\n\n')
      return {
        content: [{ type: 'text', text }],
        details: { questions, answers, cancelled: answers.some((answer) => !answer.answer) },
      }
    },
  })
}
