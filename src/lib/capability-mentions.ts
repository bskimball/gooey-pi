import type { SessionRecord, SkillRecord } from '@/types/api'

/** `$` invokes skills; `@` references files, sessions, and other capabilities. Prompt templates are `/name` commands. */
export type MentionTrigger = '@' | '$'

export interface CapabilityMention {
  start: number
  end: number
  text: string
  skill: SkillRecord
}

export interface MentionQuery {
  trigger: MentionTrigger
  /** Index of the trigger character. */
  start: number
  query: string
}

export const capabilityTrigger = (skill: SkillRecord): MentionTrigger => (skill.kind === 'skill' ? '$' : '@')

export const CAPABILITY_ROUTING_BEGIN = '===== BEGIN GOOEYPI CAPABILITY ROUTING ====='
export const CAPABILITY_ROUTING_END = '===== END GOOEYPI CAPABILITY ROUTING ====='

const boundaryBefore = (value: string | undefined): boolean => value === undefined || /[\s([{"'`]/.test(value)
const boundaryAfter = (value: string | undefined): boolean => value === undefined || /[\s.,!?;:()[\]{}"'`]/.test(value)
/** `@browser.` ends a mention; `@browser.md` is a file path. */
export const endsMention = (value: string, end: number): boolean =>
  boundaryAfter(value[end]) && !(value[end] === '.' && /[\w-]/.test(value[end + 1] ?? ''))
const mentionable = (skill: SkillRecord): boolean => skill.kind !== 'prompt'

const MENTION_QUERY_PATTERNS: Record<MentionTrigger, RegExp> = {
  '@': /(?:^|\s)@([^@\n]*)$/,
  $: /(?:^|\s)\$([^$\n]*)$/,
}

/** Finds the open mention being typed at the end of the draft; the later trigger wins. */
export function findMentionQuery(value: string): MentionQuery | null {
  let found: MentionQuery | null = null
  for (const trigger of ['@', '$'] as const) {
    const match = MENTION_QUERY_PATTERNS[trigger].exec(value)
    if (!match) continue
    const start = value.length - match[1].length - 1
    if (!found || start > found.start) found = { trigger, start, query: match[1] }
  }
  return found
}

/** Lists the capabilities a typed mention can complete to: skills for `$`, everything else for `@`. */
export function capabilitiesForMention(skills: readonly SkillRecord[], mention: MentionQuery): SkillRecord[] {
  const query = mention.query.toLocaleLowerCase().trim()
  return skills.filter((skill) => mentionable(skill) && capabilityTrigger(skill) === mention.trigger && skill.name.toLocaleLowerCase().includes(query))
}

const MENTION_MENU_LIMIT = 8

/** Exact name, then prefix, then a looser substring. Empty query does not rank. */
export function compareMentionMatch(left: string, right: string, query: string): number {
  const needle = query.toLocaleLowerCase().trim()
  if (!needle) return 0
  const rank = (label: string): number => {
    const name = label.toLocaleLowerCase()
    if (name === needle) return 0
    if (name.startsWith(needle)) return 1
    return 2
  }
  const byRank = rank(left) - rank(right)
  return byRank === 0 ? left.length - right.length : byRank
}

export type AtMentionTarget =
  | { kind: 'session'; session: SessionRecord }
  | { kind: 'capability'; skill: SkillRecord }

/** `@` results the menu can show. A typed query puts the tightest name first so it stays on screen. */
export function orderedAtMentions(
  sessions: readonly SessionRecord[],
  capabilities: readonly SkillRecord[],
  query: string,
): AtMentionTarget[] {
  const needle = query.toLocaleLowerCase().trim()
  const matchedSessions = sessions.filter((session) => session.title.toLocaleLowerCase().includes(needle))
  if (!needle) {
    return [
      ...matchedSessions.slice(0, 6).map((session) => ({ kind: 'session' as const, session })),
      ...capabilities.slice(0, 6).map((skill) => ({ kind: 'capability' as const, skill })),
    ].slice(0, MENTION_MENU_LIMIT)
  }
  const targets: AtMentionTarget[] = [
    ...matchedSessions.map((session) => ({ kind: 'session' as const, session })),
    ...capabilities.map((skill) => ({ kind: 'capability' as const, skill })),
  ]
  const label = (target: AtMentionTarget): string => target.kind === 'session' ? target.session.title : target.skill.name
  return [...targets]
    .sort((left, right) => compareMentionMatch(label(left), label(right), needle)
      || (left.kind === right.kind ? 0 : left.kind === 'session' ? -1 : 1))
    .slice(0, MENTION_MENU_LIMIT)
}

function mentionCandidates(skills: readonly SkillRecord[]): SkillRecord[] {
  const seen = new Set<string>()
  return skills
    .filter((skill) => skill.enabled && mentionable(skill) && skill.name.trim())
    .sort((left, right) => right.name.length - left.name.length)
    .filter((skill) => {
      // Skills and other capabilities live under different triggers, so a
      // shared display name must not hide either one.
      const key = `${capabilityTrigger(skill)}${skill.name.trim().toLocaleLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** Resolves visible $skill and @capability mentions against the enabled catalog without treating email addresses as capabilities. */
export function findCapabilityMentions(value: string, skills: readonly SkillRecord[]): CapabilityMention[] {
  const candidates = mentionCandidates(skills)
  const lowerValue = value.toLocaleLowerCase()
  const mentions: CapabilityMention[] = []
  for (let index = 0; index < value.length; index += 1) {
    const trigger = value[index]
    if ((trigger !== '@' && trigger !== '$') || !boundaryBefore(value[index - 1])) continue
    const skill = candidates.find((candidate) => {
      if (capabilityTrigger(candidate) !== trigger) return false
      const token = `${trigger}${candidate.name.trim()}`.toLocaleLowerCase()
      return lowerValue.startsWith(token, index) && endsMention(value, index + token.length)
    })
    if (!skill) continue
    const end = index + skill.name.trim().length + 1
    mentions.push({ start: index, end, text: value.slice(index, end), skill })
    index = end - 1
  }
  return mentions
}

function routingInstruction(mention: CapabilityMention): string {
  const token = mention.text
  if (mention.skill.id === 'prime-work-browser' || mention.skill.id === 'omp-work-browser') {
    return `${token}: use Apex's in-app Browser capability and its own browser tools. Do not substitute Chrome, an external browser, or another connected browser tool.`
  }
  if (mention.skill.id === 'prime-work-schedules' || mention.skill.id === 'omp-work-schedules') {
    return `${token}: use Apex's Scheduled tasks capability and its own schedule tools.`
  }
  // Skills are Markdown files; agents have no tool that resolves catalog ids.
  if (mention.skill.kind === 'skill' && mention.skill.path) {
    const kind = mention.skill.kind
    return `${token}: Read the ${kind} file at ${JSON.stringify(mention.skill.path)} and follow its instructions for this request. This is the exact ${kind} file selected by the user, not a substitute. No catalog lookup or catalog-ID verification is required, including for any catalog ID mentioned earlier in this conversation. Resolve its relative paths from the directory containing that ${kind} file. This is an explicit user invocation, even if the ${kind} is omitted from the automatic ${kind} list.`
  }
  return `${token}: use the enabled Apex ${mention.skill.kind} with the exact catalog id ${JSON.stringify(mention.skill.id)}. Do not substitute a similarly named capability.`
}

/** Adds explicit routing semantics while keeping the user's visible prompt unchanged. */
export function appendCapabilityRouting(prompt: string, skills: readonly SkillRecord[]): string {
  const mentions = findCapabilityMentions(prompt, skills)
  const unique = mentions.filter((mention, index) => mentions.findIndex((candidate) => candidate.skill.id === mention.skill.id) === index)
  if (!unique.length) return prompt
  const visiblePrompt = prompt
    .replaceAll(CAPABILITY_ROUTING_BEGIN, '[capability routing boundary omitted]')
    .replaceAll(CAPABILITY_ROUTING_END, '[capability routing boundary omitted]')
  return `${visiblePrompt}\n\n${CAPABILITY_ROUTING_BEGIN}\nThe user explicitly invoked the following capabilities. Follow this routing for the request:\n${unique.map((mention) => `- ${routingInstruction(mention)}`).join('\n')}\n${CAPABILITY_ROUTING_END}`
}

export function splitCapabilityRouting(text: string): { text: string; block: string | null } {
  const begin = text.indexOf(CAPABILITY_ROUTING_BEGIN)
  if (begin === -1) return { text, block: null }
  const end = text.indexOf(CAPABILITY_ROUTING_END, begin)
  if (end === -1) return { text, block: null }
  const block = text.slice(begin, end + CAPABILITY_ROUTING_END.length)
  return { text: `${text.slice(0, begin)}${text.slice(end + CAPABILITY_ROUTING_END.length)}`.trim(), block }
}
