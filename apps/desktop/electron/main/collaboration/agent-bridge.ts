import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { ApexModelDescriptor, RuntimeInfo, SessionRecord, TranscriptMessage } from '../../../src/types/api'
import { assertNoMcpAuthenticationCommand } from '../../../src/lib/mcp-policy'
import { streamingBehaviorForIntent } from '../../../src/lib/session-actions'
import type { AgentRpcManager } from '../agent-rpc'
import type { ProjectService } from '../projects'
import { CapabilityBridge, type CapabilityClaim } from 'apex-core/lib/capability-bridge'
import type { ModelCatalogProvider } from '../model-catalog'
import { availableModels, rankedModelMatches, resolveModel, resolveReasoning } from '../model-selection'
import { requireBoolean, requireExistingDirectory, requireId, requireInteger, requireString } from 'apex-core/validation'
import { encodeGooeyPiAgentMessage } from 'apex-core/collaboration/message-envelope'
import { recentOperations, type CollaborationOperations } from './session-summary'

const MAX_LISTED_SESSIONS = 100
const MAX_MESSAGES = 40
const MAX_CONTEXT_TOKENS = 30_000
const TOKEN_ESTIMATE_CHARS = 4
const MAX_CONTEXT_CHARS = MAX_CONTEXT_TOKENS * TOKEN_ESTIMATE_CHARS
const MAX_SEND_CHARS = 64 * 1024
const MAX_CREATE_PROMPT_CHARS = 1_000_000
const MAX_WAIT_MS = 30_000
const MAX_WAIT_TARGETS = 16
const MAX_ACTIVE_WAITS_PER_TOKEN = 16

interface CollaborationWaitClock {
  now(): number
  setTimeout(callback: () => void, delayMs: number): { unref(): void }
  clearTimeout(timer: { unref(): void }): void
}

const nativeWaitClock: CollaborationWaitClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as NodeJS.Timeout),
}

interface CollaborationSessionService {
  list(projectPath?: unknown, includeArchived?: unknown, force?: unknown): Promise<SessionRecord[]>
  read(filePath: unknown): Promise<TranscriptMessage[]>
  onDidChange?(listener: () => void): () => void
}

interface CollaborationTarget {
  cwd: string
  projectId?: string
  session: SessionRecord
  service: CollaborationSessionService
  manager: AgentRpcManager
}

export interface AgentCollaborationBridgeOptions {
  extensionPath: string
  sessions: Record<'pi', CollaborationSessionService>
  agents: Record<'pi', AgentRpcManager>
  catalogs: Record<'pi', ModelCatalogProvider>
  disabledProviders: Record<'pi', () => ReadonlySet<string>>
  disabledModels: Record<'pi', () => ReadonlySet<string>>
  waitClock?: CollaborationWaitClock
  projects?: Pick<ProjectService, 'collaborationScope'>
}

interface CollaborationMessage {
  id: string
  role: TranscriptMessage['role']
  agentName?: string
  text: string
}

interface CollaborationSnapshot {
  session: Pick<SessionRecord, 'id' | 'harness' | 'title' | 'status' | 'updatedAt'>
  cursor: string
  live: boolean
  estimated_tokens: number
  token_limit: number
  truncated: boolean
  messages: CollaborationMessage[]
  waiting_for_user?: { count: number; method: string; title: string; deadline?: number }
  last_error?: string
  operations: CollaborationOperations
}

function waitingForUser(manager: AgentRpcManager, runtime?: RuntimeInfo): CollaborationSnapshot['waiting_for_user'] {
  if (!runtime) return undefined
  try {
    const dialogs = manager.sessionSnapshot(runtime.runtimeId).dialogs.filter((dialog) => typeof dialog.deadline !== 'number' || dialog.deadline > Date.now())
    const first = dialogs[0]
    if (!first) return undefined
    return {
      count: dialogs.length,
      method: typeof first.method === 'string' ? first.method.slice(0, 64) : 'question',
      title: typeof first.title === 'string' ? first.title.slice(0, 200) : 'Human input required',
      ...(typeof first.deadline === 'number' ? { deadline: first.deadline } : {}),
    }
  } catch { return undefined } // Session transitions have no stable dialog snapshot.
}

function messageText(message: TranscriptMessage): string {
  if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'agent') return ''
  return message.parts.map((part) => {
    if (part.type === 'text' || part.type === 'agentMessage') return part.text
    if (part.type === 'thinking') return `[thinking]\n${part.text}`
    if (part.type === 'image') return '[image omitted]'
    return ''
  }).filter(Boolean).join('\n')
}

function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const marker = '\n[...message truncated...]\n'
  if (maxChars <= marker.length) return value.slice(-maxChars)
  const available = maxChars - marker.length
  const headChars = Math.ceil(available / 2)
  return `${value.slice(0, headChars)}${marker}${value.slice(-(available - headChars))}`
}

function boundedMessages(transcript: TranscriptMessage[], characterLimit = MAX_CONTEXT_CHARS): {
  messages: CollaborationMessage[]
  estimatedTokens: number
  truncated: boolean
} {
  let remaining = characterLimit
  const messages: CollaborationMessage[] = []
  let truncated = false
  let includedMessages = 0
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const message = transcript[index]
    const raw = messageText(message)
    if (!raw) continue
    if (includedMessages >= MAX_MESSAGES || remaining <= 0) {
      truncated = true
      break
    }
    const text = truncateMiddle(raw, remaining)
    if (text.length < raw.length) truncated = true
    remaining -= text.length
    messages.push({ id: message.id, role: message.role, agentName: message.agentName, text })
    includedMessages += 1
    if (text.length < raw.length) break
  }
  return {
    messages: messages.reverse(),
    estimatedTokens: Math.ceil((characterLimit - remaining) / TOKEN_ESTIMATE_CHARS),
    truncated,
  }
}

/** Identity of a peer runtime slot; shared by wake dedupe and delivery serialization. */
function targetKey(target: CollaborationTarget): string {
  return `${target.session.harness}:${resolve(target.session.filePath)}`
}

function cursorFor(session: SessionRecord, messages: CollaborationMessage[], live: boolean, metadata: unknown): string {
  const tail = messages.at(-1)
  return createHash('sha256').update(JSON.stringify([
    session.id, session.harness, session.status, session.updatedAt, session.eventRevision,
    live, tail?.id, tail?.text.slice(-2_048), metadata,
  ])).digest('base64url').slice(0, 32)
}

/**
 * App-owned session collaboration for all harnesses. Session files remain
 * read-only: reads use each harness's bounded SessionService, while writes are
 * delivered through a live runtime owned by this Apex process (waking an
 * authorized saved target through the normal manager when needed).
 */
export class AgentCollaborationBridge extends CapabilityBridge {
  protected readonly rateLimit = 120
  protected readonly rateLimitError = 'Session collaboration rate limit exceeded; slow down and retry shortly'
  private readonly waking = new Map<string, Promise<RuntimeInfo>>()
  private readonly deliveries = new Map<string, Promise<void>>()
  private readonly sourcesByToken = new Map<string, CollaborationTarget>()
  private readonly activeWaitsByToken = new Map<string, number>()
  private readonly activeWaitTargets = new Set<string>()
  private readonly creationQueues = new Map<string, { active: boolean; pending: Array<{ run: () => void; reject: (error: Error) => void }> }>()
  private readonly pendingRuntimeTokens = new Map<string, string>()
  private readonly waitClock: CollaborationWaitClock
  private readonly waitCancellations = new Map<string, Set<() => void>>()
  private readonly lastErrors = new Map<string, string>()
  private readonly managerSubscriptions: Array<() => void> = []

  constructor(private readonly options: AgentCollaborationBridgeOptions) {
    super()
    this.waitClock = options.waitClock ?? nativeWaitClock
  }

  override async start(): Promise<void> {
    await super.start()
    if (this.managerSubscriptions.length) return
    for (const manager of new Set(Object.values(this.options.agents))) {
      this.managerSubscriptions.push(manager.subscribe(({ runtimeId, event }) => {
        const runtime = manager.list().find((candidate) => candidate.runtimeId === runtimeId)
        if (!runtime?.sessionFile) return
        this.bindRuntimeSession(runtimeId, runtime.sessionFile)
        const key = resolve(runtime.sessionFile)
        if (event.type === 'agent_start') this.lastErrors.delete(key)
        if (event.type !== 'error' && event.type !== 'transport_error' && event.type !== 'extension_error') return
        const error = event.error ?? event.message
        if (typeof error !== 'string') return
        this.lastErrors.delete(key)
        this.lastErrors.set(key, error.slice(0, 2_000))
        if (this.lastErrors.size > 256) this.lastErrors.delete(this.lastErrors.keys().next().value!)
      }))
    }
  }

  override async stop(): Promise<void> {
    for (const unsubscribe of this.managerSubscriptions.splice(0)) unsubscribe()
    await super.stop()
    this.lastErrors.clear()
  }

  protected environmentEntries(url: string, token: string): NodeJS.ProcessEnv {
    return {
      GOOEYPI_COLLABORATION_URL: url,
      GOOEYPI_COLLABORATION_TOKEN: token,
      GOOEYPI_COLLABORATION_EXTENSION_PATH: this.options.extensionPath,
    }
  }

  protected onClaimRevoked(claim: CapabilityClaim): void {
    const { token } = claim
    this.sourcesByToken.delete(token)
    this.activeWaitsByToken.delete(token)
    for (const cancel of this.waitCancellations.get(token) ?? []) cancel()
    this.waitCancellations.delete(token)
    const queue = this.creationQueues.get(token)
    if (queue) {
      for (const entry of queue.pending.splice(0)) entry.reject(new Error('Capability expired'))
      if (!queue.active) this.creationQueues.delete(token)
    }
    for (const key of this.activeWaitTargets) if (key.startsWith(`${token}:`)) this.activeWaitTargets.delete(key)
    for (const [runtimeId, pendingToken] of this.pendingRuntimeTokens) {
      if (pendingToken === token) this.pendingRuntimeTokens.delete(runtimeId)
    }
  }

  bindSession(token: string | undefined, sessionFile: string | undefined, runtimeId?: string): void {
    if (!token) return
    const claim = this.claimForToken(token)
    if (!claim) {
      if (runtimeId) this.pendingRuntimeTokens.delete(runtimeId)
      return
    }
    if (runtimeId && !sessionFile) this.pendingRuntimeTokens.set(runtimeId, token)
    if (!sessionFile) return
    if (!claim.sessionPath) claim.sessionPath = sessionFile
    if (runtimeId) this.pendingRuntimeTokens.delete(runtimeId)
  }

  private bindRuntimeSession(runtimeId: string, sessionFile: string): void {
    const token = this.pendingRuntimeTokens.get(runtimeId)
    if (token) this.bindSession(token, sessionFile, runtimeId)
  }

  protected async dispatch(method: string, params: Record<string, unknown>, claim: CapabilityClaim, signal?: AbortSignal): Promise<unknown> {
    const source = await this.sourceFor(claim)
    if (method === 'list') return this.listPeers(source)
    if (method === 'models') return this.listModels(source, params.query)
    if (method === 'create') return this.withCreationAdmission(claim, () => this.create(source, params, claim))
    if (method === 'wait') {
      const many = params.target_session_ids !== undefined
      if (many && (params.target_session_id !== undefined || params.after_cursor !== undefined)) throw new TypeError('Use either target_session_ids or a single target_session_id with after_cursor')
      const rawIds = many ? params.target_session_ids : [params.target_session_id]
      if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > MAX_WAIT_TARGETS) throw new TypeError('target_session_ids must contain 1 to 16 UUIDs')
      const ids = rawIds.map((id) => requireId(id, 'target_session_id'))
      if (new Set(ids).size !== ids.length) throw new TypeError('Duplicate wait targets are not allowed')
      return this.withWaitAdmission(claim, ids, async () => {
        const targets = await Promise.all(ids.map((id) => this.targetFor(source, id)))
        const result = await this.wait(targets, params.after_cursor, params.timeout_ms, claim, signal)
        await Promise.all(ids.map((id) => this.targetFor(source, id)))
        await this.sourceFor(claim)
        if (this.claimForToken(claim.token) !== claim || signal?.aborted) throw new Error('Capability expired or request disconnected')
        return many ? result : { ...result.snapshots[0], timed_out: result.timed_out }
      })
    }
    const targetId = requireId(params.target_session_id, 'target_session_id')
    const target = await this.targetFor(source, targetId)
    if (method === 'read') {
      const snapshot = await this.snapshot(target)
      await this.sourceFor(claim)
      await this.targetFor(source, targetId)
      return snapshot
    }
    if (method === 'send' || method === 'steer') return this.withDeliveryLock(target, () => this.send(source, target, params.message, claim, method === 'steer'))
    if (method === 'stop') return this.withDeliveryLock(target, async () => {
      await this.sourceFor(claim)
      await this.targetFor(source, targetId)
      if (this.claimForToken(claim.token) !== claim) throw new Error('Capability expired')
      const runtime = target.manager.getForSession(target.session.filePath)
      if (!runtime) return { stopped: false, target_session_id: targetId }
      const response = await target.manager.command(runtime.runtimeId, { type: 'abort' })
      if (response.success === false) throw new Error('The target rejected the stop request')
      return { stopped: true, target_session_id: targetId }
    })
    throw new TypeError(`Unsupported collaboration method ${method}`)
  }

  private async sourceFor(claim: CapabilityClaim): Promise<CollaborationTarget> {
    if (claim.harness !== 'pi' || !claim.sessionPath) throw new Error('Session collaboration is not available yet for this thread; try again in a moment')
    let source = this.sourcesByToken.get(claim.token)
    if (!source) {
      const sessions = await this.options.sessions[claim.harness].list(undefined, true, true)
      const sessionPath = resolve(claim.sessionPath)
      const session = sessions.find((candidate) => resolve(candidate.filePath) === sessionPath)
      if (!session) throw new Error('The current collaboration session was not found')
      if (session.depth !== 0) throw new Error('Session collaboration is available only to top-level sessions')
      source = { cwd: claim.cwd, session, service: this.options.sessions[claim.harness], manager: this.options.agents[claim.harness] }
    }
    if (this.options.projects) {
      const claimed = await this.options.projects.collaborationScope(claim.cwd)
      const recorded = await this.options.projects.collaborationScope(source.session.projectPath)
      if (claimed.projectId !== recorded.projectId || (source.projectId && source.projectId !== claimed.projectId)) throw new Error('The collaboration project grant changed')
      source.projectId = claimed.projectId
    } else if (resolve(claim.cwd) !== resolve(source.session.projectPath)) {
      throw new Error('The session does not belong to its runtime working directory')
    }
    if (this.claimForToken(claim.token) !== claim || claim.expiresAt <= Date.now()) throw new Error('Capability expired')
    this.sourcesByToken.set(claim.token, source)
    return source
  }

  private async peersFor(source: CollaborationTarget): Promise<CollaborationTarget[]> {
    const peers: CollaborationTarget[] = []
    // Project grants are harness-scoped. A Pi session can collaborate with
    // Pi peers, but its token never grants access
    // to another harness's session catalog even when the cwd text matches.
    const harness = source.session.harness
    if (harness !== 'pi') throw new Error('Invalid collaboration harness')
    const service = this.options.sessions[harness]
    const scope = this.options.projects ? await this.options.projects.collaborationScope(source.cwd) : undefined
    if (scope && source.projectId && scope.projectId !== source.projectId) throw new Error('The collaboration project grant changed')
    const sessions = await service.list(scope ? undefined : source.session.projectPath, false, true)
    for (const session of sessions) {
      if (session.id === source.session.id || session.depth !== 0 || session.archived) continue
      if (scope && this.options.projects) {
        try {
          const peerScope = await this.options.projects.collaborationScope(session.projectPath)
          if (peerScope.projectId !== scope.projectId) continue
        } catch { continue }
      } else if (resolve(session.projectPath) !== resolve(source.session.projectPath)) continue
      peers.push({ cwd: session.projectPath, session, service, manager: this.options.agents[harness] })
    }
    return peers.sort((left, right) => Date.parse(right.session.updatedAt) - Date.parse(left.session.updatedAt))
  }

  private async listPeers(source: CollaborationTarget): Promise<Array<Record<string, unknown>>> {
    return (await this.peersFor(source)).filter(({ session }) => !('role' in session && session.role === 'coordinator')).slice(0, MAX_LISTED_SESSIONS).map(({ session, manager }) => ({
      id: session.id,
      harness: session.harness,
      title: session.title,
      status: waitingForUser(manager, manager.getForSession(session.filePath)) ? 'waiting' : session.status,
      updated_at: session.updatedAt,
      live: Boolean(manager.getForSession(session.filePath)),
      waiting_for_user: waitingForUser(manager, manager.getForSession(session.filePath)),
      last_error: this.lastErrors.get(resolve(session.filePath)),
    }))
  }

  private async modelsFor(source: CollaborationTarget): Promise<ApexModelDescriptor[]> {
    const harness = source.session.harness
    if (harness !== 'pi') throw new Error('Invalid collaboration harness')
    return availableModels(this.options.catalogs[harness], this.options.disabledProviders[harness](), this.options.disabledModels[harness]())
  }

  private async listModels(source: CollaborationTarget, rawQuery: unknown): Promise<Record<string, unknown>> {
    const query = rawQuery === undefined ? '' : requireString(rawQuery, 'query', { max: 256, trim: true })
    const available = await this.modelsFor(source)
    const matches = query ? rankedModelMatches(query, available) : available
    const models = matches.slice(0, 100).map((model) => ({
      key: model.key,
      name: model.name,
      provider: model.provider,
      reasoning_levels: model.availableThinkingLevels,
    }))
    return { models, matched: matches.length, returned: models.length, truncated: matches.length > models.length }
  }

  private async create(source: CollaborationTarget, params: Record<string, unknown>, claim: CapabilityClaim): Promise<Record<string, unknown>> {
    const prompt = requireString(params.prompt, 'prompt', { min: 1, max: MAX_CREATE_PROMPT_CHARS, trim: true })
    assertNoMcpAuthenticationCommand(prompt, source.session.harness)
    const title = params.title === undefined ? undefined : requireString(params.title, 'title', { min: 1, max: 200, trim: true })
    const modelQuery = params.model === undefined ? undefined : requireString(params.model, 'model', { min: 1, max: 512, trim: true })
    const reasoningQuery = params.reasoning === undefined ? undefined : requireString(params.reasoning, 'reasoning', { min: 1, max: 64, trim: true })
    const fast = params.fast === undefined ? undefined : requireBoolean(params.fast, 'fast')
    const selectedModel = modelQuery ? resolveModel(modelQuery, await this.modelsFor(source)) : undefined
    const selectedReasoning = selectedModel && reasoningQuery
      ? resolveReasoning(reasoningQuery, selectedModel.availableThinkingLevels)
      : undefined
    const requestedCwd = params.cwd === undefined ? source.cwd : requireString(params.cwd, 'cwd', { min: 1, max: 4096, trim: true })
    let cwd = source.cwd
    if (this.options.projects) {
      const sourceScope = await this.options.projects.collaborationScope(source.cwd)
      const targetScope = await this.options.projects.collaborationScope(requestedCwd)
      if (sourceScope.projectId !== targetScope.projectId) throw new TypeError('cwd must belong to the source project')
      // Resolve the exact cwd only after checking its project identity.
      cwd = await requireExistingDirectory(requestedCwd, 'cwd')
      const finalScope = await this.options.projects.collaborationScope(cwd)
      if (sourceScope.projectId !== finalScope.projectId) throw new TypeError('cwd must belong to the source project')
    } else if (resolve(requestedCwd) !== resolve(source.cwd)) {
      throw new TypeError('cwd must match the source working directory')
    }
    const manager = source.manager
    const runtime = await manager.start({
      cwd,
      ...(selectedModel ? { model: selectedModel.key } : {}),
      ...(selectedReasoning ? { thinking: selectedReasoning } : {}),
      ...(fast !== undefined ? { fast } : {}),
    })
    let appliedReasoning = selectedReasoning
    try {
      if (!selectedModel && reasoningQuery) {
        appliedReasoning = resolveReasoning(reasoningQuery, runtime.availableThinkingLevels ?? [])
        await manager.command(runtime.runtimeId, { type: 'set_thinking_level', level: appliedReasoning })
      }
      await this.sourceFor(claim)
      if (this.options.projects && (await this.options.projects.collaborationScope(cwd)).projectId !== source.projectId) throw new Error('The collaboration project grant changed')
      if (this.claimForToken(claim.token) !== claim || claim.expiresAt <= Date.now()) throw new Error('Capability expired')
      await manager.command(runtime.runtimeId, {
        type: 'prompt',
        message: encodeGooeyPiAgentMessage({ fromSessionId: source.session.id, text: prompt }),
        streamingBehavior: streamingBehaviorForIntent('queue'),
      })
      if (title) await manager.command(runtime.runtimeId, { type: 'set_session_name', name: title }).catch(() => undefined)
      await manager.command(runtime.runtimeId, { type: 'get_state' })
    } catch (error) {
      this.pendingRuntimeTokens.delete(runtime.runtimeId)
      await manager.stop(runtime.runtimeId).catch(() => false)
      throw error
    }
    const current = manager.list().find((candidate) => candidate.runtimeId === runtime.runtimeId) ?? runtime
    if (!current.sessionFile) {
      this.pendingRuntimeTokens.delete(runtime.runtimeId)
      await manager.stop(runtime.runtimeId).catch(() => false)
      throw new Error('The harness accepted the prompt but did not create a visible session. The session was not reported as created.')
    }
    this.bindRuntimeSession(current.runtimeId, current.sessionFile)
    const sessionPath = resolve(current.sessionFile)
    const created = (await source.service.list(cwd, false, true))
      .find((candidate) => candidate.depth === 0 && resolve(candidate.filePath) === sessionPath)
    if (!created) {
      this.pendingRuntimeTokens.delete(runtime.runtimeId)
      await manager.stop(runtime.runtimeId).catch(() => false)
      throw new Error('The harness created a runtime but its session is not yet readable from Apex')
    }
    return {
      created: true,
      session: {
        id: created.id,
        harness: created.harness,
        title: created.title,
        status: created.status,
        updated_at: created.updatedAt,
        live: true,
      },
      runtime_id: current.runtimeId,
      ...(selectedModel ? { model: { key: selectedModel.key, name: selectedModel.name, provider: selectedModel.provider } } : {}),
      ...(appliedReasoning ? { reasoning: appliedReasoning } : {}),
      ...(fast !== undefined ? {
        fast_mode: {
          requested: fast,
          enabled: current.serviceTier === 'priority',
          available: current.fastModeAvailable ?? current.fastModeSupported ?? false,
        },
      } : {}),
    }
  }

  private async targetFor(source: CollaborationTarget, targetId: string): Promise<CollaborationTarget> {
    const matches = (await this.peersFor(source)).filter(({ session }) => session.id === targetId)
    if (matches.length === 0) throw new Error('The target session was not found in this working directory')
    if (matches.length > 1) throw new Error('The target session id is ambiguous in this catalog')
    return matches[0]
  }

  private async snapshot(target: CollaborationTarget, tokenLimit = MAX_CONTEXT_TOKENS, operationLimit = 6_000): Promise<CollaborationSnapshot> {
    const transcript = await target.service.read(target.session.filePath)
    const context = boundedMessages(transcript, tokenLimit * TOKEN_ESTIMATE_CHARS)
    const operations = recentOperations(transcript, operationLimit)
    const refreshed = (await target.service.list(target.session.projectPath, true, false))
      .find((candidate) => candidate.id === target.session.id) ?? target.session
    target.session = refreshed
    const runtime = target.manager.getForSession(refreshed.filePath)
    const waiting = waitingForUser(target.manager, runtime)
    const error = this.lastErrors.get(resolve(refreshed.filePath)) ?? transcript.at(-1)?.errorMessage
    const lastError = typeof error === 'string' ? error.slice(0, 2_000) : undefined
    const busy = runtime && (runtime.isStreaming || runtime.isCompacting || runtime.sessionActions?.active || (runtime.sessionActions?.queuedCount ?? 0) > 0)
    let status = refreshed.status
    if (waiting) status = 'waiting'
    else if (lastError) status = 'failed'
    else if (busy) status = 'running'
    else if (runtime && status === 'running') status = 'complete'
    const session = { id: refreshed.id, harness: refreshed.harness, title: refreshed.title, status, updatedAt: refreshed.updatedAt }
    const live = Boolean(runtime)
    return {
      session,
      cursor: cursorFor({ ...refreshed, status }, context.messages, live, [waiting, lastError, operations]),
      live,
      estimated_tokens: context.estimatedTokens,
      token_limit: tokenLimit,
      truncated: context.truncated,
      messages: context.messages,
      waiting_for_user: waiting,
      last_error: lastError,
      operations,
    }
  }

  private async send(source: CollaborationTarget, target: CollaborationTarget, rawMessage: unknown, claim: CapabilityClaim, steer = false): Promise<Record<string, unknown>> {
    const message = requireString(rawMessage, 'message', { min: 1, max: MAX_SEND_CHARS, trim: true })
    assertNoMcpAuthenticationCommand(message, source.session.harness)
    const existing = target.manager.getForSession(target.session.filePath)
    const runtime = existing ?? await this.wake(target)
    const before = await this.snapshot(target)
    const attribution = encodeGooeyPiAgentMessage({
      fromSessionId: source.session.id,
      text: message,
    })
    await this.sourceFor(claim)
    await this.targetFor(source, target.session.id)
    if (this.claimForToken(claim.token) !== claim || claim.expiresAt <= Date.now()) throw new Error('Capability expired')
    const busy = runtime.isStreaming || runtime.isCompacting || runtime.sessionActions?.active
    let type = 'prompt'
    if (busy) type = steer ? 'steer' : 'follow_up'
    const response = await target.manager.command(runtime.runtimeId, { type, message: attribution })
    if (response.success === false) throw new Error('The target rejected the message')
    return { delivered: true, target_session_id: target.session.id, awakened: !existing, queued: Boolean(busy), cursor_before: before.cursor }
  }

  private async wake(target: CollaborationTarget): Promise<RuntimeInfo> {
    const key = targetKey(target)
    const existing = this.waking.get(key)
    if (existing) return existing
    const pending = target.manager.start({ cwd: target.session.projectPath, sessionPath: target.session.filePath })
    this.waking.set(key, pending)
    try { return await pending }
    finally { if (this.waking.get(key) === pending) this.waking.delete(key) }
  }

  private async withDeliveryLock<T>(target: CollaborationTarget, action: () => Promise<T>): Promise<T> {
    const key = targetKey(target)
    const previous = this.deliveries.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolveCurrent) => { release = resolveCurrent })
    this.deliveries.set(key, current)
    await previous.catch(() => undefined)
    try { return await action() }
    finally {
      release()
      if (this.deliveries.get(key) === current) this.deliveries.delete(key)
    }
  }

  private async withWaitAdmission<T>(claim: CapabilityClaim, targetIds: string[], action: () => Promise<T>): Promise<T> {
    if (this.claimForToken(claim.token) !== claim) throw new Error('Capability expired')
    const keys = targetIds.map((id) => `${claim.token}:${claim.harness}:${id}`)
    const active = this.activeWaitsByToken.get(claim.token) ?? 0
    if (active >= MAX_ACTIVE_WAITS_PER_TOKEN) throw new Error('Too many session waits are active for this runtime')
    if (keys.some((key) => this.activeWaitTargets.has(key))) throw new Error('A wait for this target session is already active')
    this.activeWaitsByToken.set(claim.token, active + 1)
    for (const key of keys) this.activeWaitTargets.add(key)
    try { return await action() }
    finally {
      for (const key of keys) this.activeWaitTargets.delete(key)
      const remaining = (this.activeWaitsByToken.get(claim.token) ?? 1) - 1
      if (remaining > 0) this.activeWaitsByToken.set(claim.token, remaining)
      else this.activeWaitsByToken.delete(claim.token)
    }
  }

  private withCreationAdmission<T>(claim: CapabilityClaim, action: () => Promise<T>): Promise<T> {
    if (this.claimForToken(claim.token) !== claim || claim.expiresAt <= Date.now()) return Promise.reject(new Error('Capability expired'))
    let queue = this.creationQueues.get(claim.token)
    if (!queue) {
      queue = { active: false, pending: [] }
      this.creationQueues.set(claim.token, queue)
    }
    if (queue.active && queue.pending.length >= 4) return Promise.reject(new Error('Too many session creations are queued for this runtime'))
    const currentQueue = queue
    return new Promise<T>((resolveResult, reject) => {
      const run = () => {
        currentQueue.active = true
        void (async () => {
          if (this.claimForToken(claim.token) !== claim || claim.expiresAt <= Date.now()) throw new Error('Capability expired')
          return action()
        })().then(resolveResult, reject).finally(() => {
          currentQueue.active = false
          const next = currentQueue.pending.shift()
          if (next) next.run()
          else if (this.creationQueues.get(claim.token) === currentQueue) this.creationQueues.delete(claim.token)
        })
      }
      if (currentQueue.active) currentQueue.pending.push({ run, reject })
      else run()
    })
  }

  private wait(targets: CollaborationTarget[], rawCursor: unknown, rawTimeout: unknown, claim: CapabilityClaim, signal?: AbortSignal): Promise<{ snapshots: CollaborationSnapshot[]; changed_session_ids: string[]; timed_out: boolean }> {
    const afterCursor = rawCursor === undefined ? undefined : requireString(rawCursor, 'after_cursor', { min: 1, max: 128, trim: true })
    const timeoutMs = rawTimeout === undefined ? 15_000 : requireInteger(rawTimeout, 'timeout_ms', 0, MAX_WAIT_MS)
    const deadline = this.waitClock.now() + timeoutMs
    return new Promise((resolveWait, rejectWait) => {
      let done = false
      let checking = false
      let dirty = false
      let expired = timeoutMs === 0
      let baseline: CollaborationSnapshot[] | undefined
      let timer: { unref(): void } | undefined
      const subscriptions: Array<() => void> = []
      const cancellations = this.waitCancellations.get(claim.token) ?? new Set<() => void>()
      this.waitCancellations.set(claim.token, cancellations)
      const finish = (error?: Error, result?: { snapshots: CollaborationSnapshot[]; changed_session_ids: string[]; timed_out: boolean }) => {
        if (done) return
        done = true
        if (timer) this.waitClock.clearTimeout(timer)
        for (const unsubscribe of subscriptions) unsubscribe()
        cancellations.delete(cancel)
        if (!cancellations.size) this.waitCancellations.delete(claim.token)
        signal?.removeEventListener('abort', disconnect)
        if (error) rejectWait(error)
        else if (result) resolveWait(result)
      }
      const cancel = () => finish(new Error('Capability expired'))
      const disconnect = () => finish(new Error('Request disconnected'))
      const check = async () => {
        if (done) return
        if (checking) { dirty = true; return }
        checking = true
        try {
          do {
            dirty = false
            const deadlineSnapshot = expired
            const snapshots = await Promise.all(targets.map((target) => this.snapshot(target, Math.floor(MAX_CONTEXT_TOKENS / targets.length), Math.floor(6_000 / targets.length))))
            if (done) return
            if (expired && !deadlineSnapshot) { dirty = true; continue }
            if (this.claimForToken(claim.token) !== claim || claim.expiresAt <= Date.now()) { cancel(); return }
            const changed = snapshots.filter((snapshot, index) => {
              const previous = afterCursor ?? baseline?.[index]?.cursor
              const runtime = targets[index].manager.getForSession(targets[index].session.filePath)
              const idle = !runtime || (!runtime.isStreaming && !runtime.isCompacting && !runtime.sessionActions?.active && !(runtime.sessionActions?.queuedCount ?? 0))
              return Boolean(snapshot.waiting_for_user || snapshot.last_error || (previous !== undefined ? snapshot.cursor !== previous : idle))
            }).map((snapshot) => snapshot.session.id)
            baseline ??= snapshots
            if (changed.length || expired) {
              finish(undefined, { snapshots, changed_session_ids: changed, timed_out: !changed.length })
              return
            }
          } while (dirty && !done)
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
        finally { checking = false }
      }
      const notify = () => { void check() }
      const relevant = new Set(['agent_end', 'error', 'transport_error', 'extension_error', 'extension_ui_request', 'extension_ui_resolved', 'runtime_exit', 'tool_execution_end', 'message_end', 'desktop_user_message', 'session_persisted', 'desktop_session_revoked'])
      cancellations.add(cancel)
      signal?.addEventListener('abort', disconnect, { once: true })
      for (const manager of new Set(targets.map((target) => target.manager))) {
        subscriptions.push(manager.subscribe(({ runtimeId, event }) => {
          if (relevant.has(String(event.type)) && targets.some((target) => target.manager === manager && manager.getForSession(target.session.filePath)?.runtimeId === runtimeId)) notify()
        }))
      }
      for (const service of new Set(targets.map((target) => target.service))) {
        if (service.onDidChange) subscriptions.push(service.onDidChange(notify))
      }
      const armDeadline = () => {
        timer = this.waitClock.setTimeout(() => {
          if (this.waitClock.now() < deadline) armDeadline()
          else { expired = true; notify() }
        }, Math.max(0, deadline - this.waitClock.now()))
        timer.unref()
      }
      if (signal?.aborted) disconnect()
      else if (this.claimForToken(claim.token) !== claim) cancel()
      else { if (!expired) armDeadline(); notify() }
    })
  }
}
