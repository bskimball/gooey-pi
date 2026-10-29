import { describe, expect, it } from 'vitest'
import { activityNotificationSignature, applySessionLifecycleEvent, readClearedActivity, readClearedAttention, sessionAttentionSignature, sessionCompanionNotificationSignature, sessionShowsCompanionNotification, signatureCleared } from '../../apps/desktop/src/app/session-attention'
import {
  buildActivitySections,
  deriveAttention,
  formatClockDuration,
  formatDeadlineCountdown,
  formatElapsedClock,
  formatQuietMinutes,
  isSessionQuiet,
  questionFromPendingExtensionUi,
  reduceSessionLive,
  seedSessionLiveFromRuntimes,
  SESSION_LIVE_HEARTBEAT_THROTTLE_MS,
  SESSION_QUIET_THRESHOLD_MS,
  summarizeToolArgs,
  syncSessionLivePendingQuestions,
  type SessionLiveMap,
} from '../../apps/desktop/src/app/session-live'
import type { PendingExtensionUi } from '../../apps/desktop/src/hooks/useExtensionUi'
import { ASK_USER_TIMEOUT_MS } from '../../apps/desktop/src/lib/extension-ui'
import { mergeSessionCatalog } from '../../apps/desktop/src/hooks/useBootstrap'
import type { RuntimeInfo, SessionRecord } from '../../apps/desktop/src/types/api'

const session = (): SessionRecord => ({
  id: 'session',
  harness: 'pi',
  filePath: '/sessions/session.jsonl',
  projectPath: '/project',
  title: 'Session',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  status: 'idle',
  depth: 0,
})

const catalogSnapshot = (record: SessionRecord, status = record.status): SessionRecord => {
  const { eventRevision: _eventRevision, statusEventRevision: _statusEventRevision, ...snapshot } = record
  return { ...snapshot, status }
}

describe('session lifecycle attention', () => {
  it('does not mark a visible completion unread', () => {
    const completed = applySessionLifecycleEvent(session(), { type: 'agent_end' }, true, Date.parse('2025-01-01T00:00:01.000Z'))
    expect(completed).toMatchObject({ status: 'complete', unread: false, eventRevision: 1, statusEventRevision: 1 })
    expect(completed.updatedAt).toBe('2025-01-01T00:00:01.000Z')
    expect(sessionAttentionSignature(completed)).toBeUndefined()
    expect(sessionShowsCompanionNotification(completed)).toBe(true)
    expect(sessionShowsCompanionNotification(completed, sessionCompanionNotificationSignature(completed))).toBe(false)
  })

  it('gives repeated background waits and completions distinct attention revisions', () => {
    const waiting = applySessionLifecycleEvent(session(), { type: 'extension_ui_request' }, false, 1)
    const waitingAgain = applySessionLifecycleEvent(waiting, { type: 'extension_ui_request' }, false, 1)
    const completed = applySessionLifecycleEvent(waitingAgain, { type: 'agent_end' }, false, 1)
    const completedAgain = applySessionLifecycleEvent(completed, { type: 'agent_end' }, false, 1)

    expect(sessionAttentionSignature(waiting)).toBe('waiting:1')
    expect(sessionAttentionSignature(waitingAgain)).toBe('waiting:2')
    expect(sessionAttentionSignature(completed)).toBe('complete:3')
    expect(sessionAttentionSignature(completedAgain)).toBe('complete:4')
    expect(Date.parse(waitingAgain.updatedAt)).toBeGreaterThan(Date.parse(waiting.updatedAt))
  })

  it('advances lifecycle revision without changing attention for failures', () => {
    const failed = applySessionLifecycleEvent(session(), { type: 'transport_error' }, false, 1)
    expect(failed).toMatchObject({ status: 'failed', eventRevision: 1 })
    expect(sessionAttentionSignature(failed)).toBe('failed:1')
    expect(sessionShowsCompanionNotification(failed)).toBe(true)
  })

  it('shows the companion badge only for new terminal turns or attention states', () => {
    expect(sessionShowsCompanionNotification(session())).toBe(false)
    expect(sessionShowsCompanionNotification({ ...session(), status: 'complete' })).toBe(false)
    expect(sessionShowsCompanionNotification({ ...session(), status: 'complete', unread: true })).toBe(true)
    expect(sessionShowsCompanionNotification({ ...session(), status: 'waiting' })).toBe(true)
    expect(sessionShowsCompanionNotification({ ...session(), status: 'waiting' }, `waiting:${session().updatedAt}`)).toBe(false)
  })

  it('keeps de-escalated notifications cleared without suppressing same-revision escalations', () => {
    const cleared = 'waiting:7'
    expect(signatureCleared('idle:7', cleared)).toBe(true)
    expect(signatureCleared('complete:7', cleared)).toBe(true)
    expect(signatureCleared('complete:7', cleared, true)).toBe(false)
    expect(signatureCleared('waiting:7', cleared)).toBe(true)
    expect(signatureCleared('waiting:7', 'failed:7')).toBe(false)
    expect(signatureCleared('failed:7', cleared)).toBe(false)
    expect(signatureCleared('waiting:8', cleared)).toBe(false)
  })

  it('resurfaces same-revision waiting and failed companion notifications', () => {
    const cleared = 'idle:7'
    expect(sessionShowsCompanionNotification({ ...session(), status: 'waiting', eventRevision: 7 }, cleared)).toBe(true)
    expect(sessionShowsCompanionNotification({ ...session(), status: 'failed', eventRevision: 7 }, cleared)).toBe(true)
  })

  it('makes settled activity dismissible until a new revision and keeps running work visible', () => {
    const completed = { ...session(), status: 'complete' as const, eventRevision: 3 }
    expect(activityNotificationSignature(completed)).toBe('complete:3')
    expect(activityNotificationSignature({ ...completed, eventRevision: 4 })).toBe('complete:4')
    expect(activityNotificationSignature({ ...completed, status: 'running' })).toBeUndefined()
    expect(activityNotificationSignature({ ...completed, archived: true })).toBeUndefined()
  })

  it('ignores desktop rate-limit drops: the agent is still running', () => {
    const running = applySessionLifecycleEvent(session(), { type: 'agent_start' }, true, 1)
    const afterLimit = applySessionLifecycleEvent(running, { type: 'transport_limit', kind: 'count' }, true, 2)
    expect(afterLimit).toBe(running)
  })

  it('finishes a manual compaction when no continuation is scheduled', () => {
    const running = applySessionLifecycleEvent(session(), { type: 'compaction_start', reason: 'manual' }, true, 1)
    const completed = applySessionLifecycleEvent(running, { type: 'compaction_end', reason: 'manual', willRetry: false }, true, 2)
    expect(running.status).toBe('running')
    expect(completed).toMatchObject({ status: 'complete', unread: false, eventRevision: 2 })
  })
})

describe('catalog merges over live session state', () => {
  it.each([
    ['running', { type: 'agent_start' }],
    ['waiting', { type: 'extension_ui_request' }],
    ['complete', { type: 'agent_end' }],
    ['failed', { type: 'transport_error' }],
  ] as const)('does not downgrade renderer-owned %s state with a stale idle catalog record', (expectedStatus, event) => {
    const live = applySessionLifecycleEvent(session(), event, false, 1)
    const diskRecord = catalogSnapshot(live, 'idle')

    const [merged] = mergeSessionCatalog([live], [diskRecord], undefined, new Map(), 0)

    expect(merged.status).toBe(expectedStatus)
    expect(merged.eventRevision).toBe(1)
    expect(merged.statusEventRevision).toBe(1)
    expect(merged.unread).toBe(live.unread)
  })

  it('keeps catalog idle authoritative without a renderer revision', () => {
    const restarted: SessionRecord = { ...session(), status: 'complete' }
    const [idleAfterRestart] = mergeSessionCatalog(
      [restarted],
      [{ ...restarted, status: 'idle' }],
      undefined,
      new Map(),
      0,
    )
    expect(idleAfterRestart.status).toBe('idle')

    const revisionWithoutStatusOwnership: SessionRecord = { ...restarted, eventRevision: 3 }
    const [externalIdle] = mergeSessionCatalog(
      [revisionWithoutStatusOwnership],
      [catalogSnapshot(revisionWithoutStatusOwnership, 'idle')],
      undefined,
      new Map(),
      0,
    )
    expect(externalIdle.status).toBe('idle')
  })

  it('does not resurrect cleared attention when live metadata settles a fallback record', () => {
    const fallback: SessionRecord = {
      ...session(),
      status: 'waiting',
      updatedAt: '2025-01-01T00:00:01.000Z',
    }
    const [fromFallback] = mergeSessionCatalog([], [fallback], undefined, new Map(), 0)
    const cleared = { ...fromFallback, unread: false }
    const live: SessionRecord = { ...fallback, status: 'idle', unread: false }

    const [merged] = mergeSessionCatalog([cleared], [live], undefined, new Map(), 0)

    expect(merged).toMatchObject({ status: 'idle', unread: false })
    expect(sessionAttentionSignature(merged)).toBeUndefined()
  })

  it.each(['unknown', 'running', 'waiting', 'failed'] as const)(
    'keeps an authoritative non-idle catalog transition to %s',
    (catalogStatus) => {
      const rendererComplete = applySessionLifecycleEvent(session(), { type: 'agent_end' }, false, 1)
      const [merged] = mergeSessionCatalog(
        [rendererComplete],
        [catalogSnapshot(rendererComplete, catalogStatus)],
        undefined,
        new Map(),
        0,
      )
      expect(merged.status).toBe(catalogStatus)
      expect(merged.eventRevision).toBe(1)
      expect(merged.statusEventRevision).toBeUndefined()
    },
  )

  it('keeps renderer status provenance when the catalog corroborates the same status', () => {
    const rendererComplete = applySessionLifecycleEvent(session(), { type: 'agent_end' }, false, 1)
    const [merged] = mergeSessionCatalog([rendererComplete], [catalogSnapshot(rendererComplete)], undefined, new Map(), 0)

    expect(merged).toBe(rendererComplete)
    expect(merged).toMatchObject({ status: 'complete', eventRevision: 1, statusEventRevision: 1 })
  })

  it('accepts idle after an authoritative catalog transition takes status ownership', () => {
    const rendererComplete = applySessionLifecycleEvent(session(), { type: 'agent_end' }, false, 1)
    const [catalogRunning] = mergeSessionCatalog(
      [rendererComplete],
      [catalogSnapshot(rendererComplete, 'running')],
      undefined,
      new Map(),
      0,
    )
    const [catalogIdle] = mergeSessionCatalog(
      [catalogRunning],
      [catalogSnapshot(catalogRunning, 'idle')],
      undefined,
      new Map(),
      0,
    )
    const rendererFailed = applySessionLifecycleEvent(catalogIdle, { type: 'transport_error' }, false, 2)

    expect(catalogRunning).toMatchObject({ status: 'running', eventRevision: 1, statusEventRevision: undefined })
    expect(catalogIdle).toMatchObject({ status: 'idle', eventRevision: 1, statusEventRevision: undefined })
    expect(rendererFailed).toMatchObject({ status: 'failed', eventRevision: 2, statusEventRevision: 2 })
  })

  it('preserves identity for a status-only stale snapshot but still applies real catalog changes and revisions', () => {
    const live = applySessionLifecycleEvent(session(), { type: 'agent_end' }, false, 1)
    const staleIdle = catalogSnapshot(live, 'idle')

    const [unchanged] = mergeSessionCatalog([live], [staleIdle], undefined, new Map(), 7)
    expect(unchanged).toBe(live)

    const [archived] = mergeSessionCatalog(
      [live],
      [{ ...staleIdle, archived: true }],
      live.filePath,
      new Map([[live.filePath, 8]]),
      7,
    )
    expect(archived).toMatchObject({
      status: 'complete',
      archived: true,
      unread: false,
      eventRevision: 1,
      statusEventRevision: 1,
      syncRevision: 8,
    })
    expect(archived).not.toBe(live)
  })

  it('lets the next renderer lifecycle event advance normally after a stale idle merge', () => {
    const completed = applySessionLifecycleEvent(session(), { type: 'agent_end' }, false, 1)
    const [merged] = mergeSessionCatalog(
      [completed],
      [catalogSnapshot(completed, 'idle')],
      undefined,
      new Map(),
      0,
    )

    const running = applySessionLifecycleEvent(merged, { type: 'agent_start' }, false, 2)
    expect(running).toMatchObject({ status: 'running', eventRevision: 2, statusEventRevision: 2, unread: false })
  })

  it('keeps a waiting badge while its extension-UI request is still open', () => {
    const waiting = applySessionLifecycleEvent(session(), { type: 'extension_ui_request' }, false, 1)
    expect(sessionAttentionSignature(waiting)).toBe('waiting:1')

    const diskRecord: SessionRecord = { ...session(), status: 'running', updatedAt: '2025-01-01T00:00:05.000Z' }
    const [merged] = mergeSessionCatalog([waiting], [diskRecord], undefined, new Map(), 0, () => true)
    expect(merged.status).toBe('waiting')
    expect(merged.eventRevision).toBe(1)
    expect(sessionAttentionSignature(merged)).toBe('waiting:1')

    const [settled] = mergeSessionCatalog([waiting], [diskRecord], undefined, new Map(), 0, () => false)
    expect(settled.status).toBe('running')
  })

  it('keeps historical completions read but marks a new running-to-complete transition unread', () => {
    const running: SessionRecord = { ...session(), status: 'running', unread: false }
    const complete: SessionRecord = { ...running, status: 'complete', updatedAt: '2025-01-01T00:00:01.000Z' }

    const [historical] = mergeSessionCatalog([], [complete], undefined, new Map(), 0)
    const [transitioned] = mergeSessionCatalog([running], [complete], undefined, new Map(), 0)

    expect(historical.unread).toBe(false)
    expect(sessionAttentionSignature(historical)).toBeUndefined()
    expect(transitioned.unread).toBe(true)
  })

  it('does not mark a same-revision terminal transition unread', () => {
    const idle = session()
    const [sameRevision] = mergeSessionCatalog(
      [idle],
      [{ ...idle, status: 'complete' }],
      undefined,
      new Map(),
      0,
    )
    const [nextRevision] = mergeSessionCatalog(
      [idle],
      [{ ...idle, status: 'complete', updatedAt: '2025-01-01T00:00:01.000Z' }],
      undefined,
      new Map(),
      0,
    )

    expect(sameRevision.unread).toBeUndefined()
    expect(nextRevision.unread).toBe(true)
  })

  it('keeps a newer optimistic lastUserMessageAt over the disk value', () => {
    const live: SessionRecord = { ...session(), lastUserMessageAt: '2025-01-01T00:10:00.000Z' }
    const diskRecord: SessionRecord = { ...session(), lastUserMessageAt: '2025-01-01T00:00:00.000Z' }
    const [merged] = mergeSessionCatalog([live], [diskRecord], undefined, new Map(), 0)
    expect(merged.lastUserMessageAt).toBe('2025-01-01T00:10:00.000Z')
  })

  it('bumps the catalog revision only for records that actually changed', () => {
    const unchanged: SessionRecord = { ...session(), id: 'same', filePath: '/sessions/same.jsonl', syncRevision: 3 }
    const moved: SessionRecord = { ...session(), id: 'moved', filePath: '/sessions/moved.jsonl', syncRevision: 3 }
    const movedOnDisk: SessionRecord = { ...moved, updatedAt: '2025-01-02T00:00:00.000Z', syncRevision: undefined }
    const [mergedSame, mergedMoved] = mergeSessionCatalog(
      [unchanged, moved],
      [{ ...unchanged, syncRevision: undefined }, movedOnDisk],
      undefined,
      new Map(),
      7,
    )
    expect(mergedSame.syncRevision).toBe(3)
    expect(mergedMoved.syncRevision).toBe(7)
  })
})

describe('cleared-attention store', () => {
  it('guards malformed persisted values, including the null literal', () => {
    expect(readClearedAttention('null')).toEqual({})
    expect(readClearedAttention('[]')).toEqual({})
    expect(readClearedAttention('"waiting:1"')).toEqual({})
    expect(readClearedAttention('not json')).toEqual({})
    expect(readClearedAttention(null)).toEqual({})
    expect(readClearedAttention('{"a":"waiting:1","b":7}')).toEqual({ a: 'waiting:1' })
  })

  it('applies the same malformed-value guards to cleared activity', () => {
    expect(readClearedActivity('null')).toEqual({})
    expect(readClearedActivity('[]')).toEqual({})
    expect(readClearedActivity('not json')).toEqual({})
    expect(readClearedActivity('{"session":"complete:3","bad":false}')).toEqual({ session: 'complete:3' })
  })
})

describe('session live reducer and sectioning', () => {
  it('tracks live phases, tools, usage, errors, and throttles token delta floods', () => {
    const file = '/sessions/live.jsonl'
    let state: SessionLiveMap = {}
    state = reduceSessionLive(state, { runtimeId: 'rt-1', sessionFile: file, event: { type: 'agent_start' }, now: 1_000 })
    expect(state[file]).toMatchObject({ runtimeId: 'rt-1', phase: 'thinking', runStartedAt: 1_000, lastEventAt: 1_000 })

    const afterDelta = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'tok' } },
      now: 1_050,
    })
    expect(afterDelta).toBe(state)

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'npm test' } },
      now: 2_000,
    })
    expect(state[file]).toMatchObject({
      phase: 'tool',
      currentTool: { id: 't1', name: 'bash', summary: 'npm test', startedAt: 2_000 },
      runStartedAt: 1_000,
    })

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash' },
      now: 3_000,
    })
    expect(state[file]?.phase).toBe('thinking')
    expect(state[file]?.currentTool).toBeUndefined()

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'context_usage', contextUsage: { tokens: 12_000, contextWindow: 100_000, percent: 12 } },
      now: 3_100,
    })
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'session_usage', sessionUsage: { cost: 0.25 } },
      now: 3_200,
    })
    expect(state[file]?.contextUsage?.percent).toBe(12)
    expect(state[file]?.sessionUsage?.cost).toBe(0.25)

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'auto_retry_end', success: false, finalError: 'Rate limit exceeded' },
      now: 4_000,
    })
    expect(state[file]).toMatchObject({ phase: 'idle', lastError: 'Rate limit exceeded' })
    expect(state[file]?.runStartedAt).toBeUndefined()

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'runtime_exit', expected: true },
      now: 5_000,
    })
    expect(state[file]).toBeUndefined()
  })

  it('orders Needs You (soonest deadline question then newest failed), Running (runStartedAt asc), Ready to Review, and Recent', () => {
    const qLate: SessionRecord = { ...session(), id: 'q-late', filePath: '/q-late.jsonl', status: 'waiting', updatedAt: '2026-01-03T00:00:00.000Z' }
    const qSoon: SessionRecord = { ...session(), id: 'q-soon', filePath: '/q-soon.jsonl', status: 'waiting', updatedAt: '2026-01-01T00:00:00.000Z' }
    const failedOld: SessionRecord = { ...session(), id: 'f-old', filePath: '/f-old.jsonl', status: 'failed', updatedAt: '2026-01-01T00:00:00.000Z' }
    const failedNew: SessionRecord = { ...session(), id: 'f-new', filePath: '/f-new.jsonl', status: 'failed', updatedAt: '2026-01-04T00:00:00.000Z' }
    const runFirst: SessionRecord = { ...session(), id: 'r-1', filePath: '/r-1.jsonl', status: 'running', updatedAt: '2026-01-05T00:00:00.000Z' }
    const runSecond: SessionRecord = { ...session(), id: 'r-2', filePath: '/r-2.jsonl', status: 'running', updatedAt: '2026-01-01T00:00:00.000Z' }
    const reviewItem: SessionRecord = { ...session(), id: 'rev-1', filePath: '/rev-1.jsonl', status: 'complete', unread: true, updatedAt: '2026-01-02T00:00:00.000Z' }
    const recentItem: SessionRecord = { ...session(), id: 'rec-1', filePath: '/rec-1.jsonl', status: 'complete', unread: false, updatedAt: '2026-01-02T00:00:00.000Z' }

    const live: SessionLiveMap = {
      '/q-late.jsonl': { runtimeId: 'rt-ql', phase: 'thinking', lastEventAt: 1, pendingQuestion: { id: '1', title: 'Late?', method: 'confirm', deadline: 5_000, runtimeId: 'rt-ql' } },
      '/q-soon.jsonl': { runtimeId: 'rt-qs', phase: 'thinking', lastEventAt: 1, pendingQuestion: { id: '2', title: 'Soon?', method: 'confirm', deadline: 2_000, runtimeId: 'rt-qs' } },
      '/r-1.jsonl': { runtimeId: 'rt-r1', phase: 'thinking', runStartedAt: 100, lastEventAt: 900 },
      '/r-2.jsonl': { runtimeId: 'rt-r2', phase: 'tool', runStartedAt: 200, lastEventAt: 300 },
    }

    expect(deriveAttention(qSoon, live['/q-soon.jsonl'])).toEqual({
      kind: 'question',
      title: 'Soon?',
      method: 'confirm',
      deadline: 2_000,
      runtimeId: 'rt-qs',
    })

    const sections = buildActivitySections(
      [failedOld, qLate, runSecond, recentItem, reviewItem, runFirst, failedNew, qSoon],
      live,
    )
    expect(sections.needsYou.map((item) => item.session.id)).toEqual(['q-soon', 'q-late', 'f-new', 'f-old'])
    expect(sections.running.map((item) => item.session.id)).toEqual(['r-1', 'r-2'])
    expect(sections.readyToReview.map((item) => item.session.id)).toEqual(['rev-1'])
    expect(sections.recent.map((item) => item.session.id)).toEqual(['rec-1'])
  })

  it('summarizes tool arguments across string, preferred keys, paths, and questions', () => {
    expect(summarizeToolArgs('   npm   run\nbuild  ')).toBe('npm run build')
    expect(summarizeToolArgs('   ')).toBeUndefined()
    expect(summarizeToolArgs(null)).toBeUndefined()
    expect(summarizeToolArgs(['array'])).toBeUndefined()
    expect(summarizeToolArgs({ command: 'git status' })).toBe('git status')
    expect(summarizeToolArgs({ question: '  which branch? ' })).toBe('which branch?')
    expect(summarizeToolArgs({ query: 'session-live' })).toBe('session-live')
    expect(summarizeToolArgs({ pattern: 'TODO' })).toBe('TODO')
    expect(summarizeToolArgs({ url: 'https://example.com' })).toBe('https://example.com')
    expect(summarizeToolArgs({ path: 'apps/desktop/src/app/session-live.ts' })).toBe('apps/desktop/src/app/session-live.ts')
    expect(summarizeToolArgs({ operation: 'status' })).toBe('status')
    expect(summarizeToolArgs({ id: 'bg_1' })).toBe('bg_1')
    expect(summarizeToolArgs({ action: 'create' })).toBe('create')
    expect(summarizeToolArgs({ code: 'return 42' })).toBe('return 42')
    expect(summarizeToolArgs({ cwd: '/workspace/app' })).toBe('/workspace/app')
    expect(summarizeToolArgs({ paths: ['src/a.ts'] })).toBe('src/a.ts')
    expect(summarizeToolArgs({ paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'] })).toBe('src/a.ts (+2)')
    expect(summarizeToolArgs({ paths: ['   '] })).toBeUndefined()
    expect(summarizeToolArgs({ questions: [{ question: 'Deploy to staging?' }] })).toBe('Deploy to staging?')
    expect(summarizeToolArgs({ questions: [null] })).toBeUndefined()
    expect(summarizeToolArgs({ questions: [{ question: 123 }] })).toBeUndefined()
    expect(summarizeToolArgs({ unrelated: 42 })).toBeUndefined()
  })

  it('converts pending extension UI requests into SessionLiveQuestion values', () => {
    const questionnaireMulti: PendingExtensionUi = {
      runtimeId: 'rt-q',
      deadline: 9_000,
      request: {
        method: 'questionnaire',
        id: 'grp-1',
        title: 'Fallback Title',
        total: 3,
        complete: false,
        questions: [{ id: 'q1', title: 'Target environment?', options: ['staging', 'prod'], index: 0 }],
      },
    }
    expect(questionFromPendingExtensionUi(questionnaireMulti)).toEqual({
      id: 'grp-1',
      title: 'Target environment? · 3 questions',
      method: 'questionnaire',
      options: ['staging', 'prod'],
      deadline: 9_000,
      runtimeId: 'rt-q',
    })

    const questionnaireSingleEmpty: PendingExtensionUi = {
      runtimeId: 'rt-q2',
      request: {
        method: 'questionnaire',
        id: 'grp-2',
        title: 'Questionnaire Title',
        total: 1,
        complete: true,
        questions: [],
      },
    }
    expect(questionFromPendingExtensionUi(questionnaireSingleEmpty)).toEqual({
      id: 'grp-2',
      title: 'Questionnaire Title',
      method: 'questionnaire',
      runtimeId: 'rt-q2',
    })

    const questionnaireSingleWithQuestion: PendingExtensionUi = {
      runtimeId: 'rt-q3',
      request: {
        method: 'questionnaire',
        id: 'grp-3',
        title: 'Fallback',
        total: 1,
        complete: true,
        questions: [{ id: 'q1', title: 'Only question?', options: ['yes'], index: 0 }],
      },
    }
    expect(questionFromPendingExtensionUi(questionnaireSingleWithQuestion)).toEqual({
      id: 'grp-3',
      title: 'Only question?',
      method: 'questionnaire',
      options: ['yes'],
      runtimeId: 'rt-q3',
    })

    const selectPending: PendingExtensionUi = {
      runtimeId: 'rt-sel',
      deadline: 5_000,
      request: {
        method: 'select',
        id: 'sel-1',
        title: 'Pick one',
        options: ['a', 'b'],
      },
    }
    expect(questionFromPendingExtensionUi(selectPending)).toEqual({
      id: 'sel-1',
      title: 'Pick one',
      method: 'select',
      options: ['a', 'b'],
      deadline: 5_000,
      runtimeId: 'rt-sel',
    })

    const confirmPending: PendingExtensionUi = {
      runtimeId: 'rt-conf',
      request: {
        method: 'confirm',
        id: 'conf-1',
        title: 'Proceed?',
        message: 'Are you sure?',
      },
    }
    expect(questionFromPendingExtensionUi(confirmPending)).toEqual({
      id: 'conf-1',
      title: 'Proceed?',
      method: 'confirm',
      runtimeId: 'rt-conf',
    })
  })

  it('seeds SessionLive from RuntimeInfo snapshots and preserves identity when unchanged', () => {
    const fileA = '/sessions/a.jsonl'
    const fileB = '/sessions/b.jsonl'
    const initial: SessionLiveMap = {
      [fileA]: {
        runtimeId: 'rt-a',
        phase: 'tool',
        currentTool: { id: 't1', name: 'bash', summary: 'ls', startedAt: 500 },
        runStartedAt: 400,
        lastEventAt: 600,
        lastError: 'prior error',
        pendingQuestion: { id: 'q1', title: 'Continue?', method: 'confirm', runtimeId: 'rt-a' },
      },
    }

    const runtimes: RuntimeInfo[] = [
      { runtimeId: 'rt-no-session', harness: 'pi', cwd: '/project', isStreaming: false },
      {
        runtimeId: 'rt-a',
        harness: 'pi',
        cwd: '/project',
        sessionFile: fileA,
        isStreaming: true,
        contextUsage: { tokens: 500, contextWindow: 10_000, percent: 5 },
        sessionUsage: {
          cost: 0.1,
          tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
        },
        sessionActions: { queuedCount: 2, steering: ['a'], followUps: ['b'] },
      },
      {
        runtimeId: 'rt-b',
        harness: 'pi',
        cwd: '/project',
        sessionFile: fileB,
        isStreaming: false,
        isCompacting: true,
      },
    ]

    const seeded = seedSessionLiveFromRuntimes(initial, runtimes, 1_000)
    expect(seeded[fileA]).toEqual({
      runtimeId: 'rt-a',
      phase: 'tool',
      currentTool: { id: 't1', name: 'bash', summary: 'ls', startedAt: 500 },
      runStartedAt: 400,
      lastEventAt: 600,
      contextUsage: { tokens: 500, contextWindow: 10_000, percent: 5 },
      sessionUsage: {
        cost: 0.1,
        tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
      },
      queuedCount: 2,
      lastError: 'prior error',
      pendingQuestion: { id: 'q1', title: 'Continue?', method: 'confirm', runtimeId: 'rt-a' },
    })
    expect(seeded[fileB]).toEqual({
      runtimeId: 'rt-b',
      phase: 'compacting',
      runStartedAt: 1_000,
      lastEventAt: 1_000,
    })

    // Calling again with identical runtime snapshots returns the exact same map reference
    const unchanged = seedSessionLiveFromRuntimes(seeded, runtimes, 2_000)
    expect(unchanged).toBe(seeded)

    // Idle transition clears runStartedAt and currentTool while streaming from idle enters thinking
    const idleAndStreaming: RuntimeInfo[] = [
      { runtimeId: 'rt-a', harness: 'pi', cwd: '/project', sessionFile: fileA, isStreaming: false },
      { runtimeId: 'rt-b', harness: 'pi', cwd: '/project', sessionFile: fileB, isStreaming: false },
    ]
    const settled = seedSessionLiveFromRuntimes(seeded, idleAndStreaming, 3_000)
    expect(settled[fileA]?.phase).toBe('idle')
    expect(settled[fileA]?.runStartedAt).toBeUndefined()
    expect(settled[fileA]?.currentTool).toBeUndefined()

    const restarted = seedSessionLiveFromRuntimes(
      settled,
      [{ runtimeId: 'rt-b', harness: 'pi', cwd: '/project', sessionFile: fileB, isStreaming: true }],
      4_000,
    )
    expect(restarted[fileB]?.phase).toBe('thinking')
    expect(restarted[fileB]?.runStartedAt).toBe(4_000)
  })

  it('syncs pending extension UI questions across existing and newly discovered sessions', () => {
    const fileA = '/sessions/a.jsonl'
    const fileB = '/sessions/b.jsonl'
    const initial: SessionLiveMap = {
      [fileA]: {
        runtimeId: 'rt-a',
        phase: 'thinking',
        runStartedAt: 100,
        lastEventAt: 200,
      },
    }

    const pendingA: PendingExtensionUi = {
      runtimeId: 'rt-a',
      deadline: 5_000,
      request: { method: 'confirm', id: 'q-a', title: 'Confirm A?', message: 'Sure?' },
    }
    const pendingB: PendingExtensionUi = {
      runtimeId: 'rt-b',
      deadline: 6_000,
      request: { method: 'input', id: 'q-b', title: 'Input B?' },
    }
    const pendingOrphan: PendingExtensionUi = {
      runtimeId: 'rt-orphan',
      request: { method: 'confirm', id: 'q-o', title: 'Orphan?', message: 'No session' },
    }

    const pendingMap = new Map<string, PendingExtensionUi>([
      ['rt-a', pendingA],
      ['rt-b', pendingB],
      ['rt-orphan', pendingOrphan],
    ])
    const runtimeSessions = new Map<string, string>([
      ['rt-a', fileA],
      ['rt-b', fileB],
    ])

    const synced = syncSessionLivePendingQuestions(initial, pendingMap, runtimeSessions, 1_000)
    expect(synced[fileA]?.pendingQuestion).toEqual({
      id: 'q-a',
      title: 'Confirm A?',
      method: 'confirm',
      deadline: 5_000,
      runtimeId: 'rt-a',
    })
    expect(synced[fileB]).toEqual({
      runtimeId: 'rt-b',
      phase: 'thinking',
      runStartedAt: 1_000,
      lastEventAt: 1_000,
      pendingQuestion: {
        id: 'q-b',
        title: 'Input B?',
        method: 'input',
        deadline: 6_000,
        runtimeId: 'rt-b',
      },
    })

    // Syncing again with identical questions preserves state identity
    expect(syncSessionLivePendingQuestions(synced, pendingMap, runtimeSessions, 2_000)).toBe(synced)

    // Matching by sessionFile when live entry has a different runtimeId
    const reboundState: SessionLiveMap = {
      [fileA]: { ...initial[fileA]!, runtimeId: 'rt-old' },
    }
    const reboundSynced = syncSessionLivePendingQuestions(reboundState, pendingMap, runtimeSessions, 2_500)
    expect(reboundSynced[fileA]?.pendingQuestion?.id).toBe('q-a')

    // Clearing all pending questions removes pendingQuestion from entries
    const cleared = syncSessionLivePendingQuestions(synced, new Map(), runtimeSessions, 3_000)
    expect(cleared[fileA]?.pendingQuestion).toBeUndefined()
    expect(cleared[fileB]?.pendingQuestion).toBeUndefined()
  })

  it('covers remaining reduceSessionLive event branches, throttling, and unchanged returns', () => {
    const file = '/sessions/branch.jsonl'
    let state: SessionLiveMap = {}

    // Missing sessionFile on non-exit event is a no-op
    expect(reduceSessionLive(state, { runtimeId: 'rt-1', event: { type: 'agent_start' }, now: 100 })).toBe(state)

    // Unknown event type is a no-op
    state = reduceSessionLive(state, { runtimeId: 'rt-1', sessionFile: file, event: { type: 'unknown_event' }, now: 100 })
    expect(state).toEqual({})

    // turn_start from fresh session and agent_start when already running
    state = reduceSessionLive(state, { runtimeId: 'rt-1', sessionFile: file, event: { type: 'turn_start' }, now: 1_000 })
    expect(state[file]).toMatchObject({ phase: 'thinking', runStartedAt: 1_000 })
    state = reduceSessionLive(state, { runtimeId: 'rt-1', sessionFile: file, event: { type: 'agent_start' }, now: 1_500 })
    expect(state[file]?.runStartedAt).toBe(1_000)

    // message_update with toolcall_end sets phase to tool (including fallback tool name)
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: {
        type: 'message_update',
        delta: { type: 'toolcall_end', toolCall: { id: 'tc-1', name: '  read  ', arguments: { path: 'README.md' } } },
      },
      now: 2_000,
    })
    expect(state[file]).toMatchObject({
      phase: 'tool',
      currentTool: { id: 'tc-1', name: 'read', summary: 'README.md', startedAt: 2_000 },
    })

    // message_update with unnamed toolcall_end defaults to 'Tool'
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'toolcall_end', toolCall: {} },
      },
      now: 2_100,
    })
    expect(state[file]?.currentTool).toEqual({ id: undefined, name: 'Tool', startedAt: 2_100 })

    // Non-toolcall_end message_update clears currentTool and transitions back to thinking
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'message_update', delta: { type: 'text_delta', delta: 'hi' } },
      now: 2_200,
    })
    expect(state[file]?.phase).toBe('thinking')
    expect(state[file]?.currentTool).toBeUndefined()

    // Heartbeat after SESSION_LIVE_HEARTBEAT_THROTTLE_MS updates lastEventAt
    const afterWindow = 2_200 + SESSION_LIVE_HEARTBEAT_THROTTLE_MS
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'message_update', delta: { type: 'text_delta', delta: 'more' } },
      now: afterWindow,
    })
    expect(state[file]?.lastEventAt).toBe(afterWindow)

    // tool_execution_start with blank name defaults to 'Tool', followed by tool_execution_update throttling
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'tool_execution_start', toolName: '   ' },
      now: afterWindow + 100,
    })
    expect(state[file]?.currentTool).toEqual({ id: undefined, name: 'Tool', startedAt: afterWindow + 100 })

    // tool_execution_update within throttle window with same name and summary returns identical state
    const throttledToolUpdate = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'tool_execution_update' },
      now: afterWindow + 200,
    })
    expect(throttledToolUpdate).toBe(state)

    // tool_execution_update with new args updates summary while keeping startedAt
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'tool_execution_update', toolCallId: 'tc-2', toolName: 'bash', args: { command: 'echo ok' } },
      now: afterWindow + 300,
    })
    expect(state[file]?.currentTool).toEqual({
      id: 'tc-2',
      name: 'bash',
      summary: 'echo ok',
      startedAt: afterWindow + 100,
    })

    // compaction_start -> message_update during compaction stays 'compacting' -> compaction_end (willRetry true & false)
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'compaction_start' },
      now: afterWindow + 400,
    })
    expect(state[file]?.phase).toBe('compacting')
    expect(state[file]?.currentTool).toBeUndefined()

    const throttledCompactingDelta = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'message_update' },
      now: afterWindow + 500,
    })
    expect(throttledCompactingDelta).toBe(state)

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'compaction_end', willRetry: true },
      now: afterWindow + 600,
    })
    expect(state[file]?.phase).toBe('thinking')
    expect(state[file]?.runStartedAt).toBe(1_000)

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'compaction_end', willRetry: false },
      now: afterWindow + 700,
    })
    expect(state[file]?.phase).toBe('idle')
    expect(state[file]?.runStartedAt).toBeUndefined()

    // auto_retry_start and auto_retry_end (success: true)
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'auto_retry_start' },
      now: afterWindow + 800,
    })
    expect(state[file]?.phase).toBe('retrying')
    expect(state[file]?.runStartedAt).toBe(afterWindow + 800)

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'auto_retry_end', success: true },
      now: afterWindow + 900,
    })
    expect(state[file]?.phase).toBe('thinking')

    // message_end: non-error is ignored, assistant stopReason === 'error' sets lastError
    const beforeMsgEnd = state
    expect(
      reduceSessionLive(state, {
        runtimeId: 'rt-1',
        sessionFile: file,
        event: { type: 'message_end', message: { role: 'assistant', stopReason: 'end_turn' } },
        now: afterWindow + 950,
      }),
    ).toBe(beforeMsgEnd)

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: {
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'error', errorMessage: '  Overloaded\nprovider  ' },
      },
      now: afterWindow + 1_000,
    })
    expect(state[file]?.lastError).toBe('Overloaded provider')

    // error / extension_error / transport_error and preserving existing lastError when event has no message
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'extension_error', message: 'Extension crashed' },
      now: afterWindow + 1_100,
    })
    expect(state[file]).toMatchObject({ phase: 'idle', lastError: 'Extension crashed' })

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'transport_error' },
      now: afterWindow + 1_200,
    })
    expect(state[file]?.lastError).toBe('Extension crashed')

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'error', error: 'Fatal failure' },
      now: afterWindow + 1_300,
    })
    expect(state[file]?.lastError).toBe('Fatal failure')

    // agent_end transitions to idle and clears runStartedAt
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'agent_start' },
      now: afterWindow + 1_400,
    })
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'agent_end' },
      now: afterWindow + 1_500,
    })
    expect(state[file]?.phase).toBe('idle')
    expect(state[file]?.runStartedAt).toBeUndefined()

    // context_usage, session_usage, session_action_update: invalid and duplicate no-ops
    const beforeUsage = state
    expect(
      reduceSessionLive(state, {
        runtimeId: 'rt-1',
        sessionFile: file,
        event: { type: 'context_usage', contextUsage: 'bad' },
        now: afterWindow + 1_600,
      }),
    ).toBe(beforeUsage)

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'context_usage', contextUsage: { tokens: 100, contextWindow: 1_000, percent: 10 } },
      now: afterWindow + 1_600,
    })
    expect(
      reduceSessionLive(state, {
        runtimeId: 'rt-1',
        sessionFile: file,
        event: { type: 'context_usage', contextUsage: { tokens: 100, contextWindow: 1_000, percent: 10 } },
        now: afterWindow + 1_650,
      }),
    ).toBe(state)

    expect(
      reduceSessionLive(state, {
        runtimeId: 'rt-1',
        sessionFile: file,
        event: { type: 'session_usage', sessionUsage: 'bad' },
        now: afterWindow + 1_700,
      }),
    ).toBe(state)

    const tokenUsage = {
      cost: 0.5,
      tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, total: 165 },
    }
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: { type: 'session_usage', sessionUsage: tokenUsage },
      now: afterWindow + 1_700,
    })
    expect(
      reduceSessionLive(state, {
        runtimeId: 'rt-1',
        sessionFile: file,
        event: { type: 'session_usage', sessionUsage: { ...tokenUsage, tokens: { ...tokenUsage.tokens } } },
        now: afterWindow + 1_750,
      }),
    ).toBe(state)

    expect(
      reduceSessionLive(state, {
        runtimeId: 'rt-1',
        sessionFile: file,
        event: { type: 'session_action_update', actions: null },
        now: afterWindow + 1_800,
      }),
    ).toBe(state)

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: {
        type: 'session_action_update',
        actions: { queuedCount: 3, steering: ['s1'], followUps: ['f1', 'f2'] },
      },
      now: afterWindow + 1_800,
    })
    expect(state[file]?.queuedCount).toBe(3)
    expect(
      reduceSessionLive(state, {
        runtimeId: 'rt-1',
        sessionFile: file,
        event: {
          type: 'session_action_update',
          actions: { queuedCount: 3, steering: ['s1'], followUps: ['f1', 'f2'] },
        },
        now: afterWindow + 1_850,
      }),
    ).toBe(state)

    // extension_ui_request: invalid request ignored, questionnaire select group & regular select/confirm
    expect(
      reduceSessionLive(state, {
        runtimeId: 'rt-1',
        sessionFile: file,
        event: { type: 'extension_ui_request', method: 'unknown' },
        now: afterWindow + 1_900,
      }),
    ).toBe(state)

    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: {
        type: 'extension_ui_request',
        id: 'req-1',
        method: 'select',
        title: 'First question?',
        options: ['__prime_ask_user__grp1:0:2', 'Option A', 'Option B'],
      },
      now: 10_000,
    })
    expect(state[file]?.pendingQuestion).toEqual({
      id: 'grp1',
      title: 'First question? · 2 questions',
      method: 'questionnaire',
      options: ['Option A', 'Option B'],
      deadline: 10_000 + ASK_USER_TIMEOUT_MS,
      runtimeId: 'rt-1',
    })

    // Second question in same questionnaire group preserves original firstTitle and deadline
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: {
        type: 'extension_ui_request',
        id: 'req-2',
        method: 'select',
        title: 'Second question?',
        options: ['__prime_ask_user__grp1:1:2', 'Option C', 'Option D'],
      },
      now: 12_000,
    })
    expect(state[file]?.pendingQuestion).toEqual({
      id: 'grp1',
      title: 'First question? · 2 questions',
      method: 'questionnaire',
      options: ['Option C', 'Option D'],
      deadline: 10_000 + ASK_USER_TIMEOUT_MS,
      runtimeId: 'rt-1',
    })

    // Regular select request with custom timeout
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: {
        type: 'extension_ui_request',
        id: 'req-sel',
        method: 'select',
        title: 'Choose target',
        options: ['local', 'remote'],
        timeout: 30_000,
      },
      now: 20_000,
    })
    expect(state[file]?.pendingQuestion).toEqual({
      id: 'req-sel',
      title: 'Choose target',
      method: 'select',
      options: ['local', 'remote'],
      deadline: 50_000,
      runtimeId: 'rt-1',
    })

    // Editor request (no timeout property)
    state = reduceSessionLive(state, {
      runtimeId: 'rt-1',
      sessionFile: file,
      event: {
        type: 'extension_ui_request',
        id: 'req-ed',
        method: 'editor',
        title: 'Edit config',
      },
      now: 21_000,
    })
    expect(state[file]?.pendingQuestion).toEqual({
      id: 'req-ed',
      title: 'Edit config',
      method: 'editor',
      runtimeId: 'rt-1',
    })

    // runtime_exit without sessionFile removes all entries matching runtimeId
    const multiState: SessionLiveMap = {
      ...state,
      '/sessions/other.jsonl': { runtimeId: 'rt-2', phase: 'thinking', lastEventAt: 1_000 },
    }
    const afterUnknownExit = reduceSessionLive(multiState, {
      runtimeId: 'rt-missing',
      event: { type: 'runtime_exit' },
      now: 22_000,
    })
    expect(afterUnknownExit).toBe(multiState)

    const afterRuntimeExit = reduceSessionLive(multiState, {
      runtimeId: 'rt-1',
      event: { type: 'runtime_exit' },
      now: 22_000,
    })
    expect(afterRuntimeExit[file]).toBeUndefined()
    expect(afterRuntimeExit['/sessions/other.jsonl']).toBeDefined()
  })

  it('handles deriveAttention edge cases, cleared filtering, search queries, and time formatters', () => {
    const base = session()

    // Archived sessions never produce attention
    expect(deriveAttention({ ...base, archived: true, status: 'failed' })).toBeNull()

    // Waiting session without live pendingQuestion uses preview or fallback
    const waitingWithPreview: SessionRecord = { ...base, status: 'waiting', preview: 'Approve deployment', eventRevision: 2 }
    expect(deriveAttention(waitingWithPreview)).toEqual({
      kind: 'question',
      title: 'Approve deployment',
      method: 'wait',
      runtimeId: '',
    })
    expect(deriveAttention(waitingWithPreview, undefined, 'waiting:2')).toBeNull()

    const waitingNoPreview: SessionRecord = { ...base, status: 'waiting', preview: '' }
    expect(deriveAttention(waitingNoPreview)).toEqual({
      kind: 'question',
      title: 'Waiting for your input',
      method: 'wait',
      runtimeId: '',
    })

    // Failed session uses live.lastError or session.preview, and respects clearedSignature
    const failedSession: SessionRecord = { ...base, status: 'failed', preview: 'Preview error', eventRevision: 4 }
    expect(deriveAttention(failedSession, { runtimeId: 'rt-1', phase: 'idle', lastEventAt: 1, lastError: 'Live error' })).toEqual({
      kind: 'failed',
      error: 'Live error',
    })
    expect(deriveAttention(failedSession)).toEqual({
      kind: 'failed',
      error: 'Preview error',
    })
    expect(deriveAttention(failedSession, undefined, 'failed:4')).toBeNull()

    // Complete unread session respects clearedSignature
    const reviewSession: SessionRecord = { ...base, status: 'complete', unread: true, eventRevision: 5 }
    expect(deriveAttention(reviewSession)).toEqual({ kind: 'review' })
    expect(deriveAttention(reviewSession, undefined, 'complete:5')).toBeNull()

    // buildActivitySections skips archived and cleared recent sessions, and filters by search query
    const archivedSession: SessionRecord = { ...base, id: 'arch', filePath: '/arch.jsonl', archived: true }
    const clearedRecent: SessionRecord = { ...base, id: 'clr', filePath: '/clr.jsonl', status: 'complete', unread: false, eventRevision: 1 }
    const matchingToolSession: SessionRecord = {
      ...base,
      id: 'tool-match',
      filePath: '/tool.jsonl',
      title: 'Refactor UI',
      status: 'running',
      lastUserMessageAt: '2026-01-01T00:00:00.000Z',
    }
    const nonMatchingSession: SessionRecord = {
      ...base,
      id: 'no-match',
      filePath: '/nomatch.jsonl',
      title: 'Unrelated task',
      status: 'idle',
    }

    const liveMap: SessionLiveMap = {
      '/tool.jsonl': {
        runtimeId: 'rt-t',
        phase: 'tool',
        currentTool: { name: 'ffgrep', summary: 'needle_token', startedAt: 10 },
        lastEventAt: 20,
      },
    }

    const filtered = buildActivitySections(
      [archivedSession, clearedRecent, matchingToolSession, nonMatchingSession],
      liveMap,
      { clr: 'complete:1' },
      '  NEEDLE_TOKEN ',
    )
    expect(filtered.running.map((item) => item.session.id)).toEqual(['tool-match'])
    expect(filtered.recent).toEqual([])

    // Multiple items in readyToReview and recent, plus tie-breaking in compareNeedsYou and compareRunning
    const qNoDeadlineA: SessionRecord = { ...base, id: 'q-a', filePath: '/qa.jsonl', status: 'waiting', updatedAt: '2026-01-01T00:00:00.000Z' }
    const qNoDeadlineB: SessionRecord = { ...base, id: 'q-b', filePath: '/qb.jsonl', status: 'waiting', updatedAt: '2026-01-02T00:00:00.000Z' }
    const runFallbackA: SessionRecord = { ...base, id: 'rf-a', filePath: '/rfa.jsonl', status: 'running', createdAt: '2026-01-01T00:00:00.000Z' }
    const runFallbackB: SessionRecord = { ...base, id: 'rf-b', filePath: '/rfb.jsonl', status: 'running', createdAt: '2026-01-01T00:00:00.000Z' }
    const revA: SessionRecord = { ...base, id: 'rev-a', filePath: '/reva.jsonl', status: 'complete', unread: true, updatedAt: '2026-01-01T00:00:00.000Z' }
    const revB: SessionRecord = { ...base, id: 'rev-b', filePath: '/revb.jsonl', status: 'complete', unread: true, updatedAt: '2026-01-03T00:00:00.000Z' }
    const recA: SessionRecord = { ...base, id: 'rec-a', filePath: '/reca.jsonl', status: 'idle', updatedAt: '2026-01-01T00:00:00.000Z' }
    const recB: SessionRecord = { ...base, id: 'rec-b', filePath: '/recb.jsonl', status: 'idle', updatedAt: '2026-01-01T00:00:00.000Z' }

    const multiSections = buildActivitySections([
      qNoDeadlineA,
      qNoDeadlineB,
      runFallbackB,
      runFallbackA,
      revA,
      revB,
      recB,
      recA,
    ])
    expect(multiSections.needsYou.map((item) => item.session.id)).toEqual(['q-b', 'q-a'])
    expect(multiSections.running.map((item) => item.session.id)).toEqual(['rf-a', 'rf-b'])
    expect(multiSections.readyToReview.map((item) => item.session.id)).toEqual(['rev-b', 'rev-a'])
    expect(multiSections.recent.map((item) => item.session.id)).toEqual(['rec-a', 'rec-b'])

    // Quiet detection and time formatting helpers
    expect(isSessionQuiet(undefined, 500_000)).toBe(false)
    expect(isSessionQuiet({ runtimeId: 'rt', phase: 'idle', lastEventAt: 0 }, 500_000)).toBe(false)
    expect(isSessionQuiet({ runtimeId: 'rt', phase: 'tool', lastEventAt: 0 }, 500_000)).toBe(false)
    expect(isSessionQuiet({ runtimeId: 'rt', phase: 'thinking', lastEventAt: 1_000 }, 1_000 + SESSION_QUIET_THRESHOLD_MS)).toBe(false)
    expect(isSessionQuiet({ runtimeId: 'rt', phase: 'thinking', lastEventAt: 1_000 }, 1_001 + SESSION_QUIET_THRESHOLD_MS)).toBe(true)

    expect(formatQuietMinutes({ runtimeId: 'rt', phase: 'thinking', lastEventAt: 0 }, 30_000)).toBe('quiet 1m')
    expect(formatQuietMinutes({ runtimeId: 'rt', phase: 'thinking', lastEventAt: 0 }, 5 * 60_000)).toBe('quiet 5m')

    expect(formatClockDuration(-500)).toBe('0:00')
    expect(formatClockDuration(65_000)).toBe('1:05')
    expect(formatClockDuration(3_661_000)).toBe('1:01:01')
    expect(formatElapsedClock(1_000, 66_000)).toBe('1:05')
    expect(formatDeadlineCountdown(10_000, 7_200)).toBe('0:03')
    expect(formatDeadlineCountdown(10_000, 15_000)).toBe('0:00')
  })
})
