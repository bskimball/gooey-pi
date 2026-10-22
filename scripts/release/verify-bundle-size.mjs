#!/usr/bin/env node
import { resolve } from 'node:path'
import { statSync } from 'node:fs'
import { assertBundleSizeBudgets, collectBundleSizeMetrics, describeSizeMetrics } from './size-budgets.mjs'

try {
  const metrics = collectBundleSizeMetrics(resolve('out'))
  assertBundleSizeBudgets(metrics)
  const runtime = statSync(resolve('out/browser-agent/runtime.mjs'))
  if (!runtime.isFile() || runtime.size === 0 || runtime.size > 1342000) throw new Error(`Browser agent runtime size outside 1-1342000 byte budget: ${runtime.size}`)
  console.log(`Browser agent runtime: ${runtime.size} bytes`)
  console.log(`Bundle size budgets passed: ${describeSizeMetrics(metrics)}`)
} catch (error) {
  console.error(`Bundle size verification failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
