import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { EffectiveCapability, EffectiveInstructionSource, EffectiveRunConfig, EffectiveSkillDir, HarnessId } from '../../src/types/api'
import { extensionInjections, resolveExtensionPath, type ExtensionPathContext } from './extension-manifest'

const MAX_SOURCES = 50
/** Pi 1.4.0 resource-loader order: the first existing file in a directory wins. */
const INSTRUCTION_FILES = ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'] as const
const SKILL_DIRS = ['.agents/skills', '.pi/skills'] as const

export interface EffectiveRunConfigRequest {
  /** Already authorized project path. */
  cwd: string
  harness: HarnessId
  extensionContext: ExtensionPathContext
  /** Overrides for tests. */
  home?: string
  agentDir?: string
}

function piAgentDir(home: string): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim()
  return configured ? configured : join(home, '.pi', 'agent')
}

/** Size of a regular file, following a symlink as Pi does; undefined for anything else or a broken link. */
function regularFileSize(path: string): number | undefined {
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat.size : undefined
  } catch {
    return undefined
  }
}

/** First instruction file Pi would load from `dir`. */
function firstInstructionFile(dir: string): { kind: EffectiveInstructionSource['kind']; path: string; bytes: number } | undefined {
  for (const kind of INSTRUCTION_FILES) {
    const path = join(dir, kind)
    const bytes = regularFileSize(path)
    if (bytes !== undefined) return { kind, path, bytes }
  }
  return undefined
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * What a run started in `cwd` will pick up: injected extensions and the
 * instruction files Pi reads. Reports names, sizes, and counts only; it never
 * returns file contents and never touches the Pi credential or trust files.
 */
export function describeEffectiveRunConfig({ cwd, harness, extensionContext, home = homedir(), agentDir }: EffectiveRunConfigRequest): EffectiveRunConfig {
  const injectedCapabilities: EffectiveCapability[] = extensionInjections(harness).map(({ capability, filename }) => ({
    capability,
    filename,
    present: existsSync(resolveExtensionPath(filename, extensionContext)),
  }))

  const instructionSources: EffectiveInstructionSource[] = []
  const start = resolve(cwd)
  const homeDir = canonical(home)
  for (let dir = start; ; dir = dirname(dir)) {
    if (dir === homeDir && dir !== start) break
    const found = firstInstructionFile(dir)
    if (found) instructionSources.push({ scope: dir === start ? 'project' : 'parent', ...found })
    if (existsSync(join(dir, '.git')) || dirname(dir) === dir) break
  }

  const userDir = agentDir ?? piAgentDir(home)
  const userInstructions = firstInstructionFile(userDir)
  if (userInstructions) instructionSources.unshift({ scope: 'user', ...userInstructions })

  const systemPath = join(userDir, 'SYSTEM.md')
  const systemBytes = regularFileSize(systemPath)
  if (systemBytes !== undefined) instructionSources.push({ scope: 'user', kind: 'SYSTEM.md', path: systemPath, bytes: systemBytes })

  const skillDirs: EffectiveSkillDir[] = []
  for (const relative of SKILL_DIRS) {
    const path = join(start, relative)
    if (!isDirectory(path)) continue
    try {
      skillDirs.push({ path, count: readdirSync(path).length })
    } catch { /* unreadable directory: omit */ }
  }

  return {
    injectedCapabilities,
    instructionSources: instructionSources.slice(0, MAX_SOURCES),
    skillDirs,
  }
}
