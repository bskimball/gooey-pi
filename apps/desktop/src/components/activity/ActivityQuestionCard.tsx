import { useEffect, useState, type FormEvent } from 'react'
import { ChatCircleDots, Check, Clock, X } from '@/components/icons'
import type { ExtensionUiResponse } from '@/components/ExtensionUiModal'
import { formatDeadlineCountdown, type SessionLiveQuestion } from '@/app/session-live'
import type { PendingExtensionUi } from '@/hooks/useExtensionUi'

export interface ActivityQuestionCardProps {
  question: SessionLiveQuestion
  pendingUi?: PendingExtensionUi | null
  now: number
  onRespond?(runtimeId: string, response: ExtensionUiResponse): Promise<void> | void
  onOpenModal?(runtimeId: string): void
}

const COMPACT_SELECT_FILTER_THRESHOLD = 6

export function ActivityQuestionCard({
  question,
  pendingUi,
  now,
  onRespond,
  onOpenModal,
}: ActivityQuestionCardProps) {
  const [inputValue, setInputValue] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setInputValue('')
    setFilterQuery('')
    setSubmitting(false)
  }, [question.id, question.method, question.runtimeId])

  const countdown = question.deadline !== undefined
    ? formatDeadlineCountdown(question.deadline, now)
    : null

  const request = pendingUi?.request
  const confirmMessage = request?.method === 'confirm' && request.message && request.message !== question.title
    ? request.message
    : undefined
  const inputPlaceholder = request?.method === 'input' && request.placeholder
    ? request.placeholder
    : 'Type your answer…'
  const selectOptions = question.options ?? (request?.method === 'select' ? request.options : [])
  const filteredOptions = filterQuery.trim()
    ? selectOptions.filter((option) => option.toLowerCase().includes(filterQuery.trim().toLowerCase()))
    : selectOptions

  const submitResponse = async (response: ExtensionUiResponse) => {
    if (!onRespond || submitting) return
    setSubmitting(true)
    try {
      await onRespond(question.runtimeId, response)
    } finally {
      setSubmitting(false)
    }
  }

  const handleInputSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = inputValue.trim()
    if (!trimmed) return
    void submitResponse({ value: trimmed })
  }

  return (
    <section className="activity-question-card" aria-label={`Question: ${question.title}`}>
      <div className="activity-question-card__header">
        <span className="activity-question-card__badge">
          <ChatCircleDots size={13} />
          <span>Needs input</span>
        </span>
        <strong className="activity-question-card__title">{question.title}</strong>
        {countdown ? (
          <span className="activity-badge activity-badge--deadline tabular" title="Time remaining to respond">
            <Clock size={11} />
            {countdown}
          </span>
        ) : null}
      </div>

      {confirmMessage ? (
        <p className="activity-question-card__message">{confirmMessage}</p>
      ) : null}

      <div className="activity-question-card__controls">
        {question.method === 'confirm' ? (
          <div className="activity-question-card__actions">
            <button
              type="button"
              className="button button--compact button--primary activity-question-card__yes"
              disabled={submitting || !onRespond}
              onClick={() => void submitResponse({ confirmed: true })}
            >
              <Check size={12} />
              <span>Yes</span>
            </button>
            <button
              type="button"
              className="button button--compact activity-question-card__no"
              disabled={submitting || !onRespond}
              onClick={() => void submitResponse({ confirmed: false })}
            >
              <X size={12} />
              <span>No</span>
            </button>
          </div>
        ) : question.method === 'select' ? (
          <div className="activity-question-card__select">
            {selectOptions.length > COMPACT_SELECT_FILTER_THRESHOLD ? (
              <input
                type="text"
                className="activity-question-card__filter"
                value={filterQuery}
                onChange={(event) => setFilterQuery(event.target.value)}
                placeholder={`Filter ${selectOptions.length} options…`}
                aria-label="Filter options"
              />
            ) : null}
            <div
              className={`activity-question-card__options ${selectOptions.length > COMPACT_SELECT_FILTER_THRESHOLD ? 'activity-question-card__options--compact' : ''}`}
              role="group"
              aria-label={question.title}
            >
              {filteredOptions.map((option, index) => (
                <button
                  key={`${option}-${index}`}
                  type="button"
                  className="button button--compact activity-question-card__option"
                  disabled={submitting || !onRespond}
                  onClick={() => void submitResponse({ value: option })}
                >
                  {option}
                </button>
              ))}
              {filteredOptions.length === 0 ? (
                <span className="activity-question-card__empty">No matching options</span>
              ) : null}
            </div>
          </div>
        ) : question.method === 'input' ? (
          <form className="activity-question-card__input-form" onSubmit={handleInputSubmit}>
            <input
              type="text"
              className="activity-question-card__input"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder={inputPlaceholder}
              aria-label={question.title}
              disabled={submitting || !onRespond}
            />
            <button
              type="submit"
              className="button button--compact button--primary activity-question-card__submit"
              disabled={submitting || !onRespond || !inputValue.trim()}
            >
              Submit
            </button>
          </form>
        ) : (
          <div className="activity-question-card__actions">
            <button
              type="button"
              className="button button--compact button--primary activity-question-card__answer-modal"
              disabled={!onOpenModal}
              onClick={() => onOpenModal?.(question.runtimeId)}
            >
              Answer…
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
