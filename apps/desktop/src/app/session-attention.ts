import { transition } from 'xstate'
import type { SessionRecord, SessionStatus } from '@/types/api'
import { sessionStatusMachine, sessionStatusSnapshot, type SessionStatusState, type SessionStatusTrigger } from './sessionStatusMachine'
import { SESSION_RUN_TERMINAL_EVENT_TYPES, type SessionLive } from './sessionLiveMachine'

const BLOCKING_EXTENSION_UI_METHODS = new Set(['select', 'confirm', 'input', 'editor'])

export function sessionLifecycleChange(event: Record<string, unknown>): SessionStatusTrigger | undefined {
  const type = typeof event.type === 'string' ? event.type : ''
  if (type === 'extension_ui_request') {
    const method = event.method
    if (method === undefined || (typeof method === 'string' && BLOCKING_EXTENSION_UI_METHODS.has(method))) {
      return { type: 'ATTENTION_REQUIRED' }
    }
    return undefined
  }
  if (type === 'agent_start' || type === 'turn_start') return { type: 'AGENT_STARTED' }
  if (type === 'compaction_start') return { type: 'AGENT_STARTED' }
  if (type === 'compaction_end' && event.willRetry !== true && (event.reason === 'manual' || event.reason === 'requested')) return { type: 'COMPACTION_FINISHED' }
  // A provider auto-retry continues the turn that the preceding agent_end
  // seemed to finish; a failed auto_retry_end is the turn's real terminal.
  if (type === 'auto_retry_start') return { type: 'AGENT_STARTED' }
  if (type === 'auto_retry_end' && event.success !== true) return { type: 'TURN_FAILED' }
  if (SESSION_RUN_TERMINAL_EVENT_TYPES.has(type)) return type === 'agent_end' ? { type: 'TURN_ENDED' } : { type: 'TURN_FAILED' }
  if (type === 'runtime_exit') return { type: 'RUNTIME_EXITED', expected: event.expected === true }
  return undefined
}

function nextUpdatedAt(previous: string, now: number): string {
  const previousTime = Date.parse(previous)
  return new Date(Math.max(now, Number.isFinite(previousTime) ? previousTime + 1 : now)).toISOString()
}

/**
 * The only writer of renderer session status. A trigger the machine does not
 * handle in the current status (e.g. a runtime exit on an idle session, or a
 * question resolution on a running one) returns the session unchanged.
 */
export function applySessionStatusEvent(
  session: SessionRecord,
  trigger: SessionStatusTrigger,
  visible = false,
  now = Date.now(),
): SessionRecord {
  const before = sessionStatusSnapshot(session)
  const [after] = transition(sessionStatusMachine, before, { ...trigger, visible })
  if (after.context.revision === before.context.revision) return session
  const eventRevision = after.context.revision
  return {
    ...session,
    status: after.value as SessionStatusState,
    updatedAt: nextUpdatedAt(session.updatedAt, now),
    eventRevision,
    statusEventRevision: eventRevision,
    unread: after.context.unread,
  }
}

export function applySessionLifecycleEvent(
  session: SessionRecord,
  event: Record<string, unknown>,
  visible: boolean,
  now = Date.now(),
): SessionRecord {
  const trigger = sessionLifecycleChange(event)
  return trigger ? applySessionStatusEvent(session, trigger, visible, now) : session
}

/**
 * The single running predicate. A pending question or waiting status is never running, even when the
 * live phase is still non-idle; a live phase otherwise counts as running whatever the stored status says.
 */
export function isSessionRunning(session: { status: SessionStatus } | undefined, live?: SessionLive): boolean {
  if (live?.pendingQuestion || session?.status === 'waiting') return false
  return session?.status === 'running' || (live !== undefined && live.phase !== 'idle')
}

export function isSessionWaiting(session: { status: SessionStatus } | undefined): boolean {
  return session?.status === 'waiting'
}

/** True when the renderer, not the catalog, authored the current status. */
export function hasRendererStatusProvenance(session: SessionRecord): boolean {
  return typeof session.statusEventRevision === 'number'
    && session.statusEventRevision === session.eventRevision
    && session.status !== 'idle'
    && session.status !== 'unknown'
}

export function sessionAttentionSignature(session: SessionRecord): string | undefined {
  const revision = session.eventRevision ?? session.updatedAt
  if (session.status === 'waiting') return `waiting:${revision}`
  if (session.status === 'failed') return `failed:${revision}`
  if (session.status === 'complete' && session.unread) return `complete:${revision}`
  return session.unread ? `unread:${revision}` : undefined
}

export function sessionCompanionNotificationSignature(session: SessionRecord): string | undefined {
  const revision = session.eventRevision ?? session.updatedAt
  if (session.status === 'waiting' || session.status === 'failed') return `${session.status}:${revision}`
  if (session.status === 'complete' && (session.unread || typeof session.eventRevision === 'number')) return `complete:${revision}`
  return session.unread ? `unread:${revision}` : undefined
}

export function signatureCleared(signature: string | undefined, clearedSignature: string | undefined, unread = false): boolean {
  if (!signature || !clearedSignature) return false
  if (signature === clearedSignature) return true
  const separator = signature.indexOf(':')
  const clearedSeparator = clearedSignature.indexOf(':')
  if (separator < 0 || clearedSeparator < 0 || signature.slice(separator + 1) !== clearedSignature.slice(clearedSeparator + 1)) return false
  const status = signature.slice(0, separator)
  return status === 'idle' || status === 'complete' && !unread
}

export function activityNotificationSignature(session: SessionRecord): string | undefined {
  if (session.archived || session.status === 'running') return undefined
  return `${session.status}:${session.eventRevision ?? session.updatedAt}`
}

function parseClearedSignatures(raw: string | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const result: Record<string, string> = {}
    for (const [id, signature] of Object.entries(parsed)) {
      if (typeof signature === 'string') result[id] = signature
    }
    return result
  } catch { return {} }
}

export function readClearedAttention(storedValue?: string | null): Record<string, string> {
  const raw = storedValue !== undefined
    ? storedValue
    : typeof window === 'undefined' ? null : window.localStorage.getItem('prime-work.cleared-session-attention')
  return parseClearedSignatures(raw)
}

export function readClearedActivity(storedValue?: string | null): Record<string, string> {
  const raw = storedValue !== undefined
    ? storedValue
    : typeof window === 'undefined' ? null : window.localStorage.getItem('prime-work.cleared-activity')
  return parseClearedSignatures(raw)
}
