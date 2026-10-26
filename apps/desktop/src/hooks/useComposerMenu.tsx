import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { At, ChatCircleText, Command, File, Folder, Gauge, Paperclip, Sparkle } from '@/components/icons'
import { useProjectFileIndex } from '@/hooks/useProjectFileIndex'
import {
  capabilitiesForMention,
  compareMentionMatch,
  findMentionQuery,
  type MentionQuery,
  type MentionTrigger,
  orderedAtMentions,
} from '@/lib/capability-mentions'
import { availableCommands, type ComposerCommand, type ComposerCommandAction, filterCommands, fuzzyFilter, selectableModels } from '@/lib/composer-commands'
import { formatFileMention, parseFileMentionQuery, rankFileEntries } from '@/lib/file-mentions'
import type { HarnessId, PrimeModelDescriptor, PrimeProviderDescriptor, PrimeThinkingLevel, SessionRecord, SkillRecord } from '@/types/api'

export type ComposerMenuKind = 'add' | 'mention' | 'command' | 'argument'

export interface ComposerSuggestion {
  key: string
  label: string
  detail?: string
  icon: ReactNode
  choose(): void
}

/** Commands whose argument is completed from an Apex list rather than typed freely. */
const ARGUMENT_COMMANDS = new Set(['model', 'thinking', 'resume'])
const FILE_MENU_LIMIT = 8
const AT_MENU_LIMIT = 6
const ARGUMENT_MENU_LIMIT = 8

export interface ComposerMenuOptions {
  value: string
  caret: number
  harness: HarnessId
  fileRoot?: string
  sessions: readonly SessionRecord[]
  /** Enabled capabilities: `$` skills and `@` capabilities. */
  enabledSkills: readonly SkillRecord[]
  /** The full catalog, used for `/` prompt templates and skills before the runtime reports its own. */
  skills: readonly SkillRecord[]
  runtimeCommands?: readonly ComposerCommand[]
  modelsByProvider: ReadonlyMap<string, PrimeModelDescriptor[]>
  providers: readonly PrimeProviderDescriptor[]
  reasoningLevels: readonly PrimeThinkingLevel[]
  reasoningLabels: Record<PrimeThinkingLevel, string>
  /** Replaces `[start, caret)` with text; the menu then follows the new draft. */
  replaceBeforeCaret(start: number, text: string): void
  insert(text: string): void
  setDraft(text: string): void
  openFilePicker(): void
  rememberSession(session: SessionRecord): void
  onModelChange(value: string): void
  onEffortChange(value: PrimeThinkingLevel): void
  runCommand(action: ComposerCommandAction): void
}

/** The composer's completion menus: `@` files, sessions and capabilities, `$` skills, `/` commands and their arguments. */
export function useComposerMenu(options: ComposerMenuOptions) {
  const { value, caret, harness, sessions, enabledSkills } = options
  const beforeCaret = value.slice(0, Math.min(caret, value.length))
  const [menu, setMenu] = useState<ComposerMenuKind | null>(null)
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const acceptedMentionRef = useRef<{ start: number; text: string } | null>(null)
  const lastValueRef = useRef(value)

  const commandText = beforeCaret.trimStart()
  const commandMatch = commandText.startsWith('/') ? /^\/(\S*)(\s+)?([^\n]*)$/.exec(commandText) : null
  const commandArgument = commandMatch?.[2] && ARGUMENT_COMMANDS.has(commandMatch[1]) ? { name: commandMatch[1], query: commandMatch[3] } : undefined
  const completingCommand = Boolean(commandMatch && (!commandMatch[2] || commandArgument))
  const mention = completingCommand ? null : findMentionQuery(beforeCaret)
  const accepted = acceptedMentionRef.current
  const mentionAccepted = Boolean(mention && accepted && mention.start === accepted.start
    && value.slice(accepted.start, accepted.start + accepted.text.length) === accepted.text)

  useEffect(() => {
    if (acceptedMentionRef.current && !mentionAccepted) acceptedMentionRef.current = null
    const edited = lastValueRef.current !== value
    lastValueRef.current = value
    setMenu((current) => {
      if (commandMatch && !commandMatch[2]) return 'command'
      if (commandArgument) return 'argument'
      if (mention && !mentionAccepted) return 'mention'
      // The add menu is opened explicitly; editing closes it, a caret move does not.
      return current === 'add' && !edited ? 'add' : null
    })
  }, [beforeCaret, value])

  const fileQuery = mention?.trigger === '@' ? parseFileMentionQuery(mention.query) : null
  const files = useProjectFileIndex(options.fileRoot, harness, menu === 'mention' && fileQuery !== null)
  const commands = useMemo(
    () => availableCommands(harness, options.runtimeCommands, options.skills),
    [harness, options.runtimeCommands, options.skills],
  )

  const chooseMention = (target: MentionQuery, trigger: MentionTrigger, label: string, session?: SessionRecord) => {
    acceptedMentionRef.current = { start: target.start, text: `${trigger}${label} ` }
    if (session) options.rememberSession(session)
    options.replaceBeforeCaret(target.start, `${trigger}${label} `)
  }

  const suggestions = buildSuggestions()

  function buildSuggestions(): ComposerSuggestion[] {
    if (menu === 'command' && commandMatch) {
      return filterCommands(commands, commandMatch[1]).map((command) => ({
        key: `command:${command.name}`,
        label: `/${command.name}`,
        detail: [command.argumentHint, command.description].filter(Boolean).join(' — ') || undefined,
        icon: command.source === 'skill' ? <Sparkle size={14} /> : <Command size={14} />,
        choose: () => options.replaceBeforeCaret(value.length - value.trimStart().length, `/${command.name} `),
      }))
    }
    if (menu === 'argument' && commandArgument) return argumentSuggestions(commandArgument.name, commandArgument.query)
    if (menu === 'mention' && mention) return mentionSuggestions(mention)
    if (menu === 'add') {
      return [
        { key: 'files', label: 'Add files', detail: 'Attach images, or reference other files by path', icon: <Paperclip size={14} />, choose: options.openFilePicker },
        { key: 'skill', label: 'Use a skill', detail: 'Invoke an enabled skill with $', icon: <Sparkle size={14} />, choose: () => options.insert('$') },
        { key: 'mention', label: 'Reference a file, session, or capability', detail: 'Search project files, sidebar work, or enabled extensions with @', icon: <At size={14} />, choose: () => options.insert('@') },
      ]
    }
    return []
  }

  function mentionSuggestions(target: MentionQuery): ComposerSuggestion[] {
    const query = target.query.toLocaleLowerCase().trim()
    const capabilities = capabilitiesForMention(enabledSkills, target)
    if (target.trigger === '$') {
      return [...capabilities].sort((left, right) => compareMentionMatch(left.name, right.name, query)).slice(0, 8).map((skill) => ({
        key: `skill:${skill.id}`,
        label: `$${skill.name}`,
        detail: skill.description,
        icon: <Sparkle size={14} />,
        choose: () => chooseMention(target, '$', skill.name),
      }))
    }
    const fileSuggestions: ComposerSuggestion[] = fileQuery === null || !files ? [] : rankFileEntries(files, fileQuery, FILE_MENU_LIMIT).map((entry) => {
      const directory = entry.type === 'directory'
      const name = entry.path.slice(entry.path.lastIndexOf('/') + 1)
      return {
        key: `file:${entry.path}`,
        label: directory ? `${name}/` : name,
        detail: entry.path,
        icon: directory ? <Folder size={14} /> : <File size={14} />,
        choose: () => {
          if (directory) {
            // Like the TUI, a directory stays open (and unquoted text stays unclosed) so completion can drill in.
            const mentionText = formatFileMention(`${entry.path}/`)
            options.replaceBeforeCaret(target.start, mentionText.endsWith('"') ? mentionText.slice(0, -1) : mentionText)
            return
          }
          const text = `${formatFileMention(entry.path)} `
          acceptedMentionRef.current = { start: target.start, text }
          options.replaceBeforeCaret(target.start, text)
        },
      }
    })
    const others = orderedAtMentions(sessions, capabilities, query).slice(0, AT_MENU_LIMIT).map((item): ComposerSuggestion => item.kind === 'session'
      ? {
          key: `session:${item.session.harness}:${item.session.id}`,
          label: `@${item.session.title}`,
          detail: `${item.session.harness.toUpperCase()} session · ${item.session.status}`,
          icon: <ChatCircleText size={14} />,
          choose: () => chooseMention(target, '@', item.session.title, item.session),
        }
      : {
          key: `capability:${item.skill.id}`,
          label: `@${item.skill.name}`,
          detail: item.skill.description,
          icon: <At size={14} />,
          choose: () => chooseMention(target, '@', item.skill.name),
        })
    return [...fileSuggestions, ...others]
  }

  function argumentSuggestions(name: string, query: string): ComposerSuggestion[] {
    if (name === 'model') {
      return fuzzyFilter(selectableModels(options.modelsByProvider, options.providers), query, (model) => `${model.provider}/${model.id} ${model.name}`).slice(0, ARGUMENT_MENU_LIMIT).map((model) => ({
        key: `model:${model.key}`,
        label: model.name,
        detail: `${model.provider}/${model.id}`,
        icon: <Command size={14} />,
        choose: () => { options.onModelChange(model.key); options.setDraft('') },
      }))
    }
    if (name === 'thinking') {
      return fuzzyFilter(options.reasoningLevels, query, (level) => level).map((level) => ({
        key: `thinking:${level}`,
        label: level,
        detail: options.reasoningLabels[level],
        icon: <Gauge size={14} />,
        choose: () => { options.onEffortChange(level); options.setDraft('') },
      }))
    }
    return fuzzyFilter(sessions, query, (session) => session.title).slice(0, ARGUMENT_MENU_LIMIT).map((session) => ({
      key: `resume:${session.harness}:${session.id}`,
      label: session.title,
      detail: `${session.harness.toUpperCase()} session · ${session.status}`,
      icon: <ChatCircleText size={14} />,
      choose: () => { options.runCommand({ type: 'resume', sessionId: session.id }); options.setDraft('') },
    }))
  }

  useEffect(() => {
    setActiveSuggestion(0)
  }, [menu, value, suggestions.length])

  return {
    menu,
    setMenu,
    suggestions,
    activeSuggestion,
    setActiveSuggestion,
    mentionsSkills: mention?.trigger === '$',
    /** Clears the accepted-mention marker so Backspace into a completed mention reopens its menu. */
    forgetAcceptedMention: () => { acceptedMentionRef.current = null },
  }
}
