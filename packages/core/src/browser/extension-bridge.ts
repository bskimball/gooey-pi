import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { callMethod, probeBroker } from './extension-bridge-client'

export interface ExtensionCommand {
  id: string
  method: string
  params: Record<string, unknown>
}
export interface ExtensionBridgeOptions {
  port?: number
  commandTimeoutMs?: number
  bridgeKind?: 'desktop' | 'vscode'
}

/** Separate from CapabilityBridge because Chrome extensions send an Origin header. */
export class ExtensionBrowserBridge {
  private server: Server | null = null
  private stream: ServerResponse | null = null
  private token = ''
  private heartbeat: NodeJS.Timeout | null = null
  private readonly pending = new Map<
    string,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: NodeJS.Timeout
    }
  >()
  private readonly events = new Set<(event: Record<string, unknown>) => void>()
  private readonly changes = new Set<() => void>()
  private context: () => Record<string, unknown> = () => ({})
  private readonly tabState = new Map<number, Record<string, unknown>>()
  private readonly remoteTabs = new Set<number>()
  private readonly releasedTabs = new Set<number>()
  private remoteBase: string | null = null
  private remoteConnected = false
  private polling: NodeJS.Timeout | null = null
  private refresh: Promise<void> | null = null
  private disposed = false
  private latestSession: string | null | undefined
  port: number | null = null

  async startOrConnect(onlyKind?: 'vscode', base = 'http://127.0.0.1:29301'): Promise<void> {
    const broker = await probeBroker(base)
    if (broker.running && (!onlyKind || broker.kind === onlyKind)) {
      this.remoteBase = base
      this.port = Number(new URL(base).port)
      await this.refreshState()
    } else {
      await this.start()
      if (this.port !== Number(new URL(base).port) && this.options.port !== 0) {
        let winner = await probeBroker(base)
        if (!winner.running) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          winner = await probeBroker(base)
        }
        if (winner.running && (!onlyKind || winner.kind === onlyKind)) {
          await this.stop()
          this.disposed = false
          this.remoteBase = base
          this.port = Number(new URL(base).port)
          await this.refreshState()
        }
      }
    }
  }

  async refreshState(): Promise<void> {
    if (!this.remoteBase || this.disposed) return
    if (this.refresh) return this.refresh
    this.refresh = this.readRemoteState().finally(() => {
      this.refresh = null
    })
    return this.refresh
  }

  private async readRemoteState(): Promise<void> {
    try {
      const base = this.remoteBase
      const hello = await fetch(`${base}/v1/extension/hello`, { signal: AbortSignal.timeout(500) })
      const identity = (await hello.json()) as { token: string }
      this.token = identity.token
      const response = await fetch(`${base}/v1/extension/tab-state`, { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(500) })
      if (!response.ok) throw new Error('Broker state unavailable')
      const state = (await response.json()) as { connected: boolean; tabs: Record<string, unknown>[] }
      if (this.disposed) return
      this.remoteConnected = state.connected
      const context = this.context()
      const ownTabs = Array.isArray(context.tabs) ? (context.tabs as Record<string, unknown>[]) : []
      const sessions = new Set(ownTabs.map((tab) => tab.sessionFile))
      sessions.add(context.activeSessionKey)
      const seen = new Set<number>()
      for (const tab of state.tabs) {
        if (typeof tab.chromeTabId !== 'number' || !sessions.has(tab.sessionKey)) continue
        seen.add(tab.chromeTabId)
        const existing = ownTabs.find((item) => item.chromeTabId === tab.chromeTabId)
        if (!existing) this.emitEvent({ ...tab, type: 'tab_paired' })
        this.emitEvent({ ...tab, type: 'tab_updated' })
        if (typeof tab.paused === 'boolean' && existing?.paused !== tab.paused) this.emitEvent({ ...tab, type: 'tab_pause_changed' })
      }
      for (const tab of ownTabs) {
        if (typeof tab.chromeTabId === 'number' && !seen.has(tab.chromeTabId)) this.emitEvent({ ...tab, type: 'tab_closed' })
      }
    } catch {
      this.remoteConnected = false
    }
    if (!this.disposed) this.changed()
  }

  async setActiveSession(sessionKey: string | null): Promise<void> {
    if (!this.remoteBase) return
    if (this.polling) clearInterval(this.polling)
    this.polling = null
    if (sessionKey !== null) {
      this.polling = setInterval(() => {
        void this.refreshState()
      }, 2000)
      this.polling.unref?.()
      await this.refreshState()
    }
  }

  private emitEvent(event: Record<string, unknown>): void {
    for (const listener of this.events) listener(event)
  }

  private snapshot(): Record<string, unknown>[] {
    const context = this.context()
    if (Array.isArray(context.tabs)) this.rememberTabs(context.tabs)
    return [...this.tabState.values()]
  }

  private rememberTabs(tabs: unknown[], remote = false): void {
    for (const tab of tabs) {
      if (!tab || typeof tab !== 'object' || !('chromeTabId' in tab) || typeof tab.chromeTabId !== 'number') continue
      if (this.releasedTabs.has(tab.chromeTabId)) continue
      if (!remote && this.remoteTabs.has(tab.chromeTabId)) continue
      if (remote) this.remoteTabs.add(tab.chromeTabId)
      const record = tab as Record<string, unknown>
      const previous = this.tabState.get(tab.chromeTabId)
      this.tabState.set(tab.chromeTabId, { ...previous, ...record, paused: previous?.paused ?? record.paused, sessionKey: previous?.sessionKey ?? record.sessionKey ?? record.sessionFile })
    }
  }

  constructor(private readonly options: ExtensionBridgeOptions = {}) {}

  setContext(context: () => Record<string, unknown>): void {
    this.context = context
  }
  onEvent(listener: (event: Record<string, unknown>) => void): () => void {
    this.events.add(listener)
    return () => {
      this.events.delete(listener)
    }
  }
  onChanged(listener: () => void): () => void {
    this.changes.add(listener)
    return () => {
      this.changes.delete(listener)
    }
  }
  isConnected(): boolean {
    return this.remoteBase ? this.remoteConnected : this.stream !== null && !this.stream.destroyed
  }
  private changed(): void {
    for (const listener of this.changes) listener()
  }

  async start(): Promise<void> {
    if (this.server) return
    const listen = (port: number) =>
      new Promise<void>((resolve, reject) => {
        const server = createServer((request, response) => {
          void this.handle(request, response)
        })
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject)
          this.server = server
          const address = server.address()
          this.port = typeof address === 'object' && address ? address.port : null
          resolve()
        })
      })
    try {
      await listen(this.options.port ?? 29301)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE' || this.options.port === 0) throw error
      await listen(0)
    }
    this.changed()
  }

  private disconnect(): void {
    this.stream?.end()
    this.stream = null
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Browser extension disconnected. Reconnect it and try again.'))
    }
    this.pending.clear()
    this.changed()
  }

  async stop(): Promise<void> {
    this.disposed = true
    if (this.polling) clearInterval(this.polling)
    this.polling = null
    await this.refresh
    this.disconnect()
    this.token = ''
    this.tabState.clear()
    this.remoteTabs.clear()
    const server = this.server
    this.server = null
    this.port = null
    if (server)
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
  }

  async call(method: string, params: Record<string, unknown> = {}, sessionKey?: string, remote = false): Promise<unknown> {
    if (this.remoteBase) {
      const context = this.context()
      return callMethod(method, params, this.token, this.remoteBase, sessionKey ?? (typeof context.activeSessionKey === 'string' ? context.activeSessionKey : undefined))
    }
    if (method === 'release_tab' && typeof params.chromeTabId === 'number') {
      this.releasedTabs.add(params.chromeTabId)
      this.tabState.delete(params.chromeTabId)
      this.remoteTabs.delete(params.chromeTabId)
      if (this.isConnected()) await this.sendCommand('sync_tab_state', { tabs: this.snapshot() })
      return true
    }
    if (method === 'sync_tab_state') {
      if ('activeSessionKey' in params) this.latestSession = typeof params.activeSessionKey === 'string' ? params.activeSessionKey : null
      if (Array.isArray(params.tabs)) {
        this.rememberTabs(params.tabs, remote)
        params = { ...params, tabs: this.snapshot() }
      }
      // setTabPaused sends a targeted command, not a tabs snapshot.
      // Explicit user intent may change pause state; stale snapshots may not.
      if (!Array.isArray(params.tabs) && typeof params.chromeTabId === 'number' && typeof params.paused === 'boolean') {
        const tab = this.tabState.get(params.chromeTabId)
        if (tab) tab.paused = params.paused
      }
    }
    const result = await this.sendCommand(method, params)
    if (method === 'create_tab' && typeof result === 'number') {
      if (remote) this.remoteTabs.add(result)
      this.tabState.set(result, { chromeTabId: result, sessionKey: sessionKey ?? this.context().activeSessionKey, url: params.url, paused: false })
    }
    if (method === 'close_tab' && typeof params.chromeTabId === 'number') {
      this.tabState.delete(params.chromeTabId)
      this.remoteTabs.delete(params.chromeTabId)
    }
    return result
  }

  private sendCommand(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.isConnected()) return Promise.reject(new Error('Browser extension is not connected'))
    const id = randomBytes(12).toString('hex')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Browser extension command timed out: ${method}`))
      }, this.options.commandTimeoutMs ?? 20_000)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      this.stream!.write(`data: ${JSON.stringify({ id, method, params } satisfies ExtensionCommand)}\n\n`)
    })
  }

  private async body(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > 8 * 1024 * 1024) throw new Error('Extension payload is too large')
      chunks.push(chunk)
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
    return value as Record<string, unknown>
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = request.headers.origin
    if (origin && !/^chrome-extension:\/\/[a-z]{32}$/.test(origin)) {
      response.writeHead(403).end('Origin is not allowed')
      return
    }
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()
      return
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
    }
    try {
      if (url.pathname === '/v1/extension/status' && request.method === 'GET') {
        json(200, { ok: true, bridge: 'apex', version: 1, kind: this.options.bridgeKind ?? 'desktop' })
        return
      }
      if (url.pathname === '/v1/extension/execute' && origin) {
        json(403, { error: 'Origin is not allowed' })
        return
      }
      if ((url.pathname === '/v1/extension/hello' && request.method === 'GET') || (url.pathname === '/v1/extension/connect' && ['GET', 'POST'].includes(request.method ?? ''))) {
        if (!this.token) this.token = randomBytes(32).toString('hex')
        json(200, { ...this.context(), token: this.token, tabs: this.snapshot() })
        return
      }
      if (!this.token || request.headers.authorization !== `Bearer ${this.token}`) {
        json(401, { error: 'Invalid extension token' })
        return
      }
      if (url.pathname === '/v1/extension/tab-state' && request.method === 'GET') {
        // Chrome's sync_tab_state is write-only; clients need attributed state.
        json(200, { connected: this.isConnected(), tabs: this.snapshot() })
        return
      }
      if (url.pathname === '/v1/extension/events' && request.method === 'GET') {
        this.disconnect()
        this.stream = response
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          Connection: 'keep-alive',
        })
        response.write(': connected\n\n')
        this.heartbeat = setInterval(() => {
          response.write(': heartbeat\n\n')
        }, 15_000)
        this.heartbeat.unref?.()
        response.on('close', () => {
          if (this.stream === response) this.disconnect()
        })
        this.changed()
        return
      }
      if (request.method !== 'POST') {
        json(404, { error: 'Unknown endpoint' })
        return
      }
      const body = await this.body(request)
      if (url.pathname === '/v1/extension/execute') {
        // This server binds only to 127.0.0.1. Native clients reuse the
        // existing unauthenticated hello token, not agent capability claims.
        if (typeof body.method !== 'string' || !body.method || !body.params || typeof body.params !== 'object' || Array.isArray(body.params)) throw new TypeError('Expected method and params')
        if (!this.isConnected() && body.method !== 'release_tab') {
          json(503, { error: 'extension_not_connected' })
          return
        }
        if (body.sessionKey !== undefined && typeof body.sessionKey !== 'string') throw new TypeError('Invalid sessionKey')
        json(200, { result: await this.call(body.method, body.params as Record<string, unknown>, body.sessionKey as string | undefined, true) })
        return
      }
      if (url.pathname === '/v1/extension/result') {
        if (typeof body.id !== 'string') throw new Error('Command id is required')
        const pending = this.pending.get(body.id)
        if (pending) {
          this.pending.delete(body.id)
          clearTimeout(pending.timer)
          if (typeof body.error === 'string') pending.reject(new Error(body.error))
          else pending.resolve(body.result)
        }
      } else if (url.pathname === '/v1/extension/event') {
        if (typeof body.chromeTabId === 'number') {
          if (this.releasedTabs.has(body.chromeTabId) && body.type !== 'tab_paired') {
            json(200, { ok: true })
            return
          }
          const previous = this.tabState.get(body.chromeTabId)
          // Popup pairing has no caller identity. Unregistered shared tabs
          // belong to the most recently active session across both apps.
          body.sessionKey = previous?.sessionKey ?? body.sessionKey ?? this.latestSession ?? this.context().activeSessionKey
          if (body.type === 'tab_paired') this.releasedTabs.delete(body.chromeTabId)
          if (body.type === 'tab_closed' || body.type === 'tab_unpaired') {
            this.releasedTabs.add(body.chromeTabId)
            this.tabState.delete(body.chromeTabId)
            this.remoteTabs.delete(body.chromeTabId)
          } else if (!this.releasedTabs.has(body.chromeTabId)) this.tabState.set(body.chromeTabId, { ...previous, ...body })
        }
        this.emitEvent(body)
      } else {
        json(404, { error: 'Unknown endpoint' })
        return
      }
      json(200, { ok: true })
    } catch (error) {
      json(400, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
