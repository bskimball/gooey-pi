import type { Dispatch, SetStateAction } from 'react'
import { type BashCommand, parseSlashCommand } from '@/lib/composer-commands'
import { hasPiExtensionCommand } from '@/lib/harness'
import type { PrimeWorkApi, TranscriptMessage } from '@/types/api'

/**
 * Runs a runtime extension command through `prompt`, which Pi executes
 * immediately even mid-turn; as a steer or follow-up Pi would reject it.
 * Returns false, sending nothing, when the prompt is not an extension command.
 */
export async function runExtensionCommandNow(
  bridge: PrimeWorkApi,
  runtimeId: string,
  prompt: string,
  ownsRuntime: () => boolean = () => true,
): Promise<boolean> {
  const slash = parseSlashCommand(prompt)
  if (!slash) return false
  const listed = await bridge.agent.command(runtimeId, { type: 'get_commands' })
  if (!ownsRuntime()) throw new Error('Workspace changed before the command could be sent.')
  if (!hasPiExtensionCommand(listed, slash.name)) return false
  await bridge.agent.command(runtimeId, { type: 'prompt', message: prompt, streamingBehavior: 'followUp' })
  return true
}

interface BashRun {
  bridge: PrimeWorkApi
  runtimeId: string
  bash: BashCommand
  setMessages: Dispatch<SetStateAction<TranscriptMessage[]>>
  isCurrent(): boolean
}

/** Runs a `!`/`!!` command through Pi's `bash` RPC and shows it as a bash tool row. */
export async function runBashCommand({ bridge, runtimeId, bash, setMessages, isCurrent }: BashRun): Promise<void> {
  const id = `bash-${Date.now()}`
  const call = { type: 'toolCall' as const, id, name: 'bash', args: { command: bash.command } }
  const update = (change: (message: TranscriptMessage) => TranscriptMessage | null) => {
    if (!isCurrent()) return
    setMessages((items) => items.flatMap((item) => {
      if (item.id !== id) return [item]
      const next = change(item)
      return next ? [next] : []
    }))
  }
  if (isCurrent()) setMessages((items) => [...items, { id, role: 'tool', timestamp: Date.now(), streaming: true, parts: [call] }])
  let response: Record<string, unknown>
  try {
    response = await bridge.agent.command(runtimeId, { type: 'bash', command: bash.command, ...(bash.excludeFromContext ? { excludeFromContext: true } : {}) })
  } catch (error) {
    update(() => null)
    throw error
  }
  const data = (typeof response.data === 'object' && response.data !== null ? response.data : {}) as Record<string, unknown>
  const output = typeof data.output === 'string' ? data.output : ''
  const truncation = data.truncated === true && typeof data.fullOutputPath === 'string' ? `\n\n[Output truncated. Full output: ${data.fullOutputPath}]` : ''
  const notes = [data.cancelled === true ? '[Cancelled]' : '', bash.excludeFromContext ? '[Not sent to the model]' : ''].filter(Boolean).join(' ')
  const text = [`${output}${truncation}`.trim(), notes].filter(Boolean).join('\n\n')
  const isError = data.cancelled === true || (typeof data.exitCode === 'number' && data.exitCode !== 0)
  update((item) => ({ ...item, streaming: false, completedAt: Date.now(), parts: [call, { type: 'toolResult', name: 'bash', text, isError }] }))
}
