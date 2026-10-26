import { useEffect, useId, useRef, useState } from 'react'
import { ArrowSquareOut, CaretDown, Command } from './icons'
import type { CheckoutAction, CheckoutCatalog, GitStatus, HarnessId, PrimeContextUsage, RuntimeInfo, SessionUsage } from '@/types/api'
import { contextDialLabel } from '@/lib/format-cost'
import { isPiBehaviorMode, PI_BEHAVIOR_MODE_EVENT, PI_BEHAVIOR_MODE_OPTIONS, type PiBehaviorMode, readSavedPiBehaviorMode } from '@/lib/harness'
import { ChangedFilesList, changeTotals, filesChangedLabel } from './ChangedFiles'
import { CheckoutPicker } from './CheckoutPicker'
import { ExecutingModelChip } from './ExecutingModelChip'

interface SessionStatusBarProps {
  harness?: HarnessId
  /** A run or submit is in flight; checkout switching waits for it. */
  busy?: boolean
  git: GitStatus
  checkoutCatalog?: CheckoutCatalog
  checkoutLabel?: string
  checkoutsLoading?: boolean
  onExecuteCheckout?(action: CheckoutAction): Promise<void> | void
  contextUsage?: PrimeContextUsage
  sessionUsage?: SessionUsage
  executingModel?: RuntimeInfo['executingModel']
  onOpenChanges(): void
}

function usePiMode(enabled: boolean): PiBehaviorMode | undefined {
  const [mode, setMode] = useState<PiBehaviorMode>(readSavedPiBehaviorMode)
  useEffect(() => {
    const onModeChange = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (isPiBehaviorMode(detail)) setMode(detail)
    }
    window.addEventListener(PI_BEHAVIOR_MODE_EVENT, onModeChange)
    return () => window.removeEventListener(PI_BEHAVIOR_MODE_EVENT, onModeChange)
  }, [])
  return enabled ? mode : undefined
}

/** One quiet row above the transcript: where the run is working, what it changed, and how much room it has left. */
export function SessionStatusBar({ harness = 'pi', busy = false, git, checkoutCatalog, checkoutLabel, checkoutsLoading, onExecuteCheckout, contextUsage, sessionUsage, executingModel, onOpenChanges }: SessionStatusBarProps) {
  const [changesOpen, setChangesOpen] = useState(false)
  const changesRef = useRef<HTMLDivElement>(null)
  const changesId = useId()
  const mode = usePiMode(harness === 'pi')
  const modeLabel = mode && mode !== 'pi' ? PI_BEHAVIOR_MODE_OPTIONS.find((option) => option.value === mode)?.label : undefined
  const fileCount = git.files.length
  const { additions, deletions } = changeTotals(git.files)
  const percent = contextUsage?.percent === null || contextUsage?.percent === undefined ? null : Math.min(100, Math.max(0, Math.round(contextUsage.percent)))
  const contextLabel = contextDialLabel(contextUsage, sessionUsage)

  useEffect(() => { if (!fileCount) setChangesOpen(false) }, [fileCount])
  useEffect(() => {
    if (!changesOpen) return
    const close = (event: MouseEvent) => { if (!(event.target instanceof Node) || !changesRef.current?.contains(event.target)) setChangesOpen(false) }
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setChangesOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onEscape)
    }
  }, [changesOpen])

  return <header className="session-status-bar" aria-label="Session status">
    <div className="session-status-bar__group">
      <CheckoutPicker catalog={checkoutCatalog} fallbackLabel={checkoutLabel} loading={checkoutsLoading} disabled={busy} onExecute={onExecuteCheckout} />
      {fileCount ? <div className="session-status-bar__changes" ref={changesRef}>
        <button type="button" className="session-status-pill session-status-pill--dirty" aria-expanded={changesOpen} aria-controls={changesOpen ? changesId : undefined} onClick={() => setChangesOpen((open) => !open)}>
          <span className="session-status-pill__dot" aria-hidden="true" />
          {filesChangedLabel(fileCount)}
          <span className="session-status-pill__diff"><span className="is-add">+{additions}</span> <span className="is-remove">−{deletions}</span></span>
          <CaretDown className="session-status-pill__caret" size={11} />
        </button>
        {changesOpen ? <div className="session-changes-popover" id={changesId} role="dialog" aria-label="Changed files">
          <ChangedFilesList files={git.files} />
          {git.truncated ? <p className="session-changes-popover__note">Showing the first {fileCount} changes.</p> : null}
          <button type="button" className="session-changes-popover__review" onClick={() => { setChangesOpen(false); onOpenChanges() }}>
            Review in Changes <ArrowSquareOut size={12} />
          </button>
        </div> : null}
      </div> : null}
    </div>
    <div className="session-status-bar__group session-status-bar__group--end">
      {modeLabel ? <span className={`session-status-pill session-status-pill--mode ${mode === 'apex-orchestrate' ? 'is-orchestrate' : ''}`} title={`Pi mode: ${modeLabel}`}>
        <Command size={11} /> {mode === 'apex-orchestrate' ? '/orchestrate' : modeLabel}
      </span> : null}
      <ExecutingModelChip executingModel={executingModel} />
      <span
        className={`session-status-pill session-status-pill--context ${percent === null ? 'is-unavailable' : percent >= 95 ? 'is-critical' : percent >= 80 ? 'is-warning' : ''}`}
        role="meter"
        aria-label="Session context usage"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={contextLabel}
        title={contextLabel}
      >
        <span className="session-status-pill__meter" aria-hidden="true"><span style={{ width: `${percent ?? 0}%` }} /></span>
        {percent === null ? 'Context —' : `Context ${percent}%`}
      </span>
    </div>
  </header>
}
