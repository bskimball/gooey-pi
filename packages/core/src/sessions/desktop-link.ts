import { connect, type Socket } from 'node:net'
import { realpath, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'
import { StrictJsonlDecoder } from '../jsonl'
import { isRecord, requireRecord, requireString } from '../validation'
import type { RuntimeInfo, TranscriptMessage } from '../types/api'

export interface DesktopSessionSnapshot {
  runtime: RuntimeInfo
  messages: TranscriptMessage[]
  dialogs: Record<string, unknown>[]
  statuses: Record<string, string>
}
export interface DesktopSessionClient {
  snapshot: DesktopSessionSnapshot
  command(command: Record<string, unknown>): Promise<Record<string, unknown>>
  close(): Promise<void>
}
export interface DesktopConnectOptions {
  sessionPath: string
  cwd: string
  onEvent(event: Record<string, unknown>): void
  onDisconnect(reason: string): void
  editorRequest(method: string, params: Record<string, unknown>): Promise<unknown>
}

export const DESKTOP_LINK_MAX_BYTES = 16 * 1024 * 1024
const MAX_PENDING = 64
const TIMEOUT_MS = 60_000
const UNKNOWN_OUTCOME = 'Desktop connection lost; command outcome unknown. Do not retry automatically.'
export function desktopLinksDir(): string { return join(homedir(), '.pi', 'agent', 'apex-desktop-links') }
export async function desktopCanonicalPath(path: string): Promise<string> {
  const resolved = normalize(await realpath(path))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Bounded JSONL duplex RPC. Request ids are scoped to each direction. */
export class DesktopLinkPeer {
  private nextId = 0
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer?: NodeJS.Timeout }>()
  private incoming = 0
  private ended = false
  onRequest: (method: string, params: Record<string, unknown>) => Promise<unknown> = async () => { throw new Error('Unsupported desktop request') }
  onEvent: (event: Record<string, unknown>) => void = () => undefined
  onClose: (reason: string) => void = () => undefined

  constructor(readonly socket: Socket) {
    const decoder = new StrictJsonlDecoder((line) => this.receive(requireRecord(JSON.parse(line), 'frame')), DESKTOP_LINK_MAX_BYTES)
    socket.on('data', (chunk) => { try { decoder.push(chunk) } catch { this.close('Invalid desktop protocol frame') } })
    socket.on('error', () => this.close(UNKNOWN_OUTCOME))
    socket.on('close', () => this.close(UNKNOWN_OUTCOME))
  }

  send(frame: Record<string, unknown>): void {
    if (this.ended) throw new Error(UNKNOWN_OUTCOME)
    const payload = `${JSON.stringify(frame)}\n`
    if (Buffer.byteLength(payload) > DESKTOP_LINK_MAX_BYTES || this.socket.writableLength + Buffer.byteLength(payload) > DESKTOP_LINK_MAX_BYTES * 2) {
      this.close('Desktop transport buffer limit exceeded; command outcome unknown. Do not retry automatically.')
      throw new Error(UNKNOWN_OUTCOME)
    }
    this.socket.write(payload)
  }

  request(method: string, params: Record<string, unknown>, timeoutMs = TIMEOUT_MS): Promise<unknown> {
    if (this.ended) return Promise.reject(new Error(UNKNOWN_OUTCOME))
    if (this.pending.size >= MAX_PENDING) return Promise.reject(new Error('Too many pending desktop requests'))
    const id = String(++this.nextId)
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => this.close('Desktop request timed out; command outcome unknown. Do not retry automatically.'), timeoutMs) : undefined
      timer?.unref()
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ kind: 'request', id, method, params }) } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  close(reason = 'Desktop client detached'): void {
    if (this.ended) return
    this.ended = true
    this.socket.destroy()
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new Error(`${reason} ${UNKNOWN_OUTCOME}`)) }
    this.pending.clear()
    this.onClose(reason)
  }

  private receive(frame: Record<string, unknown>): void {
    if (frame.kind === 'event') { this.onEvent(requireRecord(frame.event, 'event')); return }
    const id = requireString(frame.id, 'id', { min: 1, max: 32 })
    if (frame.kind === 'response') {
      const call = this.pending.get(id)
      if (!call) throw new Error('Unexpected desktop response')
      this.pending.delete(id)
      clearTimeout(call.timer)
      if (typeof frame.error === 'string') call.reject(new Error(frame.error))
      else call.resolve(frame.result)
      return
    }
    if (frame.kind !== 'request' || ++this.incoming > MAX_PENDING) throw new Error('Invalid desktop request')
    const method = requireString(frame.method, 'method', { min: 1, max: 128 })
    const params = requireRecord(frame.params, 'params')
    void this.onRequest(method, params).then(
      (result) => this.send({ kind: 'response', id, result }),
      (error: unknown) => this.send({ kind: 'response', id, error: error instanceof Error ? error.message : 'Desktop request failed' }),
    ).catch(() => this.close(UNKNOWN_OUTCOME)).finally(() => { this.incoming -= 1 })
  }
}

function snapshotFromWire(raw: unknown): DesktopSessionSnapshot {
  const value = requireRecord(raw, 'snapshot')
  const runtime = requireRecord(value.runtime, 'runtime')
  requireString(runtime.runtimeId, 'runtime.runtimeId', { min: 1, max: 256 })
  requireString(runtime.cwd, 'runtime.cwd', { min: 1, max: 4096 })
  if (!Array.isArray(value.messages) || !Array.isArray(value.dialogs) || !value.messages.every((row) => isRecord(row) && typeof row.id === 'string' && Array.isArray(row.parts)) || !value.dialogs.every(isRecord)) throw new Error('Invalid desktop snapshot')
  const statuses = requireRecord(value.statuses, 'statuses')
  if (!Object.values(statuses).every((text) => typeof text === 'string')) throw new Error('Invalid desktop statuses')
  // Full runtime/message shapes are produced by the authenticated Desktop manager.
  return value as unknown as DesktopSessionSnapshot
}

/** null means no live Desktop owns this session. Authorization/protocol errors throw. */
export async function connectDesktopSession(options: DesktopConnectOptions): Promise<DesktopSessionClient | null> {
  return connectDesktopSessionInDirectory(options, desktopLinksDir())
}

/** Explicit directory seam for isolated local socket contract tests. */
export async function connectDesktopSessionInDirectory(options: DesktopConnectOptions, directory: string): Promise<DesktopSessionClient | null> {
  let names: string[]
  try { names = await readdir(directory) } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return null
    throw error
  }
  for (const name of names.filter((entry) => /^desktop-\d+\.json$/.test(entry)).slice(0, 128)) {
    let endpoint: Record<string, unknown>
    try {
      if ((await stat(join(directory, name))).size > 4096) throw new Error('Invalid desktop endpoint record')
      endpoint = requireRecord(JSON.parse(await readFile(join(directory, name), 'utf8')), 'endpoint')
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') continue
      throw error
    }
    if (!Number.isInteger(endpoint.pid) || typeof endpoint.pid !== 'number' || endpoint.pid <= 0) throw new Error('Invalid desktop endpoint PID')
    try { process.kill(endpoint.pid, 0) } catch { continue }
    if (!Number.isInteger(endpoint.port) || typeof endpoint.port !== 'number' || endpoint.port < 1 || endpoint.port > 65535) throw new Error('Invalid desktop endpoint port')
    if (endpoint.version !== 1) throw new Error('Unsupported Desktop endpoint version')
    const token = requireString(endpoint.token, 'token', { min: 64, max: 64 })
    const socket = connect(endpoint.port, '127.0.0.1')
    const connected = await new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('Desktop endpoint connection timed out')) }, 3000)
      socket.once('connect', () => { clearTimeout(timer); resolve(true) })
      socket.once('error', (error) => {
        clearTimeout(timer)
        if ('code' in error && error.code === 'ECONNREFUSED') resolve(false)
        else reject(error)
      })
    })
    if (!connected) continue
    const peer = new DesktopLinkPeer(socket)
    const queued: Record<string, unknown>[] = []
    let queuedBytes = 0
    let ready = false
    let detached = false
    let dropped: string | undefined
    peer.onEvent = (event) => {
      if (ready) options.onEvent(event)
      else {
        queuedBytes += Buffer.byteLength(JSON.stringify(event))
        if (queued.length >= 1024 || queuedBytes > DESKTOP_LINK_MAX_BYTES) { peer.close('Desktop initial event queue overflow'); return }
        queued.push(event)
      }
    }
    peer.onClose = (reason) => { dropped = reason; if (ready && !detached) options.onDisconnect(reason) }
    peer.onRequest = (method, params) => {
      if (!method.startsWith('editor.')) throw new Error('Unsupported reverse desktop method')
      return options.editorRequest(method, params)
    }
    try {
      const raw = await peer.request('attach', { version: 1, token, sessionPath: options.sessionPath, cwd: options.cwd })
      if (raw === null) { peer.close(); continue }
      const snapshot = snapshotFromWire(raw)
      // A macrotask guarantees consumer initialization after the returned promise resolves.
      setTimeout(() => {
        if (detached) return
        ready = true
        for (const event of queued.splice(0)) options.onEvent(event)
        if (dropped) options.onDisconnect(dropped)
      }, 0)
      return {
        snapshot,
        // The owning runtime enforces command deadlines and pauses them for dialogs.
        command: async (command) => requireRecord(await peer.request('command', { command }, 0), 'command response'),
        close: async () => {
          detached = true
          try { await peer.request('detach', {}) } catch { /* A disconnected client no longer controls the editor. */ }
          peer.close()
        },
      }
    } catch (error) { detached = true; peer.close(); throw error }
  }
  return null
}
