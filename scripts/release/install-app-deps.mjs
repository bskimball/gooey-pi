#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { runCommand } from './lib.mjs'

export function qualifyWinptyBatchPaths(path = new URL('../../node_modules/node-pty/deps/winpty/src/winpty.gyp', import.meta.url)) {
  const source = readFileSync(path, 'utf8')
  // Explicit paths work when Windows disables implicit current-directory lookup.
  const qualified = source.replace(/&& (GetCommitHash|UpdateGenVersion)\.bat/g, '&& .\\\\$1.bat')
  if (qualified !== source) writeFileSync(path, qualified)
}

/** Backport the submission-wait abort guard, still missing in Durable 1.5.2. */
export function patchPiDurableSubmissionWait(directory = new URL('../../node_modules/@earendil-works/pi-durable/', import.meta.url)) {
  const manifest = new URL('package.json', directory)
  if (!existsSync(manifest) || JSON.parse(readFileSync(manifest, 'utf8')).version !== '1.5.2') return
  const path = new URL('dist/harness/submissions.js', directory)
  const source = readFileSync(path, 'utf8')
  const original = '            return { promise: this.#waiters.add(id, context) };'
  const patched = `            context.abortSignal?.throwIfAborted();\n${original}`
  if (source.includes(patched)) return
  if (source.split(original).length !== 2) throw new Error('Unexpected Pi Durable 1.5.2 submission wait implementation')
  writeFileSync(path, source.replace(original, patched))
}

/** Guard node-pty 1.1.0's Windows console-list helper when AttachConsole races shutdown. */
export function patchNodePtyConsoleListAgent(directory = new URL('../../node_modules/node-pty/', import.meta.url)) {
  const manifest = new URL('package.json', directory)
  if (!existsSync(manifest) || JSON.parse(readFileSync(manifest, 'utf8')).version !== '1.1.0') return
  const path = new URL('lib/conpty_console_list_agent.js', directory)
  if (!existsSync(path)) return
  const source = readFileSync(path, 'utf8')
  const original = 'var consoleProcessList = getConsoleProcessList(shellPid);'
  const patched = [
    'var consoleProcessList = [shellPid];',
    'try {',
    '    consoleProcessList = getConsoleProcessList(shellPid);',
    '}',
    'catch (_e) {',
    '    // Shell or pseudoconsole can already be gone during shutdown.',
    '}',
  ].join('\n')
  if (source.includes(patched)) return
  if (source.split(original).length !== 2) throw new Error('Unexpected node-pty 1.1.0 conpty_console_list_agent implementation')
  writeFileSync(path, source.replace(original, patched))
}

/**
 * @param {(command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => unknown} run
 * @param {NodeJS.ProcessEnv} sourceEnvironment
 * @param {NodeJS.Platform} platform
 */
export function installAppDependencies(run = runCommand, sourceEnvironment = process.env, platform = process.platform) {
  const env = { ...sourceEnvironment }
  if (platform === 'darwin' && !env.PYTHON) env.PYTHON = '/usr/bin/python3'

  patchPiDurableSubmissionWait()
  patchNodePtyConsoleListAgent()
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
