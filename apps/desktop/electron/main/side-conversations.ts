import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalSessionPath } from 'apex-core/session-paths'
import { isRecord, rejectUnknownKeys, requireId, requireRecord, requireString } from 'apex-core/validation'
import type { SideConversation, SideReturnContext } from '../../src/types/api'
import type { AgentRpcManager } from './agent-rpc'
import type { SessionService } from './sessions'

/** Persistent session policy and parent link. Read/search tools are not an OS sandbox. */
export class SideConversations {
  constructor(
    private readonly directory: string,
    private readonly sessions: Pick<SessionService, 'create' | 'list' | 'requireSessionPath'>,
    private readonly manager: AgentRpcManager,
    private readonly authorizeCwd: (cwd: string) => Promise<string>,
  ) { mkdirSync(directory, { recursive: true, mode: 0o700 }) }
  private path(session: string): string {
    return join(this.directory, `${createHash('sha256').update(canonicalSessionPath(session)).digest('hex')}.json`)
  }
  private parse(raw: unknown): SideConversation {
    if (!isRecord(raw) || raw.policy !== 'read-only-tools' || typeof raw.sessionFile !== 'string' || typeof raw.parentSession !== 'string' || typeof raw.cwd !== 'string' || typeof raw.createdAt !== 'string' || (raw.initialContext !== undefined && typeof raw.initialContext !== 'string')) throw new Error('Invalid side conversation metadata; refusing to remove its policy')
    return { sessionFile: raw.sessionFile, parentSession: raw.parentSession, cwd: raw.cwd, createdAt: raw.createdAt, policy: 'read-only-tools', ...(raw.initialContext === undefined ? {} : { initialContext: raw.initialContext }) }
  }
  private load(session: string): SideConversation | undefined {
    let data: string
    try { data = readFileSync(this.path(session), 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    const metadata = this.parse(JSON.parse(data))
    if (canonicalSessionPath(metadata.sessionFile) !== canonicalSessionPath(session)) throw new Error('Side conversation metadata does not match its session')
    return metadata
  }
  isReadOnly(session: string): boolean { return this.load(session) !== undefined }
  async create(parentValue: unknown, optionsValue: unknown = {}): Promise<SideConversation> {
    const parentSession = await this.sessions.requireSessionPath(parentValue)
    const options = requireRecord(optionsValue, 'side conversation options')
    rejectUnknownKeys(options, ['excerpt', 'harness'], 'side conversation options')
    if (options.harness !== undefined && options.harness !== 'pi') throw new Error('Read-only side conversations are unavailable for this harness')
    const excerpt = options.excerpt === undefined ? undefined : requireString(options.excerpt, 'excerpt', { max: 128 * 1024 })
    const parent = (await this.sessions.list(undefined, true, true)).find((item) => canonicalSessionPath(item.filePath) === canonicalSessionPath(parentSession))
    if (!parent) throw new Error('Parent session is not in the session catalog')
    const cwd = await this.authorizeCwd(parent.projectPath)
    await this.manager.checkReadOnlySupport(cwd)
    return this.manager.withSideCreation(async () => {
      const state: { metadata?: SideConversation } = {}
      try {
        await this.sessions.create(cwd, (sessionFile) => {
          const pending: SideConversation = { parentSession, sessionFile, cwd, createdAt: new Date().toISOString(), policy: 'read-only-tools', ...(excerpt === undefined ? {} : { initialContext: excerpt }) }
          const destination = this.path(sessionFile)
          const temporary = `${destination}.${randomUUID()}.tmp`
          try {
            writeFileSync(temporary, JSON.stringify(pending), { flag: 'wx', mode: 0o600 })
            renameSync(temporary, destination)
            state.metadata = pending
          } finally { rmSync(temporary, { force: true }) }
        })
        if (!state.metadata) throw new Error('Session creation did not persist its side policy')
        return state.metadata
      } catch (error) {
        // A created or partially written session retains its policy. Never discard session data.
        if (state.metadata && !existsSync(state.metadata.sessionFile)) rmSync(this.path(state.metadata.sessionFile), { force: true })
        throw new Error(`Unable to create side conversation${state.metadata ? ` ${state.metadata.sessionFile}` : ''}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }
  async list(parentValue: unknown): Promise<SideConversation[]> {
    const parent = canonicalSessionPath(await this.sessions.requireSessionPath(parentValue))
    return readdirSync(this.directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).map((name) => this.parse(JSON.parse(readFileSync(join(this.directory, name), 'utf8')))).filter((item) => existsSync(item.sessionFile) && canonicalSessionPath(item.parentSession) === parent)
  }
  async get(sessionValue: unknown): Promise<SideConversation | null> {
    return this.load(await this.sessions.requireSessionPath(sessionValue)) ?? null
  }
  async prepareReturn(parentRuntimeValue: unknown, sideValue: unknown, textValue: unknown): Promise<SideReturnContext> {
    const parentRuntime = requireId(parentRuntimeValue, 'parent runtime id')
    const side = await this.get(sideValue)
    if (!side) throw new Error('Side conversation was not found')
    const text = requireString(textValue, 'selected text', { min: 1, max: 128 * 1024 })
    return this.manager.withRewind(parentRuntime, side.parentSession, async () => ({ sourceSession: side.sessionFile, text }))
  }
}
