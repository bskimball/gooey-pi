import type { ApexApi, RuntimeInfo } from '@/types/api'

type StartOptions = Parameters<ApexApi['agent']['start']>[0]
const starts = new WeakMap<ApexApi, Map<string, Promise<RuntimeInfo>>>()

/** Prewarming and Send join the same launch, including an unsaved workspace. */
export function startWorkspaceRuntime(bridge: ApexApi, options: StartOptions, generation: number): Promise<RuntimeInfo> {
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
