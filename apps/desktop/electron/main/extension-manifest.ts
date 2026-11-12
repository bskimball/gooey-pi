import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { HarnessId } from '../../src/types/api'

export type ExtensionCapability = 'schedule' | 'browser' | 'browserAgent' | 'askUser' | 'collaboration' | 'piFastMode' | 'editor' | 'visualPreview'

export interface ExtensionInjection {
  readonly capability: ExtensionCapability
  readonly filename: string
  readonly environmentVariable: string
}

const injectionsByHarness = {
  pi: [
    { capability: 'editor', filename: 'apex-editor.ts', environmentVariable: 'APEX_EDITOR_EXTENSION_PATH' },
    { capability: 'visualPreview', filename: 'apex-visual-previews.ts', environmentVariable: 'APEX_VISUAL_PREVIEW_EXTENSION_PATH' },
    { capability: 'piFastMode', filename: 'pi-work-fast-mode.ts', environmentVariable: 'GOOEYPI_PI_FAST_MODE_EXTENSION_PATH' },
    { capability: 'schedule', filename: 'apex-schedules.ts', environmentVariable: 'APEX_SCHEDULE_EXTENSION_PATH' },
    { capability: 'browser', filename: 'apex-browser.ts', environmentVariable: 'APEX_BROWSER_EXTENSION_PATH' },
    { capability: 'browserAgent', filename: 'apex-browser-agent.ts', environmentVariable: 'APEX_BROWSER_AGENT_EXTENSION_PATH' },
    { capability: 'askUser', filename: 'apex-ask-user.ts', environmentVariable: 'APEX_ASK_USER_EXTENSION_PATH' },
    { capability: 'collaboration', filename: 'apex-collaboration.ts', environmentVariable: 'GOOEYPI_COLLABORATION_EXTENSION_PATH' },
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

export function resolveDesktopAppRoot(appPath: string): string {
  const desktop = join(appPath, 'apps', 'desktop')
  return existsSync(join(desktop, 'assets')) ? desktop : appPath
}

export function resolveExtensionPath(filename: string, context: ExtensionPathContext): string {
  const root = context.isPackaged ? context.resourcesPath : join(resolveDesktopAppRoot(context.appPath), 'assets')
  return join(root, 'extensions', filename)
}
