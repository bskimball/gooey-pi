import { parseMcpAuthenticationCommand } from '@/lib/mcp-policy'
import type { HarnessId, PrimeModelDescriptor, PrimeProviderDescriptor, PrimeThinkingLevel, SessionRecord, SkillRecord } from '@/types/api'

/** Where a slash command comes from: Apex itself, or the Pi runtime's `get_commands` listing. */
export type ComposerCommandSource = 'builtin' | 'extension' | 'prompt' | 'skill'

export interface ComposerCommand {
  /** Name without the leading slash, e.g. `compact` or `skill:unslop`. */
  name: string
  description?: string
  argumentHint?: string
  source: ComposerCommandSource
}

/** Pi's built-in TUI commands that Apex maps to its own controls. TUI-only commands are omitted. */
export const BUILTIN_COMPOSER_COMMANDS: readonly ComposerCommand[] = [
  { name: 'model', description: 'Select model', argumentHint: '<provider/model>', source: 'builtin' },
  { name: 'thinking', description: 'Set reasoning effort', argumentHint: '<level>', source: 'builtin' },
  { name: 'new', description: 'Start a new session', source: 'builtin' },
  { name: 'resume', description: 'Resume a different session', argumentHint: '<session>', source: 'builtin' },
  { name: 'name', description: 'Set session display name', argumentHint: '<name>', source: 'builtin' },
  { name: 'session', description: 'Show session info and stats', source: 'builtin' },
  { name: 'copy', description: 'Copy last agent message to clipboard', source: 'builtin' },
  { name: 'compact', description: 'Manually compact the session context', argumentHint: '[instructions]', source: 'builtin' },
  { name: 'settings', description: 'Open settings', source: 'builtin' },
  { name: 'login', description: 'Configure provider authentication', source: 'builtin' },
  { name: 'logout', description: 'Remove provider authentication', source: 'builtin' },
]

/** Apex's modes extension commands, listed before a runtime has reported its own commands. */
const PI_MODE_COMMANDS: readonly ComposerCommand[] = [
  { name: 'mode', description: 'Switch Pi, Apex, Apex Orchestrate, Fusion, Hydra, or Work', source: 'extension' },
  { name: 'orchestrate', description: 'Toggle Apex Orchestrate mode', source: 'extension' },
]

/** Commands Apex executes itself instead of sending them to the agent. `/compact` keeps its RPC route. */
export type LocalCommandName = 'model' | 'thinking' | 'new' | 'resume' | 'name' | 'session' | 'copy' | 'settings' | 'login' | 'logout'

const LOCAL_COMMANDS: ReadonlySet<string> = new Set<LocalCommandName>(['model', 'thinking', 'new', 'resume', 'name', 'session', 'copy', 'settings', 'login', 'logout'])

export function isLocalCommand(name: string): name is LocalCommandName {
  return LOCAL_COMMANDS.has(name)
}

/** Actions the app shell performs for local commands the composer cannot handle on its own. */
export type ComposerCommandAction =
  | { type: 'new' }
  | { type: 'resume'; sessionId: string }
  | { type: 'name'; title: string }
  | { type: 'session' }
  | { type: 'copy' }
  | { type: 'settings'; section: 'general' | 'providers' }

export interface SlashCommand {
  name: string
  args: string
}

/** Splits `/name args` the way Pi does: the name runs to the first whitespace. */
export function parseSlashCommand(text: string): SlashCommand | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return undefined
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (!match) return undefined
  return { name: match[1], args: (match[2] ?? '').trim() }
}

export function parseCompactCommand(prompt: string): { customInstructions?: string } | undefined {
  const trimmed = prompt.trim()
  if (trimmed === '/compact') return {}
  if (trimmed.startsWith('/compact ')) {
    const customInstructions = trimmed.slice(9).trim()
    return customInstructions ? { customInstructions } : {}
  }
  return undefined
}

export type McpCommand = { type: 'authenticate'; server?: string }

export function parseMcpCommand(prompt: string, harness: HarnessId): McpCommand | undefined {
  const authentication = parseMcpAuthenticationCommand(prompt.trim(), harness)
  return authentication
    ? authentication.server ? { type: 'authenticate', server: authentication.server } : { type: 'authenticate' }
    : undefined
}

export interface BashCommand {
  command: string
  /** `!!` runs the command without sending its output to the model. */
  excludeFromContext: boolean
}

/** Pi's `!command` / `!!command` prefixes for running a shell command from the prompt. */
export function parseBashCommand(text: string): BashCommand | undefined {
  const match = /^!(!?)([\s\S]*)$/.exec(text.trim())
  const command = match?.[2].trim()
  return match && command ? { command, excludeFromContext: match[1] === '!' } : undefined
}

const SOURCES: ReadonlySet<string> = new Set(['extension', 'prompt', 'skill'])

/** Reads Pi's `get_commands` response; malformed entries are skipped. */
export function parseRuntimeCommands(response: unknown): ComposerCommand[] {
  const data = typeof response === 'object' && response !== null ? Reflect.get(response, 'data') : undefined
  const commands: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'commands') : undefined
  if (!Array.isArray(commands)) return []
  return commands.flatMap((command: unknown): ComposerCommand[] => {
    if (typeof command !== 'object' || command === null) return []
    const name: unknown = Reflect.get(command, 'name')
    const source: unknown = Reflect.get(command, 'source')
    const description: unknown = Reflect.get(command, 'description')
    if (typeof name !== 'string' || !name.trim() || /\s/.test(name) || typeof source !== 'string' || !SOURCES.has(source)) return []
    return [{ name, source: source as ComposerCommandSource, ...(typeof description === 'string' && description ? { description } : {}) }]
  })
}

/** Prompt templates and skills from the capability catalog, for sessions without a runtime yet. */
export function catalogCommands(skills: readonly SkillRecord[]): ComposerCommand[] {
  return skills.flatMap((skill): ComposerCommand[] => {
    const name = skill.name.trim()
    if (!skill.enabled || !name || /\s/.test(name)) return []
    if (skill.kind === 'prompt') return [{ name, description: skill.description, source: 'prompt' }]
    if (skill.kind === 'skill') return [{ name: `skill:${name}`, description: skill.description, source: 'skill' }]
    return []
  })
}

/**
 * Built-ins first, then the runtime's commands (templates, extensions, skills).
 * The runtime listing is authoritative once known; the catalog only fills in before then.
 */
export function availableCommands(harness: HarnessId, runtimeCommands: readonly ComposerCommand[] | undefined, skills: readonly SkillRecord[]): ComposerCommand[] {
  const fallback = [...(harness === 'pi' ? PI_MODE_COMMANDS : []), ...catalogCommands(skills)]
  const sourceOrder: Record<ComposerCommandSource, number> = { builtin: 0, prompt: 1, extension: 2, skill: 3 }
  const listed = [...(runtimeCommands ?? fallback)].sort((left, right) => sourceOrder[left.source] - sourceOrder[right.source])
  const seen = new Set<string>()
  return [...BUILTIN_COMPOSER_COMMANDS, ...listed].filter((command) => {
    if (seen.has(command.name)) return false
    seen.add(command.name)
    return true
  })
}

/** Pi TUI's fuzzy matcher: query characters in order, rewarding consecutive and word-boundary hits. Lower is better. */
export function fuzzyMatch(query: string, text: string): { matches: boolean; score: number } {
  const needle = query.toLowerCase()
  const haystack = text.toLowerCase()
  if (!needle) return { matches: true, score: 0 }
  if (needle.length > haystack.length) return { matches: false, score: 0 }
  let score = 0
  let last = -1
  let consecutive = 0
  for (const character of needle) {
    const index = haystack.indexOf(character, last + 1)
    if (index === -1) return { matches: false, score: 0 }
    if (last === index - 1) {
      consecutive += 1
      score -= consecutive * 5
    } else {
      consecutive = 0
      if (last >= 0) score += (index - last - 1) * 2
    }
    if (index === 0 || /[\s\-_./:]/.test(haystack[index - 1])) score -= 10
    score += index * 0.1
    last = index
  }
  if (needle === haystack) score -= 100
  return { matches: true, score }
}

export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  const tokens = query.trim().split(/[\s/]+/).filter(Boolean)
  if (!tokens.length) return [...items]
  const scored: Array<{ item: T; score: number }> = []
  for (const item of items) {
    let score = 0
    let matches = true
    for (const token of tokens) {
      const match = fuzzyMatch(token, text(item))
      if (!match.matches) { matches = false; break }
      score += match.score
    }
    if (matches) scored.push({ item, score })
  }
  return scored.sort((left, right) => left.score - right.score).map(({ item }) => item)
}

/** Models the picker offers: available models from enabled providers. */
export function selectableModels(modelsByProvider: ReadonlyMap<string, PrimeModelDescriptor[]>, providers: readonly PrimeProviderDescriptor[]): PrimeModelDescriptor[] {
  return providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) => modelsByProvider.get(provider.id) ?? [])
    .filter((model) => model.available)
}

export type LocalCommandOutcome =
  | { type: 'action'; action: ComposerCommandAction }
  | { type: 'model'; key: string }
  | { type: 'effort'; level: PrimeThinkingLevel }
  /** Leave `/name ` in the draft so its argument menu opens. */
  | { type: 'complete'; draft: string }
  | { type: 'error'; message: string }

interface LocalCommandContext {
  models: readonly PrimeModelDescriptor[]
  reasoningLevels: readonly PrimeThinkingLevel[]
  sessions: readonly SessionRecord[]
}

/** Resolves a submitted local command, matching arguments the way its completion menu does. */
export function resolveLocalCommand(name: LocalCommandName, args: string, context: LocalCommandContext): LocalCommandOutcome {
  if (name === 'new' || name === 'session' || name === 'copy') return { type: 'action', action: { type: name } }
  if (name === 'settings') return { type: 'action', action: { type: 'settings', section: 'general' } }
  if (name === 'login' || name === 'logout') return { type: 'action', action: { type: 'settings', section: 'providers' } }
  if (name === 'name') return args ? { type: 'action', action: { type: 'name', title: args } } : { type: 'error', message: 'Usage: /name <name>' }
  if (!args) return { type: 'complete', draft: `/${name} ` }
  const needle = args.toLowerCase()
  if (name === 'model') {
    const model = context.models.find((candidate) => [candidate.key, `${candidate.provider}/${candidate.id}`, candidate.id].some((label) => label.toLowerCase() === needle))
      ?? fuzzyFilter(context.models, args, (candidate) => `${candidate.provider}/${candidate.id} ${candidate.name}`)[0]
    return model ? { type: 'model', key: model.key } : { type: 'error', message: `No available model matches "${args}".` }
  }
  if (name === 'thinking') {
    const level = context.reasoningLevels.find((candidate) => candidate === needle)
    return level ? { type: 'effort', level } : { type: 'error', message: `Unknown reasoning level "${args}". Use one of: ${context.reasoningLevels.join(', ')}.` }
  }
  const session = context.sessions.find((candidate) => candidate.title.trim().toLowerCase() === needle)
    ?? fuzzyFilter(context.sessions, args, (candidate) => candidate.title)[0]
  return session ? { type: 'action', action: { type: 'resume', sessionId: session.id } } : { type: 'error', message: `No session matches "${args}".` }
}

/** Matches `skill:` commands by their bare name first, like the TUI's command menu. */
export function filterCommands(commands: readonly ComposerCommand[], query: string): ComposerCommand[] {
  const bare = (command: ComposerCommand) => command.name.startsWith('skill:') ? command.name.slice('skill:'.length) : command.name
  const bareMatches = fuzzyFilter(commands, query, bare)
  const matched = new Set(bareMatches)
  const fullMatches = fuzzyFilter(commands.filter((command) => command.name.startsWith('skill:') && !matched.has(command)), query, (command) => command.name)
  return [...bareMatches, ...fullMatches]
}
