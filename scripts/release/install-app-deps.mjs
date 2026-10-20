#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { runCommand } from './lib.mjs'

export function qualifyWinptyBatchPaths(path = new URL('../../node_modules/node-pty/deps/winpty/src/winpty.gyp', import.meta.url)) {
  const source = readFileSync(path, 'utf8')
  // Explicit paths work when Windows disables implicit current-directory lookup.
  const qualified = source.replace(/&& (GetCommitHash|UpdateGenVersion)\.bat/g, '&& .\\\\$1.bat')
  if (qualified !== source) writeFileSync(path, qualified)
}

/**
 * @param {(command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => unknown} run
 * @param {NodeJS.ProcessEnv} sourceEnvironment
 * @param {NodeJS.Platform} platform
 */
export function installAppDependencies(run = runCommand, sourceEnvironment = process.env, platform = process.platform) {
  const env = { ...sourceEnvironment }
  if (platform === 'darwin' && !env.PYTHON) env.PYTHON = '/usr/bin/python3'

  run('install-electron', [], { env })
  if (platform === 'win32') qualifyWinptyBatchPaths()
  run('electron-builder', ['install-app-deps'], { env })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    installAppDependencies()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
