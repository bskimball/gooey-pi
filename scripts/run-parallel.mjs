import { resolveConfig } from 'electron-vite'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { build as viteBuild } from 'vite'

const root = resolve(import.meta.dirname, '..')
const cliArgs = process.argv.slice(2)
const electronTarget = cliArgs.find((arg) => arg.startsWith('--electron-target='))?.split('=')[1]

if (electronTarget) {
  process.env.NODE_ENV_ELECTRON_VITE = 'production'
  const resolved = await resolveConfig({}, 'build', 'production')
  const targets = electronTarget === 'renderer' ? /** @type {const} */ (['renderer']) : /** @type {const} */ (['main', 'preload'])
  for (const target of targets) {
    const viteConfig = resolved.config?.[target]
    if (viteConfig) {
      if (viteConfig.build?.watch) viteConfig.build.watch = null
      await viteBuild(viteConfig)
    }
  }
  process.exit(0)
}

const bundleOnly = cliArgs.includes('--bundle-only')
const selfScript = resolve(root, 'scripts/run-parallel.mjs')

/** @type {Array<{ label: string; args: string[] }>} */
const tasks = [
  ...(bundleOnly ? [] : [{ label: 'typecheck', args: [resolve(root, 'scripts/typecheck.mjs')] }]),
  { label: 'electron-main-preload', args: [selfScript, '--electron-target=node'] },
  { label: 'electron-renderer', args: [selfScript, '--electron-target=renderer'] },
  { label: 'browser-agent', args: [resolve(root, 'scripts/build-browser-agent.mjs')] },
]

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
 * @param {{ label: string; args: string[] }} task
 * @returns {Promise<{ label: string; code: number; stdout: string; stderr: string }>}
 */
function runTask(task) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, task.args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    })
    activeChildren.add(child)

    /** @type {Buffer[]} */
    const outChunks = []
    /** @type {Buffer[]} */
    const errChunks = []
    child.stdout?.on('data', (chunk) => outChunks.push(chunk))
    child.stderr?.on('data', (chunk) => errChunks.push(chunk))

    child.on('error', (err) => {
      activeChildren.delete(child)
      killActive('SIGTERM')
      resolvePromise({ label: task.label, code: 1, stdout: Buffer.concat(outChunks).toString('utf8'), stderr: err.message })
    })

    child.on('close', (code) => {
      activeChildren.delete(child)
      const exitCode = code ?? 1
      if (exitCode !== 0) killActive('SIGTERM')
      resolvePromise({
        label: task.label,
        code: exitCode,
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
      })
    })
  })
}

const results = await Promise.all(tasks.map(runTask))

let failed = false
for (const res of results) {
  if (res.stdout) process.stdout.write(res.stdout)
  if (res.stderr) process.stderr.write(res.stderr)
  if (res.code !== 0) {
    failed = true
    process.stderr.write(`[${res.label}] failed with exit code ${res.code}\n`)
  }
}

if (failed) process.exitCode = 1
