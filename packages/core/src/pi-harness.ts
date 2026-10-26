import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type ExecutableSource = string | null | (() => string | null)
export type StoredHarnessId = 'pi' | 'prime' | 'omp'
export interface PiInvocation {
  file: string
  args: string[]
}

export const WINDOWS_ENTRYPOINTS = [
  ['@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js'],
  ['@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'],
  ['@mariozechner', 'pi-coding-agent', 'dist', 'cli.js'],
]

/** Resolve npm's Windows shim to a Node invocation without invoking a shell. */
export function resolvePiExecutable(configuredPath: string): PiInvocation {
  if (process.platform !== 'win32') return { file: configuredPath || 'pi', args: [] }
  const shims = [
    configuredPath,
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'pi.cmd') : '',
    ...(process.env.PATH ?? '')
      .split(';')
      .filter(Boolean)
      .map((dir) => join(dir, 'pi.cmd')),
  ].filter(Boolean)
  for (const shim of shims) {
    if (!existsSync(shim)) continue
    if (shim.toLowerCase().endsWith('.js')) return { file: 'node', args: [shim] }
    const dir = dirname(shim)
    const node = existsSync(join(dir, 'node.exe')) ? join(dir, 'node.exe') : 'node'
    const known = WINDOWS_ENTRYPOINTS.map((parts) => join(dir, 'node_modules', ...parts)).find((file) => existsSync(file))
    const fromShim = /"%dp0%\\([^"]+\.js)"/.exec(readFileSync(shim, 'utf8'))?.[1]
    const cli = known ?? (fromShim ? join(dir, fromShim) : undefined)
    if (cli && existsSync(cli)) return { file: node, args: [cli] }
  }
  throw new Error('Pi was not found. Install it with `npm install -g @earendil-works/pi-coding-agent`, or set `apex.piPath`.')
}
