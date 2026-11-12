import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useEffect, useId, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react'
import type { ExtensionUiRequest } from '@/lib/extension-ui'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { ApexButton, Modal } from './ui'
import {
  initialQuestionnaireSnapshot,
  questionnaireAnswer,
  questionnaireRequestEvent,
  reduceQuestionnaire,
  selectQuestionnaireComplete,
  selectQuestionnaireValues,
} from './extensionQuestionnaireMachine'

/** Plain selects longer than this get a search field; short lists stay a button stack. */
const SELECT_SEARCH_THRESHOLD = 8

export type ExtensionUiResponse =
  | { cancelled: true }
  | { value: string }
  | { confirmed: boolean }
  | { values: Record<string, string> }

interface ExtensionUiModalProps {
  request: ExtensionUiRequest
  onRespond(response: ExtensionUiResponse): void
  platform?: NodeJS.Platform
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

export function ExtensionUiModal({ request, onRespond, platform = 'darwin', deadline }: ExtensionUiModalProps) {
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
    if (!questionnaire?.complete) return
    const container = questionnaireRef.current
    if (!container || container.contains(document.activeElement)) return
    const focusTarget = container.querySelector<HTMLElement>('.extension-question__options button')
      ?? container.querySelector<HTMLElement>('.extension-questionnaire__progress button.is-active')
    focusTarget?.focus()
  }, [request.id, questionnaire?.complete, questionIndex])

  const cancel = () => onRespond({ cancelled: true })

  const activeQuestion = questionnaire && questionIndex < questionnaire.questions.length
    ? questionnaire.questions[questionIndex]
    : undefined
  const activeSelected = activeQuestion ? wizardContext.selectedByQuestion[activeQuestion.id] ?? 0 : 0
  const canSubmit = (wizard.matches('answering') || wizard.matches('reviewing')) && selectQuestionnaireComplete(wizardContext)

  const selectQuestionOption = (index: number) => {
    if (activeQuestion) dispatchWizard({ type: 'SELECT', index })
  }

  const navigateQuestion = (index: number) => {
    if (questionnaire) dispatchWizard({ type: 'NAVIGATE', index })
  }

  const commitQuestion = (index = activeSelected) => {
    if (!activeQuestion) return
    const bounded = Math.max(0, Math.min(activeQuestion.options.length - 1, index))
    if (!questionnaireAnswer(activeQuestion, bounded, wizardContext.contexts)) {
      contextInputRefs.current[activeQuestion.id]?.focus()
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

  return (
    <Modal title={request.title} onClose={cancel} footer={(
      <>
        <ApexButton onClick={cancel}>Cancel</ApexButton>
        {request.method === 'confirm' ? <ApexButton variant="primary" onClick={() => onRespond({ confirmed: true })}>Confirm</ApexButton> : null}
        {request.method === 'input' || request.method === 'editor' ? <ApexButton variant="primary" disabled={!value.trim()} onClick={() => onRespond({ value })}>Continue</ApexButton> : null}
        {questionnaire ? <ApexButton variant="primary" disabled={!canSubmit} onClick={submitQuestionnaire}>Submit answers</ApexButton> : null}
      </>
    )}>
      {questionnaire ? (
        <div ref={questionnaireRef} className="extension-questionnaire" onKeyDown={handleQuestionnaireKeyDown}>
          {!questionnaire.complete ? <p className="modal-intro">Preparing questions…</p> : null}
          {questionnaire.complete ? (
            <>
              {remainingSeconds !== undefined ? (
                <div className="extension-questionnaire__timer" role="timer" aria-live="polite">
                  <span>Time remaining</span>
                  <strong aria-label={`${remainingSeconds} seconds remaining`}>
                    {remainingSeconds}s
                  </strong>
                </div>
              ) : null}
              <div className="extension-questionnaire__progress" aria-label="Question progress">
                {questionnaire.questions.map((question, index) => (
                  <button type="button" key={question.id} aria-current={questionIndex === index ? 'step' : undefined} className={questionIndex === index ? 'is-active' : ''} onClick={() => navigateQuestion(index)}>
                    {wizardContext.answeredByQuestion[question.id] ? '✓' : '○'} {index + 1}
                  </button>
                ))}
                <button type="button" aria-current={questionIndex === questionnaire.questions.length ? 'step' : undefined} className={questionIndex === questionnaire.questions.length ? 'is-active' : ''} onClick={() => navigateQuestion(questionnaire.questions.length)}>✓ Submit</button>
              </div>
              {activeQuestion ? (
                <div className="extension-questionnaire__question">
                  <p className="modal-intro">Question {questionIndex + 1} of {questionnaire.questions.length}</p>
                  <h3>{activeQuestion.title}</h3>
                  <div className="extension-question__options" role="listbox" aria-label={activeQuestion.title}>
                    {activeQuestion.options.map((option, index) => {
                      const isSelected = activeSelected === index
                      return <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={isSelected ? 'is-selected' : ''}
                        key={`${option}-${index}`}
                        onClick={() => commitQuestion(index)}
                      >
                        <span className="extension-question__option-index">{index + 1}</span>
                        <span>{option}</span>
                      </button>
                    })}
                  </div>
                  <label className="field extension-questionnaire__context">
                    <span>Type to add context</span>
                    <input
                      ref={(element) => { contextInputRefs.current[activeQuestion.id] = element }}
                      value={wizardContext.contexts[activeQuestion.id] ?? ''}
                      placeholder="Type to add context"
                      aria-label="Additional context"
                      onChange={(event) => dispatchWizard({ type: 'TYPE_CONTEXT', text: event.target.value })}
                    />
                  </label>
                  <p className="extension-questionnaire__hint">{shortcutLabel(platform, ['Primary', 'ArrowLeft'])} / {shortcutLabel(platform, ['Primary', 'ArrowRight'])} or PgUp/PgDn questions · ↑ ↓ choices · 1–9 select · Enter continue</p>
                </div>
              ) : (
                <div className="extension-questionnaire__submit" role="listbox" aria-label="Submit answers">
                  {questionnaire.questions.map((question) => {
                    const answer = questionnaireAnswer(question, wizardContext.selectedByQuestion[question.id] ?? 0, wizardContext.contexts)
                    return <p key={question.id}><strong>{question.index + 1}.</strong> {answer?.answer ?? 'Not answered'}</p>
                  })}
                </div>
              )}
            </>
          ) : null}
        </div>
      ) : null}
      {selectRequest ? (
        <div className="extension-question">
          <p className="modal-intro">Choose an option to let the agent continue.</p>
          {searchable ? (
            <label className="field extension-question__search">
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
            <div id={selectListId} className="extension-question__options" role="listbox" aria-label={selectRequest.title} onKeyDown={handleOptionsKeyDown}>
              {selectOptions.map(({ option, index }, position) => (
                <button
                  type="button"
                  role="option"
                  id={`${selectListId}-${index}`}
                  ref={(element) => { selectOptionRefs.current[index] = element }}
                  aria-selected={highlighted?.index === index}
                  className={highlighted?.index === index ? 'is-selected' : ''}
                  key={`${option}-${index}`}
                  onClick={() => { setSelected(position); onRespond({ value: option }) }}
                  onFocus={() => setSelected(position)}
                >
                  {searchable ? null : <span className="extension-question__option-index">{index + 1}</span>}
                  <span>{option}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="extension-question__empty" role="status">No options match “{query.trim()}”. Clear the search to see all {selectRequest.options.length}.</p>
          )}
          {searchable ? <p className="extension-questionnaire__hint">{selectOptions.length} of {selectRequest.options.length} · ↑ ↓ choose · Enter select · Esc cancel</p> : null}
        </div>
      ) : null}
      {request.method === 'confirm' ? <p className="modal-intro extension-question__message">{request.message}</p> : null}
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
