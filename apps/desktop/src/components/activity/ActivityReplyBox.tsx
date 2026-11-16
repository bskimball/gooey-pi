import { styles as activityStyles } from 'apex-ui/styles/activity.stylex'
import { styles as overlaysStyles } from 'apex-ui/styles/overlays.stylex'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import { useMachine } from '@xstate/react'
import { ArrowUp, Check, CircleNotch, WarningCircle } from '@/components/icons'
import * as stylex from '@stylexjs/stylex'
import { ApexButton } from '@/components/ui'
import type { SessionRecord } from '@/types/api'
import { activityReplyMachine, type ReplyFeedbackState } from './activityReplyMachine'

const replyInputStyles = stylex.create({
  input: {
    minWidth: 0,
    minHeight: 26,
    maxHeight: 128,
    flex: '1 1 auto',
    paddingTop: 3,
    paddingBottom: 3,
    borderWidth: 0,
    outlineStyle: 'none',
    resize: 'none',
    color: 'var(--text)',
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 'var(--fs-ui)',
    lineHeight: 1.4,
  },
})

const replyInputStyleProps = stylex.props(replyInputStyles.input)

export interface ActivityReplyBoxProps {
  session: SessionRecord
  runtimeId?: string
  isRunning: boolean
  canFollowUp: boolean
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  onSend?(session: SessionRecord, text: string, mode: 'steer' | 'follow-up', runtimeId?: string): Promise<void>
}

export function ActivityReplyBox({
  session,
  runtimeId,
  isRunning,
  canFollowUp,
  textareaRef,
  onSend,
}: ActivityReplyBoxProps) {
  const [snapshot, send] = useMachine(activityReplyMachine)
  const { draft } = snapshot.context
  const feedback: ReplyFeedbackState = snapshot.matches('sending') ? 'sending'
    : snapshot.matches('sent') ? 'sent'
      : snapshot.matches('failed') ? 'failed' : 'idle'
  const internalRef = useRef<HTMLTextAreaElement | null>(null)

  const mode: 'steer' | 'follow-up' = isRunning ? 'steer' : 'follow-up'
  const enabled = Boolean(onSend && (isRunning || canFollowUp))

  useEffect(() => {
    send({ type: 'RESET' })
  }, [send, session.id])

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

  const submitReply = () => {
    const trimmed = draft.trim()
    if (!trimmed || !enabled || !onSend || feedback === 'sending') return
    send({
      type: 'SUBMIT',
      sendReply: () => onSend(session, trimmed, mode, runtimeId),
    })
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
      submitReply()
    }
  }

  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault()
    submitReply()
  }

  const placeholder = !enabled
    ? 'Open session to continue'
    : isRunning
      ? 'Steer this run…'
      : 'Follow up in this session…'

  return (
    <form
      className={[`activity-reply ${!enabled ? 'activity-reply--disabled' : ''} ${feedback !== 'idle' ? `activity-reply--${feedback}` : ''}`, stylex.props(activityStyles.activityReply).className].filter(Boolean).join(' ')}
      aria-label={isRunning ? 'Steer session' : 'Reply to session'}
      onSubmit={handleFormSubmit}
    >
      <div className={`activity-reply__box ${stylex.props(activityStyles.activityReplyBox).className ?? ""}`}>
        <textarea
          {...replyInputStyleProps}
          ref={assignRef}
          rows={1}
          className={`activity-reply__input ${stylex.props(activityStyles.activityReplyInput, replyInputStyles.input).className ?? ""}`}
          value={draft}
          disabled={!enabled || feedback === 'sending'}
          placeholder={placeholder}
          aria-label={!enabled ? 'Open session to continue' : isRunning ? 'Steer message' : 'Follow-up message'}
          onChange={(event) => {
            send({ type: 'EDIT', draft: event.target.value })
          }}
          onKeyDown={handleKeyDown}
        />
        <ApexButton xstyle={[activityStyles.activityReplySend]}
          type="submit"
          variant="primary"
          compact
          className="activity-reply__send"
          disabled={!enabled || feedback === 'sending' || !draft.trim()}
          aria-label={isRunning ? 'Send steer' : 'Send follow-up'}
        >
          {feedback === 'sending' ? (
            <CircleNotch className={`spin ${stylex.props(activityStyles.spin, overlaysStyles.spin).className ?? ""}`} size={12} />
          ) : (
            <ArrowUp size={12} weight="bold" />
          )}
          <span>{isRunning ? 'Steer' : 'Send'}</span>
        </ApexButton>
      </div>

      <div className={`activity-reply__footer ${stylex.props(activityStyles.activityReplyFooter).className ?? ""}`}>
        {feedback === 'sent' ? (
          <span className={`activity-reply__status activity-reply__status--sent ${stylex.props(activityStyles.activityReplyStatus, activityStyles.activityReplyStatusSent).className ?? ""}`} role="status">
            <Check size={11} />
            <span>{isRunning ? 'Steer sent' : 'Follow-up queued'}</span>
          </span>
        ) : feedback === 'failed' ? (
          <span className={`activity-reply__status activity-reply__status--failed ${stylex.props(activityStyles.activityReplyStatus, activityStyles.activityReplyStatusFailed).className ?? ""}`} role="status">
            <WarningCircle size={11} />
            <span>Delivery failed — draft preserved</span>
          </span>
        ) : !enabled ? (
          <span className={`activity-reply__hint ${stylex.props(activityStyles.activityReplyHint).className ?? ""}`}>Open session to continue</span>
        ) : (
          <span className={`activity-reply__hint ${stylex.props(activityStyles.activityReplyHint).className ?? ""}`}>
            <kbd>Enter</kbd> {isRunning ? 'steer' : 'send'} · <kbd>Shift+Enter</kbd> newline
          </span>
        )}
      </div>
    </form>
  )
}
