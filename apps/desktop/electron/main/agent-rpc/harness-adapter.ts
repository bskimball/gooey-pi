import type { PrimeContextUsage, RuntimeHarnessId, SessionUsage, SessionUsageTokens } from '../../../src/types/api'
import { extensionInjections } from '../extension-manifest'
import { HARNESSES } from '../harness'
import { isRecord } from 'apex-core/validation'
import type { RpcObject } from './types'

export interface HarnessStartArgsInput {
  cwd: string
  sessionPath?: string
  providerId?: string
  modelId?: string
  thinking?: string
  environment: NodeJS.ProcessEnv
}

export interface HarnessStateReading {
  serviceTier?: 'default' | 'priority'
  contextUsage?: PrimeContextUsage
}

/** Pi's wire protocol, shared by the manager and transport. */
export interface HarnessRpcAdapter {
  readonly id: RuntimeHarnessId
  readonly agentName: string
  readonly negotiateProtocolVersion?: number
  readonly chunkedFrames: boolean
  readonly spawnsInCwd?: boolean
  buildStartArgs(input: HarnessStartArgsInput): string[]
  translateCommand(command: RpcObject): RpcObject
  normalizeEvent(event: RpcObject): RpcObject | null
  buildServiceTierCommand?(serviceTier: 'default' | 'priority'): RpcObject
  readState(data: RpcObject): HarnessStateReading
}

export function parseContextUsage(raw: unknown): PrimeContextUsage | null {
  if (!isRecord(raw) || !Number.isSafeInteger(raw.contextWindow) || Number(raw.contextWindow) <= 0) return null
  const tokens = raw.tokens === null ? null : Number.isSafeInteger(raw.tokens) && Number(raw.tokens) >= 0 ? Number(raw.tokens) : undefined
  const percent = raw.percent === null ? null : typeof raw.percent === 'number' && Number.isFinite(raw.percent) && raw.percent >= 0 ? raw.percent : undefined
  if (tokens === undefined || percent === undefined) return null
  return { tokens, contextWindow: Number(raw.contextWindow), percent }
}

const SESSION_TOKEN_FIELDS: Array<keyof SessionUsageTokens> = ['input', 'output', 'cacheRead', 'cacheWrite', 'total']

function parseSessionUsageTokens(raw: unknown): SessionUsageTokens | undefined {
  if (!isRecord(raw)) return undefined
  const tokens: Partial<SessionUsageTokens> = {}
  for (const field of SESSION_TOKEN_FIELDS) {
    const value = raw[field]
    if (!Number.isSafeInteger(value) || Number(value) < 0) return undefined
    tokens[field] = Number(value)
  }
  return tokens as SessionUsageTokens
}

export function parseSessionUsage(raw: unknown): SessionUsage | null {
  if (!isRecord(raw)) return null
  const cost = typeof raw.cost === 'number' && Number.isFinite(raw.cost) && raw.cost >= 0 ? raw.cost : null
  const tokens = parseSessionUsageTokens(raw.tokens)
  if (cost === null && tokens === undefined) return null
  return tokens ? { cost, tokens } : { cost }
}

const unsafeArgValue = (value: string): boolean => value.startsWith('-') || /[\r\n]/.test(value)
const UNSUPPORTED_COMMANDS = new Set([
  'send_message', 'clone', 'set_heartbeat', 'update_heartbeat', 'manage_heartbeat', 'observe', 'unobserve',
  'list_heartbeats', 'get_heartbeat', 'agent_messages_status', 'agent_messages_pause', 'agent_messages_resume',
  'agent_messages_clear',
])

export const PI_RPC_ADAPTER: HarnessRpcAdapter = {
  id: 'pi',
  agentName: HARNESSES.pi.agentName,
  chunkedFrames: false,
  // Pi derives its session bucket from the child process cwd.
  spawnsInCwd: true,
  buildStartArgs: (input) => {
    const args = ['--mode', 'rpc']
    // --resume is an interactive selector; exact session paths use --session.
    if (input.sessionPath) args.push('--session', input.sessionPath)
    if (input.modelId !== undefined) {
      if (unsafeArgValue(input.modelId)) throw new TypeError('Invalid model')
      if (input.providerId) args.push('--provider', input.providerId)
      args.push('--model', input.modelId)
    }
    if (input.thinking) args.push('--thinking', input.thinking)
    const computerUseSkillPath = input.environment.GOOEYPI_COMPUTER_USE_SKILL_PATH
    if (computerUseSkillPath && !unsafeArgValue(computerUseSkillPath)) args.push('--skill', computerUseSkillPath)
    for (const injection of extensionInjections('pi')) {
      const extensionPath = input.environment[injection.environmentVariable]
      if (extensionPath && !unsafeArgValue(extensionPath)) args.push('--extension', extensionPath)
    }
    return args
  },
  translateCommand: (command) => {
    const type = String(command.type)
    if (UNSUPPORTED_COMMANDS.has(type)) throw new Error(`RPC command ${type} is not supported by the Pi harness`)
    if (command.type !== 'prompt' || command.streamingBehavior === undefined) return command
    const { streamingBehavior: _, ...rest } = command
    return rest
  },
  normalizeEvent: (event) => event,
  buildServiceTierCommand: (serviceTier) => ({ type: 'prompt', message: `/gooeypi-fast-mode ${serviceTier}` }),
  readState: () => ({}),
}
