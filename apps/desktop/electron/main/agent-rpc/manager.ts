import type { ApexEventEnvelope, ApexModelDescriptor, RuntimeInfo } from '../../../src/types/api'
import { assertNoMcpAuthenticationCommand } from '../../../src/lib/mcp-policy'
import { parseSessionActionSnapshot, streamingBehaviorForIntent } from '../../../src/lib/session-actions'
import { resolveExecutable, runProcess, type ExecutableSource } from '../process-utils'
import { canonicalSessionPath } from 'apex-core/session-paths'
import { RuntimeSessionClaims, type RuntimeSessionRelease } from 'apex-core/sessions/runtime-owners'
import { isPathWithin, isRecord, rejectUnknownKeys, requireId, requireRecord, requireString } from 'apex-core/validation'
import { isThinkingLevel, validateRpcCommand } from './command-schema'
import { PI_RPC_ADAPTER, type HarnessRpcAdapter } from './harness-adapter'
import { RpcRuntime } from './runtime'
import type { RpcObject } from './types'
import type { WorkspaceUseLease, WorkspaceUseOwner } from '../repository-use-gate'
import { readPiTranscript } from 'apex-core/sessions/pi'
import type { DesktopSessionSnapshot } from 'apex-core/sessions/desktop-link'
import { DesktopSessionProjection } from '../desktop-link-projection'
import type { RunReceipts } from '../run-receipts'

/**
 * Structural slice of the provider catalog the manager needs; ApexProviderService
 * satisfies it.
 */
export interface ProviderCatalog {
  requireAvailableModel(rawKey: unknown, disabledProviders?: ReadonlySet<string>, disabledModels?: ReadonlySet<string>): Promise<ApexModelDescriptor>
  capabilities(provider: string | undefined, modelId: string | undefined): Promise<ApexModelDescriptor | undefined>
}

const MAX_IDLE_RUNTIMES = 3
const IDLE_RUNTIME_TTL_MS = 5 * 60_000

export class AgentRpcManager {
  private readonly runtimes = new Map<string, RpcRuntime>()
  private readonly projections = new Map<string, DesktopSessionProjection>()
  private readonly unavailableProjections = new Set<string>()
  private readonly subscribers = new Set<(event: ApexEventEnvelope) => void>()
  private readonly attachmentPins = new Map<string, number>()
  private readonly sessionClaims = new Map<string, RuntimeSessionClaims>()
  private readonly sessionTransitions = new Set<string>()
  private acquireSession: (path: string) => RuntimeSessionRelease = () => () => undefined
  private readonly startingRuntimes = new Set<string>()
  private readonly retiringRuntimes = new Set<string>()
  private readonly runtimeEnvironmentRevisions = new Map<string, number>()
  private readonly lastUsedAt = new Map<string, number>()
  private readonly activeCommands = new Map<string, number>()
  private readonly promptAdmissions = new Map<string, number>()
  private readonly idleSweep: NodeJS.Timeout
  private runtimeEnvironmentRevision = 0
  private disabledModels: () => ReadonlySet<string> = () => new Set()
  private eventSink: (envelope: ApexEventEnvelope) => void = () => undefined
  private eventSequence = 0
  private runtimeEnvironmentProvider: (scope: { cwd: string; sessionPath?: string; interactive: boolean }) => NodeJS.ProcessEnv = () => ({})
  private runtimeStartListener: (environment: NodeJS.ProcessEnv, info: RuntimeInfo) => void = () => undefined
  private runtimeEndListener: (environment: NodeJS.ProcessEnv, info?: RuntimeInfo) => void = () => undefined
  private runtimeAdmission: Promise<void> = Promise.resolve()
  private sessionAttachGuard: (sessionPath: string) => Promise<void> = async () => undefined
  private beginWorkspaceUse: (
    cwd: string,
    owner: WorkspaceUseOwner,
    retireIfIdle: () => Promise<boolean>,
  ) => Promise<WorkspaceUseLease> = async () => ({ release: () => undefined })
  private closed = false
  private promptAccepted: (session: string) => void = () => undefined
  setPromptAcceptedListener(listener: (session: string) => void): void { this.promptAccepted = listener }
  private receipts?: RunReceipts
  private isReadOnlySession: (path: string) => boolean = () => false
  private sideCreation: Promise<void> = Promise.resolve()
  async withSideCreation<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.sideCreation
    let release!: () => void
    this.sideCreation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await action() } finally { release() }
  }
  setReadOnlySessionProvider(provider: (path: string) => boolean): void { this.isReadOnlySession = provider }
  setRunReceipts(receipts: RunReceipts): void { this.receipts = receipts }
  runReceipts(): RunReceipts { if (!this.receipts) throw new Error('Run receipts are unavailable'); return this.receipts }

  constructor(
    private readonly executable: ExecutableSource,
    private readonly authorizeCwd: (cwd: string) => Promise<string>,
    private readonly validateSessionPath: (path: string) => Promise<string>,
    private readonly providers?: ProviderCatalog,
    private readonly disabledProviders: () => ReadonlySet<string> = () => new Set(),
    private readonly adapter: HarnessRpcAdapter = PI_RPC_ADAPTER,
  ) {
    this.idleSweep = setInterval(() => {
      if (!this.closed) void this.withRuntimeAdmission(() => this.pruneIdleRuntimes(MAX_IDLE_RUNTIMES)).catch(() => undefined)
    }, 30_000)
    this.idleSweep.unref()
  }

  setEventSink(sink: (envelope: ApexEventEnvelope) => void): void { this.eventSink = sink }

  subscribe(sink: (envelope: ApexEventEnvelope) => void): () => void {
    this.subscribers.add(sink)
    return () => { this.subscribers.delete(sink) }
  }

  sessionSnapshot(runtimeId: string): DesktopSessionSnapshot & { eventSequence: number } {
    const runtime = this.requireRuntime(runtimeId).snapshot()
    const projection = this.projections.get(runtimeId)
    if (!projection || this.unavailableProjections.has(runtimeId) || this.startingRuntimes.has(runtimeId) || this.sessionTransitions.has(runtimeId)) throw new Error('Runtime snapshot is not available')
    return structuredClone({ runtime, messages: projection.messages, dialogs: projection.pendingDialogs(), statuses: projection.statuses, eventSequence: this.eventSequence })
  }

  pinAttachment(runtimeId: string): () => void {
    this.requireRuntime(runtimeId)
    this.attachmentPins.set(runtimeId, (this.attachmentPins.get(runtimeId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = (this.attachmentPins.get(runtimeId) ?? 1) - 1
      if (count) this.attachmentPins.set(runtimeId, count)
      else this.attachmentPins.delete(runtimeId)
    }
  }

  private publishEvent(envelope: ApexEventEnvelope): void {
    const normalized = this.projections.get(envelope.runtimeId)?.apply(envelope.event)
    const published = { ...envelope, sequence: ++this.eventSequence }
    this.eventSink(published)
    for (const sink of this.subscribers) sink(published)
    if (normalized) {
      const event = { runtimeId: envelope.runtimeId, event: normalized, sequence: ++this.eventSequence }
      this.eventSink(event)
      for (const sink of this.subscribers) sink(event)
    }
  }

  setDisabledModelsProvider(provider: () => ReadonlySet<string>): void { this.disabledModels = provider }

  setWorkspaceUseProvider(provider: (
    cwd: string,
    owner: WorkspaceUseOwner,
    retireIfIdle: () => Promise<boolean>,
  ) => Promise<WorkspaceUseLease>): void {
    this.beginWorkspaceUse = provider
  }

  setRuntimeEnvironmentProvider(provider: (scope: { cwd: string; sessionPath?: string; interactive: boolean }) => NodeJS.ProcessEnv): void {
    this.runtimeEnvironmentProvider = provider
  }

  /** Called once per successfully started runtime with the environment it was spawned with, so capability bridges can bind their claims to the runtime's session. */
  setRuntimeStartListener(listener: (environment: NodeJS.ProcessEnv, info: RuntimeInfo) => void): void {
    this.runtimeStartListener = listener
  }

  /** Called once when ownership of a spawned environment ends, including starts that fail before a runtime can be created. */
  setRuntimeEndListener(listener: (environment: NodeJS.ProcessEnv, info?: RuntimeInfo) => void): void {
    this.runtimeEndListener = listener
  }

  /** Checked before a runtime attaches to an existing session file; throws to refuse the attach. */
  setSessionAttachGuard(guard: (sessionPath: string) => Promise<void>): void { this.sessionAttachGuard = guard }

  setSessionClaimProvider(acquire: (path: string) => RuntimeSessionRelease): void { this.acquireSession = acquire }

  beginShutdown(): void { this.closed = true; clearInterval(this.idleSweep) }

  async checkReadOnlySupport(cwd: string, executable = resolveExecutable(this.executable)): Promise<void> {
    if (this.adapter.id !== 'pi') throw new Error('Read-only side conversations are unavailable for this harness')
    if (!executable) throw new Error('Pi executable was not found; read-only side conversations are unavailable')
    const help = await runProcess(executable, ['--help'], { cwd, timeoutMs: 10_000, maxBytes: 1024 * 1024 }).catch((error: unknown) => {
      throw new Error(`Unable to verify configured Pi read-only capability: ${error instanceof Error ? error.message : String(error)}`)
    })
    if (help.code !== 0 || help.timedOut || help.outputExceeded || !['--tools', '--no-extensions', '--no-mcp'].every((flag) => new RegExp(`^\\s*${flag}(?:[\\s,=]|$)`, 'm').test(help.stdout))) throw new Error('Configured Pi does not support the required read-only side conversation flags')
  }

  async start(raw: unknown): Promise<RuntimeInfo> {
    return this.startWithMode(raw, true)
  }

  /** Internal scheduler entrypoint: unattended children must never expose UI-blocking tools. */
  async startUnattended(raw: unknown): Promise<RuntimeInfo> {
    return this.startWithMode(raw, false)
  }

  private async startWithMode(raw: unknown, interactive: boolean): Promise<RuntimeInfo> {
    this.requireOpen()
    const executable = resolveExecutable(this.executable)
    if (!executable) throw new Error(`${this.adapter.agentName} executable was not found`)
    const options = requireRecord(raw, 'options')
    rejectUnknownKeys(options, ['cwd', 'sessionPath', 'model', 'thinking', 'fast'], 'options')
    const cwd = await this.authorizeCwd(requireString(options.cwd, 'cwd', { min: 1, max: 4096 }))
    this.requireOpen()
    // A side file can be visible in the catalog before its policy is durable.
    await this.sideCreation
    const sessionPath = options.sessionPath === undefined
      ? undefined
      : await this.validateSessionPath(requireString(options.sessionPath, 'sessionPath', { max: 4096 }))
    if (sessionPath) await this.sessionAttachGuard(sessionPath)
    const readOnly = sessionPath ? this.isReadOnlySession(sessionPath) : false
    if (readOnly) await this.checkReadOnlySupport(cwd, executable)
    let selectedModel: ApexModelDescriptor | undefined
    let modelId: string | undefined
    if (options.model !== undefined) {
      selectedModel = this.providers
        ? await this.providers.requireAvailableModel(options.model, this.disabledProviders(), this.disabledModels())
        : undefined
      modelId = selectedModel?.id ?? requireString(options.model, 'model', { min: 1, max: 256, trim: true })
    }
    let thinking: string | undefined
    if (options.thinking !== undefined) {
      thinking = requireString(options.thinking, 'thinking', { min: 1, max: 16, trim: true })
      if (!isThinkingLevel(thinking)) throw new TypeError('Invalid thinking level')
      if (selectedModel && !selectedModel.availableThinkingLevels.includes(thinking)) throw new TypeError(`${selectedModel.name} does not support ${thinking} reasoning`)
    }
    if (options.fast !== undefined && typeof options.fast !== 'boolean') throw new TypeError('fast must be a boolean')
    this.requireOpen()
    const runtimeEnvironmentRevision = this.runtimeEnvironmentRevision
    const runtimeEnvironment = this.runtimeEnvironmentProvider({ cwd, sessionPath, interactive })
    let runtime: RpcRuntime | undefined
    let workspaceUse!: WorkspaceUseLease
    const workspaceOwner: Extract<WorkspaceUseOwner, { kind: 'agent' }> = { kind: 'agent', harness: this.adapter.id, runtimeId: `starting-${Date.now()}` }
    workspaceUse = await this.beginWorkspaceUse(
      cwd,
      workspaceOwner,
      async () => {
        if (!runtime) return false
        const retired = await this.retireForCheckout(runtime)
        if (retired) workspaceUse.release()
        return retired
      },
    )
    const claims = new RuntimeSessionClaims(this.acquireSession)
    let finishReservation: (() => void) | undefined
    let environmentEnded = false
    const notifyRuntimeEnd = (info?: RuntimeInfo): void => {
      if (environmentEnded) return
      environmentEnded = true
      workspaceUse.release()
      try { this.runtimeEndListener(runtimeEnvironment, info) } catch { /* capability cleanup must never fail runtime cleanup */ }
    }
    try {
      if (sessionPath) {
        finishReservation = claims.reserve(sessionPath)
        claims.confirm(sessionPath)
      }
      const args = this.adapter.buildStartArgs({
        cwd,
        sessionPath,
        providerId: selectedModel?.provider,
        modelId,
        thinking,
        environment: runtimeEnvironment,
        readOnly,
      })
      // Read before spawn: persistence cannot race the baseline and live frames.
      const baseline = sessionPath ? await readPiTranscript(sessionPath, false) : []
      runtime = await this.admitRuntime(() => {
        const created = new RpcRuntime(
          executable,
          args,
          cwd,
          (event) => {
            this.lastUsedAt.set(event.runtimeId, Date.now())
            this.publishEvent(event)
          },
          (closed) => {
            claims.dispose()
            this.sessionClaims.delete(closed.runtimeId)
            this.startingRuntimes.delete(closed.runtimeId)
            this.runtimes.delete(closed.runtimeId)
            this.retiringRuntimes.delete(closed.runtimeId)
            this.runtimeEnvironmentRevisions.delete(closed.runtimeId)
            this.lastUsedAt.delete(closed.runtimeId)
            this.projections.delete(closed.runtimeId)
            this.unavailableProjections.delete(closed.runtimeId)
            this.attachmentPins.delete(closed.runtimeId)
            notifyRuntimeEnd(closed.snapshot())
          },
          runtimeEnvironment,
          {},
          this.adapter,
        )
        if (readOnly) created.enforceReadOnly()
        created.setInternalEventListener((event) => {
          this.receipts?.event(created, event)
          // A run may start even when its RPC acknowledgement is lost or late.
          if (event.type === 'agent_start') {
            const session = created.snapshot().sessionFile
            if (session) this.promptAccepted(session)
          }
        })
        this.projections.set(created.runtimeId, new DesktopSessionProjection(baseline))
        claims.setChildPid(created.childPid())
        this.sessionClaims.set(created.runtimeId, claims)
        created.setSessionFileListener((path) => {
          try { claims.confirm(path) } catch (error) {
            void created.stop().catch(() => false)
            throw error
          }
        })
        if (!sessionPath) created.persistFirstPrompt()
        // Record the environment generation before admission resolves so a
        // concurrent settings refresh cannot mistake this child for a new one.
        this.runtimeEnvironmentRevisions.set(created.runtimeId, runtimeEnvironmentRevision)
        return created
      })
      workspaceOwner.runtimeId = runtime.runtimeId
      if (runtimeEnvironmentRevision < this.runtimeEnvironmentRevision) void this.retireWhenIdle(runtime)
      await runtime.handshake()
      finishReservation?.()
      if (
        selectedModel
        && runtime.snapshot().model
        && (runtime.snapshot().model?.provider !== selectedModel.provider || runtime.snapshot().model?.id !== selectedModel.id)
      ) {
        await runtime.command(this.adapter.translateCommand({
          type: 'set_model',
          provider: selectedModel.provider,
          modelId: selectedModel.id,
        }))
        if (thinking !== undefined && runtime.snapshot().thinkingLevel !== thinking) {
          await runtime.command(this.adapter.translateCommand({
            type: 'set_thinking_level',
            level: thinking,
          }))
        }
      }
      await this.decorate(runtime)
      if (runtime.snapshot().fastModeSupported && options.fast === true) await runtime.setServiceTier('priority', true)
      try { this.runtimeStartListener(runtimeEnvironment, runtime.snapshot()) } catch { /* capability binding must never fail a start */ }
      this.startingRuntimes.delete(runtime.runtimeId)
      this.lastUsedAt.set(runtime.runtimeId, Date.now())
      return runtime.snapshot()
    } catch (error) {
      if (runtime) {
        // Release the runtime slot explicitly: the close-event cleanup may never
        // fire if the child cannot be reaped, and a failed start must not remain
        // in the resident-process catalog.
        this.startingRuntimes.delete(runtime.runtimeId)
        this.runtimes.delete(runtime.runtimeId)
        this.runtimeEnvironmentRevisions.delete(runtime.runtimeId)
        this.lastUsedAt.delete(runtime.runtimeId)
        await runtime.stop().catch(() => false)
      }
      if (!runtime) claims.dispose()
      // Admission/constructor failures have no close event; failed handshakes
      // can also leave an unreapable child. The once guard joins all paths.
      notifyRuntimeEnd(runtime?.snapshot())
      throw error
    }
  }

  /**
   * Retire children launched with stale capability settings. Idle runtimes are
   * stopped now; busy runtimes are polled until their current turn settles.
   */
  async requestRuntimeEnvironmentRefresh(): Promise<void> {
    this.runtimeEnvironmentRevision += 1
    await Promise.all([...this.runtimes.values()].map((runtime) => this.retireWhenIdle(runtime)))
  }

  async withRewind<T>(runtimeId: unknown, sessionPath: string, action: (runtime: RpcRuntime, fork: (entryId: string) => Promise<RpcObject>) => Promise<T>): Promise<T> {
    const id = requireId(runtimeId, 'runtimeId')
    const runtime = this.requireRuntime(id)
    if (this.sessionTransitions.has(id) || this.activeCommands.has(id) || !this.isIdle(runtime)) throw new Error('Runtime is busy')
    this.sessionTransitions.add(id)
    this.activeCommands.set(id, 1)
    const previous = runtime.snapshot().sessionFile
    try {
      const session = await this.validateSessionPath(sessionPath)
      if (!previous || canonicalSessionPath(previous) !== canonicalSessionPath(session)) throw new Error('Runtime does not own this session')
      const state = await runtime.command({ type: 'get_state' })
      if (!isRecord(state.data) || state.data.isStreaming !== false || state.data.isCompacting !== false || state.data.pendingMessageCount !== 0 || typeof state.data.sessionFile !== 'string' || canonicalSessionPath(state.data.sessionFile) !== canonicalSessionPath(session)) throw new Error('Runtime is busy or session state is unavailable')
      return await action(runtime, (entryId) => {
        this.publishEvent({ runtimeId: id, event: { type: 'desktop_session_revoked', reason: 'Desktop session is changing' } })
        return this.dispatchCommand(id, { type: 'fork', entryId })
      })
    } finally {
      const next = this.runtimes.get(id)?.snapshot()
      if (next && next.sessionFile !== previous) {
        this.unavailableProjections.add(id)
        try {
          const baseline = next.sessionFile ? await readPiTranscript(next.sessionFile, false) : []
          this.projections.set(id, new DesktopSessionProjection(baseline))
          this.unavailableProjections.delete(id)
        } catch { /* Do not expose the previous session's projection. */ }
      }
      this.sessionTransitions.delete(id)
      const remaining = (this.activeCommands.get(id) ?? 1) - 1
      if (remaining) this.activeCommands.set(id, remaining)
      else this.activeCommands.delete(id)
    }
  }

  async command(runtimeId: unknown, rawCommand: unknown): Promise<RpcObject> {
    const id = requireId(runtimeId, 'runtimeId')
    const transition = isRecord(rawCommand) && ['switch_session', 'new_session', 'clone', 'fork', 'branch'].includes(String(rawCommand.type))
    if (transition && this.runtimes.get(id)?.isReadOnlySide()) throw new Error(`Read-only side conversation blocks RPC command ${String(rawCommand.type)}`)
    if (this.sessionTransitions.has(id) && !(isRecord(rawCommand) && rawCommand.type === 'extension_ui_response')) throw new Error('A session change is already in progress')
    const previousSession = transition ? this.runtimes.get(id)?.snapshot().sessionFile : undefined
    if (transition) {
      this.sessionTransitions.add(id)
      this.publishEvent({ runtimeId: id, event: { type: 'desktop_session_revoked', reason: 'Desktop session is changing' } })
    }
    this.activeCommands.set(id, (this.activeCommands.get(id) ?? 0) + 1)
    try {
      return await this.dispatchCommand(runtimeId, rawCommand)
    } catch (error) {
      // Delivery failures for user-visible commands (steer, prompt, follow_up)
      // are otherwise only surfaced as a transient renderer toast; keep a
      // durable trace in the main-process log for diagnosis.
      const type = isRecord(rawCommand) && typeof rawCommand.type === 'string' ? rawCommand.type : 'invalid'
      console.error(`[agent-rpc] ${new Date().toISOString()} command ${type} failed:`, error instanceof Error ? error.message : error)
      throw error
    } finally {
      if (transition) {
        const next = this.runtimes.get(id)?.snapshot()
        if (next && next.sessionFile !== previousSession) {
          this.unavailableProjections.add(id)
          try {
            const baseline = next.sessionFile ? await readPiTranscript(next.sessionFile, false) : []
            this.projections.set(id, new DesktopSessionProjection(baseline))
            this.unavailableProjections.delete(id)
          } catch { /* A failed read must not expose the previous session's history. */ }
        }
        this.sessionTransitions.delete(id)
      }
      const remaining = (this.activeCommands.get(id) ?? 1) - 1
      if (remaining) this.activeCommands.set(id, remaining)
      else this.activeCommands.delete(id)
    }
  }

  private async dispatchCommand(runtimeId: unknown, rawCommand: unknown): Promise<RpcObject> {
    this.requireOpen()
    const runtime = this.requireRuntime(runtimeId)
    if (this.retiringRuntimes.has(runtime.runtimeId)) throw new Error('Runtime is being retired for a branch checkout')
    const command = await validateRpcCommand(rawCommand, this.validateSessionPath)
    if (runtime.isReadOnlySide() && ['switch_session', 'new_session', 'clone', 'fork', 'branch'].includes(String(command.type))) throw new Error(`Read-only side conversation blocks RPC command ${String(command.type)}`)
    // attached_prompt is resolved here, after validation, against owner state.
    const attachedPrompt = command.type === 'attached_prompt'
    if (attachedPrompt && (!this.receipts || this.isBusy(runtime))) {
      const busy = this.isBusy(runtime)
      command.type = busy ? command.intent === 'steer' ? 'steer' : 'follow_up' : 'prompt'
      delete command.intent
    }
    if (command.type === 'switch_session' && typeof command.sessionPath === 'string') {
      await this.sideCreation
      if (this.isReadOnlySession(command.sessionPath)) throw new Error('A read-only side conversation must be opened in its own runtime')
      await this.sessionAttachGuard(command.sessionPath)
    }
    if (command.type === 'new_session' && typeof command.parentSession === 'string' && this.isReadOnlySession(command.parentSession)) throw new Error('A read-only side conversation cannot be used to bypass its runtime policy')
    this.requireOpen()
    if (this.retiringRuntimes.has(runtime.runtimeId)) throw new Error('Runtime is being retired')
    this.lastUsedAt.set(runtime.runtimeId, Date.now())
    const policyPrompt = command.type === 'prompt' || command.type === 'steer' || command.type === 'follow_up' || command.type === 'attached_prompt'
      ? command.message
      : undefined
    if (typeof policyPrompt === 'string') assertNoMcpAuthenticationCommand(policyPrompt, this.adapter.id)
    // Clear the finished marker only after Pi confirms that a user prompt was accepted.
    const forwardPrompt = async (admitted: RpcObject): Promise<RpcObject> => {
      const session = runtime.snapshot().sessionFile
      const response = await runtime.command(this.adapter.translateCommand(admitted))
      const disposition = isRecord(response.data) ? response.data.disposition : undefined
      if (response.success === true && disposition !== 'handled' && session) {
        try { this.promptAccepted(session) }
        catch (error) { throw new Error(`Prompt was accepted but finished status could not be cleared: ${error instanceof Error ? error.message : String(error)}`) }
      }
      return response
    }
    // Validation is harness-independent; the harness vocabulary applies after
    // it. set_service_tier passes through untranslated because the fast-mode
    // interception below routes it via runtime.setServiceTier instead.
    if (this.receipts && ['prompt', 'attached_prompt', 'steer', 'follow_up'].includes(String(command.type))) {
      if (Array.isArray(command.images) && command.images.length > 0 && runtime.snapshot().imageInputSupported === false) throw new Error('The active model does not accept images. Choose a vision model and try again.')
      return this.receipts.admit(runtime, command, forwardPrompt)
    }
    const translated = this.adapter.translateCommand(command)
    if (command.type === 'set_model' && this.providers) {
      await this.providers.requireAvailableModel(`${String(command.provider)}/${String(command.modelId)}`, this.disabledProviders(), this.disabledModels())
    }
    if (command.type === 'set_service_tier') {
      const serviceTier = command.serviceTier === 'priority' ? 'priority' : 'default'
      const supported = await runtime.setServiceTier(serviceTier)
      if (!supported) throw new Error('Fast mode is not supported by the selected model')
      return { type: 'response', command: 'set_service_tier', success: true }
    }
    if (Array.isArray(command.images) && command.images.length > 0 && runtime.snapshot().imageInputSupported === false) {
      throw new Error('The active model does not accept images. Choose a vision model and try again.')
    }
    const finishReservation = command.type === 'switch_session' && typeof command.sessionPath === 'string'
      ? this.sessionClaims.get(runtime.runtimeId)?.reserve(command.sessionPath)
      : undefined
    const projection = this.projections.get(runtime.runtimeId)
    const dialogId = command.type === 'extension_ui_response' && typeof command.id === 'string' ? command.id : undefined
    if (dialogId) {
      if (!projection) throw new Error('Dialog response is stale or already submitted')
      projection.beginAnswer(dialogId)
    }
    const holdsAdmission = command.type === 'prompt' || command.type === 'compact'
    if (holdsAdmission) this.promptAdmissions.set(runtime.runtimeId, (this.promptAdmissions.get(runtime.runtimeId) ?? 0) + 1)
    let response: RpcObject
    try {
      response = this.receipts && ['switch_session', 'new_session', 'clone', 'fork', 'branch', 'bash', 'compact'].includes(String(command.type))
        ? await this.receipts.mutate(runtime, () => runtime.command(translated))
        : ['prompt', 'steer', 'follow_up'].includes(String(command.type)) ? await forwardPrompt(command) : await runtime.command(translated)
      if (dialogId && response.success === true) this.publishEvent({ runtimeId: runtime.runtimeId, event: { type: 'extension_ui_resolved', id: dialogId } })
      finishReservation?.()
    } catch (error) {
      // A lost response may mean the switch succeeded. Keep both claims until
      // the child actually closes rather than guessing which file it writes.
      if (finishReservation || ['new_session', 'clone', 'fork', 'branch'].includes(String(command.type))) await runtime.stop().catch(() => false)
      throw error
    } finally {
      if (dialogId) projection?.answering.delete(dialogId)
      if (holdsAdmission) {
        const count = (this.promptAdmissions.get(runtime.runtimeId) ?? 1) - 1
        if (count) this.promptAdmissions.set(runtime.runtimeId, count)
        else this.promptAdmissions.delete(runtime.runtimeId)
      }
    }
    if (command.type === 'steer' || command.type === 'follow_up') {
      // Refresh the action snapshot after admission when the runtime exposes it.
      try {
        const state = await runtime.command({ type: 'get_state' })
        const explicitActions = isRecord(state.data) ? parseSessionActionSnapshot(state.data.sessionActions) : null
        if (explicitActions) return { ...response, sessionActions: explicitActions }
      } catch { /* action events remain the fallback */ }
      return response
    }
    if (command.type === 'set_model' || command.type === 'cycle_model') {
      const preference = runtime.serviceTierPreference()
      await this.decorate(runtime)
      if (runtime.snapshot().fastModeSupported) await runtime.setServiceTier(preference, true)
    } else if (command.type === 'set_thinking_level' || command.type === 'cycle_thinking_level') await this.decorate(runtime)
    return response
  }

  async runPromptToCompletion(runtimeId: unknown, messageValue: unknown, timeoutMs = 30 * 60_000): Promise<RuntimeInfo> {
    const id = requireId(runtimeId, 'runtimeId')
    const message = requireString(messageValue, 'message', { min: 1, max: 1024 * 1024 })
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60 * 60_000) throw new TypeError('Invalid scheduled run timeout')
    const runtime = this.requireRuntime(id)
    const startedAt = Date.now()
    let observedBusy = runtime.snapshot().isStreaming
    await this.command(id, {
      type: 'prompt',
      message,
      streamingBehavior: streamingBehaviorForIntent('queue'),
    })
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise<void>((resolveDelay) => {
        const timer = setTimeout(resolveDelay, 200)
        timer.unref()
      })
      this.requireOpen()
      if (!this.runtimes.has(id)) throw new Error('Scheduled runtime exited before the prompt completed')
      try { await runtime.command({ type: 'get_state' }) } catch { /* the event snapshot may still be authoritative */ }
      const snapshot = runtime.snapshot()
      if (snapshot.isStreaming || snapshot.isCompacting) observedBusy = true
      if (!snapshot.isStreaming && !snapshot.isCompacting && (observedBusy || Date.now() - startedAt >= 750)) return snapshot
    }
    try { await runtime.command({ type: 'abort' }) } catch { /* timeout remains authoritative */ }
    throw new Error('Scheduled run timed out')
  }

  async stop(runtimeId: unknown): Promise<boolean> {
    const id = requireId(runtimeId, 'runtimeId')
    if (this.sessionTransitions.has(id)) return false
    const runtime = this.runtimes.get(id)
    if (!runtime) return false
    return runtime.stop()
  }

  list(): RuntimeInfo[] {
    return [...this.runtimes.values()]
      .filter((runtime) => !this.startingRuntimes.has(runtime.runtimeId) && !this.retiringRuntimes.has(runtime.runtimeId))
      .map((runtime) => runtime.snapshot())
  }

  /** Cheap ownership probe for IPC routing; requireRuntime keeps the authoritative not-found error. */
  has(runtimeId: string): boolean { return this.runtimes.has(runtimeId) }

  getForSession(filePath: string): RuntimeInfo | undefined {
    const wanted = canonicalSessionPath(filePath)
    return this.list().find((runtime) => runtime.sessionFile && canonicalSessionPath(runtime.sessionFile) === wanted)
  }

  async stopForSession(filePath: string): Promise<void> {
    const wanted = canonicalSessionPath(filePath)
    const matches = [...this.runtimes.values()].filter((runtime) => {
      const path = runtime.snapshot().sessionFile
      return path !== undefined && canonicalSessionPath(path) === wanted
    })
    await Promise.all(matches.map((runtime) => runtime.stop()))
  }

  /** Stops the runtime on `filePath` only while it is idle. False when it is busy or failed to stop. */
  async releaseIdleSession(filePath: string): Promise<boolean> {
    const wanted = canonicalSessionPath(filePath)
    const runtime = [...this.runtimes.values()].find((candidate) => {
      const path = candidate.snapshot().sessionFile
      return path !== undefined && canonicalSessionPath(path) === wanted
    })
    return runtime ? this.retireForCheckout(runtime) : true
  }

  async stopForProjectRoots(roots: string[]): Promise<void> {
    const matches = [...this.runtimes.values()].filter((runtime) => roots.some((root) => isPathWithin(root, runtime.snapshot().cwd)))
    await Promise.all(matches.map((runtime) => runtime.stop()))
  }

  async renameForSession(filePath: string, title: string): Promise<boolean> {
    this.requireOpen()
    const wanted = canonicalSessionPath(filePath)
    const runtime = [...this.runtimes.values()].find((candidate) => {
      const path = candidate.snapshot().sessionFile
      return path !== undefined && canonicalSessionPath(path) === wanted
    })
    if (!runtime) return false
    const response = await runtime.command({ type: 'set_session_name', name: title })
    return response.success === true
  }

  async stopAll(): Promise<void> {
    this.beginShutdown()
    const runtimes = [...this.runtimes.values()]
    await Promise.all(runtimes.map((runtime) => runtime.stop()))
  }

  private async retireWhenIdle(runtime: RpcRuntime): Promise<void> {
    const wantedRevision = this.runtimeEnvironmentRevision
    if (!this.runtimes.has(runtime.runtimeId)
      || (this.runtimeEnvironmentRevisions.get(runtime.runtimeId) ?? wantedRevision) >= wantedRevision) return
    if (this.isIdle(runtime)) {
      await runtime.stop()
      return
    }
    const timer = setTimeout(() => { void this.retireWhenIdle(runtime) }, 250)
    timer.unref()
  }

  private async retireForCheckout(runtime: RpcRuntime): Promise<boolean> {
    const decision = await this.withRuntimeAdmission(async () => {
      if (!this.runtimes.has(runtime.runtimeId)) return 'gone'
      if (!this.isIdle(runtime)) return 'busy'
      this.retiringRuntimes.add(runtime.runtimeId)
      return 'retiring'
    })
    if (decision === 'gone') return true
    if (decision === 'busy') return false
    try {
      const stopped = await runtime.stop()
      if (stopped && this.runtimes.get(runtime.runtimeId) === runtime) this.runtimes.delete(runtime.runtimeId)
      return stopped
    } finally {
      this.retiringRuntimes.delete(runtime.runtimeId)
    }
  }

  /** Busy from the runtime's activity and session actions, or from a prompt the manager is admitting. */
  private isBusy(runtime: RpcRuntime): boolean {
    const snapshot = runtime.snapshot()
    return snapshot.isStreaming || snapshot.isCompacting || Boolean(snapshot.sessionActions?.active) || this.promptAdmissions.has(runtime.runtimeId)
  }

  private isIdle(runtime: RpcRuntime): boolean {
    if (this.activeCommands.has(runtime.runtimeId)) return false
    if (this.startingRuntimes.has(runtime.runtimeId)) return false
    if (this.retiringRuntimes.has(runtime.runtimeId)) return false
    return !this.isBusy(runtime) && (runtime.snapshot().sessionActions?.queuedCount ?? 0) === 0
  }

  private requireOpen(): void {
    if (this.closed) throw new Error(`${this.adapter.agentName} manager is shutting down`)
  }

  private async admitRuntime(createRuntime: () => RpcRuntime): Promise<RpcRuntime> {
    return this.withRuntimeAdmission(async () => {
      this.requireOpen()
      await this.pruneIdleRuntimes(MAX_IDLE_RUNTIMES - 1)
      this.requireOpen()
      const runtime = createRuntime()
      this.runtimes.set(runtime.runtimeId, runtime)
      this.startingRuntimes.add(runtime.runtimeId)
      return runtime
    })
  }

  private async pruneIdleRuntimes(limit: number): Promise<void> {
    const now = Date.now()
    const idle = [...this.runtimes.values()].filter((runtime) => !this.attachmentPins.has(runtime.runtimeId) && this.isIdle(runtime))
      .sort((left, right) => (this.lastUsedAt.get(left.runtimeId) ?? now) - (this.lastUsedAt.get(right.runtimeId) ?? now))
    for (const [index, runtime] of idle.entries()) {
      if (this.attachmentPins.has(runtime.runtimeId) || !this.isIdle(runtime)) continue
      if (index >= idle.length - limit && now - (this.lastUsedAt.get(runtime.runtimeId) ?? now) < IDLE_RUNTIME_TTL_MS) continue
      this.retiringRuntimes.add(runtime.runtimeId)
      try {
        const stopped = await runtime.stop()
        if (stopped && this.runtimes.get(runtime.runtimeId) === runtime) this.runtimes.delete(runtime.runtimeId)
      } finally {
        this.retiringRuntimes.delete(runtime.runtimeId)
      }
    }
  }

  private async withRuntimeAdmission<T>(action: () => Promise<T>): Promise<T> {
    let releaseAdmission!: () => void
    const previousAdmission = this.runtimeAdmission
    this.runtimeAdmission = new Promise<void>((resolveAdmission) => { releaseAdmission = resolveAdmission })
    await previousAdmission
    try {
      return await action()
    } finally {
      releaseAdmission()
    }
  }

  private async decorate(runtime: RpcRuntime): Promise<void> {
    if (!this.providers) return
    const snapshot = runtime.snapshot()
    runtime.applyCapabilities(await this.providers.capabilities(snapshot.model?.provider, snapshot.model?.id))
  }

  private requireRuntime(value: unknown): RpcRuntime {
    const id = requireId(value, 'runtimeId')
    const runtime = this.runtimes.get(id)
    if (!runtime) throw new Error('Runtime was not found')
    return runtime
  }
}
