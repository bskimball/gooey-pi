import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

type Json = Record<string, unknown>

export interface PiInvocation { file: string; args: string[] }

// Same entrypoints pi-desktop probes behind the Windows npm shim (electron/main/harness.ts).
const WINDOWS_ENTRYPOINTS = [
  ['@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js'],
  ['@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'],
  ['@mariozechner', 'pi-coding-agent', 'dist', 'cli.js'],
]

/**
 * Windows can't spawn npm's pi.cmd without a shell, so run the shim's cli.js with node directly,
 * like pi-desktop does. Other platforms run the pi executable.
 */
export function resolvePi(configuredPath: string): PiInvocation {
  if (process.platform !== 'win32') return { file: configuredPath || 'pi', args: [] }
  const shims = [
    configuredPath,
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'pi.cmd') : '',
    ...(process.env.PATH ?? '').split(';').filter(Boolean).map((dir) => join(dir, 'pi.cmd')),
  ].filter(Boolean)
  for (const shim of shims) {
    if (!existsSync(shim)) continue
    if (shim.toLowerCase().endsWith('.js')) return { file: 'node', args: [shim] }
    const dir = dirname(shim)
    const node = existsSync(join(dir, 'node.exe')) ? join(dir, 'node.exe') : 'node'
    const known = WINDOWS_ENTRYPOINTS.map((parts) => join(dir, 'node_modules', ...parts)).find((file) => existsSync(file))
    const fromShim = /"%dp0%\\([^"]+\.js)"/.exec(readFileSync(shim, 'utf8'))?.[1]
    const cli = known ?? (fromShim ? join(dir, fromShim) : undefined)
    if (cli && existsSync(cli)) return { file: node, args: [cli] }
  }
  throw new Error('Pi was not found. Install it with `npm install -g @earendil-works/pi-coding-agent`, or set `apex.piPath`.')
}

/** JSONL RPC client for `pi --mode rpc` (see pi docs/rpc.md). */
export class PiRpc {
  private child: ChildProcessWithoutNullStreams
  private buffer = ''
  private nextId = 1
  private pending = new Map<string, { resolve(data: unknown): void; reject(error: Error): void }>()
  private stderrTail = ''

  constructor(invocation: PiInvocation, args: string[], cwd: string, private readonly onRecord: (record: Json) => void, onExit: (code: number | null, stderr: string) => void, environment: NodeJS.ProcessEnv = {}) {
    this.child = spawn(invocation.file, [...invocation.args, ...args], { cwd, env: { ...process.env, ...environment }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.read(chunk))
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => { this.stderrTail = (this.stderrTail + chunk).slice(-4000) })
    const fail = (error: Error) => { for (const { reject } of this.pending.values()) reject(error); this.pending.clear() }
    this.child.on('error', (error) => { fail(error); onExit(null, error.message) })
    this.child.on('exit', (code) => { fail(new Error(`Pi exited (code ${code})`)); onExit(code, this.stderrTail.trim()) })
  }

  // Split only on LF: readline would also split on U+2028/U+2029, which are valid inside JSON strings.
  private read(chunk: string) {
    this.buffer += chunk
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      if (!line.trim()) continue
      let record: Json
      try { record = JSON.parse(line) } catch { continue }
      if (record.type === 'response' && typeof record.id === 'string' && this.pending.has(record.id)) {
        const waiter = this.pending.get(record.id)!
        this.pending.delete(record.id)
        if (record.success === false) waiter.reject(new Error(String(record.error ?? `${String(record.command)} failed`)))
        else waiter.resolve(record.data)
        continue
      }
      this.onRecord(record)
    }
  }

  private write(record: Json) {
    if (this.child.stdin.writable) this.child.stdin.write(JSON.stringify(record) + '\n')
  }

  command<T = Json>(type: string, fields: Json = {}): Promise<T> {
    const id = `apex-${this.nextId++}`
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (data: unknown) => void, reject })
      this.write({ ...fields, id, type })
    })
  }

  /** extension_ui_response has no command response; it reuses the request id. */
  respondToUi(id: string, response: Json) {
    this.write({ type: 'extension_ui_response', id, ...response })
  }

  /** Closing stdin asks pi for an orderly shutdown. */
  dispose() {
    this.child.stdin.end()
    const timer = setTimeout(() => this.child.kill(), 3000)
    this.child.once('exit', () => clearTimeout(timer))
  }
}
