import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import {
  ArrowUpRight,
  ChatCircleDots,
  Check,
  CheckCircle,
  CircleNotch,
  Clock,
  Robot,
  Square,
  Terminal,
  WarningCircle,
} from '@/components/icons'
import { ContextUsageRing } from '@/components/ContextUsageRing'
import { resolveRunStart, runningPhaseLabel, type ActivitySectionKind } from './ActivityRow'
import {
  formatElapsedClock,
  summarizeToolArgs,
  type ActivityRowItem,
} from '@/app/session-live'
import { activityNotificationSignature } from '@/app/session-attention'
import { runTranscriptRead } from '@/app/transcript-load'
import { extractPiSessionWidgets } from '@/components/inspector/session-summary'
import { formatSessionCost, PRICING_UNAVAILABLE } from '@/lib/format-cost'
import { boundText } from '@/lib/render-bounds'
import type { MessagePart, SessionRecord, TranscriptMessage } from '@/types/api'

export const TAIL_MESSAGE_LIMIT = 12
export const TAIL_READ_THROTTLE_MS = 1_500

export interface ActivityPeekProps {
  item: ActivityRowItem | null
  section: ActivitySectionKind | null
  projectName: string
  now: number
  stopConfirmSignal?: number
  cancelConfirmSignal?: number
  readTranscript?(filePath: string): Promise<TranscriptMessage[]>
  onOpen(session: SessionRecord): void
  onClear(sessions: SessionRecord[]): void
  onStop?(session: SessionRecord, runtimeId?: string): void
  questionSlot?: ReactNode
  replySlot?: ReactNode
}

interface TailToolChip {
  key: string
  name: string
  summary?: string
  status: 'running' | 'done' | 'error'
}

interface TailEntry {
  id: string
  role: TranscriptMessage['role']
  text?: string
  tools: TailToolChip[]
}

function buildTailEntries(messages: readonly TranscriptMessage[], isSessionRunning: boolean): TailEntry[] {
  const flatParts: MessagePart[] = messages.flatMap((message) => Array.isArray(message.parts) ? message.parts : [])
  const resultByCallIndex = new Map<number, Extract<MessagePart, { type: 'toolResult' }>>()

  for (let i = 0; i < flatParts.length; i += 1) {
    const part = flatParts[i]
    if (part.type !== 'toolCall') continue
    for (let cursor = i + 1; cursor < flatParts.length; cursor += 1) {
      const candidate = flatParts[cursor]
      if (candidate.type === 'toolCall' && candidate.name === part.name && !part.id) break
      if (candidate.type === 'toolResult') {
        if (part.id && candidate.partId === part.id) {
          resultByCallIndex.set(i, candidate)
          break
        }
        if (candidate.name === undefined || candidate.name === part.name) {
          resultByCallIndex.set(i, candidate)
          break
        }
      }
    }
  }

  const sliceStart = Math.max(0, messages.length - TAIL_MESSAGE_LIMIT)
  let globalPartCursor = 0
  for (let m = 0; m < sliceStart; m += 1) {
    globalPartCursor += Array.isArray(messages[m].parts) ? messages[m].parts.length : 0
  }

  const entries: TailEntry[] = []
  for (let m = sliceStart; m < messages.length; m += 1) {
    const message = messages[m]
    const parts = Array.isArray(message.parts) ? message.parts : []
    const textChunks: string[] = []
    const tools: TailToolChip[] = []

    for (let p = 0; p < parts.length; p += 1) {
      const part = parts[p]
      const flatIndex = globalPartCursor + p
      if (part.type === 'text') {
        const trimmed = part.text.trim()
        if (trimmed) textChunks.push(trimmed)
      } else if (part.type === 'toolCall') {
        const result = resultByCallIndex.get(flatIndex)
        const status: TailToolChip['status'] = result
          ? (result.streaming ? 'running' : result.isError ? 'error' : 'done')
          : (isSessionRunning && m === messages.length - 1 ? 'running' : 'done')
        tools.push({
          key: part.id ?? `${message.id}-tool-${p}`,
          name: part.name,
          summary: summarizeToolArgs(part.args),
          status,
        })
      }
    }
    globalPartCursor += parts.length

    const combinedText = textChunks.length > 0
      ? boundText(textChunks.join('\n\n'), 420, '…')
      : undefined
    if (combinedText || tools.length > 0) {
      entries.push({
        id: message.id,
        role: message.role,
        ...(combinedText ? { text: combinedText } : {}),
        tools,
      })
    }
  }

  return entries
}

function formatModelBadge(session: SessionRecord): string | null {
  if (!session.model) return null
  return session.provider ? `${session.provider}/${session.model}` : session.model
}

export function ActivityPeek({
  item,
  section,
  projectName,
  now,
  stopConfirmSignal = 0,
  cancelConfirmSignal = 0,
  readTranscript,
  onOpen,
  onClear,
  onStop,
  questionSlot,
  replySlot,
}: ActivityPeekProps) {
  const session = item?.session
  const live = item?.live
  const attention = item?.attention

  const [confirmingStop, setConfirmingStop] = useState(false)
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [loadingTail, setLoadingTail] = useState(false)
  const stopTriggerRef = useRef<HTMLButtonElement>(null)
  const cancelStopRef = useRef<HTMLButtonElement>(null)
  const confirmBoxRef = useRef<HTMLDivElement>(null)
  const tailScrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const readRequestIdRef = useRef(0)
  const lastReadAtRef = useRef(0)
  const lastFilePathRef = useRef<string | undefined>(undefined)

  const isRunning = Boolean(
    section === 'running'
    || (live && live.phase !== 'idle' && !live.pendingQuestion)
    || (!attention && session?.status === 'running'),
  )
  const isQuestion = attention?.kind === 'question'
  const isFailed = attention?.kind === 'failed' || (!isRunning && !isQuestion && session?.status === 'failed')
  const reviewable = Boolean(session && !isRunning && !isQuestion && activityNotificationSignature(session))

  useEffect(() => {
    setConfirmingStop(false)
  }, [session?.id, isRunning])

  const lastStopSignalRef = useRef(stopConfirmSignal)
  useEffect(() => {
    if (stopConfirmSignal !== lastStopSignalRef.current) {
      lastStopSignalRef.current = stopConfirmSignal
      if (isRunning) setConfirmingStop(true)
    }
  }, [isRunning, stopConfirmSignal])

  const lastCancelSignalRef = useRef(cancelConfirmSignal)
  useEffect(() => {
    if (cancelConfirmSignal !== lastCancelSignalRef.current) {
      lastCancelSignalRef.current = cancelConfirmSignal
      setConfirmingStop(false)
    }
  }, [cancelConfirmSignal])

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

  const sessionFilePath = session?.filePath
  const liveReadSignal = useMemo(() => [
    session?.status ?? '',
    session?.updatedAt ?? '',
    session?.eventRevision ?? 0,
    live?.phase ?? '',
    live?.currentTool?.name ?? '',
    live?.currentTool?.summary ?? '',
    live?.currentTool?.startedAt ?? 0,
    live?.lastError ?? '',
    live?.pendingQuestion?.id ?? '',
  ].join('|'), [
    live?.currentTool?.name,
    live?.currentTool?.startedAt,
    live?.currentTool?.summary,
    live?.lastError,
    live?.pendingQuestion?.id,
    live?.phase,
    session?.eventRevision,
    session?.status,
    session?.updatedAt,
  ])

  useEffect(() => {
    if (!sessionFilePath || !readTranscript) {
      readRequestIdRef.current += 1
      lastFilePathRef.current = sessionFilePath
      setMessages([])
      setLoadingTail(false)
      return
    }

    let mounted = true
    const sessionChanged = lastFilePathRef.current !== sessionFilePath
    if (sessionChanged) {
      lastFilePathRef.current = sessionFilePath
      lastReadAtRef.current = 0
      stickToBottomRef.current = true
      setMessages([])
    }

    const executeRead = () => {
      const requestId = ++readRequestIdRef.current
      lastReadAtRef.current = Date.now()
      if (sessionChanged) setLoadingTail(true)
      void runTranscriptRead({
        read: () => readTranscript(sessionFilePath),
        isCurrent: () => mounted && lastFilePathRef.current === sessionFilePath && readRequestIdRef.current === requestId,
        onValue: (nextMessages) => {
          setMessages(Array.isArray(nextMessages) ? nextMessages : [])
          setLoadingTail(false)
        },
        onError: () => {
          setLoadingTail(false)
        },
        onFinally: () => undefined,
      })
    }

    const elapsed = Date.now() - lastReadAtRef.current
    if (sessionChanged || elapsed >= TAIL_READ_THROTTLE_MS) {
      executeRead()
      return () => {
        mounted = false
      }
    }

    const timer = window.setTimeout(executeRead, TAIL_READ_THROTTLE_MS - elapsed)
    return () => {
      mounted = false
      window.clearTimeout(timer)
    }
  }, [liveReadSignal, readTranscript, sessionFilePath])

  const widgets = useMemo(() => extractPiSessionWidgets(messages), [messages])
  const doneTodos = useMemo(
    () => widgets.todos.filter((todo) => todo.status === 'completed' || todo.status === 'done').length,
    [widgets.todos],
  )
  const activeTodo = useMemo(
    () => widgets.todos.find((todo) => todo.status === 'in_progress'),
    [widgets.todos],
  )
  const runningSubagents = useMemo(
    () => widgets.specialists.filter((specialist) => specialist.status === 'running').length,
    [widgets.specialists],
  )
  const hasProgressLine = widgets.todos.length > 0 || runningSubagents > 0

  const tailEntries = useMemo(
    () => buildTailEntries(messages, isRunning),
    [ isRunning, messages ],
  )

  const liveActiveTool = useMemo<TailToolChip | null>(() => {
    if (!isRunning || live?.phase !== 'tool' || !live.currentTool) return null
    const lastEntry = tailEntries.at(-1)
    const lastTool = lastEntry?.tools.at(-1)
    if (
      lastTool
      && lastTool.status === 'running'
      && lastTool.name === live.currentTool.name
      && (lastTool.summary ?? '') === (live.currentTool.summary ?? '')
    ) {
      return null
    }
    return {
      key: `live-tool-${live.currentTool.startedAt}-${live.currentTool.name}`,
      name: live.currentTool.name,
      summary: live.currentTool.summary,
      status: 'running',
    }
  }, [isRunning, live?.currentTool, live?.phase, tailEntries])

  useLayoutEffect(() => {
    const container = tailScrollRef.current
    if (!container || !stickToBottomRef.current) return
    container.scrollTop = container.scrollHeight
  }, [tailEntries, liveActiveTool, session?.id])

  const handleTailScroll = () => {
    const container = tailScrollRef.current
    if (!container) return
    stickToBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 28
  }

  if (!item || !session) {
    return (
      <aside className="activity-peek activity-peek--empty" aria-label="Session peek">
        <div className="activity-peek__empty-state">
          <ChatCircleDots size={22} />
          <p>Select a session to peek at its live tail, answer questions, or send a steer.</p>
        </div>
      </aside>
    )
  }

  const modelBadge = formatModelBadge(session)
  const runStartedAt = isRunning ? resolveRunStart(item) : undefined
  const elapsedText = runStartedAt !== undefined ? formatElapsedClock(runStartedAt, now) : undefined
  const costLabel = isRunning ? formatSessionCost(live?.sessionUsage) : null
  const displayCost = costLabel && costLabel !== PRICING_UNAVAILABLE ? costLabel : null
  const phase = isRunning ? runningPhaseLabel(item) : undefined

  return (
    <aside className="activity-peek" aria-label={`Peek ${session.title}`} data-session-id={session.id}>
      <header className="activity-peek__header">
        <div className="activity-peek__identity">
          <div className="activity-peek__title-row">
            <h2 className="activity-peek__title">{session.title}</h2>
            <span className="activity-peek__project">{projectName}</span>
            {modelBadge ? <span className="activity-peek__model mono">{modelBadge}</span> : null}
          </div>

          <div className="activity-peek__subrow">
            {isRunning && phase ? (
              <span className={`activity-peek__phase ${phase.isTool ? 'activity-peek__phase--tool mono' : ''}`}>
                <CircleNotch className="spin" size={12} />
                <span>{phase.text}</span>
              </span>
            ) : isQuestion ? (
              <span className="activity-peek__phase activity-peek__phase--waiting">
                <ChatCircleDots size={12} />
                <span>Waiting for your answer</span>
              </span>
            ) : isFailed ? (
              <span className="activity-peek__phase activity-peek__phase--failed">
                <WarningCircle size={12} />
                <span>{(attention?.kind === 'failed' ? attention.error : undefined) ?? live?.lastError ?? 'Session failed'}</span>
              </span>
            ) : (
              <span className="activity-peek__phase activity-peek__phase--idle">
                <CheckCircle size={12} />
                <span>Ready</span>
              </span>
            )}

            {isRunning ? (
              <div className="activity-peek__metrics tabular">
                {live?.contextUsage ? (
                  <span className="activity-meta__ring">
                    <ContextUsageRing contextUsage={live.contextUsage} sessionUsage={live.sessionUsage} />
                  </span>
                ) : null}
                {displayCost ? <span className="activity-meta__cost tabular">{displayCost}</span> : null}
                {elapsedText ? (
                  <span className="activity-meta__elapsed tabular" aria-label={`Peek elapsed ${elapsedText}`}>
                    <Clock size={11} />
                    {elapsedText}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="activity-peek__actions">
          {isRunning && onStop ? (
            confirmingStop ? (
              <div
                ref={confirmBoxRef}
                className="activity-stop-confirm activity-peek__stop-confirm"
                role="group"
                aria-label="Confirm stopping run"
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
                    onStop(session, live?.runtimeId)
                  }}
                >
                  Stop
                </button>
              </div>
            ) : (
              <button
                ref={stopTriggerRef}
                type="button"
                className="button button--compact activity-peek__stop"
                aria-label="Stop run"
                title="Stop run (x)"
                onClick={() => setConfirmingStop(true)}
              >
                <Square size={11} weight="fill" />
                <span>Stop</span>
              </button>
            )
          ) : null}

          {reviewable ? (
            <button
              type="button"
              className="button button--compact activity-peek__clear"
              aria-label="Mark reviewed"
              title="Mark reviewed (e)"
              onClick={() => onClear([session])}
            >
              <Check size={12} />
              <span>Mark reviewed</span>
            </button>
          ) : null}

          <button
            type="button"
            className="button button--compact activity-peek__open"
            aria-label={`Open ${session.title}`}
            title="Open session (Enter)"
            onClick={() => onOpen(session)}
          >
            <span>Open session</span>
            <ArrowUpRight size={12} />
          </button>
        </div>
      </header>

      {questionSlot}

      {hasProgressLine ? (
        <div className="activity-peek__progress" aria-label="Session progress">
          {widgets.todos.length > 0 ? (
            <span className="activity-peek__progress-pill tabular">
              <CheckCircle size={12} />
              <span>{doneTodos}/{widgets.todos.length} todos</span>
              {activeTodo ? <span className="activity-peek__progress-detail">· {activeTodo.content}</span> : null}
            </span>
          ) : null}
          {runningSubagents > 0 ? (
            <span className="activity-peek__progress-pill activity-peek__progress-pill--agents tabular">
              <Robot size={12} />
              <span>{runningSubagents} {runningSubagents === 1 ? 'subagent' : 'subagents'} running</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        ref={tailScrollRef}
        className="activity-peek__tail scroll-area"
        role="log"
        aria-label="Live session tail"
        onScroll={handleTailScroll}
      >
        {loadingTail && tailEntries.length === 0 ? (
          <div className="activity-peek__tail-placeholder">Loading recent activity…</div>
        ) : tailEntries.length === 0 && !liveActiveTool ? (
          <div className="activity-peek__tail-placeholder">
            {session.preview ? (
              <p className="activity-tail-preview">{session.preview}</p>
            ) : (
              'No transcript entries recorded yet.'
            )}
          </div>
        ) : (
          <div className="activity-tail-list">
            {tailEntries.map((entry) => (
              <div key={entry.id} className={`activity-tail-item activity-tail-item--${entry.role}`}>
                {entry.text ? (
                  <div className="activity-tail-text">
                    <span className="activity-tail-role">{entry.role === 'user' ? 'You' : entry.role === 'system' ? 'System' : 'Agent'}</span>
                    <p className="activity-tail-body">{entry.text}</p>
                  </div>
                ) : null}
                {entry.tools.length > 0 ? (
                  <div className="activity-tail-tools">
                    {entry.tools.map((tool) => (
                      <div key={tool.key} className={`activity-tail-tool activity-tail-tool--${tool.status}`}>
                        {tool.status === 'running' ? (
                          <CircleNotch className="spin" size={11} />
                        ) : tool.status === 'error' ? (
                          <WarningCircle size={11} />
                        ) : (
                          <Terminal size={11} />
                        )}
                        <strong className="activity-tail-tool__name mono">{tool.name}</strong>
                        {tool.summary ? <span className="activity-tail-tool__summary mono">{tool.summary}</span> : null}
                        <span className="activity-tail-tool__status">{tool.status}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            {liveActiveTool ? (
              <div className="activity-tail-tools">
                <div className="activity-tail-tool activity-tail-tool--running activity-tail-tool--live">
                  <CircleNotch className="spin" size={11} />
                  <strong className="activity-tail-tool__name mono">{liveActiveTool.name}</strong>
                  {liveActiveTool.summary ? <span className="activity-tail-tool__summary mono">{liveActiveTool.summary}</span> : null}
                  <span className="activity-tail-tool__status">running</span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {replySlot}
    </aside>
  )
}
