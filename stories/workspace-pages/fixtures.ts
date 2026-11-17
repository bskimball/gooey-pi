import bundledSprite from '../../apps/desktop/assets/pets/gooey-pi/spritesheet.webp?url'
import type { ApexApi, ApexModelCatalog, AppMeta, PetDefinition, AutomationScheduleRecord } from '../../packages/core/src/types/api'
import { SAMPLE_PROJECTS, SAMPLE_SESSIONS, SAMPLE_SKILLS, SAMPLE_SCHEDULES, SAMPLE_TRANSCRIPT } from '../../apps/desktop/src/lib/data'

export const now = Date.parse('2026-08-06T12:00:00Z')
export const timestamp = new Date(now).toISOString()
export const noop = () => undefined
export const succeed = async () => undefined
export const pending = <T>(): Promise<T> => new Promise(() => undefined)
export const fail = async (): Promise<never> => {
  throw new Error('Fixture operation failed. Retry to continue.')
}
export const projects = SAMPLE_PROJECTS.map((project) => ({ ...project, createdAt: timestamp, lastOpenedAt: timestamp }))
export const sessions = SAMPLE_SESSIONS.map((session) => ({ ...session, createdAt: timestamp, updatedAt: timestamp }))
export const skills = SAMPLE_SKILLS
export const messages = SAMPLE_TRANSCRIPT
export const schedules: AutomationScheduleRecord[] = SAMPLE_SCHEDULES.map((schedule) => ({
  ...schedule,
  createdAt: timestamp,
  updatedAt: timestamp,
  nextRunAt: '2026-08-07T09:00:00Z',
  timing: { kind: 'rrule' as const, dtstartLocal: '2026-08-07T09:00:00', timeZone: 'UTC', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
}))
export const catalog: ApexModelCatalog = {
  apexVersion: '1.0.0',
  refreshedAt: timestamp,
  providers: [
    { id: 'fixture', name: 'Story provider', authMethod: 'api_key', configured: true, modelCount: 2, availableModelCount: 2, enabled: true },
    { id: 'disabled', name: 'Disabled provider', authMethod: 'oauth', configured: false, modelCount: 0, availableModelCount: 0, enabled: false },
  ],
  models: [
    {
      key: 'fixture/reviewer',
      provider: 'fixture',
      id: 'reviewer',
      name: 'Review model',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 200000,
      maxTokens: 16000,
      availableThinkingLevels: ['off', 'medium', 'high'],
      fastModeSupported: true,
      available: true,
      enabled: true,
    },
    {
      key: 'fixture/hidden',
      provider: 'fixture',
      id: 'hidden',
      name: 'Hidden model',
      reasoning: false,
      input: ['text'],
      contextWindow: 32000,
      maxTokens: 4000,
      availableThinkingLevels: ['off'],
      fastModeSupported: false,
      available: true,
      enabled: false,
    },
  ],
}
export const meta: AppMeta = { version: '1.0.0', platform: 'darwin', homeDir: '/Users/story', harnesses: { pi: { path: '/fixture/pi', version: '1.0.0' } } }
export const orb: PetDefinition = { id: 'orb', petId: 'orb', displayName: 'Orb', description: 'Built-in companion', source: 'built-in', kind: 'orb' }
export const spritePet: PetDefinition = { id: 'fixture/sprite', petId: 'sprite', displayName: 'Sprite companion', description: 'Offline sprite fixture', source: 'built-in', kind: 'spritesheet' }
// The production bundled sheet is served by Storybook, never fetched from a remote URL.
export const pets: ApexApi['pets'] = { list: async () => [orb, spritePet], sprite: async () => bundledSprite }
export function fixedClock() {
  const original = Date.now
  Date.now = () => now
  return () => {
    Date.now = original
  }
}
export function voiceFixture(): ApexApi['voice'] {
  const status: Awaited<ReturnType<ApexApi['voice']['credentialStatus']>> = {
    configured: { openai: true, groq: false, deepgram: false, 'self-hosted': false },
    source: { openai: 'session' },
    storage: { available: true },
  }
  return {
    credentialStatus: async () => status,
    saveApiKey: async (provider) => {
      status.configured[provider] = true
      return { ...status }
    },
    deleteApiKey: async (provider) => {
      status.configured[provider] = false
      return { ...status }
    },
    createRealtimeCall: async () => {
      throw new Error('VoiceOrb requires the dedicated browser safety fixture')
    },
    transcribe: async () => 'Offline transcript',
    testSelfHosted: async () => true,
    executeTool: async () => ({ output: 'Offline story response' }),
  }
}
