import type { HarnessId } from '@/types/api'

export const HARNESS_SELECTOR_ORDER: readonly HarnessId[] = ['pi', 'omp', 'prime']

/** Product name shown in window chrome and the brand switcher. */
export const HARNESS_PRODUCT_NAMES: Record<HarnessId, string> = { prime: 'Prime Work', omp: 'OMP Work', pi: 'Pi Work' }

/** The agent each harness runs, used in settings and error copy. */
export const HARNESS_AGENT_NAMES: Record<HarnessId, string> = { prime: 'Prime Agent', omp: 'OMP', pi: 'Pi' }

/** Short conversational name ("Prime is working"). */
export const HARNESS_SHORT_NAMES: Record<HarnessId, string> = { prime: 'Prime', omp: 'OMP', pi: 'Pi' }

export type PiBehaviorMode = 'pi' | 'apex' | 'apex-orchestrate' | 'fusion' | 'work'

export const PI_BEHAVIOR_MODE_OPTIONS: ReadonlyArray<{ value: PiBehaviorMode; label: string; detail: string }> = [
  { value: 'apex', label: 'Apex', detail: 'Inline-first lead with specialist delegation' },
  { value: 'apex-orchestrate', label: 'Apex Orchestrate', detail: 'Delegate discovery, implementation, and gates' },
  { value: 'fusion', label: 'Fusion', detail: 'Lead + persistent sidekick pair' },
  { value: 'work', label: 'Work', detail: 'Operations-first collaboration crew' },
  { value: 'pi', label: 'Pi', detail: 'Standard Pi prompt and tools' },
]

const PI_BEHAVIOR_MODE_STORAGE_KEY = 'gooeypi:pi-behavior-mode'
export const PI_BEHAVIOR_MODE_EVENT = 'gooeypi:pi-mode-change'
let activePiBehaviorMode: PiBehaviorMode | undefined

export function isPiBehaviorMode(value: unknown): value is PiBehaviorMode {
  return value === 'pi' || value === 'apex' || value === 'apex-orchestrate' || value === 'fusion' || value === 'work'
}

export function piModeFromStatusText(statusText: unknown): PiBehaviorMode | undefined {
  if (typeof statusText !== 'string') return undefined
  const normalized = statusText.trim().toLowerCase()
  if (normalized === 'pi') return 'pi'
  if (normalized === 'apex') return 'apex'
  if (normalized === 'apex orchestrate' || normalized === 'apex-orchestrate') return 'apex-orchestrate'
  if (normalized === 'fusion') return 'fusion'
  if (normalized === 'work') return 'work'
  return undefined
}

export function parsePiModeCommand(prompt: string, harness: HarnessId): string | undefined {
  if (harness !== 'pi') return undefined
  const trimmed = prompt.trim()
  if (/^\/(?:mode(?:\s+\S.*)?|orchestrate(?:\s+\S.*)?)$/i.test(trimmed)) return trimmed
  return undefined
}

export function piModeFromCommand(command: string): PiBehaviorMode | undefined {
  const match = /^\/(mode|orchestrate)(?:\s+(\S+))?$/i.exec(command.trim())
  if (!match) return undefined
  const verb = match[1].toLowerCase()
  const arg = match[2]?.toLowerCase()
  if (verb === 'mode' && isPiBehaviorMode(arg) && arg !== 'fusion') return arg
  if (verb === 'orchestrate') {
    if (arg === 'on') return 'apex-orchestrate'
    if (arg === 'off') return 'apex'
    if (!arg || arg === 'toggle') return readSavedPiBehaviorMode() === 'apex-orchestrate' ? 'apex' : 'apex-orchestrate'
  }
  return undefined
}

export function readDefaultPiBehaviorMode(): PiBehaviorMode {
  try {
    if (typeof window === 'undefined') return 'apex'
    const saved = window.localStorage?.getItem(PI_BEHAVIOR_MODE_STORAGE_KEY)
    if (isPiBehaviorMode(saved)) return saved
  } catch { /* ignore storage errors */ }
  return 'apex'
}

export function readSavedPiBehaviorMode(): PiBehaviorMode {
  return activePiBehaviorMode ?? readDefaultPiBehaviorMode()
}

export function publishActivePiBehaviorMode(mode: PiBehaviorMode): void {
  activePiBehaviorMode = mode
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PI_BEHAVIOR_MODE_EVENT, { detail: mode }))
  } catch { /* ignore event errors */ }
}

export function savePiBehaviorMode(mode: PiBehaviorMode, persistDefault = mode !== 'apex-orchestrate'): void {
  if (persistDefault && mode !== 'apex-orchestrate') {
    try {
      if (typeof window !== 'undefined') window.localStorage?.setItem(PI_BEHAVIOR_MODE_STORAGE_KEY, mode)
    } catch { /* ignore storage errors */ }
  }
  publishActivePiBehaviorMode(mode)
}
