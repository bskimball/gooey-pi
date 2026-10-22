#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const lockfile = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
const obsolete = /(?:prime-agent|@earendil-works\/pi-(?:agent-core|ai|tui))/
// Pi SDK packages may be dev-only inputs bundled into the browser-agent runtime, which runs inside Pi; they must never ship with the app.
const shipped = [
  ...Object.keys({ ...manifest.dependencies, ...manifest.overrides }),
  ...Object.entries(lockfile.packages)
    .filter(([, entry]) => entry.dev !== true)
    .map(([name]) => name),
]
for (const name of shipped) {
  if (obsolete.test(name)) throw new Error(`Removed Prime SDK dependency ships with the app: ${name}`)
}
for (const name of readdirSync(resolve(root, 'vendor'))) {
  if (name.startsWith('prime-agent')) throw new Error(`Removed Prime SDK artifact remains: ${name}`)
}
console.log('Pi-only dependency boundary verified; no vendored SDK patches remain.')
