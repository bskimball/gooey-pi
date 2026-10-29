import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import { ArrowUp, Check, CircleNotch, WarningCircle } from '@/components/icons'
import type { SessionRecord } from '@/types/api'

export interface ActivityReplyBoxProps {
  session: SessionRecord
  runtimeId?: string
  isRunning: boolean
  canFollowUp: boolean
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  onSend?(session: SessionRecord, text: string, mode: 'steer' | 'follow-up', runtimeId?: string): Promise<void>
}

type ReplyFeedbackState = 'idle' | 'sending' | 'sent' | 'failed'

export function ActivityReplyBox({
  session,
  runtimeId,
  isRunning,
  canFollowUp,
  textareaRef,
  onSend,
}: ActivityReplyBoxProps) {
  const [draft, setDraft] = useState('')
  const [feedback, setFeedback] = useState<ReplyFeedbackState>('idle')
  const internalRef = useRef<HTMLTextAreaElement | null>(null)
  const sentTimerRef = useRef<number | undefined>(undefined)

  const mode: 'steer' | 'follow-up' = isRunning ? 'steer' : 'follow-up'
  const enabled = Boolean(onSend && (isRunning || canFollowUp))

  useEffect(() => {
    setDraft('')
    setFeedback('idle')
    if (sentTimerRef.current !== undefined) {
      window.clearTimeout(sentTimerRef.current)
      sentTimerRef.current = undefined
    }
  }, [session.id])

  useEffect(() => () => {
    if (sentTimerRef.current !== undefined) {
      window.clearTimeout(sentTimerRef.current)
    }
  }, [])

  useLayoutEffect(() => {
    const el = internalRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(128, Math.max(36, el.scrollHeight))}px`
  }, [draft])

  const assignRef = (node: HTMLTextAreaElement | null) => {
    internalRef.current = node
    if (textareaRef) {
      textareaRef.current = node
    }
  }

  const submitReply = async () => {
    const trimmed = draft.trim()
    if (!trimmed || !enabled || !onSend || feedback === 'sending') return
    if (sentTimerRef.current !== undefined) {
      window.clearTimeout(sentTimerRef.current)
      sentTimerRef.current = undefined
    }
    setFeedback('sending')
    try {
      await onSend(session, trimmed, mode, runtimeId)
      setDraft('')
      setFeedback('sent')
      sentTimerRef.current = window.setTimeout(() => {
        setFeedback('idle')
        sentTimerRef.current = undefined
      }, 2_200)
    } catch {
      setFeedback('failed')
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submitReply()
    }
  }

  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submitReply()
  }

  const placeholder = !enabled
    ? 'Open session to continue'
    : isRunning
      ? 'Steer this run…'
      : 'Follow up in this session…'

  return (
    <form
      className={`activity-reply ${!enabled ? 'activity-reply--disabled' : ''} ${feedback !== 'idle' ? `activity-reply--${feedback}` : ''}`}
      aria-label={isRunning ? 'Steer session' : 'Reply to session'}
      onSubmit={handleFormSubmit}
    >
      <div className="activity-reply__box">
        <textarea
          ref={assignRef}
          rows={1}
          className="activity-reply__input"
          value={draft}
          disabled={!enabled || feedback === 'sending'}
          placeholder={placeholder}
          aria-label={!enabled ? 'Open session to continue' : isRunning ? 'Steer message' : 'Follow-up message'}
          onChange={(event) => {
            setDraft(event.target.value)
            if (feedback === 'failed' || feedback === 'sent') setFeedback('idle')
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="submit"
          className="button button--compact button--primary activity-reply__send"
          disabled={!enabled || feedback === 'sending' || !draft.trim()}
          aria-label={isRunning ? 'Send steer' : 'Send follow-up'}
        >
          {feedback === 'sending' ? (
            <CircleNotch className="spin" size={12} />
          ) : (
            <ArrowUp size={12} weight="bold" />
          )}
          <span>{isRunning ? 'Steer' : 'Send'}</span>
        </button>
      </div>

      <div className="activity-reply__footer">
        {feedback === 'sent' ? (
          <span className="activity-reply__status activity-reply__status--sent" role="status">
            <Check size={11} />
            <span>{isRunning ? 'Steer sent' : 'Follow-up queued'}</span>
          </span>
        ) : feedback === 'failed' ? (
          <span className="activity-reply__status activity-reply__status--failed" role="status">
            <WarningCircle size={11} />
            <span>Delivery failed — draft preserved</span>
          </span>
        ) : !enabled ? (
          <span className="activity-reply__hint">Open session to continue</span>
        ) : (
          <span className="activity-reply__hint">
            <kbd>Enter</kbd> {isRunning ? 'steer' : 'send'} · <kbd>Shift+Enter</kbd> newline
          </span>
        )}
      </div>
    </form>
  )
}
