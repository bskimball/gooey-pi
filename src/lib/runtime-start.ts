import type { PrimeWorkApi, RuntimeInfo } from '@/types/api'

type StartOptions = Parameters<PrimeWorkApi['agent']['start']>[0]
const starts = new WeakMap<PrimeWorkApi, Map<string, Promise<RuntimeInfo>>>()

/** Prewarming and Send join the same launch, including an unsaved workspace. */
export function startWorkspaceRuntime(bridge: PrimeWorkApi, options: StartOptions, generation: number): Promise<RuntimeInfo> {
  let pending = starts.get(bridge)
  if (!pending) {
    pending = new Map()
    starts.set(bridge, pending)
  }
  const key = JSON.stringify([options.harness, options.cwd, options.sessionPath ?? generation])
  const existing = pending.get(key)
  if (existing) return existing
  const startedAt = performance.now()
  const promise = bridge.agent.start(options).finally(() => {
    pending.delete(key)
    performance.measure('apex:runtime-start', { start: startedAt })
  })
  pending.set(key, promise)
  return promise
}
