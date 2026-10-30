import { PRIME_THINKING_LEVELS, type HarnessId, type PrimeThinkingLevel } from '@/types/api'

export const HARNESS_SELECTOR_ORDER: readonly HarnessId[] = ['pi']

/** Product name shown in window chrome and the brand switcher. */
export const HARNESS_PRODUCT_NAMES: Record<HarnessId, string> = { pi: 'Pi Work' }

/** The agent each harness runs, used in settings and error copy. */
export const HARNESS_AGENT_NAMES: Record<HarnessId, string> = { pi: 'Pi' }

/** Short conversational name ("Prime is working"). */
export const HARNESS_SHORT_NAMES: Record<HarnessId, string> = { pi: 'Pi' }

export type PiBehaviorMode = 'pi' | 'apex' | 'apex-orchestrate' | 'fusion' | 'hydra' | 'work'
export type ActivePiHydraTier = 'standard' | 'high' | 'max'
export type PiHydraTier = 'off' | ActivePiHydraTier

export const PI_BEHAVIOR_MODE_OPTIONS: ReadonlyArray<{ value: PiBehaviorMode; label: string; detail: string }> = [
  { value: 'apex', label: 'Apex', detail: 'Inline-first lead with specialist delegation' },
  { value: 'apex-orchestrate', label: 'Apex Orchestrate', detail: 'Delegate discovery, implementation, and gates' },
  { value: 'fusion', label: 'Fusion', detail: 'Lead + persistent sidekick pair' },
  { value: 'hydra', label: 'Hydra', detail: 'Stats-driven model and effort router' },
  { value: 'work', label: 'Work', detail: 'Operations-first collaboration crew' },
  { value: 'pi', label: 'Pi', detail: 'Standard Pi prompt and tools' },
]

export const PI_HYDRA_TIER_OPTIONS: ReadonlyArray<{ value: ActivePiHydraTier; label: string; detail: string }> = [
  { value: 'standard', label: 'Hydra: Standard', detail: 'Balanced coding, speed, and cost efficiency' },
  { value: 'high', label: 'Hydra: High', detail: 'High-capability coding and reasoning routing' },
  { value: 'max', label: 'Hydra: Max', detail: 'Frontier intelligence and coding routing' },
]

const PI_BEHAVIOR_MODE_STORAGE_KEY = 'gooeypi:pi-behavior-mode'
const PI_HYDRA_TIER_STORAGE_KEY = 'gooeypi:pi-hydra-tier'
export const PI_BEHAVIOR_MODE_EVENT = 'gooeypi:pi-mode-change'
export const PI_HYDRA_STATUS_KEY = 'hydra'
export const PI_HYDRA_TIER_EVENT = 'gooeypi:pi-hydra-tier-change'
let activePiBehaviorMode: PiBehaviorMode | undefined
let activePiHydraTier: ActivePiHydraTier | undefined

export function isActivePiHydraTier(value: unknown): value is ActivePiHydraTier {
  return value === 'standard' || value === 'high' || value === 'max'
}

export function parsePiHydraStatus(statusText: unknown): ActivePiHydraTier | undefined {
  if (typeof statusText !== 'string') return undefined
  const normalized = statusText.trim().toLowerCase()
  const tier = normalized.startsWith('hydra:') ? normalized.slice('hydra:'.length).trim() : normalized
  return isActivePiHydraTier(tier) ? tier : undefined
}

export function isPiBehaviorMode(value: unknown): value is PiBehaviorMode {
  return value === 'pi' || value === 'apex' || value === 'apex-orchestrate' || value === 'fusion' || value === 'hydra' || value === 'work'
}

export function piModeFromStatusText(statusText: unknown): PiBehaviorMode | undefined {
  if (typeof statusText !== 'string') return undefined
  if (parsePiHydraStatus(statusText)) return 'hydra'
  const normalized = statusText.trim().toLowerCase()
  if (normalized === 'pi') return 'pi'
  if (normalized === 'apex') return 'apex'
  if (normalized === 'apex orchestrate' || normalized === 'apex-orchestrate') return 'apex-orchestrate'
  if (normalized === 'fusion') return 'fusion'
  if (normalized === 'hydra') return 'hydra'
  if (normalized === 'work') return 'work'
  return undefined
}

export function parsePiModeCommand(prompt: string, harness: HarnessId): string | undefined {
  if (harness !== 'pi') return undefined
  const trimmed = prompt.trim()
  if (/^\/(?:mode(?:\s+\S.*)?|orchestrate(?:\s+\S.*)?)$/i.test(trimmed)) return trimmed
  return undefined
}

/** Checks Pi's `get_commands` response without accepting a same-named prompt or skill. */
export function hasPiExtensionCommand(response: Record<string, unknown>, name: string): boolean {
  const commands: unknown = typeof response.data === 'object' && response.data !== null ? Reflect.get(response.data, 'commands') : undefined
  return Array.isArray(commands) && commands.some((command: unknown) => typeof command === 'object' && command !== null
    && Reflect.get(command, 'name') === name && Reflect.get(command, 'source') === 'extension')
}

export function piHydraTierFromCommand(command: string): ActivePiHydraTier | undefined {
  const match = /^\/mode\s+hydra(?:\s+(\S+))?$/i.exec(command.trim())
  if (!match) return undefined
  const sub = match[1]?.toLowerCase()
  if (isActivePiHydraTier(sub)) return sub
  if (!sub || sub === 'on') return readSavedPiHydraTier()
  return undefined
}

export function piModeFromCommand(command: string): PiBehaviorMode | undefined {
  const hydraMatch = /^\/mode\s+hydra(?:\s+(\S+))?$/i.exec(command.trim())
  if (hydraMatch) {
    const sub = hydraMatch[1]?.toLowerCase()
    if (!sub || sub === 'on' || isActivePiHydraTier(sub)) return 'hydra'
    if (sub === 'off') {
      const fallback = readDefaultPiBehaviorMode()
      return fallback === 'hydra' ? 'apex' : fallback
    }
    return undefined
  }
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

export function readDefaultPiHydraTier(): ActivePiHydraTier {
  try {
    if (typeof window === 'undefined') return 'high'
    const saved = window.localStorage?.getItem(PI_HYDRA_TIER_STORAGE_KEY)
    if (isActivePiHydraTier(saved)) return saved
  } catch { /* ignore storage errors */ }
  return 'high'
}

export function readSavedPiHydraTier(): ActivePiHydraTier {
  return activePiHydraTier ?? readDefaultPiHydraTier()
}

export function publishActivePiHydraTier(tier: ActivePiHydraTier): void {
  activePiHydraTier = tier
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PI_HYDRA_TIER_EVENT, { detail: tier }))
  } catch { /* ignore event errors */ }
}

export function savePiHydraTier(tier: ActivePiHydraTier): void {
  try {
    if (typeof window !== 'undefined') window.localStorage?.setItem(PI_HYDRA_TIER_STORAGE_KEY, tier)
  } catch { /* ignore storage errors */ }
  publishActivePiHydraTier(tier)
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

export interface PiFusionModelChoice {
  provider: string
  modelId: string
  thinking: PrimeThinkingLevel
}

export interface PiFusionPair {
  lead: PiFusionModelChoice
  sidekick: PiFusionModelChoice
}

/** Status key the Pi modes extension uses for the active Fusion pair (JSON statusText). */
export const PI_FUSION_PAIR_STATUS_KEY = 'fusion-pair'
export const PI_FUSION_PAIR_EVENT = 'gooeypi:pi-fusion-pair-change'
const MAX_FUSION_PAIR_STATUS_LENGTH = 2_000
let activePiFusionPair: PiFusionPair | null = null

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

function identityPart(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !hasControlCharacter(value) ? value : undefined
}

function isThinkingLevel(value: unknown): value is PrimeThinkingLevel {
  return PRIME_THINKING_LEVELS.some((level) => level === value)
}

function fusionModelChoice(value: unknown): PiFusionModelChoice | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const provider = identityPart(Reflect.get(value, 'provider'))
  const modelId = identityPart(Reflect.get(value, 'modelId'))
  const thinking: unknown = Reflect.get(value, 'thinking')
  if (!provider || !modelId || !isThinkingLevel(thinking)) return undefined
  return { provider, modelId, thinking }
}

/** Parses the extension's structured `fusion-pair` status; anything else is no pair. */
export function parsePiFusionPairStatus(statusText: unknown): PiFusionPair | undefined {
  if (typeof statusText !== 'string' || statusText.length > MAX_FUSION_PAIR_STATUS_LENGTH) return undefined
  let data: unknown
  try { data = JSON.parse(statusText) } catch { return undefined }
  if (typeof data !== 'object' || data === null) return undefined
  const lead = fusionModelChoice(Reflect.get(data, 'lead'))
  const sidekick = fusionModelChoice(Reflect.get(data, 'sidekick'))
  return lead && sidekick ? { lead, sidekick } : undefined
}

export function fusionModelIdentity(choice: PiFusionModelChoice): string {
  return `${choice.provider}/${choice.modelId}`
}

export function readActivePiFusionPair(): PiFusionPair | null {
  return activePiFusionPair
}

/** Publishes the active runtime's reported pair; null when none is known. Never persisted. */
export function publishActivePiFusionPair(pair: PiFusionPair | null): void {
  activePiFusionPair = pair
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PI_FUSION_PAIR_EVENT, { detail: pair }))
  } catch { /* ignore event errors */ }
}
