import { useMachine } from '@xstate/react'
import { CaretDown, Check, FolderSimpleStar } from './icons'
import { ApexButton } from './ui'
import { useEffect, useId, useRef } from 'react'
import type { CheckoutAction, CheckoutCatalog } from '@/types/api'
import { checkoutPickerMachine } from './checkoutPickerMachine'

interface CheckoutPickerProps {
  catalog?: CheckoutCatalog
  fallbackLabel?: string
  loading?: boolean
  disabled?: boolean
  onExecute?(action: CheckoutAction): Promise<void> | void
}

function checkoutLabel(catalog: CheckoutCatalog | undefined, fallback: string | undefined): string {
  if (!catalog) return fallback ?? 'Checkout'
  if (catalog.strategy === 'branch') return catalog.activeName || fallback || 'Checkout'
  const active = catalog.checkouts.find((worktree) => worktree.path === catalog.activePath)
    ?? catalog.checkouts.find((worktree) => worktree.current)
  return active?.branch ?? active?.name ?? fallback ?? 'Checkout'
}

export function CheckoutPicker({ catalog, fallbackLabel, loading = false, disabled = false, onExecute }: CheckoutPickerProps) {
  const [snapshot, send, actor] = useMachine(checkoutPickerMachine)
  const open = snapshot.matches('open')
  const busy = snapshot.matches({ open: 'busy' })
  const creating = busy && snapshot.context.busyKind === 'create'
  const branch = snapshot.context.branch
  const error = snapshot.matches({ open: 'error' }) ? snapshot.context.error : ''
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const strategy = catalog?.strategy ?? 'worktree'

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) send({ type: 'CLOSE' })
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') send({ type: 'CLOSE' })
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open, send])

  const runAction = async (action: CheckoutAction, eventType: 'SWITCH' | 'CREATE'): Promise<void> => {
    if (!onExecute || actor.getSnapshot().matches({ open: 'busy' })) return
    send({ type: eventType })
    try {
      await onExecute(action)
      send({ type: 'SUCCEED' })
    } catch (cause) {
      send({ type: 'FAIL', message: cause instanceof Error ? cause.message : 'Could not change checkout' })
    }
  }

  const create = (): void => {
    const name = snapshot.context.branch.trim()
    if (!name || !onExecute || actor.getSnapshot().matches({ open: 'busy' })) return
    void runAction({ strategy, operation: 'create', branch: name }, 'CREATE')
  }

  const enabled = Boolean(!disabled && onExecute && catalog && (catalog.checkouts.length > 0 || strategy === 'branch'))
  const label = checkoutLabel(catalog, fallbackLabel)
  return (
    <div className="worktree-picker" ref={rootRef}>
      <button
        type="button"
        className="permissions-chip worktree-picker__trigger"
        aria-label={`Checkout: ${label}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={!enabled}
        onClick={() => send({ type: 'TOGGLE' })}
      >
        <FolderSimpleStar size={12} />
        <span className="worktree-picker__label">{label}</span>
        <CaretDown className="worktree-picker__chevron" size={11} />
      </button>
      {open && catalog ? (
        <div className="worktree-picker__menu" id={menuId} role="menu" aria-label={strategy === 'worktree' ? 'Git worktrees' : 'Git branches'}>
          <div className="worktree-picker__heading">Checkouts</div>
          <div className="worktree-picker__options">
            {loading ? <span className="worktree-picker__empty">Loading…</span> : catalog.checkouts.length === 0 ? <span className="worktree-picker__empty">No checkouts found</span> : catalog.strategy === 'worktree'
              ? catalog.checkouts.map((worktree) => {
                  const selected = worktree.path === catalog.activePath
                  return (
                    <button type="button" role="menuitemradio" aria-checked={selected} className={`worktree-picker__option ${selected ? 'is-active' : ''}`} key={worktree.path} onClick={() => { if (selected) send({ type: 'CLOSE' }); else void runAction({ strategy: 'worktree', operation: 'open', path: worktree.path }, 'SWITCH') }}>
                      <span className="worktree-picker__check">{selected ? <Check size={13} /> : null}</span>
                      <span className="worktree-picker__option-copy"><strong>{worktree.branch ?? worktree.name}</strong><span title={worktree.path}>{worktree.path}</span></span>
                    </button>
                  )
                })
              : catalog.checkouts.map((localBranch) => (
                  <button type="button" role="menuitemradio" aria-checked={localBranch.current} className={`worktree-picker__option ${localBranch.current ? 'is-active' : ''}`} key={localBranch.name} onClick={() => { if (localBranch.current) send({ type: 'CLOSE' }); else void runAction({ strategy: 'branch', operation: 'switch', branch: localBranch.name }, 'SWITCH') }}>
                    <span className="worktree-picker__check">{localBranch.current ? <Check size={13} /> : null}</span>
                    <span className="worktree-picker__option-copy"><strong>{localBranch.name}</strong><span>{localBranch.current ? 'Current branch' : 'Local branch'}</span></span>
                  </button>
                ))}
          </div>
          <form className="worktree-picker__create" onSubmit={(event) => { event.preventDefault(); create() }}>
            <label htmlFor={`${menuId}-branch`}>Create {strategy}</label>
            <div>
              <input id={`${menuId}-branch`} value={branch} placeholder="New branch name" onChange={(event) => send({ type: 'SET_BRANCH', branch: event.target.value })} />
              <ApexButton type="submit" variant="primary" compact disabled={!branch.trim() || busy}>{creating ? 'Creating…' : 'Create'}</ApexButton>
            </div>
            {error ? <span role="alert">{error}</span> : null}
          </form>
        </div>
      ) : null}
    </div>
  )
}
