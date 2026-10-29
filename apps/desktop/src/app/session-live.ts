import { contextUsageFromEvent, eventType, sessionUsageFromEvent } from './agent-events'
import { activityNotificationSignature, signatureCleared } from './session-attention'
import { ASK_USER_TIMEOUT_MS, parseExtensionUiRequest } from '@/lib/extension-ui'
import type { PendingExtensionUi } from '@/hooks/useExtensionUi'
import { boundText } from '@/lib/render-bounds'
import { parseSessionActionSnapshot } from '@/lib/session-actions'
import type { PrimeContextUsage, RuntimeInfo, SessionRecord, SessionUsage } from '@/types/api'

export type SessionLivePhase = 'thinking' | 'tool' | 'compacting' | 'retrying' | 'idle'

export interface SessionLiveTool {
  id?: string
  name: string
  summary?: string
  startedAt: number
}

export interface SessionLiveQuestion {
  id: string
  title: string
  method: string
  options?: string[]
  deadline?: number
  runtimeId: string
}

export interface SessionLive {
  runtimeId: string
  phase: SessionLivePhase
  currentTool?: SessionLiveTool
  runStartedAt?: number
  lastEventAt: number
  contextUsage?: PrimeContextUsage
  sessionUsage?: SessionUsage
  queuedCount?: number
  lastError?: string
  pendingQuestion?: SessionLiveQuestion
}

export type SessionLiveMap = Readonly<Record<string, SessionLive>>

export type Attention =
  | { kind: 'question'; title: string; method: string; deadline?: number; runtimeId: string }
  | { kind: 'failed'; error?: string }
  | { kind: 'review' }

export interface SessionLiveEventInput {
  runtimeId: string
  sessionFile?: string
  event: Record<string, unknown>
  now?: number
}

export interface ActivityRowItem {
  session: SessionRecord
  live?: SessionLive
  attention: Attention | null
}

export interface ActivitySections {
  needsYou: ActivityRowItem[]
  running: ActivityRowItem[]
  readyToReview: ActivityRowItem[]
  recent: ActivityRowItem[]
}

/** Minimum interval between lastEventAt-only state commits during streaming floods. */
export const SESSION_LIVE_HEARTBEAT_THROTTLE_MS = 10_000

/** Running sessions with no events for >3 min outside tool execution show a quiet indicator. */
export const SESSION_QUIET_THRESHOLD_MS = 3 * 60_000

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function cleanLine(value: string, max = 120): string | undefined {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized ? boundText(normalized, max, '…') : undefined
}

export function summarizeToolArgs(args: unknown): string | undefined {
  if (typeof args === 'string') return cleanLine(args)
  const raw = asRecord(args)
  if (!raw) return undefined
  const preferred = raw.command ?? raw.question ?? raw.query ?? raw.pattern ?? raw.url ?? raw.path ?? raw.operation ?? raw.id ?? raw.action ?? raw.code ?? raw.cwd
  if (typeof preferred === 'string') return cleanLine(preferred)
  if (Array.isArray(raw.paths) && typeof raw.paths[0] === 'string') {
    const first = cleanLine(raw.paths[0], 80)
    return first ? (raw.paths.length > 1 ? `${first} (+${raw.paths.length - 1})` : first) : undefined
  }
  if (Array.isArray(raw.questions) && raw.questions.length > 0) {
    const firstQuestion = asRecord(raw.questions[0])
    if (typeof firstQuestion?.question === 'string') return cleanLine(firstQuestion.question)
  }
  return undefined
}

export function questionFromPendingExtensionUi(pending: PendingExtensionUi): SessionLiveQuestion {
  const { request, runtimeId, deadline } = pending
  if (request.method === 'questionnaire') {
    const firstTitle = request.questions[0]?.title
    const title = !firstTitle
      ? request.title
      : request.total > 1
        ? `${firstTitle} · ${request.total} questions`
        : firstTitle
    return {
      id: request.id,
      title,
      method: 'questionnaire',
      ...(request.questions[0]?.options ? { options: request.questions[0].options } : {}),
      ...(deadline !== undefined ? { deadline } : {}),
      runtimeId,
    }
  }
  return {
    id: request.id,
    title: request.title,
    method: request.method,
    ...(request.method === 'select' ? { options: request.options } : {}),
    ...(deadline !== undefined ? { deadline } : {}),
    runtimeId,
  }
}

function sameContextUsage(left?: PrimeContextUsage, right?: PrimeContextUsage): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return left.tokens === right.tokens && left.contextWindow === right.contextWindow && left.percent === right.percent
}

function sameSessionUsage(left?: SessionUsage, right?: SessionUsage): boolean {
  if (left === right) return true
  if (!left || !right) return false
  if (left.cost !== right.cost) return false
  if (left.tokens === right.tokens) return true
  if (!left.tokens || !right.tokens) return false
  return left.tokens.input === right.tokens.input
    && left.tokens.output === right.tokens.output
    && left.tokens.cacheRead === right.tokens.cacheRead
    && left.tokens.cacheWrite === right.tokens.cacheWrite
    && left.tokens.total === right.tokens.total
}

function sameQuestion(left?: SessionLiveQuestion, right?: SessionLiveQuestion): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return left.id === right.id
    && left.title === right.title
    && left.method === right.method
    && left.deadline === right.deadline
    && left.runtimeId === right.runtimeId
}

export function seedSessionLiveFromRuntimes(
  state: SessionLiveMap,
  runtimes: readonly RuntimeInfo[],
  now = Date.now(),
): SessionLiveMap {
  let next: Record<string, SessionLive> | undefined
  for (const runtime of runtimes) {
    const sessionFile = runtime.sessionFile
    if (!sessionFile) continue
    const previous = (next ?? state)[sessionFile]
    const isCompacting = Boolean(runtime.isCompacting)
    const isStreaming = Boolean(runtime.isStreaming)
    const phase: SessionLivePhase = isCompacting
      ? 'compacting'
      : isStreaming
        ? (previous && previous.phase !== 'idle' ? previous.phase : 'thinking')
        : 'idle'
    const runStartedAt = isStreaming || isCompacting ? (previous?.runStartedAt ?? now) : undefined
    const contextUsage = runtime.contextUsage ?? previous?.contextUsage
    const sessionUsage = runtime.sessionUsage ?? previous?.sessionUsage
    const queuedCount = runtime.sessionActions?.queuedCount ?? previous?.queuedCount
    const candidate: SessionLive = {
      runtimeId: runtime.runtimeId,
      phase,
      ...(phase === 'tool' && previous?.currentTool ? { currentTool: previous.currentTool } : {}),
      ...(runStartedAt !== undefined ? { runStartedAt } : {}),
      lastEventAt: previous?.lastEventAt ?? now,
      ...(contextUsage ? { contextUsage } : {}),
      ...(sessionUsage ? { sessionUsage } : {}),
      ...(queuedCount !== undefined ? { queuedCount } : {}),
      ...(previous?.lastError ? { lastError: previous.lastError } : {}),
      ...(previous?.pendingQuestion ? { pendingQuestion: previous.pendingQuestion } : {}),
    }
    if (previous
      && previous.runtimeId === candidate.runtimeId
      && previous.phase === candidate.phase
      && previous.currentTool === candidate.currentTool
      && previous.runStartedAt === candidate.runStartedAt
      && sameContextUsage(previous.contextUsage, candidate.contextUsage)
      && sameSessionUsage(previous.sessionUsage, candidate.sessionUsage)
      && previous.queuedCount === candidate.queuedCount) {
      continue
    }
    next ??= { ...state }
    next[sessionFile] = candidate
  }
  return next ?? state
}

export function syncSessionLivePendingQuestions(
  state: SessionLiveMap,
  pendingByRuntime: ReadonlyMap<string, PendingExtensionUi>,
  runtimeSessions: ReadonlyMap<string, string>,
  now = Date.now(),
): SessionLiveMap {
  let next: Record<string, SessionLive> | undefined
  const questionBySession = new Map<string, SessionLiveQuestion>()
  for (const [runtimeId, pending] of pendingByRuntime) {
    const sessionFile = runtimeSessions.get(runtimeId)
    if (sessionFile) questionBySession.set(sessionFile, questionFromPendingExtensionUi(pending))
  }
  for (const [sessionFile, live] of Object.entries(state)) {
    const pendingForRuntime = pendingByRuntime.get(live.runtimeId)
    const question = pendingForRuntime ? questionFromPendingExtensionUi(pendingForRuntime) : questionBySession.get(sessionFile)
    if (sameQuestion(live.pendingQuestion, question)) continue
    next ??= { ...state }
    const { pendingQuestion: _previous, ...rest } = live
    next[sessionFile] = question ? { ...rest, pendingQuestion: question } : rest
  }
  for (const [sessionFile, question] of questionBySession) {
    if ((next ?? state)[sessionFile]) continue
    next ??= { ...state }
    next[sessionFile] = {
      runtimeId: question.runtimeId,
      phase: 'thinking',
      runStartedAt: now,
      lastEventAt: now,
      pendingQuestion: question,
    }
  }
  return next ?? state
}

function putSessionLive(
  state: SessionLiveMap,
  sessionFile: string,
  entry: SessionLive,
): SessionLiveMap {
  return { ...state, [sessionFile]: entry }
}

export function reduceSessionLive(
  state: SessionLiveMap,
  { runtimeId, sessionFile, event, now = Date.now() }: SessionLiveEventInput,
): SessionLiveMap {
  const type = eventType(event)
  if (type === 'runtime_exit') {
    if (sessionFile && sessionFile in state) {
      const { [sessionFile]: _removed, ...rest } = state
      return rest
    }
    let next: Record<string, SessionLive> | undefined
    for (const [key, value] of Object.entries(state)) {
      if (value.runtimeId !== runtimeId) continue
      if (!next) {
        next = { ...state }
      }
      delete next[key]
    }
    return next ?? state
  }

  if (!sessionFile) return state
  const previous = state[sessionFile]
  const base: SessionLive = previous
    ? { ...previous, runtimeId }
    : { runtimeId, phase: 'idle', lastEventAt: now }

  if (type === 'agent_start' || type === 'turn_start') {
    const runStartedAt = type === 'agent_start' && base.phase === 'idle'
      ? now
      : base.runStartedAt ?? now
    const { currentTool: _tool, lastError: _err, pendingQuestion: _q, ...rest } = base
    return putSessionLive(state, sessionFile, {
      ...rest,
      phase: 'thinking',
      runStartedAt,
      lastEventAt: now,
    })
  }

  if (type === 'message_update') {
    const delta = asRecord(event.assistantMessageEvent) ?? asRecord(event.delta)
    const deltaType = typeof delta?.type === 'string' ? delta.type : ''
    if (deltaType === 'toolcall_end') {
      const tool = asRecord(delta?.toolCall)
      const name = typeof tool?.name === 'string' && tool.name.trim() ? tool.name.trim() : 'Tool'
      const id = typeof tool?.id === 'string' ? tool.id : undefined
      const summary = summarizeToolArgs(tool?.arguments ?? tool?.args)
      return putSessionLive(state, sessionFile, {
        ...base,
        phase: 'tool',
        currentTool: { id, name, ...(summary ? { summary } : {}), startedAt: now },
        runStartedAt: base.runStartedAt ?? now,
        lastEventAt: now,
      })
    }
    const targetPhase: SessionLivePhase = base.phase === 'compacting' ? 'compacting' : 'thinking'
    if (previous
      && previous.runtimeId === runtimeId
      && previous.phase === targetPhase
      && !previous.currentTool
      && previous.runStartedAt !== undefined
      && now - previous.lastEventAt < SESSION_LIVE_HEARTBEAT_THROTTLE_MS) {
      return state
    }
    const { currentTool: _tool, ...rest } = base
    return putSessionLive(state, sessionFile, {
      ...rest,
      phase: targetPhase,
      runStartedAt: base.runStartedAt ?? now,
      lastEventAt: now,
    })
  }

  if (type === 'tool_execution_start') {
    const name = typeof event.toolName === 'string' && event.toolName.trim() ? event.toolName.trim() : 'Tool'
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : undefined
    const summary = summarizeToolArgs(event.args)
    return putSessionLive(state, sessionFile, {
      ...base,
      phase: 'tool',
      currentTool: { id, name, ...(summary ? { summary } : {}), startedAt: now },
      runStartedAt: base.runStartedAt ?? now,
      lastEventAt: now,
    })
  }

  if (type === 'tool_execution_update') {
    const name = typeof event.toolName === 'string' && event.toolName.trim()
      ? event.toolName.trim()
      : base.currentTool?.name ?? 'Tool'
    const id = typeof event.toolCallId === 'string' ? event.toolCallId : base.currentTool?.id
    const summary = summarizeToolArgs(event.args) ?? base.currentTool?.summary
    const startedAt = base.currentTool?.startedAt ?? now
    if (previous
      && previous.runtimeId === runtimeId
      && previous.phase === 'tool'
      && previous.currentTool?.name === name
      && previous.currentTool?.summary === summary
      && previous.runStartedAt !== undefined
      && now - previous.lastEventAt < SESSION_LIVE_HEARTBEAT_THROTTLE_MS) {
      return state
    }
    return putSessionLive(state, sessionFile, {
      ...base,
      phase: 'tool',
      currentTool: { id, name, ...(summary ? { summary } : {}), startedAt },
      runStartedAt: base.runStartedAt ?? now,
      lastEventAt: now,
    })
  }

  if (type === 'tool_execution_end') {
    const { currentTool: _tool, pendingQuestion: _q, ...rest } = base
    return putSessionLive(state, sessionFile, {
      ...rest,
      phase: 'thinking',
      runStartedAt: base.runStartedAt ?? now,
      lastEventAt: now,
    })
  }

  if (type === 'compaction_start') {
    const { currentTool: _tool, ...rest } = base
    return putSessionLive(state, sessionFile, {
      ...rest,
      phase: 'compacting',
      runStartedAt: base.runStartedAt ?? now,
      lastEventAt: now,
    })
  }

  if (type === 'compaction_end') {
    const willRetry = event.willRetry === true
    const { currentTool: _tool, runStartedAt: prevStart, ...rest } = base
    return putSessionLive(state, sessionFile, {
      ...rest,
      phase: willRetry ? 'thinking' : 'idle',
      ...(willRetry ? { runStartedAt: prevStart ?? now } : {}),
      lastEventAt: now,
    })
  }

  if (type === 'auto_retry_start') {
    const { currentTool: _tool, ...rest } = base
    return putSessionLive(state, sessionFile, {
      ...rest,
      phase: 'retrying',
      runStartedAt: base.runStartedAt ?? now,
      lastEventAt: now,
    })
  }

  if (type === 'auto_retry_end') {
    if (event.success === true) {
      return putSessionLive(state, sessionFile, {
        ...base,
        phase: 'thinking',
        runStartedAt: base.runStartedAt ?? now,
        lastEventAt: now,
      })
    }
    const finalError = typeof event.finalError === 'string' ? cleanLine(event.finalError, 240) : undefined
    const { currentTool: _tool, runStartedAt: _start, pendingQuestion: _q, ...rest } = base
    return putSessionLive(state, sessionFile, {
      ...rest,
      phase: 'idle',
      ...(finalError ?? rest.lastError ? { lastError: finalError ?? rest.lastError } : {}),
      lastEventAt: now,
    })
  }

  if (type === 'message_end') {
    const message = asRecord(event.message)
    if (message?.role === 'assistant' && message.stopReason === 'error') {
      const errorText = typeof message.errorMessage === 'string' ? cleanLine(message.errorMessage, 240) : undefined
      return putSessionLive(state, sessionFile, {
        ...base,
        ...(errorText ? { lastError: errorText } : {}),
        lastEventAt: now,
      })
    }
    return state
  }

  if (type === 'error' || type === 'extension_error' || type === 'transport_error') {
    const rawError = typeof event.error === 'string' ? event.error : typeof event.message === 'string' ? event.message : undefined
    const errorText = rawError ? cleanLine(rawError, 240) : undefined
    const { currentTool: _tool, runStartedAt: _start, pendingQuestion: _q, ...rest } = base
    return putSessionLive(state, sessionFile, {
      ...rest,
      phase: 'idle',
      ...(errorText ?? rest.lastError ? { lastError: errorText ?? rest.lastError } : {}),
      lastEventAt: now,
    })
  }

  if (type === 'agent_end') {
    const { currentTool: _tool, runStartedAt: _start, pendingQuestion: _q, ...rest } = base
    return putSessionLive(state, sessionFile, {
      ...rest,
      phase: 'idle',
      lastEventAt: now,
    })
  }

  if (type === 'context_usage') {
    const contextUsage = contextUsageFromEvent(event)
    if (!contextUsage || (previous && sameContextUsage(previous.contextUsage, contextUsage))) return state
    return putSessionLive(state, sessionFile, { ...base, contextUsage })
  }

  if (type === 'session_usage') {
    const sessionUsage = sessionUsageFromEvent(event)
    if (!sessionUsage || (previous && sameSessionUsage(previous.sessionUsage, sessionUsage))) return state
    return putSessionLive(state, sessionFile, { ...base, sessionUsage })
  }

  if (type === 'session_action_update') {
    const actions = parseSessionActionSnapshot(event.actions)
    if (!actions || (previous && previous.queuedCount === actions.queuedCount)) return state
    return putSessionLive(state, sessionFile, { ...base, queuedCount: actions.queuedCount })
  }

  if (type === 'extension_ui_request') {
    const parsed = parseExtensionUiRequest(event)
    if (!parsed) return state
    if (parsed.method === 'select' && parsed.questionnaire) {
      const sameGroup = base.pendingQuestion?.id === parsed.questionnaire.groupId
      const timeout = parsed.timeout ?? ASK_USER_TIMEOUT_MS
      const deadline = sameGroup && base.pendingQuestion?.deadline !== undefined
        ? base.pendingQuestion.deadline
        : timeout > 0 ? now + timeout : undefined
      const firstTitle = sameGroup && base.pendingQuestion
        ? base.pendingQuestion.title.split(' · ')[0] ?? parsed.title
        : parsed.title
      const title = parsed.questionnaire.total > 1
        ? `${firstTitle} · ${parsed.questionnaire.total} questions`
        : firstTitle
      return putSessionLive(state, sessionFile, {
        ...base,
        pendingQuestion: {
          id: parsed.questionnaire.groupId,
          title,
          method: 'questionnaire',
          options: parsed.options,
          ...(deadline !== undefined ? { deadline } : {}),
          runtimeId,
        },
        lastEventAt: now,
      })
    }
    const timeout = 'timeout' in parsed ? parsed.timeout : undefined
    const deadline = timeout !== undefined && timeout > 0 ? now + timeout : undefined
    return putSessionLive(state, sessionFile, {
      ...base,
      pendingQuestion: {
        id: parsed.id,
        title: parsed.title,
        method: parsed.method,
        ...(parsed.method === 'select' ? { options: parsed.options } : {}),
        ...(deadline !== undefined ? { deadline } : {}),
        runtimeId,
      },
      lastEventAt: now,
    })
  }

  return state
}

export function deriveAttention(
  session: SessionRecord,
  live?: SessionLive,
  clearedSignature?: string,
): Attention | null {
  if (session.archived) return null
  if (live?.pendingQuestion) {
    return {
      kind: 'question',
      title: live.pendingQuestion.title,
      method: live.pendingQuestion.method,
      ...(live.pendingQuestion.deadline !== undefined ? { deadline: live.pendingQuestion.deadline } : {}),
      runtimeId: live.pendingQuestion.runtimeId,
    }
  }
  const signature = activityNotificationSignature(session)
  const isCleared = Boolean(signature && signatureCleared(signature, clearedSignature, session.unread))
  if (session.status === 'waiting') {
    if (isCleared) return null
    return {
      kind: 'question',
      title: session.preview || 'Waiting for your input',
      method: 'wait',
      runtimeId: live?.runtimeId ?? '',
    }
  }
  if (session.status === 'running' || (live !== undefined && live.phase !== 'idle')) {
    return null
  }
  if (session.status === 'failed') {
    if (isCleared) return null
    const error = live?.lastError ?? session.preview
    return {
      kind: 'failed',
      ...(error ? { error } : {}),
    }
  }
  if (session.status === 'complete' && session.unread) {
    if (isCleared) return null
    return { kind: 'review' }
  }
  return null
}

function compareUpdatedDesc(left: SessionRecord, right: SessionRecord): number {
  const diff = Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  return (Number.isFinite(diff) ? diff : 0) || left.id.localeCompare(right.id)
}

function compareNeedsYou(left: ActivityRowItem, right: ActivityRowItem): number {
  const leftIsQuestion = left.attention?.kind === 'question'
  const rightIsQuestion = right.attention?.kind === 'question'
  if (leftIsQuestion !== rightIsQuestion) return leftIsQuestion ? -1 : 1
  if (left.attention?.kind === 'question' && right.attention?.kind === 'question') {
    const leftDeadline = left.attention.deadline ?? Number.POSITIVE_INFINITY
    const rightDeadline = right.attention.deadline ?? Number.POSITIVE_INFINITY
    if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline
  }
  return compareUpdatedDesc(left.session, right.session)
}

function compareRunning(left: ActivityRowItem, right: ActivityRowItem): number {
  const leftStart = left.live?.runStartedAt ?? Date.parse(left.session.lastUserMessageAt ?? left.session.createdAt)
  const rightStart = right.live?.runStartedAt ?? Date.parse(right.session.lastUserMessageAt ?? right.session.createdAt)
  const safeLeft = Number.isFinite(leftStart) ? leftStart : 0
  const safeRight = Number.isFinite(rightStart) ? rightStart : 0
  return (safeLeft - safeRight) || left.session.id.localeCompare(right.session.id)
}

export function buildActivitySections(
  sessions: readonly SessionRecord[],
  liveBySession: SessionLiveMap = {},
  clearedActivity: Readonly<Record<string, string>> = {},
  query = '',
): ActivitySections {
  const normalized = query.trim().toLowerCase()
  const needsYou: ActivityRowItem[] = []
  const running: ActivityRowItem[] = []
  const readyToReview: ActivityRowItem[] = []
  const recent: ActivityRowItem[] = []

  for (const session of sessions) {
    if (session.archived) continue
    const live = liveBySession[session.filePath]
    const clearedSig = clearedActivity[session.id]
    const attention = deriveAttention(session, live, clearedSig)
    const isRunning = !attention && (session.status === 'running' || (live !== undefined && live.phase !== 'idle'))

    if (!attention && !isRunning) {
      const signature = activityNotificationSignature(session)
      if (signature && signatureCleared(signature, clearedSig, session.unread)) continue
    }

    if (normalized) {
      const hay = [
        session.title,
        session.preview ?? '',
        live?.currentTool?.name ?? '',
        live?.currentTool?.summary ?? '',
        live?.lastError ?? '',
        attention?.kind === 'question' ? attention.title : '',
      ].join(' ').toLowerCase()
      if (!hay.includes(normalized)) continue
    }

    const item: ActivityRowItem = { session, live, attention }
    if (attention?.kind === 'question' || attention?.kind === 'failed') {
      needsYou.push(item)
    } else if (isRunning) {
      running.push(item)
    } else if (attention?.kind === 'review') {
      readyToReview.push(item)
    } else {
      recent.push(item)
    }
  }

  needsYou.sort(compareNeedsYou)
  running.sort(compareRunning)
  readyToReview.sort((a, b) => compareUpdatedDesc(a.session, b.session))
  recent.sort((a, b) => compareUpdatedDesc(a.session, b.session))

  return { needsYou, running, readyToReview, recent }
}

export function isSessionQuiet(
  live: SessionLive | undefined,
  now: number,
  thresholdMs = SESSION_QUIET_THRESHOLD_MS,
): boolean {
  if (!live || live.phase === 'idle' || live.phase === 'tool') return false
  return now - live.lastEventAt > thresholdMs
}

export function formatQuietMinutes(live: SessionLive, now: number): string {
  const minutes = Math.max(1, Math.floor((now - live.lastEventAt) / 60_000))
  return `quiet ${minutes}m`
}

export function formatClockDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  const totalMinutes = Math.floor(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  if (hours > 0) {
    const minutes = String(totalMinutes % 60).padStart(2, '0')
    return `${hours}:${minutes}:${seconds}`
  }
  return `${totalMinutes}:${seconds}`
}

export function formatElapsedClock(startedAt: number, now: number): string {
  return formatClockDuration(Math.max(0, now - startedAt))
}

export function formatDeadlineCountdown(deadline: number, now: number): string {
  const remainingMs = Math.max(0, deadline - now)
  const totalSeconds = Math.ceil(remainingMs / 1_000)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  const minutes = Math.floor(totalSeconds / 60)
  return `${minutes}:${seconds}`
}
