import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DiscoveredProjectScript } from '../../src/types/api'

const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_NODE_SCRIPTS = 24
const MAX_MAKEFILE_TARGETS = 16

type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm'

const PRIORITY_RUN_SCRIPTS = ['dev', 'start', 'serve', 'preview', 'watch'] as const
const PRIORITY_TASK_SCRIPTS = ['build', 'test', 'check', 'typecheck', 'lint'] as const

const LIFECYCLE_HOOKS = new Set([
  'prepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'version',
  'preversion',
  'postversion',
  'install',
  'uninstall',
  'preinstall',
  'postinstall',
  'preuninstall',
  'postuninstall',
  'prerestart',
  'postrestart',
  'prestop',
  'poststop',
  'preshrinkwrap',
  'postshrinkwrap',
  'pretest',
  'posttest',
  'prestart',
  'poststart',
  'prebuild',
  'postbuild',
])

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    return info.isFile()
  } catch {
    return false
  }
}

async function readBoundedText(filePath: string): Promise<string | undefined> {
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) return undefined
    return await readFile(filePath, 'utf8')
  } catch {
    return undefined
  }
}

function isLifecycleHook(name: string, allScripts: Record<string, unknown>): boolean {
  if (name === 'preview') return false
  if (LIFECYCLE_HOOKS.has(name)) return true
  if (name.startsWith('pre') && name.length > 3 && Object.prototype.hasOwnProperty.call(allScripts, name.slice(3))) return true
  if (name.startsWith('post') && name.length > 4 && Object.prototype.hasOwnProperty.call(allScripts, name.slice(4))) return true
  return false
}

function parsePackageManagerField(value: unknown): PackageManager | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().toLowerCase()
  const name = trimmed.split('@', 1)[0]
  if (name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'npm') return name
  return undefined
}

async function detectPackageManager(rootDir: string, packageManagerField: unknown): Promise<PackageManager> {
  const fromField = parsePackageManagerField(packageManagerField)
  if (fromField) return fromField
  if (await isRegularFile(join(rootDir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await isRegularFile(join(rootDir, 'yarn.lock'))) return 'yarn'
  if (await isRegularFile(join(rootDir, 'bun.lock')) || await isRegularFile(join(rootDir, 'bun.lockb'))) return 'bun'
  return 'npm'
}

function formatNodeCommand(pm: PackageManager, name: string): string {
  if (pm === 'npm' && name === 'test') return 'npm test'
  return `${pm} run ${name}`
}

function orderScriptNames(names: string[]): string[] {
  const rank = new Map<string, number>()
  PRIORITY_RUN_SCRIPTS.forEach((name, index) => rank.set(name, index))
  PRIORITY_TASK_SCRIPTS.forEach((name, index) => rank.set(name, PRIORITY_RUN_SCRIPTS.length + index))

  return [...names].sort((left, right) => {
    const leftRank = rank.get(left)
    const rightRank = rank.get(right)
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank
    if (leftRank !== undefined) return -1
    if (rightRank !== undefined) return 1
    return left.localeCompare(right)
  })
}

async function discoverPackageJsonScripts(rootDir: string): Promise<DiscoveredProjectScript[]> {
  const raw = await readBoundedText(join(rootDir, 'package.json'))
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []

  const pkg = parsed as Record<string, unknown>
  const scriptsField = pkg.scripts
  if (!scriptsField || typeof scriptsField !== 'object' || Array.isArray(scriptsField)) return []

  const scriptsRecord = scriptsField as Record<string, unknown>
  const validNames: string[] = []
  for (const [name, command] of Object.entries(scriptsRecord)) {
    const trimmedName = name.trim()
    if (!trimmedName || /[\0\r\n]/.test(trimmedName)) continue
    if (typeof command !== 'string' || !command.trim()) continue
    if (isLifecycleHook(trimmedName, scriptsRecord)) continue
    validNames.push(trimmedName)
  }
  if (validNames.length === 0) return []

  const pm = await detectPackageManager(rootDir, pkg.packageManager)
  return orderScriptNames(validNames)
    .slice(0, MAX_NODE_SCRIPTS)
    .map((name) => ({ name, command: formatNodeCommand(pm, name) }))
}

async function discoverCargoScripts(rootDir: string): Promise<DiscoveredProjectScript[]> {
  const cargoToml = await readBoundedText(join(rootDir, 'Cargo.toml'))
  if (cargoToml === undefined) return []
  const isBinary = /\[\[bin\]\]/m.test(cargoToml) || await isRegularFile(join(rootDir, 'src', 'main.rs'))
  if (isBinary) {
    return [
      { name: 'run', command: 'cargo run' },
      { name: 'test', command: 'cargo test' },
      { name: 'check', command: 'cargo check' },
    ]
  }
  return [
    { name: 'check', command: 'cargo check' },
    { name: 'test', command: 'cargo test' },
  ]
}

async function discoverGoScripts(rootDir: string): Promise<DiscoveredProjectScript[]> {
  if (!(await isRegularFile(join(rootDir, 'go.mod')))) return []
  return [
    { name: 'run', command: 'go run .' },
    { name: 'test', command: 'go test ./...' },
    { name: 'build', command: 'go build ./...' },
  ]
}

async function discoverPythonScripts(rootDir: string): Promise<DiscoveredProjectScript[]> {
  if (!(await isRegularFile(join(rootDir, 'pyproject.toml')))) return []
  return [{ name: 'test', command: 'pytest' }]
}

async function discoverMakefileScripts(rootDir: string): Promise<DiscoveredProjectScript[]> {
  const makefile = await readBoundedText(join(rootDir, 'Makefile'))
  if (!makefile) return []

  const seen = new Set<string>()
  const targets: DiscoveredProjectScript[] = []
  for (const line of makefile.split(/\r?\n/)) {
    const match = /^([a-zA-Z0-9][a-zA-Z0-9_-]*):/.exec(line)
    if (!match) continue
    const target = match[1]
    if (seen.has(target)) continue
    seen.add(target)
    targets.push({ name: target, command: `make ${target}` })
    if (targets.length >= MAX_MAKEFILE_TARGETS) break
  }
  return targets
}

/**
 * Reads project manifests from an already-authorized directory without executing
 * any commands. Returns discovered runnable scripts or an empty array.
 */
export async function discoverProjectScripts(rootDir: string): Promise<DiscoveredProjectScript[]> {
  const nodeScripts = await discoverPackageJsonScripts(rootDir)
  if (nodeScripts.length > 0) return nodeScripts

  const cargoScripts = await discoverCargoScripts(rootDir)
  if (cargoScripts.length > 0) return cargoScripts

  const goScripts = await discoverGoScripts(rootDir)
  if (goScripts.length > 0) return goScripts

  const pythonScripts = await discoverPythonScripts(rootDir)
  if (pythonScripts.length > 0) return pythonScripts

  return discoverMakefileScripts(rootDir)
}
