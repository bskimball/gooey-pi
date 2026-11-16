import type { DiscoveredProjectScript, ProjectRecord, ProjectScripts } from '@/types/api'

export class ProjectScriptBusyError extends Error {
  constructor() {
    super('Another project script is already starting or running.')
    this.name = 'ProjectScriptBusyError'
  }
}

export function activeProjectScriptKind<T extends string>(run: { projectId: string; kind: T } | undefined, projectId?: string): T | undefined {
  return run && run.projectId === projectId ? run.kind : undefined
}

export function setupNeedsRun(scripts?: ProjectScripts): boolean {
  if (!scripts?.setup.trim()) return false
  return scripts.setupLastRun !== scripts.setup
}

export function availableProjectScripts(project: Pick<ProjectRecord, 'discoveredScripts' | 'scripts'>): DiscoveredProjectScript[] {
  const discovered = project.discoveredScripts ?? []
  const legacyRun = project.scripts?.run.trim()
  if (!legacyRun) return discovered
  if (discovered.some((script) => script.command.trim() === legacyRun)) return discovered
  return [{ name: 'run', command: legacyRun }, ...discovered]
}

export function resolveSelectedProjectScript(
  scripts: readonly DiscoveredProjectScript[],
  preferredName?: string | null,
): DiscoveredProjectScript | undefined {
  if (scripts.length === 0) return undefined
  if (preferredName) {
    const matched = scripts.find((script) => script.name === preferredName)
    if (matched) return matched
  }
  return scripts[0]
}
