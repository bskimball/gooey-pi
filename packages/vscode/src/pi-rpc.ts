import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { StrictJsonlDecoder } from 'apex-core/jsonl'
import { RPC_READ_FRAME_LIMIT_BYTES } from 'apex-core/jsonl-limits'
import type { PiInvocation } from 'apex-core/pi-harness'
import { isRecord } from 'apex-core/validation'

export { type PiInvocation, resolvePiExecutable as resolvePi } from 'apex-core/pi-harness'

type Json = Record<string, unknown>

/** JSONL RPC client for `pi --mode rpc` (see pi docs/rpc.md). */
export class PiRpc {
  private child: ChildProcessWithoutNullStreams
  private nextId = 1
  private pending = new Map<string, { resolve(data: unknown): void; reject(error: Error): void }>()
  private stderrTail = ''

  constructor(
    invocation: PiInvocation,
    args: string[],
    cwd: string,
    private readonly onRecord: (record: Json) => void,
    onExit: (code: number | null, stderr: string) => void,
    environment: NodeJS.ProcessEnv = {},
  ) {
    this.child = spawn(invocation.file, [...invocation.args, ...args], { cwd, env: { ...process.env, ...environment }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const fail = (error: Error) => {
      for (const { reject } of this.pending.values()) reject(error)
      this.pending.clear()
    }
    let frameFailed = false
    const decoder = new StrictJsonlDecoder((line) => this.read(line), RPC_READ_FRAME_LIMIT_BYTES)
    const frameError = (error: unknown) => {
      frameFailed = true
      const failure = error instanceof Error ? error : new Error(String(error))
      this.stderrTail = failure.message
      fail(failure)
      this.child.kill()
    }
    this.child.stdout.on('data', (chunk: Buffer) => {
      if (frameFailed) return
      try {
        decoder.push(chunk)
      } catch (error) {
        frameError(error)
      }
    })
    this.child.stdout.on('end', () => {
      if (frameFailed) return
      try {
        decoder.end()
      } catch (error) {
        frameError(error)
      }
    })
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-4000)
    })
    this.child.on('error', (error) => {
      fail(error)
      onExit(null, error.message)
    })
    this.child.on('exit', (code) => {
      fail(new Error(`Pi exited (code ${code})`))
      onExit(code, this.stderrTail.trim())
    })
  }

  private read(line: string) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      return
    }
    if (!isRecord(record)) return
    if (record.type === 'response' && typeof record.id === 'string' && this.pending.has(record.id)) {
      const waiter = this.pending.get(record.id)!
      this.pending.delete(record.id)
      if (record.success === false) waiter.reject(new Error(String(record.error ?? `${String(record.command)} failed`)))
      else waiter.resolve(record.data)
      return
    }
    this.onRecord(record)
  }

  private write(record: Json) {
    if (this.child.stdin.writable) this.child.stdin.write(`${JSON.stringify(record)}\n`)
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
