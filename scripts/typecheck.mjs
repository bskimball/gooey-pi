import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const vscodeOnly = process.argv.slice(2).includes('--vscode-only')

/** @type {Array<[string, string]>} */
const allTargets = [
  ['node', 'tsconfig.node.json'],
  ['web', 'tsconfig.web.json'],
  ['tests', 'tsconfig.tests.json'],
  ['scripts', 'tsconfig.scripts.json'],
  ['extensions', 'tsconfig.extensions.json'],
  ['browser-agent', 'tsconfig.browser-agent.json'],
  ['vscode', 'packages/vscode/tsconfig.json'],
  ['vscode-webview', 'packages/vscode/webview/tsconfig.json'],
]

const targets = vscodeOnly ? allTargets.filter(([label]) => label === 'vscode' || label === 'vscode-webview') : allTargets

mkdirSync(resolve(root, 'node_modules/.cache/tsc'), { recursive: true })

/** @returns {Promise<string | null>} */
async function resolveTscExe() {
  try {
    const mod = await import(pathToFileURL(resolve(root, 'node_modules/typescript/lib/getExePath.js')).href)
    if (typeof mod.default === 'function') {
      const exe = mod.default()
      if (typeof exe === 'string' && exe.length > 0) return exe
    }
  } catch {
    // Fall back to Node wrapper when native binary lookup is unavailable.
  }
  return null
}

const tscExe = await resolveTscExe()
const tscScript = resolve(root, 'node_modules/typescript/bin/tsc')
/** @type {Set<import('node:child_process').ChildProcess>} */
const activeChildren = new Set()

/** @param {NodeJS.Signals} signal */
function killActive(signal) {
  for (const child of activeChildren) {
    if (!child.killed) child.kill(signal)
  }
}

process.on('SIGINT', () => {
  killActive('SIGINT')
  process.exit(130)
})

process.on('SIGTERM', () => {
  killActive('SIGTERM')
  process.exit(143)
})

/**
 * @param {string} label
 * @param {string} configPath
 * @returns {Promise<{ label: string; code: number; output: string }>}
 */
function runTarget(label, configPath) {
  const cmd = tscExe ?? process.execPath
  const args = tscExe ? ['--noEmit', '-p', resolve(root, configPath)] : [tscScript, '--noEmit', '-p', resolve(root, configPath)]

  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    })
    activeChildren.add(child)

    /** @type {Buffer[]} */
    const chunks = []
    child.stdout?.on('data', (chunk) => chunks.push(chunk))
    child.stderr?.on('data', (chunk) => chunks.push(chunk))

    child.on('error', (err) => {
      activeChildren.delete(child)
      resolvePromise({ label, code: 1, output: err.message })
    })

    child.on('close', (code) => {
      activeChildren.delete(child)
      resolvePromise({
        label,
        code: code ?? 1,
        output: Buffer.concat(chunks).toString('utf8').trimEnd(),
      })
    })
  })
}

const results = await Promise.all(targets.map(([label, configPath]) => runTarget(label, configPath)))

let failed = false
for (const res of results) {
  if (res.code !== 0) {
    failed = true
    process.stderr.write(`[typecheck:${res.label}] failed with exit code ${res.code}\n`)
    if (res.output) process.stderr.write(`${res.output}\n`)
  }
}

if (failed) process.exitCode = 1
