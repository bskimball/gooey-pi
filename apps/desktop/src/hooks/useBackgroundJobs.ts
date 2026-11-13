import { useEffect, useState } from 'react'
import type { ApexApi, BackgroundJob, BackgroundJobEvent } from '@/types/api'
import { useStableCallback } from './useStableCallback'

const OUTPUT_CAP = 256_000

type OutputListener = (chunk: { reset: boolean; data: string }) => void

/** Job output lives outside React state so streaming chunks never re-render the app. */
export class BackgroundJobOutput {
  private readonly buffers = new Map<string, string>()
  private readonly listeners = new Map<string, Set<OutputListener>>()

  read(key: string): string { return this.buffers.get(key) ?? '' }

  reset(key: string, data: string): void {
    this.buffers.set(key, data.slice(-OUTPUT_CAP))
    this.emit(key, { reset: true, data })
  }

  append(key: string, data: string): void {
    this.buffers.set(key, (this.read(key) + data).slice(-OUTPUT_CAP))
    this.emit(key, { reset: false, data })
  }

  delete(key: string): void { this.buffers.delete(key) }

  subscribe(key: string, listener: OutputListener): () => void {
    const set = this.listeners.get(key) ?? new Set<OutputListener>()
    set.add(listener)
    this.listeners.set(key, set)
    return () => {
      set.delete(listener)
      if (!set.size) this.listeners.delete(key)
    }
  }

  private emit(key: string, chunk: { reset: boolean; data: string }): void {
    for (const listener of this.listeners.get(key) ?? []) listener(chunk)
  }
}

const normalizePath = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()

/** Session files arrive from different sources; compare them separator- and case-insensitively. */
export function sameSessionPath(left?: string, right?: string): boolean {
  if (!left || !right) return false
  return left === right || normalizePath(left) === normalizePath(right)
}

/** Like shell terminals, job tabs belong to the project folder they run in. */
export function jobInFolder(job: BackgroundJob, folder?: string): boolean {
  if (!folder) return false
  const root = normalizePath(folder)
  const cwd = normalizePath(job.cwd)
  return cwd === root || cwd.startsWith(`${root}/`)
}

export function useBackgroundJobs(bridge: ApexApi | null, onJobStarted: (job: BackgroundJob) => void) {
  const [output] = useState(() => new BackgroundJobOutput())
  const [jobs, setJobs] = useState<BackgroundJob[]>([])
  const announceStarted = useStableCallback(onJobStarted)

  useEffect(() => {
    if (!bridge) return
    let loaded = false
    const pending: BackgroundJobEvent[] = []
    const upsert = (job: BackgroundJob) => setJobs((current) => {
      const index = current.findIndex((candidate) => candidate.key === job.key)
      if (index < 0) return [...current, job]
      return current.map((candidate, position) => position === index ? job : candidate)
    })
    const apply = (event: BackgroundJobEvent) => {
      if (event.type === 'output') output.append(event.key, event.data)
      else if (event.type === 'updated') upsert(event.job)
      else if (event.type === 'removed') {
        output.delete(event.key)
        setJobs((current) => current.filter((job) => job.key !== event.key))
      } else {
        output.reset(event.job.key, event.output)
        upsert(event.job)
        announceStarted(event.job)
      }
    }
    const off = bridge.backgroundJobs.onEvent((event) => {
      if (loaded) apply(event)
      else pending.push(event)
    })
    void bridge.backgroundJobs.list().then((snapshot) => {
      for (const { output: text, ...job } of snapshot) output.reset(job.key, text)
      setJobs(snapshot.map(({ output: _text, ...job }) => job))
    }).catch(() => undefined).finally(() => {
      loaded = true
      for (const event of pending.splice(0)) apply(event)
    })
    return off
  }, [announceStarted, bridge, output])

  return { jobs, output }
}
