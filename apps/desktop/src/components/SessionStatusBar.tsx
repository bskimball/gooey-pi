import { useEffect, useId, useRef, useState } from 'react'
import { ArrowSquareOut, CaretDown, GitBranch } from './icons'
import type { CheckoutAction, CheckoutCatalog, GitStatus, PrimeContextUsage, RuntimeInfo, SessionUsage } from '@/types/api'
import { contextDialLabel } from '@/lib/format-cost'
import { ChangedFilesList, changeTotals, filesChangedLabel } from './ChangedFiles'
import { CheckoutPicker } from './CheckoutPicker'
import { ExecutingModelChip } from './ExecutingModelChip'

export interface SessionStatusItemsProps {
  /** A run or submit is in flight; checkout switching waits for it. */
  busy?: boolean
  git?: GitStatus
  checkoutCatalog?: CheckoutCatalog
  checkoutLabel?: string
  checkoutsLoading?: boolean
  onExecuteCheckout?(action: CheckoutAction): Promise<void> | void
  contextUsage?: PrimeContextUsage
  sessionUsage?: SessionUsage
  executingModel?: RuntimeInfo['executingModel']
  onOpenChanges?(): void
}

/** The session's place in the title bar: checkout, what the run changed, and how much room it has left. */
export function SessionStatusItems({ busy = false, git, checkoutCatalog, checkoutLabel, checkoutsLoading, onExecuteCheckout, contextUsage, sessionUsage, executingModel, onOpenChanges }: SessionStatusItemsProps) {
  const [changesOpen, setChangesOpen] = useState(false)
  const changesRef = useRef<HTMLDivElement>(null)
  const changesId = useId()
  const files = git?.files ?? []
  const fileCount = files.length
  const { additions, deletions } = changeTotals(files)
  const percent = contextUsage?.percent === null || contextUsage?.percent === undefined ? null : Math.min(100, Math.max(0, Math.round(contextUsage.percent)))
  const contextLabel = contextDialLabel(contextUsage, sessionUsage)
  const interactiveCheckout = Boolean(checkoutCatalog || checkoutsLoading || onExecuteCheckout)

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

  return <>
    {interactiveCheckout || checkoutLabel ? <span className="title-toolbar__separator" aria-hidden="true">/</span> : null}
    {interactiveCheckout
      ? <span className="session-status__checkout no-drag"><CheckoutPicker catalog={checkoutCatalog} fallbackLabel={checkoutLabel} loading={checkoutsLoading} disabled={busy} onExecute={onExecuteCheckout} /></span>
      : checkoutLabel ? <span className="branch-pill"><GitBranch size={12} />{checkoutLabel}</span> : null}
    {fileCount ? <div className="session-status__changes no-drag" ref={changesRef}>
      <button type="button" className="session-status-pill session-status-pill--dirty" title={filesChangedLabel(fileCount)} aria-expanded={changesOpen} aria-controls={changesOpen ? changesId : undefined} onClick={() => setChangesOpen((open) => !open)}>
        <span className="session-status-pill__dot" aria-hidden="true" />
        {fileCount} dirty
        <span className="session-status-pill__diff" aria-hidden="true">·</span>
        <span className="session-status-pill__diff"><span className="is-add">+{additions}</span> <span className="is-remove">−{deletions}</span></span>
        <CaretDown className="session-status-pill__caret" size={11} />
      </button>
      {changesOpen ? <div className="session-changes-popover" id={changesId} role="dialog" aria-label="Changed files">
        <ChangedFilesList files={files} />
        {git?.truncated ? <p className="session-changes-popover__note">Showing the first {fileCount} changes.</p> : null}
        {onOpenChanges ? <button type="button" className="session-changes-popover__review" onClick={() => { setChangesOpen(false); onOpenChanges() }}>
          Review in Changes <ArrowSquareOut size={12} />
        </button> : null}
      </div> : null}
    </div> : null}
    {contextUsage || sessionUsage ? <span
      className={`session-status-pill session-status-pill--context no-drag ${percent === null ? 'is-unavailable' : percent >= 95 ? 'is-critical' : percent >= 80 ? 'is-warning' : ''}`}
      role="meter"
      tabIndex={0}
      aria-label="Session context usage"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={contextLabel}
      title={contextLabel}
    >
      {percent === null ? 'context —' : `context ${percent}%`}
    </span> : null}
    <ExecutingModelChip executingModel={executingModel} />
  </>
}
