import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:net'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DesktopLinkPeer, desktopCanonicalPath, desktopLinksDir } from 'apex-core/sessions/desktop-link'
import { canonicalSessionPath } from 'apex-core/session-paths'
import { requireRecord, requireString } from 'apex-core/validation'
import type { AgentRpcManager } from './agent-rpc'
import { CapabilityBridge, type CapabilityClaim } from 'apex-core/lib/capability-bridge'

class DesktopEditorBridge extends CapabilityBridge {
  protected readonly rateLimit = 240
  protected readonly rateLimitError = 'Editor request rate limit exceeded'
  private readonly runtimeIds = new Map<string, string>()
  constructor(private readonly link: DesktopLinkServer) { super() }
  protected environmentEntries(url: string, token: string): NodeJS.ProcessEnv { return { APEX_EDITOR_URL: url, APEX_EDITOR_TOKEN: token } }
  bindRuntime(token: string | undefined, runtimeId: string) {
    if (token && this.claimForToken(token)) this.runtimeIds.set(token, runtimeId)
  }
  override revoke(token: string | undefined): boolean {
    if (token) this.runtimeIds.delete(token)
    return super.revoke(token)
  }
  protected dispatch(method: string, params: Record<string, unknown>, claim: CapabilityClaim): Promise<unknown> {
    const runtimeId = this.runtimeIds.get(claim.token)
    if (!runtimeId) throw new Error('Editor runtime is not ready')
    return this.link.editorRequestForRuntime(runtimeId, claim.cwd, method, params)
  }
}

const ALLOWED = new Set([
  'attached_prompt', 'prompt', 'steer', 'follow_up', 'abort', 'abort_retry', 'compact',
  'set_model', 'cycle_model', 'set_thinking_level', 'cycle_thinking_level', 'set_session_name',
  'get_state', 'get_session_stats', 'get_available_models', 'get_commands', 'get_last_assistant_text',
  'get_messages', 'get_available_thinking_levels', 'clear_queue', 'set_steering_mode', 'set_follow_up_mode', 'extension_ui_response',
])
interface Attachment { peer: DesktopLinkPeer; runtimeId: string; session: string; cwd: string; release(): void }

/** One authenticated local endpoint per Desktop process; one editor per runtime. */
export class DesktopLinkServer {
  readonly editor = new DesktopEditorBridge(this)
  private server: Server | undefined
  private readonly token = randomBytes(32).toString('hex')
  private readonly peers = new Set<DesktopLinkPeer>()
  private readonly attachments = new Map<string, Attachment>()
  private unsubscribe: (() => void) | undefined
  private readonly record: string
  private stopped = false

  constructor(private readonly manager: AgentRpcManager, private readonly authorizeCwd: (cwd: string) => Promise<string>, private readonly directory = desktopLinksDir()) {
    this.record = join(directory, `desktop-${process.pid}.json`)
  }

  async start(): Promise<void> {
    if (this.server) return
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const server = createServer((socket) => {
      if (this.peers.size >= 64) { socket.destroy(); return }
      const peer = new DesktopLinkPeer(socket)
      this.peers.add(peer)
      let attachment: Attachment | undefined
      let attaching = false
      const deadline = setTimeout(() => { if (!attachment) peer.close('Desktop attach timed out') }, 10_000)
      deadline.unref()
      peer.onClose = () => {
        clearTimeout(deadline)
        this.peers.delete(peer)
        if (attachment && this.attachments.get(attachment.runtimeId) === attachment) {
          this.attachments.delete(attachment.runtimeId)
          attachment.release()
        }
      }
      peer.onRequest = async (method, params) => {
        if (method === 'attach') {
          if (attachment || attaching) throw new Error('Desktop client is already attaching or attached')
          attaching = true
          try {
            if (params.version !== 1) throw new Error('Unsupported Desktop protocol version')
            const token = requireString(params.token, 'token', { min: 64, max: 64 })
            if (!/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(this.token))) throw new Error('Desktop authentication failed')
            const path = requireString(params.sessionPath, 'sessionPath', { min: 1, max: 4096 })
            const runtime = this.manager.getForSession(path)
            if (!runtime) return null
            const cwd = await desktopCanonicalPath(await this.authorizeCwd(requireString(params.cwd, 'cwd', { min: 1, max: 4096 })))
            const session = await desktopCanonicalPath(path)
            if (cwd !== await desktopCanonicalPath(runtime.cwd)) throw new Error('Desktop session workspace does not match')
            if (!runtime.sessionFile || session !== await desktopCanonicalPath(runtime.sessionFile)) throw new Error('Desktop session path does not match')
            // All awaits precede this synchronous snapshot/subscription boundary.
            const current = this.manager.getForSession(path)
            if (!current || current.runtimeId !== runtime.runtimeId || this.stopped || !this.peers.has(peer)) throw new Error('Desktop session changed during attachment')
            if (this.attachments.has(runtime.runtimeId)) throw new Error('This Desktop session already has a controlling editor client')
            const snapshot = this.manager.sessionSnapshot(runtime.runtimeId)
            attachment = { peer, runtimeId: runtime.runtimeId, cwd, session, release: this.manager.pinAttachment(runtime.runtimeId) }
            this.attachments.set(runtime.runtimeId, attachment)
            clearTimeout(deadline)
            return snapshot
          } finally { attaching = false }
        }
        if (!attachment) throw new Error('Desktop attachment required')
        if (method === 'detach') {
          this.attachments.delete(attachment.runtimeId)
          attachment.release()
          attachment = undefined
          return {}
        }
        if (method !== 'command') throw new Error('Unsupported desktop method')
        const command = requireRecord(params.command, 'command')
        if (typeof command.type !== 'string' || !ALLOWED.has(command.type)) throw new Error('Command is not allowed for an attached Desktop session')
        await this.validateAttachment(attachment)
        // No awaits after the final identity check and before manager admission.
        this.requireCurrent(attachment)
        return this.manager.command(attachment.runtimeId, command)
      }
    })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Desktop endpoint did not bind')
    this.unsubscribe = this.manager.subscribe(({ runtimeId, event }) => {
      const attachment = this.attachments.get(runtimeId)
      if (!attachment) return
      if (event.type === 'runtime_exit' || event.type === 'desktop_session_revoked') {
        attachment.peer.close('Desktop runtime ended or changed; command outcome unknown. Do not retry automatically.')
        return
      }
      try {
        this.requireCurrent(attachment)
        attachment.peer.send({ kind: 'event', event })
      } catch { attachment.peer.close('Desktop session changed; command outcome unknown. Do not retry automatically.') }
    })
    const temporary = `${this.record}.${this.token}.tmp`
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, pid: process.pid, port: address.port, token: this.token }), { mode: 0o600 })
      await rename(temporary, this.record)
    } catch (error) { await this.stop(); throw error }
    finally { await rm(temporary, { force: true }) }
    await this.editor.start()
  }

  private requireCurrent(attachment: Attachment): void {
    const runtime = this.manager.list().find((item) => item.runtimeId === attachment.runtimeId)
    if (this.attachments.get(attachment.runtimeId) !== attachment || !runtime?.sessionFile || canonicalSessionPath(runtime.sessionFile) !== canonicalSessionPath(attachment.session)) throw new Error('Desktop session attachment was revoked')
  }

  private async validateAttachment(attachment: Attachment): Promise<void> {
    this.requireCurrent(attachment)
    const snapshot = this.manager.sessionSnapshot(attachment.runtimeId)
    if (await desktopCanonicalPath(snapshot.runtime.cwd) !== attachment.cwd || !snapshot.runtime.sessionFile || await desktopCanonicalPath(snapshot.runtime.sessionFile) !== attachment.session) {
      attachment.peer.close('Desktop workspace or session changed')
      throw new Error('Desktop workspace or session changed')
    }
  }

  editorRequestForRuntime(runtimeId: string, cwd: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const runtime = this.manager.list().find((item) => item.runtimeId === runtimeId)
    if (!runtime?.sessionFile) throw new Error('Editor runtime is no longer available')
    return this.editorRequest(runtime.sessionFile, cwd, method, params)
  }

  async editorRequest(sessionPath: string, cwd: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!method.startsWith('editor.')) throw new Error('Unsupported editor method')
    const runtime = this.manager.getForSession(sessionPath)
    const attachment = runtime && this.attachments.get(runtime.runtimeId)
    if (!attachment) throw new Error('No editor client is attached to this Desktop session')
    await this.validateAttachment(attachment)
    if (await desktopCanonicalPath(cwd) !== attachment.cwd) throw new Error('Editor workspace does not match the runtime claim')
    this.requireCurrent(attachment)
    return attachment.peer.request(method, { ...params, cwd: attachment.cwd })
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    await this.editor.stop()
    for (const peer of this.peers) peer.close('Desktop is shutting down; command outcome unknown. Do not retry automatically.')
    const server = this.server
    this.server = undefined
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(this.record, { force: true })
  }
}
