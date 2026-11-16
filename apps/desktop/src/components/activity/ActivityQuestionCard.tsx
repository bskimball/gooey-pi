import * as stylex from '@stylexjs/stylex'
import { styles as activityStyles } from 'apex-ui/styles/activity.stylex'
import { styles as workbenchStyles } from 'apex-ui/styles/workbench.stylex'
import { useEffect, useState, type FormEvent } from 'react'
import { ChatCircleDots, Check, Clock, X } from '@/components/icons'
import { ApexButton } from '@/components/ui'
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
    <section className={`activity-question-card ${stylex.props(activityStyles.activityQuestionCard).className ?? ""}`} aria-label={`Question: ${question.title}`}>
      <div className={`activity-question-card__header ${stylex.props(activityStyles.activityQuestionCardHeader).className ?? ""}`}>
        <span className={`activity-question-card__badge ${stylex.props(activityStyles.activityQuestionCardBadge).className ?? ""}`}>
          <ChatCircleDots size={13} />
          <span>Needs input</span>
        </span>
        <strong className={`activity-question-card__title ${stylex.props(activityStyles.activityQuestionCardTitle).className ?? ""}`}>{question.title}</strong>
        {countdown ? (
          <span className={`activity-badge activity-badge--deadline tabular ${stylex.props(activityStyles.tabular, activityStyles.activityBadge, activityStyles.activityBadgeDeadline).className ?? ""}`} title="Time remaining to respond">
            <Clock size={11} />
            {countdown}
          </span>
        ) : null}
      </div>

      {confirmMessage ? (
        <p className={`activity-question-card__message ${stylex.props(activityStyles.activityQuestionCardMessage).className ?? ""}`}>{confirmMessage}</p>
      ) : null}

      <div className="activity-question-card__controls">
        {question.method === 'confirm' ? (
          <div className={`activity-question-card__actions ${stylex.props(activityStyles.activityQuestionCardActions).className ?? ""}`}>
            <ApexButton
              type="button"
              compact
              variant="primary"
              className="activity-question-card__yes"
              disabled={submitting || !onRespond}
              onClick={() => void submitResponse({ confirmed: true })}
              icon={<Check size={12} />}
            >
              Yes
            </ApexButton>
            <ApexButton
              type="button"
              compact
              className="activity-question-card__no"
              disabled={submitting || !onRespond}
              onClick={() => void submitResponse({ confirmed: false })}
              icon={<X size={12} />}
            >
              No
            </ApexButton>
          </div>
        ) : question.method === 'select' ? (
          <div className={`activity-question-card__select ${stylex.props(activityStyles.activityQuestionCardSelect).className ?? ""}`}>
            {selectOptions.length > COMPACT_SELECT_FILTER_THRESHOLD ? (
              <input
                type="text"
                className={`activity-question-card__filter ${stylex.props(activityStyles.activityQuestionCardFilter).className ?? ""}`}
                value={filterQuery}
                onChange={(event) => setFilterQuery(event.target.value)}
                placeholder={`Filter ${selectOptions.length} options…`}
                aria-label="Filter options"
              />
            ) : null}
            <div
              className={[`activity-question-card__options ${selectOptions.length > COMPACT_SELECT_FILTER_THRESHOLD ? 'activity-question-card__options--compact' : ''}`, stylex.props(activityStyles.activityQuestionCardOptions, (selectOptions.length > COMPACT_SELECT_FILTER_THRESHOLD) && activityStyles.activityQuestionCardOptionsCompact).className].filter(Boolean).join(' ')}
              role="group"
              aria-label={question.title}
            >
              {filteredOptions.map((option, index) => (
                <button
                  key={`${option}-${index}`}
                  type="button"
                  className={`button button--compact activity-question-card__option ${stylex.props(workbenchStyles.button, workbenchStyles.buttonCompact, activityStyles.activityQuestionCardOption).className ?? ""}`}
                  disabled={submitting || !onRespond}
                  onClick={() => void submitResponse({ value: option })}
                >
                  {option}
                </button>
              ))}
              {filteredOptions.length === 0 ? (
                <span className={`activity-question-card__empty ${stylex.props(activityStyles.activityQuestionCardEmpty).className ?? ""}`}>No matching options</span>
              ) : null}
            </div>
          </div>
        ) : question.method === 'input' ? (
          <form className={`activity-question-card__input-form ${stylex.props(activityStyles.activityQuestionCardInputForm).className ?? ""}`} onSubmit={handleInputSubmit}>
            <input
              type="text"
              className={`activity-question-card__input ${stylex.props(activityStyles.activityQuestionCardInput).className ?? ""}`}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder={inputPlaceholder}
              aria-label={question.title}
              disabled={submitting || !onRespond}
            />
            <ApexButton
              type="submit"
              compact
              variant="primary"
              className="activity-question-card__submit"
              disabled={submitting || !onRespond || !inputValue.trim()}
            >
              Submit
            </ApexButton>
          </form>
        ) : (
          <div className={`activity-question-card__actions ${stylex.props(activityStyles.activityQuestionCardActions).className ?? ""}`}>
            <ApexButton
              type="button"
              compact
              variant="primary"
              className="activity-question-card__answer-modal"
              disabled={!onOpenModal}
              onClick={() => onOpenModal?.(question.runtimeId)}
            >
              Answer…
            </ApexButton>
          </div>
        )}
      </div>
    </section>
  )
}
