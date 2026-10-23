import { join } from 'node:path'
import type { HarnessId } from '../../src/types/api'

export type ExtensionCapability = 'schedule' | 'browser' | 'browserAgent' | 'askUser' | 'collaboration' | 'piFastMode'

export interface ExtensionInjection {
  readonly capability: ExtensionCapability
  readonly filename: string
  readonly environmentVariable: string
}

const injectionsByHarness = {
  pi: [
    { capability: 'piFastMode', filename: 'pi-work-fast-mode.ts', environmentVariable: 'GOOEYPI_PI_FAST_MODE_EXTENSION_PATH' },
    { capability: 'schedule', filename: 'omp-work-schedules.ts', environmentVariable: 'PRIME_WORK_SCHEDULE_EXTENSION_PATH' },
    { capability: 'browser', filename: 'omp-work-browser.ts', environmentVariable: 'PRIME_WORK_BROWSER_EXTENSION_PATH' },
    { capability: 'browserAgent', filename: 'apex-browser-agent.ts', environmentVariable: 'APEX_BROWSER_AGENT_EXTENSION_PATH' },
    { capability: 'askUser', filename: 'omp-work-ask-user.ts', environmentVariable: 'PRIME_WORK_ASK_USER_EXTENSION_PATH' },
    { capability: 'collaboration', filename: 'omp-work-collaboration.ts', environmentVariable: 'GOOEYPI_COLLABORATION_EXTENSION_PATH' },
  ],
} as const satisfies Readonly<Record<HarnessId, readonly ExtensionInjection[]>>

export const EXTENSION_INJECTIONS = Object.freeze(injectionsByHarness)

export const SHIPPED_EXTENSION_FILENAMES = [...new Set(
  Object.values(injectionsByHarness).flatMap((injections) => injections.map(({ filename }) => filename)),
)].sort()

export function extensionInjections(harness: HarnessId): readonly ExtensionInjection[] {
  return EXTENSION_INJECTIONS[harness]
}

export function extensionInjection(harness: HarnessId, capability: ExtensionCapability): ExtensionInjection {
  const injection = extensionInjections(harness).find((candidate) => candidate.capability === capability)
  if (!injection) throw new Error(`Harness ${harness} does not inject the ${capability} extension`)
  return injection
}

export interface ExtensionPathContext {
  readonly isPackaged: boolean
  readonly appPath: string
  readonly resourcesPath: string
}

export function resolveExtensionPath(filename: string, context: ExtensionPathContext): string {
  const root = context.isPackaged ? context.resourcesPath : join(context.appPath, 'assets')
  return join(root, 'extensions', filename)
}
