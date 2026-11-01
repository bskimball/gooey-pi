import type { MessagePart, TranscriptMessage } from '@/types/api'

export type CheckKind = 'test' | 'lint' | 'typecheck' | 'build' | 'format'
/** 'unknown' means the check ran but its exit status can't be trusted (masked by the shell). */
export type CheckOutcome = 'passed' | 'failed' | 'running' | 'unknown'
export type ReviewAgent = 'oracle' | 'inspector'

export interface Check {
  kind: CheckKind
  outcome: CheckOutcome
  /** Possible workspace changes recorded after this check started. */
  changesSince: number
}

export interface Review {
  agent: ReviewAgent
  verdict: string
  changesSince: number
}

export interface Readiness {
  checks: Check[]
  reviews: Review[]
  /** Index of the last possible workspace change in the flattened parts, or -1. */
  lastEditIndex: number
}

type ToolResultPart = Extract<MessagePart, { type: 'toolResult' }>

const SHELL_TOOLS = new Set(['bash', 'powershell'])
const FILE_MUTATING_TOOLS = new Set(['edit', 'write', 'apply_patch', 'multi_edit'])
const TASK_TOOLS = new Set(['task', 'task_start', 'task_wait', 'task_status', 'task_send', 'task_chain'])
const VERDICT_TOOLS = new Set(['task', 'task_wait', 'task_status'])
const RELEVANT_TOOLS = new Set([...SHELL_TOOLS, ...FILE_MUTATING_TOOLS, ...TASK_TOOLS])
const REVIEW_AGENTS: readonly string[] = ['oracle', 'inspector']
const WRITER_AGENTS = new Set(['machinist', 'artisan', 'stevedore', 'scribe', 'picasso'])
const VERDICT = /^(?:outcome|verdict)\s*[:-]\s*(BLOCK|BLOCKED|PASS|ADVISORY|FAIL)\b/im
const RECEIPT = /\b(?:started|reused)\s+task_\d+\b|^\s*(?:lifecycle|status|state)\s*:\s*running\b/im

const CHECK_KINDS: readonly CheckKind[] = ['test', 'lint', 'typecheck', 'build', 'format']
const RUNNER = '(?:npm|pnpm|yarn|bun)'
const CHECK_PATTERNS: Record<CheckKind, RegExp> = {
  test: new RegExp(`^(?:vitest|jest|pytest|playwright test|bun test|go test|cargo test|${RUNNER}(?: run)? test)(?![\\w-])`),
  lint: new RegExp(`^(?:oxlint|eslint|ruff|golangci-lint|${RUNNER} run lint)(?![\\w-])`),
  typecheck: new RegExp(`^(?:tsc|pyright|mypy|${RUNNER} run typecheck)(?![\\w-])`),
  build: new RegExp(`^(?:vite build|electron-vite build|cargo build|go build|${RUNNER} run build)(?![\\w-])`),
  format: new RegExp(`^(?:(?:oxfmt|prettier)\\b.*--check|${RUNNER} run format:check)(?![\\w-])`),
}
const READ_ONLY_COMMANDS = new Set(['cd', 'pushd', 'popd', 'ls', 'dir', 'cat', 'type', 'head', 'tail', 'grep', 'rg', 'find', 'pwd', 'echo', 'printf', 'wc', 'which', 'where', 'true', ':', 'sleep'])
const READ_ONLY_GIT = new Set(['status', 'diff', 'log', 'show', 'rev-parse'])
const WRAPPER_RUNNERS = new Set(['npx', 'bunx', 'pnpx'])
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])

interface SimpleCommand {
  words: string[]
  /** Separators around this command, if any. */
  next: string | undefined
  previous: string | undefined
}

const toolName = (name: string | undefined) => name?.toLowerCase()

/**
 * A verdict inside a fenced block or blockquote is a quotation of an earlier report, not this result's verdict.
 * An unclosed fence hides everything after it, so a cut-off quotation reads as no verdict rather than a stale one.
 */
function withoutQuotedText(text: string): string {
  const kept: string[] = []
  let fence: string | undefined
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      const closer = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1]
      if (closer && closer[0] === fence[0] && closer.length >= fence.length) fence = undefined
    } else if (marker) {
      fence = marker
    } else if (!/^\s*>/.test(line)) {
      kept.push(line)
    }
  }
  return kept.join('\n')
}

function parseCommand(command: string): { simple: SimpleCommand[]; opaque: boolean; redirects: boolean } {
  const stripped = command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, '""')
  const pieces = stripped.split(/(&&|\|\||;|\||\r?\n)/)
  const simple: SimpleCommand[] = []
  for (let i = 0; i < pieces.length; i += 2) {
    const words = pieces[i].trim().split(/\s+/).filter(Boolean)
    if (words.length) simple.push({ words, next: pieces[i + 1], previous: pieces[i - 1] })
  }
  return {
    simple,
    // Command substitution and background jobs (a lone `&`) hide the exit status of what they run.
    opaque: /`|\$\(|(?:^|[^&>])&(?![&>])/.test(stripped),
    redirects: stripped.replace(/\d?>&\d|>\s*(?:\/dev\/null|nul)\b/gi, '').includes('>'),
  }
}

/** The tool actually invoked, with env assignments, runners, and executable paths removed. */
function invocation(words: readonly string[]): string[] {
  let rest = [...words]
  for (;;) {
    while (rest.length && /^\w+=/.test(rest[0])) rest = rest.slice(1)
    if (!rest.length) return rest
    const first = (rest[0].split(/[\\/]/).pop() ?? '').replace(/\.(?:cmd|exe)$/i, '')
    rest = [first, ...rest.slice(1)]
    if (WRAPPER_RUNNERS.has(first)) {
      rest = rest.slice(1)
      while (rest[0]?.startsWith('-')) rest = rest.slice(1)
      continue
    }
    if (PACKAGE_MANAGERS.has(first) && ['exec', 'x', 'dlx'].includes(rest[1])) { rest = rest.slice(2); continue }
    if (/^(?:python3?|py)$/.test(first) && rest[1] === '-m') { rest = rest.slice(2); continue }
    return rest
  }
}

function checkKindsOf(words: readonly string[]): CheckKind[] {
  const text = invocation(words).join(' ')
  return CHECK_KINDS.filter((kind) => CHECK_PATTERNS[kind].test(text))
}

function isReadOnly(words: readonly string[]): boolean {
  const call = invocation(words)
  const [first, second] = call
  if (!first) return true
  // Quoted arguments are blanked before matching, so a quoted flag such as "--fix" cannot be ruled out.
  if (checkKindsOf(words).length) return !call.some((word) => word.includes('""') || /^(?:--fix\b.*|--write|-w|--update|-u|--update-snapshots?)$/.test(word))
  if (first === 'find') return !call.some((word) => word === '-delete' || word.startsWith('-exec'))
  if (first === 'git') return READ_ONLY_GIT.has(second) || (second === 'branch' && call.slice(2).every((word) => word.startsWith('-')))
  if (first === 'node' || first === 'npm') return second === '-v' || second === '--version'
  return READ_ONLY_COMMANDS.has(first)
}

function mayChangeWorkspace(command: string): boolean {
  const { simple, opaque, redirects } = parseCommand(command)
  return opaque || redirects || simple.some(({ words }) => !isReadOnly(words))
}

export function isReadinessPart(part: MessagePart): boolean {
  if (part.type === 'toolCall') return RELEVANT_TOOLS.has(part.name.toLowerCase())
  if (part.type === 'toolResult') return part.name === undefined || RELEVANT_TOOLS.has(part.name.toLowerCase())
  return false
}

function findResult(parts: readonly MessagePart[], startIndex: number, name: string): { part: ToolResultPart; index: number } | undefined {
  for (let cursor = startIndex + 1; cursor < parts.length; cursor += 1) {
    const candidate = parts[cursor]
    if (candidate.type === 'toolCall' && toolName(candidate.name) === name) return undefined
    if (candidate.type === 'toolResult' && (candidate.name === undefined || toolName(candidate.name) === name)) return { part: candidate, index: cursor }
  }
  return undefined
}

function exitCodes(result: ToolResultPart): number[] {
  const codes = [...result.text.matchAll(/exited with code (\d+)/gi)].map((match) => Number(match[1]))
  const details = result.details && typeof result.details === 'object' ? (result.details as Record<string, unknown>).exitCode : undefined
  if (typeof details === 'number') codes.push(details)
  return codes
}

/**
 * Outcome per check kind the command invokes as a plain simple command; echo/grep/path mentions never count.
 * A pass counts only when every later command is a non-mutating check joined by `&&`; anything else could mask
 * the check's exit status or change files after it ran, so the result is unknown.
 */
function checkOutcomes(command: string, result: ToolResultPart | undefined): Map<CheckKind, CheckOutcome> {
  const { simple, opaque, redirects } = parseCommand(command)
  const maskable = opaque || simple.some(({ next, previous }) => next === '||' || next === '|' || previous === '|' || previous === '||')
  const outcomes = new Map<CheckKind, CheckOutcome>()
  simple.forEach(({ words }, position) => {
    const kinds = checkKindsOf(words)
    if (!kinds.length) return
    let outcome: CheckOutcome
    if (!result || result.streaming) outcome = 'running'
    else if (result.isError || exitCodes(result).some((code) => code !== 0)) outcome = 'failed'
    else {
      const chainedWithAnd = simple.slice(position, -1).every(({ next }) => next === '&&')
      const onlyChecksFollow = simple.slice(position + 1).every((later) => checkKindsOf(later.words).length > 0 && isReadOnly(later.words))
      outcome = !maskable && !redirects && chainedWithAnd && onlyChecksFollow ? 'passed' : 'unknown'
    }
    for (const kind of kinds) outcomes.set(kind, outcome)
  })
  return outcomes
}

export function extractReadiness(messages: TranscriptMessage[]): Readiness {
  return readinessFromParts(messages.flatMap((message) => Array.isArray(message.parts) ? message.parts : []))
}

function agentsOf(args: Record<string, unknown> | undefined, workerAgents: ReadonlyMap<string, string>): string[] {
  if (typeof args?.agent === 'string') return [args.agent.toLowerCase()]
  if (typeof args?.id === 'string') return [workerAgents.get(args.id)].filter((agent): agent is string => agent !== undefined)
  if (!Array.isArray(args?.steps)) return []
  return args.steps.flatMap((step: unknown) => {
    const agent = step && typeof step === 'object' ? (step as Record<string, unknown>).agent : undefined
    return typeof agent === 'string' ? [agent.toLowerCase()] : []
  })
}

function readinessFromParts(parts: readonly MessagePart[]): Readiness {
  const changeIndexes: number[] = []
  const latestChecks = new Map<CheckKind, { outcome: CheckOutcome; index: number }>()
  const latestReviews = new Map<ReviewAgent, { verdict: string; index: number }>()
  const workerAgents = new Map<string, string>()

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part.type !== 'toolCall') continue
    const name = part.name.toLowerCase()
    const args = part.args && typeof part.args === 'object' ? (part.args as Record<string, unknown>) : undefined
    if (FILE_MUTATING_TOOLS.has(name)) {
      changeIndexes.push(index)
    } else if (SHELL_TOOLS.has(name) && typeof args?.command === 'string') {
      const found = findResult(parts, index, name)
      for (const [kind, outcome] of checkOutcomes(args.command, found?.part)) {
        if (latestChecks.get(kind)?.outcome === 'failed' && outcome === 'unknown') continue
        latestChecks.set(kind, { outcome, index })
      }
      if (mayChangeWorkspace(args.command)) changeIndexes.push(index)
    } else if (TASK_TOOLS.has(name)) {
      const found = findResult(parts, index, name)
      if (name === 'task_start' && typeof args?.agent === 'string') {
        const started = found ? /\b(?:started|reused)\s+(task_\d+)\b/i.exec(found.part.text)?.[1] : undefined
        if (started) workerAgents.set(started, args.agent.toLowerCase())
      }
      const agents = agentsOf(args, workerAgents)
      if (agents.some((agent) => WRITER_AGENTS.has(agent))) changeIndexes.push(found?.index ?? index)
      const agent = agents[0]
      if (VERDICT_TOOLS.has(name) && agent && REVIEW_AGENTS.includes(agent) && found && !found.part.streaming && !RECEIPT.test(found.part.text)) {
        const verdict = VERDICT.exec(withoutQuotedText(found.part.text))?.[1]
        if (verdict) latestReviews.set(agent as ReviewAgent, { verdict: verdict.toUpperCase(), index })
      }
    }
  }

  const changesAfter = (index: number) => new Set(changeIndexes.filter((change) => change > index)).size
  return {
    checks: CHECK_KINDS.flatMap((kind) => {
      const latest = latestChecks.get(kind)
      return latest ? [{ kind, outcome: latest.outcome, changesSince: changesAfter(latest.index) }] : []
    }),
    reviews: REVIEW_AGENTS.flatMap((agent) => {
      const latest = latestReviews.get(agent as ReviewAgent)
      return latest ? [{ agent: agent as ReviewAgent, verdict: latest.verdict, changesSince: changesAfter(latest.index) }] : []
    }),
    lastEditIndex: changeIndexes.length ? Math.max(...changeIndexes) : -1,
  }
}

const sameItems = <T>(left: readonly T[], right: readonly T[]) => left.length === right.length && left.every((item, index) => item === right[index])

/** Per-inspector selector: only relevant tool parts are collected, and the result keeps its identity until they change. */
export function createReadinessSelector() {
  const perMessage = new Map<string, { message: TranscriptMessage; parts: MessagePart[] }>()
  let lastParts: MessagePart[] = []
  let readiness: Readiness = { checks: [], reviews: [], lastEditIndex: -1 }
  return (messages: TranscriptMessage[]): Readiness => {
    const next = new Map<string, { message: TranscriptMessage; parts: MessagePart[] }>()
    const collected: MessagePart[] = []
    for (const message of messages) {
      const cached = perMessage.get(message.id)
      let entry = cached?.message === message ? cached : undefined
      if (!entry) {
        const relevant = (Array.isArray(message.parts) ? message.parts : []).filter(isReadinessPart)
        entry = { message, parts: cached && sameItems(cached.parts, relevant) ? cached.parts : relevant }
      }
      next.set(message.id, entry)
      collected.push(...entry.parts)
    }
    perMessage.clear()
    for (const [id, entry] of next) perMessage.set(id, entry)
    if (!sameItems(lastParts, collected)) {
      lastParts = collected
      readiness = readinessFromParts(collected)
    }
    return readiness
  }
}
