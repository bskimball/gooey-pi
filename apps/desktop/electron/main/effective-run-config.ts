import { access, lstat, readdir, realpath, stat } from 'node:fs/promises'
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
  signal?: AbortSignal
}

function piAgentDir(home: string): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim()
  return configured ? configured : join(home, '.pi', 'agent')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Size of a regular file, following a symlink as Pi does; undefined for anything else or a broken link. */
async function regularFileSize(path: string): Promise<number | undefined> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : undefined
  } catch {
    return undefined
  }
}

/** First instruction file Pi would load from `dir`. */
async function firstInstructionFile(dir: string): Promise<{ kind: EffectiveInstructionSource['kind']; path: string; bytes: number } | undefined> {
  for (const kind of INSTRUCTION_FILES) {
    const path = join(dir, kind)
    const bytes = await regularFileSize(path)
    if (bytes !== undefined) return { kind, path, bytes }
  }
  return undefined
}

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * What a run started in `cwd` will pick up: injected extensions and the
 * instruction files Pi reads. Reports names, sizes, and counts only; it never
 * returns file contents and never touches the Pi credential or trust files.
 */
export async function describeEffectiveRunConfig({ cwd, harness, extensionContext, home = homedir(), agentDir, signal }: EffectiveRunConfigRequest): Promise<EffectiveRunConfig> {
  signal?.throwIfAborted()
  const injectedCapabilities: EffectiveCapability[] = await Promise.all(
    extensionInjections(harness).map(async ({ capability, filename }) => ({
      capability,
      filename,
      present: await pathExists(resolveExtensionPath(filename, extensionContext)),
    })),
  )

  const instructionSources: EffectiveInstructionSource[] = []
  const start = resolve(cwd)
  const homeDir = await canonical(home)
  for (let dir = start; ; dir = dirname(dir)) {
    signal?.throwIfAborted()
    if (dir === homeDir && dir !== start) break
    const found = await firstInstructionFile(dir)
    if (found) instructionSources.push({ scope: dir === start ? 'project' : 'parent', ...found })
    if (await pathExists(join(dir, '.git')) || dirname(dir) === dir) break
  }

  signal?.throwIfAborted()
  const userDir = agentDir ?? piAgentDir(home)
  const userInstructions = await firstInstructionFile(userDir)
  if (userInstructions) instructionSources.unshift({ scope: 'user', ...userInstructions })

  const systemPath = join(userDir, 'SYSTEM.md')
  const systemBytes = await regularFileSize(systemPath)
  if (systemBytes !== undefined) instructionSources.push({ scope: 'user', kind: 'SYSTEM.md', path: systemPath, bytes: systemBytes })

  const skillDirs: EffectiveSkillDir[] = []
  for (const relative of SKILL_DIRS) {
    signal?.throwIfAborted()
    const path = join(start, relative)
    if (!await isDirectory(path)) continue
    try {
      skillDirs.push({ path, count: (await readdir(path)).length })
    } catch { /* unreadable directory: omit */ }
  }

  return {
    injectedCapabilities,
    instructionSources: instructionSources.slice(0, MAX_SOURCES),
    skillDirs,
  }
}
