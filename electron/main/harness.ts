import { join, posix } from 'node:path'

import type { HarnessId } from '../../src/types/api'

/**
 * Static description of one agent harness: how its executable is discovered
 * and where its agent state lives on disk. Discovery itself stays in
 * process-utils (`harnessExecutableCandidates`/`findHarnessExecutable`) so
 * every harness shares the same absolute-path and X_OK rules.
 */
export interface HarnessDescriptor {
  id: HarnessId
  productName: string
  agentName: string
  executableName: (platform: NodeJS.Platform) => string
  /** Environment override for the executable; only absolute paths are honored. */
  binaryEnvVar: string
  /** Directories under process.resourcesPath (as path segments) that may bundle the executable. */
  bundledResourceDirs: readonly (readonly string[])[]
  /** Harness-specific locations beyond the shared package-manager and system directories. */
  candidateDirs: (platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv) => string[]
  /** Official npm `.cmd` shim on Windows and the package entrypoint below `<shim dir>\node_modules`. */
  windowsNpmShim?: { shim: string; entrypoints: readonly (readonly string[])[] }
  agentDir: (home: string) => string
  sessionRoot: (home: string) => string
}

export const HARNESSES = {
  pi: {
    id: 'pi',
    productName: 'Pi Work',
    agentName: 'Pi',
    executableName: (platform) => platform === 'win32' ? 'pi.exe' : 'pi',
    binaryEnvVar: 'PI_BINARY',
    bundledResourceDirs: [],
    candidateDirs: (platform, home, env) => platform === 'win32' ? [] : [
      posix.join(env.XDG_DATA_HOME ?? posix.join(home, '.local', 'share'), 'pi-node', 'current', 'bin'),
    ],
    windowsNpmShim: { shim: 'pi.cmd', entrypoints: [['@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js'], ['@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'], ['@mariozechner', 'pi-coding-agent', 'dist', 'cli.js']] },
    agentDir: (home) => join(home, '.pi', 'agent'),
    sessionRoot: (home) => join(home, '.pi', 'agent', 'sessions'),
  },
} satisfies Record<'pi', HarnessDescriptor>
