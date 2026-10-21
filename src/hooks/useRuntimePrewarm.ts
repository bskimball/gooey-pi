import { useEffect, useRef } from 'react'
import { startWorkspaceRuntime } from '@/lib/runtime-start'
import { findRuntimeForWorkspace } from '@/lib/workspace'
import type { WorkspaceSnapshot } from '@/app/workspace'
import type { HarnessId, PrimeThinkingLevel, PrimeWorkApi, RuntimeInfo, SessionRecord } from '@/types/api'

interface PrewarmOptions {
  bridge: PrimeWorkApi | null
  ready: boolean
  harness: HarnessId
  generation: number
  workspaceRef: React.RefObject<WorkspaceSnapshot>
  runtimeId: string | undefined
  sessionStatus: SessionRecord['status'] | undefined
  sessionFile: string | undefined
  model: string
  thinking: PrimeThinkingLevel
  fast: boolean
  attachRuntime(runtime: RuntimeInfo, generation: number): void
}

export function useRuntimePrewarm({ bridge, ready, harness, generation, workspaceRef, runtimeId, sessionStatus, sessionFile, model, thinking, fast, attachRuntime }: PrewarmOptions): void {
  const attempted = useRef<string | undefined>(undefined)
  useEffect(() => {
    const selected = workspaceRef.current
    const key = JSON.stringify([generation, sessionFile])
    const stillSelected = () => workspaceRef.current.generation === generation
      && workspaceRef.current.cwd === selected.cwd && workspaceRef.current.sessionFile === selected.sessionFile
    if (!bridge || !ready || !model || runtimeId || !selected.cwd || !selected.project || selected.project.inferred
      || selected.generation !== generation || selected.sessionFile !== sessionFile || sessionStatus === 'running' || attempted.current === key) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      attempted.current = key
      void (async () => {
        const runtimes = (await bridge.agent.list()).filter((runtime) => runtime.harness === harness)
        if (cancelled || !stillSelected()) return
        const runtime = findRuntimeForWorkspace(runtimes, selected.cwd, selected.sessionFile)
          ?? await startWorkspaceRuntime(bridge, { cwd: selected.cwd!, sessionPath: selected.sessionFile, model, thinking, fast, harness }, generation)
        if (stillSelected() && runtime.cwd === selected.cwd
          && (!selected.sessionFile || runtime.sessionFile === selected.sessionFile)) attachRuntime(runtime, generation)
      })().catch(() => {
        // Send remains the authoritative error path and can retry a failed warmup.
      })
    }, 300)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [attachRuntime, bridge, fast, generation, harness, model, ready, runtimeId, sessionFile, sessionStatus, thinking, workspaceRef])
}
