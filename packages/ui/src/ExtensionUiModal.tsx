import * as stylex from '@stylexjs/stylex'
import { styles as overlaysStyles } from './styles/overlays.stylex'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useId, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react'
import type { ExtensionUiRequest } from '@/lib/extension-ui'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { ChatCircleDots, Check, Clock } from './icons'
import { ApexButton, Modal } from './ui'
import {
  OTHER_OPTION,
  initialQuestionnaireSnapshot,
  questionnaireAnswer,
  questionnaireRequestEvent,
  reduceQuestionnaire,
  selectQuestionnaireComplete,
  selectQuestionnaireValues,
} from './extensionQuestionnaireMachine'

/** Plain selects longer than this get a search field; short lists stay a button stack. */
const SELECT_SEARCH_THRESHOLD = 8
/** The countdown turns to the warning color once this few seconds remain. */
const URGENT_SECONDS = 30

const formatCountdown = (seconds: number) => seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

const sx = (...styles: Array<stylex.StyleXStyles | false | null | undefined>) => stylex.props(...styles).className ?? ''

export type ExtensionUiResponse =
  | { cancelled: true }
  | { value: string }
  | { confirmed: boolean }
  | { values: Record<string, string> }

interface ExtensionUiModalProps {
  request: ExtensionUiRequest
  onRespond(response: ExtensionUiResponse): void
  platform?: NodeJS.Platform
  presentation?: 'modal' | 'inline'
  /** Host-owned expiry timestamp (epoch ms). Without it, the modal starts a countdown when this request first shows. */
  deadline?: number
}

/** Case-insensitive match on every whitespace-separated term, keeping original positions. */
function filterSelectOptions(options: readonly string[], query: string): Array<{ option: string; index: number }> {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return options
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => {
      const text = option.toLocaleLowerCase()
      return terms.every((term) => text.includes(term))
    })
}

/** Milliseconds left until `deadline`, re-rendered once a second; undefined when there is no deadline. */
function useRemainingMs(deadline: number | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (deadline === undefined) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [deadline])
  return deadline === undefined ? undefined : Math.max(0, deadline - now)
}

export function ExtensionUiModal({ request, onRespond, platform = 'darwin', deadline, presentation = 'modal' }: ExtensionUiModalProps) {
  const instant = Boolean(useReducedMotion())
    || (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion'))
  const prefill = request.method === 'editor' ? request.prefill : undefined
  const questionnaireTimeout = request.method === 'questionnaire' ? request.timeout : undefined
  const fallbackDeadline = useMemo(
    () => questionnaireTimeout === undefined ? undefined : Date.now() + questionnaireTimeout,
    [request.id, questionnaireTimeout],
  )
  const remainingMs = useRemainingMs(deadline ?? fallbackDeadline)
  const [value, setValue] = useState(prefill ?? '')
  const [selected, setSelected] = useState(0)
  const [query, setQuery] = useState('')
  const questionnaire = request.method === 'questionnaire' ? request : undefined
  const [wizard, dispatchWizard] = useReducer(reduceQuestionnaire, questionnaire, initialQuestionnaireSnapshot)
  const wizardContext = wizard.context
  const questionIndex = wizardContext.index
  const contextInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const questionnaireRef = useRef<HTMLDivElement | null>(null)
  const inlineFocusIntent = useRef<{ requestId: string; index: number } | null>(null)
  const selectOptionRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const selectListId = useId()

  useEffect(() => {
    setValue(prefill ?? '')
    setSelected(0)
    setQuery('')
  }, [prefill, request.id, request.method])

  const selectRequest = request.method === 'select' ? request : undefined
  const searchable = Boolean(selectRequest && selectRequest.options.length > SELECT_SEARCH_THRESHOLD)
  const selectOptions = selectRequest ? filterSelectOptions(selectRequest.options, searchable ? query : '') : []
  const highlighted = selectOptions[Math.min(selected, selectOptions.length - 1)]

  // The modal focus trap focuses its first control (Close) on the next frame;
  // React's autoFocus renders no attribute for it to prefer, so claim focus
  // after it: the search field, or the first option of a short list so Enter
  // answers instead of dismissing.
  const isSelect = Boolean(selectRequest)
  useEffect(() => {
    if (!isSelect) return
    const frame = requestAnimationFrame(() => {
      if (searchable) searchInputRef.current?.focus()
      else selectOptionRefs.current[0]?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [isSelect, searchable, request.id])

  useEffect(() => {
    if (!searchable || !highlighted) return
    selectOptionRefs.current[highlighted.index]?.scrollIntoView?.({ block: 'nearest' })
  }, [searchable, highlighted?.index])

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowUp' ? -1 : 1
      setSelected((current) => Math.max(0, Math.min(selectOptions.length - 1, current + delta)))
      return
    }
    if (event.key === 'Enter') {
      // With no matches, Enter must not answer with a stale or hidden option.
      event.preventDefault()
      if (highlighted) onRespond({ value: highlighted.option })
    }
  }

  const handleOptionsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (searchable || !selectOptions.length) return
    const last = selectOptions.length - 1
    const current = Math.min(selected, last)
    if (event.key === 'Enter' && highlighted) {
      event.preventDefault()
      onRespond({ value: highlighted.option })
      return
    }
    let target: number
    switch (event.key) {
      case 'ArrowDown': target = Math.min(last, current + 1); break
      case 'ArrowUp': target = Math.max(0, current - 1); break
      case 'Home': target = 0; break
      case 'End': target = last; break
      default: return
    }
    event.preventDefault()
    selectOptionRefs.current[selectOptions[target].index]?.focus()
  }

  // Sync the wizard with each delivered request: a new id resets answers, a refreshed one keeps them.
  useEffect(() => {
    if (questionnaire) dispatchWizard(questionnaireRequestEvent(questionnaire))
  }, [questionnaire])

  useEffect(() => {
    const intent = inlineFocusIntent.current
    inlineFocusIntent.current = null
    if (!questionnaire?.complete) return
    const container = questionnaireRef.current
    if (!container || container.contains(document.activeElement)) return
    if (presentation === 'inline' && (intent?.requestId !== request.id || intent.index !== questionIndex || document.activeElement !== document.body)) return
    const focusTarget = container.querySelector<HTMLElement>('.extension-question__options button')
      ?? container.querySelector<HTMLElement>('.extension-questionnaire__progress button.is-active')
    focusTarget?.focus()
  }, [request.id, questionnaire?.complete, questionIndex, presentation])

  const cancel = () => onRespond({ cancelled: true })

  const activeQuestion = questionnaire && questionIndex < questionnaire.questions.length
    ? questionnaire.questions[questionIndex]
    : undefined
  const activeSelected = activeQuestion ? wizardContext.selectedByQuestion[activeQuestion.id] ?? 0 : 0
  const writingAnswer = activeQuestion?.options[activeSelected] === OTHER_OPTION
  const allAnswered = selectQuestionnaireComplete(wizardContext)
  const canSubmit = (wizard.matches('answering') || wizard.matches('reviewing')) && allAnswered

  const selectQuestionOption = (index: number) => {
    if (activeQuestion) dispatchWizard({ type: 'SELECT', index })
  }

  const rememberInlineFocus = (index: number) => {
    if (presentation === 'inline' && index !== questionIndex && questionnaireRef.current?.contains(document.activeElement)) {
      inlineFocusIntent.current = { requestId: request.id, index }
    }
  }

  const navigateQuestion = (index: number) => {
    if (questionnaire) {
      rememberInlineFocus(Math.max(0, Math.min(questionnaire.questions.length, index)))
      dispatchWizard({ type: 'NAVIGATE', index })
    }
  }

  const commitQuestion = (index = activeSelected) => {
    if (!activeQuestion) return
    const bounded = Math.max(0, Math.min(activeQuestion.options.length - 1, index))
    if (!questionnaireAnswer(activeQuestion, bounded, wizardContext.contexts)) {
      contextInputRefs.current[activeQuestion.id]?.focus()
    } else {
      rememberInlineFocus(questionIndex + 1)
    }
    dispatchWizard({ type: 'COMMIT', index: bounded })
  }

  const submitQuestionnaire = () => {
    const values = selectQuestionnaireValues(wizardContext)
    if (!canSubmit || !values) return
    dispatchWizard({ type: 'SUBMIT' })
    onRespond({ values })
    dispatchWizard({ type: 'RESPONDED' })
  }

  const handleQuestionnaireKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!questionnaire?.complete) return
    const isTextInput = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
    const modifiedArrow = event.ctrlKey || event.metaKey
    // Question navigation is bound to explicit keys only. Tab is intentionally
    // not handled here so the focus trap can reach the footer buttons, and bare
    // arrow keys keep their native caret behavior inside text fields.
    if (event.key === 'PageUp' || (modifiedArrow && event.key === 'ArrowLeft')) {
      event.preventDefault()
      navigateQuestion(questionIndex - 1)
      return
    }
    if (event.key === 'PageDown' || (modifiedArrow && event.key === 'ArrowRight')) {
      event.preventDefault()
      navigateQuestion(questionIndex + 1)
      return
    }
    // Step and edit buttons keep native Enter activation. Enter on the current
    // Review step is also the keyboard shortcut to submit the summary.
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement
      && event.target.getAttribute('role') !== 'option'
      && !(questionIndex === questionnaire.questions.length && event.target.getAttribute('aria-current') === 'step')) return
    if (questionIndex === questionnaire.questions.length) {
      if (event.key === 'Enter') {
        event.preventDefault()
        submitQuestionnaire()
      }
      return
    }
    if (!activeQuestion) return
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const delta = event.key === 'ArrowUp' ? -1 : 1
      selectQuestionOption(activeSelected + delta)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      commitQuestion()
      return
    }
    // Let text fields receive printable characters, including digits. Number
    // shortcuts apply when the question itself has focus, while a clicked
    // context field should behave like a normal text input.
    if (isTextInput && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) return
    if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1
      if (index < activeQuestion.options.length) {
        event.preventDefault()
        selectQuestionOption(index)
      }
    }
    // Other printable keys are never hijacked: a focused button keeps its
    // native key handling and typing context happens in the context field.
  }

  const remainingSeconds = remainingMs === undefined ? undefined : Math.max(0, Math.ceil(remainingMs / 1_000))

  const inline = presentation === 'inline' && Boolean(questionnaire)
  const footer = (
    <>
      {questionnaire?.complete && activeQuestion && (
        <details className={sx(overlaysStyles.extensionQuestionnaireShortcuts)}>
          <summary className={sx(overlaysStyles.extensionQuestionnaireShortcutsLabel)}>Keyboard shortcuts</summary>
          <div className={sx(overlaysStyles.extensionQuestionnaireHint)}>
            <span><kbd>↑ ↓</kbd> or <kbd>1–9</kbd> choose</span>
            <span><kbd>Enter</kbd> confirm</span>
            <span><kbd>{shortcutLabel(platform, ['Primary', 'ArrowLeft'])}</kbd> / <kbd>{shortcutLabel(platform, ['Primary', 'ArrowRight'])}</kbd> switch question</span>
          </div>
        </details>
      )}
      <ApexButton variant="quiet" onClick={cancel}>Cancel</ApexButton>
      {request.method === 'confirm' ? <ApexButton variant="primary" onClick={() => onRespond({ confirmed: true })}>Confirm</ApexButton> : null}
      {request.method === 'input' || request.method === 'editor' ? <ApexButton variant="primary" disabled={!value.trim()} onClick={() => onRespond({ value })}>Continue</ApexButton> : null}
      {questionnaire && (
        questionnaire.complete && activeQuestion && !allAnswered ? (
          <ApexButton variant="primary" onClick={() => commitQuestion()}>
            {questionIndex + 1 === questionnaire.questions.length ? 'Review answers' : 'Next'}
          </ApexButton>
        ) : <ApexButton variant="primary" disabled={!canSubmit} onClick={submitQuestionnaire}>Submit answers</ApexButton>
      )}
    </>
  )
  const questionnaireContent = questionnaire ? (
        <div ref={questionnaireRef} className={`extension-questionnaire ${sx(inline && overlaysStyles.extensionQuestionnaireInlineBody)}`} onKeyDown={handleQuestionnaireKeyDown}>
          {!questionnaire.complete ? (
            <>
              {inline ? <h2 className={`extension-questionnaire__inline-title ${sx(overlaysStyles.extensionQuestionnaireInlineTitle)}`}>{request.title}</h2> : null}
              <p className={`modal-intro ${sx(overlaysStyles.modalIntro)}`}>Preparing questions…</p>
            </>
          ) : (
            <>
              <div className={`extension-questionnaire__header ${sx(overlaysStyles.extensionQuestionnaireHeader)}`}>
                <span className={`extension-questionnaire__step ${sx(overlaysStyles.extensionQuestionnaireStep)}`}>
                  <ChatCircleDots size={15} aria-hidden="true" />
                  {activeQuestion ? `Question ${questionIndex + 1} of ${questionnaire.questions.length}` : `${questionnaire.questions.length} ${questionnaire.questions.length === 1 ? 'question' : 'questions'}`}
                </span>
                <div className={`extension-questionnaire__progress ${sx(overlaysStyles.extensionQuestionnaireProgress)}`} role="group" aria-label="Question progress">
                  {questionnaire.questions.map((question, index) => {
                    const active = questionIndex === index
                    const answered = Boolean(wizardContext.answeredByQuestion[question.id])
                    return (
                      <button
                        type="button"
                        key={question.id}
                        aria-current={active ? 'step' : undefined}
                        aria-label={`Question ${index + 1}${answered ? ', answered' : ''}`}
                        className={`${active ? 'is-active' : ''} ${sx(overlaysStyles.extensionQuestionnaireStepButton, active && overlaysStyles.extensionQuestionnaireStepButtonActive)}`}
                        onClick={() => navigateQuestion(index)}
                      >
                        {answered && <Check size={10} weight="bold" aria-hidden="true" />}
                        {index + 1}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    aria-current={questionIndex === questionnaire.questions.length ? 'step' : undefined}
                    className={`${questionIndex === questionnaire.questions.length ? 'is-active' : ''} ${sx(overlaysStyles.extensionQuestionnaireStepButton, questionIndex === questionnaire.questions.length && overlaysStyles.extensionQuestionnaireStepButtonActive)}`}
                    onClick={() => navigateQuestion(questionnaire.questions.length)}
                  >
                    Review
                  </button>
                </div>
                {remainingSeconds !== undefined ? (
                  <div className={`extension-questionnaire__timer ${sx(overlaysStyles.extensionQuestionnaireTimer, remainingSeconds <= URGENT_SECONDS && overlaysStyles.extensionQuestionnaireTimerUrgent)}`} role="timer" aria-live="polite">
                    <Clock size={12} aria-hidden="true" />
                    <span className={sx(overlaysStyles.extensionQuestionnaireTimerLabel)}>Time remaining</span>
                    <strong className={sx(overlaysStyles.extensionQuestionnaireTimerValue)} aria-label={`${remainingSeconds} seconds remaining`}>
                      {formatCountdown(remainingSeconds)}
                    </strong>
                  </div>
                ) : null}
              </div>
              {inline ? <h2 className={`extension-questionnaire__inline-title ${sx(overlaysStyles.extensionQuestionnaireInlineTitle)}`}>{activeQuestion?.title ?? 'Review your answers'}</h2> : null}
              {activeQuestion ? (
                <div className="extension-questionnaire__question">
                  {inline ? null : <h3 className={sx(overlaysStyles.extensionQuestionnaireInlineTitle)}>{activeQuestion.title}</h3>}
                  <div className={`extension-question__options ${sx(overlaysStyles.extensionQuestionOptions)}`} role="listbox" aria-label={activeQuestion.title}>
                    {activeQuestion.options.map((option, index) => {
                      const isSelected = activeSelected === index
                      return <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`${isSelected ? 'is-selected' : ''} ${sx(overlaysStyles.extensionQuestionOption, isSelected && overlaysStyles.extensionQuestionOptionSelected)}`}
                        key={`${option}-${index}`}
                        onClick={() => commitQuestion(index)}
                      >
                        <span aria-hidden="true" className={`extension-question__option-index ${sx(overlaysStyles.extensionQuestionOptionIndex)}`}>{index + 1}</span>
                        <span className={sx(overlaysStyles.extensionQuestionOptionLabel)}>{option}</span>
                        {isSelected && <Check size={16} weight="bold" aria-hidden="true" className={sx(overlaysStyles.extensionQuestionOptionCheck)} />}
                      </button>
                    })}
                  </div>
                  <TextInput
                    ref={(element) => { contextInputRefs.current[activeQuestion.id] = element }}
                    label={writingAnswer ? 'Your answer' : 'Add context'}
                    isOptional={!writingAnswer}
                    size="sm"
                    width="100%"
                    value={wizardContext.contexts[activeQuestion.id] ?? ''}
                    placeholder={writingAnswer ? 'Write your own answer' : 'Add a detail about your choice'}
                    aria-label={writingAnswer ? 'Your answer' : 'Additional context'}
                    containerClassName={`extension-questionnaire__context ${sx(overlaysStyles.extensionQuestionnaireContext)}`}
                    onChange={(text) => dispatchWizard({ type: 'TYPE_CONTEXT', text })}
                  />
                </div>
              ) : (
                <div className={`extension-questionnaire__submit ${sx(overlaysStyles.extensionQuestionnaireSubmit)}`} role="group" aria-label="Review answers">
                  {inline ? null : <h3 className={sx(overlaysStyles.extensionQuestionnaireInlineTitle)}>Review your answers</h3>}
                  {questionnaire.questions.map((question) => {
                    const answer = wizardContext.answeredByQuestion[question.id]
                      ? questionnaireAnswer(question, wizardContext.selectedByQuestion[question.id] ?? 0, wizardContext.contexts)
                      : undefined
                    return (
                      <button
                        type="button"
                        key={question.id}
                        className={sx(overlaysStyles.extensionQuestionnaireReviewRow)}
                        onClick={() => navigateQuestion(question.index)}
                      >
                        <span aria-hidden="true" className={sx(overlaysStyles.extensionQuestionOptionIndex)}>{question.index + 1}</span>
                        <span className={sx(overlaysStyles.extensionQuestionnaireReviewBody)}>
                          <span className={sx(overlaysStyles.extensionQuestionnaireReviewQuestion)}>{question.title}</span>
                          <span className={sx(overlaysStyles.extensionQuestionnaireReviewAnswer, !answer && overlaysStyles.extensionQuestionnaireReviewMissing)}>
                            {answer?.answer ?? 'Not answered'}
                          </span>
                          {answer && 'context' in answer && answer.context ? <span className={sx(overlaysStyles.extensionQuestionnaireReviewContext)}>{answer.context}</span> : null}
                        </span>
                        <span className={sx(overlaysStyles.extensionQuestionnaireReviewEdit)}>Edit</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
  ) : null

  if (inline) {
    return <motion.section
      key={request.id}
      className={`extension-questionnaire-inline ${stylex.props(overlaysStyles.extensionQuestionnaireInline).className ?? ""}`}
      aria-label={request.title}
      initial={instant ? false : { opacity: 0, transform: 'translateY(16px)' }}
      animate={{ opacity: 1, transform: 'translateY(0)' }}
      transition={{ duration: instant ? 0 : 0.2, ease: [0.23, 1, 0.32, 1] }}
    >
      {questionnaireContent}
      <div className={`extension-questionnaire-inline__footer ${sx(overlaysStyles.extensionQuestionnaireInlineFooter)}`}>
        {footer}
      </div>
    </motion.section>
  }

  return (
    <Modal title={request.title} onClose={cancel} footer={footer}>
      {questionnaireContent}
      {selectRequest ? (
        <div className="extension-question">
          <p className={`modal-intro ${stylex.props(overlaysStyles.modalIntro).className ?? ""}`}>Choose an option to let the agent continue.</p>
          {searchable ? (
            <label className={`field extension-question__search ${stylex.props(overlaysStyles.field, overlaysStyles.extensionQuestionSearch).className ?? ""}`}>
              <span>Search {selectRequest.options.length} options</span>
              <input
                ref={searchInputRef}
                role="combobox"
                aria-expanded="true"
                aria-autocomplete="list"
                aria-controls={selectListId}
                aria-activedescendant={highlighted ? `${selectListId}-${highlighted.index}` : undefined}
                value={query}
                placeholder="Type to filter"
                onChange={(event) => { setQuery(event.target.value); setSelected(0) }}
                onKeyDown={handleSearchKeyDown}
              />
            </label>
          ) : null}
          {selectOptions.length ? (
            <div id={selectListId} className={`extension-question__options ${stylex.props(overlaysStyles.extensionQuestionOptions).className ?? ""}`} role="listbox" aria-label={selectRequest.title} onKeyDown={handleOptionsKeyDown}>
              {selectOptions.map(({ option, index }, position) => (
                <button
                  type="button"
                  role="option"
                  id={`${selectListId}-${index}`}
                  ref={(element) => { selectOptionRefs.current[index] = element }}
                  aria-selected={highlighted?.index === index}
                  className={`${highlighted?.index === index ? 'is-selected' : ''} ${sx(overlaysStyles.extensionQuestionOption, highlighted?.index === index && overlaysStyles.extensionQuestionOptionSelected)}`}
                  key={`${option}-${index}`}
                  onClick={() => { setSelected(position); onRespond({ value: option }) }}
                  onFocus={() => setSelected(position)}
                >
                  {searchable ? null : <span className={`extension-question__option-index ${sx(overlaysStyles.extensionQuestionOptionIndex)}`}>{index + 1}</span>}
                  <span className={sx(overlaysStyles.extensionQuestionOptionLabel)}>{option}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className={`extension-question__empty ${stylex.props(overlaysStyles.extensionQuestionEmpty).className ?? ""}`} role="status">No options match “{query.trim()}”. Clear the search to see all {selectRequest.options.length}.</p>
          )}
          {searchable ? <p className={`extension-questionnaire__hint ${stylex.props(overlaysStyles.extensionQuestionnaireHint).className ?? ""}`}>{selectOptions.length} of {selectRequest.options.length} · ↑ ↓ choose · Enter select · Esc cancel</p> : null}
        </div>
      ) : null}
      {request.method === 'confirm' ? <p className={`modal-intro extension-question__message ${stylex.props(overlaysStyles.modalIntro, overlaysStyles.extensionQuestionMessage).className ?? ""}`}>{request.message}</p> : null}
      {request.method === 'input' ? (
        <TextInput
          label="Response"
          hasAutoFocus
          value={value}
          placeholder={request.placeholder}
          containerClassName="field extension-question__field"
          onChange={(nextValue) => setValue(nextValue)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && value.trim()) {
              event.preventDefault()
              onRespond({ value })
            }
          }}
        />
      ) : null}
      {request.method === 'editor' ? (
        <TextArea
          label="Response"
          hasAutoFocus
          rows={7}
          value={value}
          containerClassName="field extension-question__field"
          onChange={(nextValue) => setValue(nextValue)}
        />
      ) : null}
    </Modal>
  )
}
