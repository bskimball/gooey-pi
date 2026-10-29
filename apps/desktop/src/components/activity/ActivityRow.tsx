import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChatCircleDots, Check, CheckCircle, CircleNotch, Clock, Square, WarningCircle } from '@/components/icons'
import { ContextUsageRing } from '@/components/ContextUsageRing'
import {
  formatDeadlineCountdown,
  formatElapsedClock,
  formatQuietMinutes,
  isSessionQuiet,
  type ActivityRowItem,
} from '@/app/session-live'
import { activityNotificationSignature } from '@/app/session-attention'
import { formatRelative } from '@/lib/data'
import { formatSessionCost, PRICING_UNAVAILABLE } from '@/lib/format-cost'
import type { SessionRecord } from '@/types/api'

export type ActivitySectionKind = 'needs-you' | 'running' | 'review' | 'recent'

export interface ActivityRowProps {
  item: ActivityRowItem
  section: ActivitySectionKind
  projectName: string
  now: number
  selected?: boolean
  stopConfirmSignal?: number
  cancelConfirmSignal?: number
  onSelect?(session: SessionRecord): void
  onOpen(session: SessionRecord): void
  onClear(sessions: SessionRecord[]): void
  onStop?(session: SessionRecord, runtimeId?: string): void
}

export function runningPhaseLabel(item: ActivityRowItem): { text: string; isTool: boolean } {
  const { live } = item
  if (live?.phase === 'tool' && live.currentTool) {
    const summary = live.currentTool.summary ? ` · ${live.currentTool.summary}` : ''
    return { text: `▶ ${live.currentTool.name}${summary}`, isTool: true }
  }
  if (live?.phase === 'compacting') return { text: 'Compacting', isTool: false }
  if (live?.phase === 'retrying') return { text: 'Retrying', isTool: false }
  return { text: 'Thinking', isTool: false }
}

export function resolveRunStart(item: ActivityRowItem): number | undefined {
  if (item.live?.runStartedAt !== undefined) return item.live.runStartedAt
  const parsed = Date.parse(item.session.lastUserMessageAt ?? item.session.updatedAt)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function ActivityRow({
  item,
  section,
  projectName,
  now,
  selected = false,
  stopConfirmSignal = 0,
  cancelConfirmSignal = 0,
  onSelect,
  onOpen,
  onClear,
  onStop,
}: ActivityRowProps) {
  const { session, live, attention } = item
  const [confirmingStop, setConfirmingStop] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const stopTriggerRef = useRef<HTMLButtonElement>(null)
  const cancelStopRef = useRef<HTMLButtonElement>(null)
  const confirmBoxRef = useRef<HTMLDivElement>(null)

  const isRunning = section === 'running'
  const isQuestion = attention?.kind === 'question'
  const isFailed = attention?.kind === 'failed' || (!isRunning && !isQuestion && session.status === 'failed')
  const isReview = section === 'review'
  const reviewable = !isRunning && !isQuestion && Boolean(activityNotificationSignature(session))

  useEffect(() => {
    if (!isRunning && confirmingStop) {
      setConfirmingStop(false)
    }
  }, [isRunning, confirmingStop])

  const lastStopSignalRef = useRef(stopConfirmSignal)
  useEffect(() => {
    if (stopConfirmSignal !== lastStopSignalRef.current) {
      lastStopSignalRef.current = stopConfirmSignal
      if (selected && isRunning) setConfirmingStop(true)
    }
  }, [isRunning, selected, stopConfirmSignal])

  const lastCancelSignalRef = useRef(cancelConfirmSignal)
  useEffect(() => {
    if (cancelConfirmSignal !== lastCancelSignalRef.current) {
      lastCancelSignalRef.current = cancelConfirmSignal
      setConfirmingStop(false)
    }
  }, [cancelConfirmSignal])

  useEffect(() => {
    if (selected) {
      rowRef.current?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [selected])

  useEffect(() => {
    if (!confirmingStop) return
    const frame = requestAnimationFrame(() => {
      cancelStopRef.current?.focus()
    })
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !confirmBoxRef.current?.contains(event.target)) {
        setConfirmingStop(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [confirmingStop])

  const cancelStopConfirm = () => {
    setConfirmingStop(false)
    requestAnimationFrame(() => {
      stopTriggerRef.current?.focus()
    })
  }

  const handleConfirmKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelStopConfirm()
    }
  }

  const iconTone = isRunning
    ? 'running'
    : isQuestion
      ? 'waiting'
      : isFailed
        ? 'failed'
        : isReview
          ? 'review'
          : 'recent'

  const phase = isRunning ? runningPhaseLabel(item) : undefined
  const runStartedAt = isRunning ? resolveRunStart(item) : undefined
  const elapsedText = runStartedAt !== undefined ? formatElapsedClock(runStartedAt, now) : undefined
  const costLabel = isRunning ? formatSessionCost(live?.sessionUsage) : null
  const displayCost = costLabel && costLabel !== PRICING_UNAVAILABLE ? costLabel : null
  const quiet = isRunning && isSessionQuiet(live, now) ? formatQuietMinutes(live!, now) : null
  const countdown = isQuestion && attention.deadline !== undefined
    ? formatDeadlineCountdown(attention.deadline, now)
    : null

  return (
    <div
      ref={rowRef}
      className={`activity-row activity-row--${section} ${selected ? 'is-selected' : ''} ${confirmingStop ? 'is-confirming-stop' : ''}`}
      data-session-id={session.id}
      data-selected={selected ? 'true' : undefined}
    >
      <button
        type="button"
        className="activity-row__main"
        aria-current={selected ? 'true' : undefined}
        aria-label={onSelect ? `Select ${session.title}` : `Open ${session.title}`}
        onClick={() => {
          if (onSelect) onSelect(session)
          else onOpen(session)
        }}
        onDoubleClick={() => {
          if (onSelect) onOpen(session)
        }}
      >
        <span className={`activity-icon activity-icon--${iconTone}`}>
          {isRunning ? (
            <CircleNotch className="spin" size={15} />
          ) : isQuestion ? (
            <ChatCircleDots size={15} />
          ) : isFailed ? (
            <WarningCircle size={15} />
          ) : (
            <CheckCircle size={15} />
          )}
        </span>

        <span className="activity-main">
          <span className="activity-main__header">
            <strong className="activity-main__title">{session.title}</strong>
            <span className="activity-main__project">{projectName}</span>
            {quiet ? <span className="activity-tag activity-tag--quiet">{quiet}</span> : null}
            {isRunning && live?.queuedCount ? (
              <span className="activity-tag activity-tag--queued">{live.queuedCount} queued</span>
            ) : null}
          </span>

          <span className="activity-main__status">
            {isRunning && phase ? (
              <span className={`activity-status-line ${phase.isTool ? 'activity-status-line--tool mono' : 'activity-status-line--phase'}`}>
                {phase.text}
              </span>
            ) : isQuestion ? (
              <span className="activity-status-line activity-status-line--question">
                {attention.title}
              </span>
            ) : isFailed ? (
              <span className="activity-status-line activity-status-line--failed">
                {(attention?.kind === 'failed' ? attention.error : undefined) ?? live?.lastError ?? session.preview ?? 'Session ended with an error'}
              </span>
            ) : (
              <span className="activity-status-line activity-status-line--preview">
                {session.preview ?? 'Open session to view details'}
              </span>
            )}
          </span>
        </span>

        <span className="activity-meta">
          {isRunning ? (
            <>
              {live?.contextUsage ? (
                <span className="activity-meta__ring">
                  <ContextUsageRing contextUsage={live.contextUsage} sessionUsage={live.sessionUsage} />
                </span>
              ) : null}
              {displayCost ? <span className="activity-meta__cost tabular">{displayCost}</span> : null}
              {elapsedText ? (
                <span className="activity-meta__elapsed tabular" aria-label={`Elapsed ${elapsedText}`}>
                  <Clock size={11} />
                  {elapsedText}
                </span>
              ) : null}
            </>
          ) : isQuestion ? (
            <>
              {countdown ? (
                <span className="activity-badge activity-badge--deadline tabular" title="Time remaining to respond">
                  <Clock size={11} />
                  {countdown}
                </span>
              ) : (
                <span className="activity-badge activity-badge--waiting">Needs input</span>
              )}
            </>
          ) : (
            <span className="activity-meta__time tabular">
              <Clock size={11} />
              {formatRelative(session.updatedAt)}
            </span>
          )}
        </span>
      </button>

      {isRunning || reviewable ? (
        <div className="activity-row__actions">
          {isRunning ? (
            confirmingStop ? (
              <div
                ref={confirmBoxRef}
                className="activity-stop-confirm"
                role="group"
                aria-label={`Confirm stopping ${session.title}`}
                onKeyDown={handleConfirmKeyDown}
              >
                <span className="activity-stop-confirm__prompt">Stop this run?</span>
                <button
                  ref={cancelStopRef}
                  type="button"
                  className="button button--compact activity-stop-confirm__cancel"
                  onClick={cancelStopConfirm}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button button--compact button--danger activity-stop-confirm__confirm"
                  onClick={() => {
                    setConfirmingStop(false)
                    onStop?.(session, live?.runtimeId)
                  }}
                >
                  Stop
                </button>
              </div>
            ) : (
              <button
                ref={stopTriggerRef}
                type="button"
                className="icon-button icon-button--small activity-row__stop"
                aria-label={`Stop ${session.title}`}
                title="Stop run"
                onClick={() => setConfirmingStop(true)}
              >
                <Square size={12} weight="fill" />
              </button>
            )
          ) : (
            <button
              type="button"
              className={`activity-row__clear activity-row__clear--${session.status}`}
              aria-label={`Mark ${session.title} reviewed`}
              title="Mark reviewed"
              onClick={() => onClear([session])}
            >
              <Check size={13} />
              <span>Mark reviewed</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
