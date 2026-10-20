import * as processes from '../../electron/main/process-utils'
import * as filesystem from 'node:fs/promises'
import { constants } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HarnessDiscoveryService, detectedHarnesses, probeHarnessExecutable, reconcileActiveHarness, type HarnessProbeFailure } from '../../electron/main/harness-discovery'
import { defaultSettings, type DesktopState } from '../../electron/main/store'
import { HARNESSES, type HarnessDescriptor } from '../../electron/main/harness'
import { findHarnessExecutable } from '../../electron/main/process-utils'

vi.mock('../../electron/main/process-utils', async (importOriginal) => ({ ...await importOriginal<typeof import('../../electron/main/process-utils')>() }))
vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs/promises')>() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('HarnessDiscoveryService', () => {
  it('preserves bounded sanitized preparation errors and OS error classifications', async () => {
    vi.spyOn(processes, 'runProcess').mockRejectedValueOnce(new Error('Missing official Pi installation\n' + 'x'.repeat(300)))
    const result = await probeHarnessExecutable('C:\\Tools\\pi.cmd')
    expect(result.failure?.detail).toHaveLength(200)
    expect(result.failure?.detail).toContain('Missing official Pi installation')
    expect(result.failure?.detail).not.toContain('\n')
    for (const [code, detail] of [['ENOENT', 'path does not exist'], ['EACCES', 'permission denied'], ['EPERM', 'permission denied'], ['EINVAL', 'spawn error EINVAL']]) {
      vi.spyOn(processes, 'runProcess').mockRejectedValueOnce(Object.assign(new Error('private detail'), { code }))
      expect((await probeHarnessExecutable('C:\\Tools\\pi.cmd')).failure?.detail).toBe(detail)
    }
  })
  beforeEach(() => {
    vi.stubEnv('PRIME_WORK_E2E_HIDE_WINDOWS', '1')
    vi.stubEnv('PI_BINARY', '')
    vi.stubEnv('PATH', '')
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
  it('reconciles against the settings state inside the serialized transaction', async () => {
    const state = { settings: defaultSettings() } as DesktopState
    state.settings.activeHarness = 'pi'
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    let queue = Promise.resolve()
    const store = {
      update<T>(mutator: (draft: DesktopState) => T): Promise<T> {
        const operation = queue.then(async () => {
          await firstGate
          return mutator(state)
        })
        queue = operation.then(() => undefined, () => undefined)
        return operation
      },
    }
    const userSelection = store.update((draft) => { draft.settings.activeHarness = 'pi' })
    const reconciliation = reconcileActiveHarness(store, {
      pi: { path: null, version: null },
    })
    releaseFirst()

    await userSelection
    await expect(reconciliation).resolves.toMatchObject({ activeHarness: 'pi' })
    expect(state.settings.activeHarness).toBe('pi')

    await expect(reconcileActiveHarness(store, {
      pi: { path: '/bin/pi', version: '1' },
    })).resolves.toMatchObject({ activeHarness: 'pi' })
    expect(state.settings.activeHarness).toBe('pi')
  })

  it('publishes one atomic status snapshot using the current runtime overrides', async () => {
    const runtimePaths = { omp: '/configured/omp', prime: '/configured/prime', pi: '/configured/pi' }
    const findExecutable = vi.fn(async (descriptor: HarnessDescriptor, configured?: string, accept?: (candidate: string) => Promise<boolean>) => {
      const candidate = descriptor.id === 'pi' ? configured ?? null : null
      return candidate && await accept?.(candidate) ? candidate : null
    })
    const probeExecutable = vi.fn(async (path: string) => ({ runnable: true, version: `${path}-version` }))
    const discovery = new HarnessDiscoveryService(() => runtimePaths, { findExecutable, probeExecutable })

    const statuses = await discovery.refresh()

    expect(statuses).toEqual({
      pi: { path: '/configured/pi', version: '/configured/pi-version' },
    })
    expect(discovery.executable('pi')).toBe('/configured/pi')
    expect(detectedHarnesses(statuses)).toEqual(['pi'])
    expect(findExecutable).toHaveBeenCalledOnce()
    expect(findExecutable).toHaveBeenCalledWith(expect.objectContaining({ id: 'pi' }), '/configured/pi', expect.any(Function), expect.any(Function))
  })

  it('excludes existing but non-runnable candidates and continues discovery', async () => {
    const discovery = new HarnessDiscoveryService(
      () => ({ omp: '', prime: '', pi: '/broken/pi' }),
      {
        findExecutable: async (descriptor, _configured, accept) => {
          if (descriptor.id !== 'pi' || !accept) return null
          for (const candidate of ['/broken/pi', '/working/pi']) if (await accept(candidate)) return candidate
          return null
        },
        probeExecutable: async (path) => path.includes('working')
          ? { runnable: true, version: '2.0.0' }
          : { runnable: false, version: null },
      },
    )

    await expect(discovery.refresh()).resolves.toMatchObject({
      pi: { path: '/working/pi', version: '2.0.0' },
    })
  })

  it('prevents an older overlapping refresh from replacing newer results', async () => {
    const firstPi = deferred<string | null>()
    let generation = 0
    const discovery = new HarnessDiscoveryService(
      () => ({ omp: '', prime: '', pi: '' }),
      {
        findExecutable: async (descriptor, _configured, accept) => {
          if (descriptor.id !== 'pi') return null
          generation += 1
          const candidate = generation === 1 ? await firstPi.promise : '/new/pi'
          return candidate && await accept?.(candidate) ? candidate : null
        },
        probeExecutable: async () => ({ runnable: true, version: null }),
      },
    )

    const stale = discovery.refresh()
    const current = await discovery.refresh()
    firstPi.resolve('/old/pi')

    expect(current.pi.path).toBe('/new/pi')
    await expect(stale).resolves.toMatchObject({ pi: { path: '/new/pi' } })
    expect(discovery.executable('pi')).toBe('/new/pi')
  })

  it.each([
    ['exit', { kind: 'exit', code: 1, detail: 'Node.js is too old' }],
    ['spawn', { kind: 'spawn', detail: 'path does not exist' }],
    ['timeout', { kind: 'timeout', detail: 'after 10 seconds' }],
    ['overflow', { kind: 'overflow', detail: 'output exceeded the probe limit' }],
  ] as const)('reports a %s probe failure', async (_label, failure) => {
    const probeFailure = failure as HarnessProbeFailure
    const discovery = new HarnessDiscoveryService(
      () => ({ omp: '', prime: '', pi: '' }),
      {
        findExecutable: async (descriptor, _configured, accept, onFailure) => {
          if (descriptor.id !== 'pi' || !accept) return null
          await accept('/broken/pi')
          onFailure?.({ path: '/broken/pi', reason: 'probe failed', kind: 'rejected' })
          return null
        },
        probeExecutable: async () => ({ runnable: false, version: null, failure: probeFailure }),
      },
    )

    await expect(discovery.refresh()).resolves.toMatchObject({
      pi: { path: null, version: null, problem: { path: '/broken/pi', reason: expect.stringContaining(failure.kind === 'exit' ? 'exited with code 1' : failure.kind === 'spawn' ? 'could not start' : failure.kind === 'timeout' ? 'timed out' : 'output exceeded') } },
    })
  })

  it('reports missing and non-executable configured candidates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gooeypi-discovery-'))
    const missing = join(dir, 'missing-pi')
    const nonExecutable = join(dir, 'pi')
    writeFileSync(nonExecutable, '#!/bin/sh\nexit 0\n')
    chmodSync(nonExecutable, 0o644)
    const originalAccess = filesystem.access
    vi.spyOn(filesystem, 'access').mockImplementation(async (path, mode) => {
      if (path === nonExecutable && mode === constants.X_OK) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      return originalAccess(path, mode)
    })
    try {
      const missingFailures: Array<{ path: string; reason: string }> = []
      await findHarnessExecutable(HARNESSES.pi, missing, async () => false, (failure) => missingFailures.push(failure))
      expect(missingFailures.find((failure) => failure.path === missing)).toEqual({ path: missing, reason: 'path does not exist', kind: 'missing' })

      const nonExecutableFailures: Array<{ path: string; reason: string }> = []
      await findHarnessExecutable(HARNESSES.pi, nonExecutable, async () => false, (failure) => nonExecutableFailures.push(failure))
      expect(nonExecutableFailures.find((failure) => failure.path === nonExecutable)).toEqual({ path: nonExecutable, reason: 'not executable', kind: 'rejected' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not report an absent automatic candidate', async () => {
    const discovery = new HarnessDiscoveryService(
      () => ({ omp: '', prime: '', pi: '' }),
      {
        findExecutable: async (descriptor, _configured, _accept, onFailure) => {
          if (descriptor.id === 'pi') onFailure?.({ path: '/automatic/pi', reason: 'path does not exist', kind: 'missing' })
          return null
        },
      },
    )

    const statuses = await discovery.refresh()
    expect(statuses).toMatchObject({
      pi: { path: null, version: null },
    })
    expect(statuses.pi.problem).toBeUndefined()
  })

  it('reports an automatic candidate that exists but is rejected', async () => {
    const discovery = new HarnessDiscoveryService(
      () => ({ omp: '', prime: '', pi: '' }),
      {
        findExecutable: async (descriptor, _configured, _accept, onFailure) => {
          if (descriptor.id === 'pi') onFailure?.({ path: '/automatic/pi', reason: 'probe failed', kind: 'rejected' })
          return null
        },
      },
    )

    await expect(discovery.refresh()).resolves.toMatchObject({
      pi: { path: null, version: null, problem: { path: '/automatic/pi', reason: 'probe failed' } },
    })
  })

  it('reports an absent configured override', async () => {
    const discovery = new HarnessDiscoveryService(
      () => ({ omp: '', prime: '', pi: '/configured/pi' }),
      {
        findExecutable: async (descriptor, _configured, _accept, onFailure) => {
          if (descriptor.id === 'pi') onFailure?.({ path: '/configured/pi', reason: 'path does not exist', kind: 'missing' })
          return null
        },
      },
    )

    await expect(discovery.refresh()).resolves.toMatchObject({
      pi: { path: null, version: null, problem: { path: '/configured/pi', reason: 'path does not exist' } },
    })
  })

  it('keeps the meaningful last stderr line in a probe failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gooeypi-probe-'))
    const executable = process.execPath
    const script = join(dir, 'probe.cjs')
    writeFileSync(script, 'process.stderr.write("warning noise\\n(node:123) ExperimentalWarning: noisy\\nTypeError: webidl.util.markAsUncloneable is not a function\\n"); process.exit(1)')
    const originalRunProcess = processes.runProcess
    vi.spyOn(processes, 'runProcess').mockImplementation((file, _args, options) => originalRunProcess(file, [script], options))
    try {
      await expect(probeHarnessExecutable(executable)).resolves.toMatchObject({
        runnable: false,
        failure: { kind: 'exit', detail: 'TypeError: webidl.util.markAsUncloneable is not a function' },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
