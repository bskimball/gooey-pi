import { LayerDepthProvider, layerAnimations, useLayer, useLayerDismissal } from '@astryxdesign/core/Layer'
import { TextInput } from '@astryxdesign/core/TextInput'
import * as stylex from '@stylexjs/stylex'
import { useMachine } from '@xstate/react'
import { CaretDown, Check, FolderSimpleStar } from './icons'
import { ApexButton } from './ui'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CheckoutAction, CheckoutCatalog } from '@/types/api'
import { checkoutPickerMachine } from './checkoutPickerMachine'

interface CheckoutPickerProps {
  catalog?: CheckoutCatalog
  fallbackLabel?: string
  loading?: boolean
  disabled?: boolean
  onExecute?(action: CheckoutAction): Promise<void> | void
}

const styles = stylex.create({
  root: {
    position: 'relative',
    width: '100%',
    minWidth: 0,
  },
  trigger: {
    width: '100%',
    maxWidth: 'none',
    minWidth: 0,
    height: 32,
    minHeight: 32,
    justifyContent: 'space-between',
    gap: 8,
    paddingBlock: 0,
    paddingInline: 9,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: {
      default: 'var(--text-secondary)',
      ':hover:not(:disabled)': 'var(--text)',
    },
    backgroundColor: {
      default: 'var(--surface-subtle)',
      ':hover:not(:disabled)': 'var(--surface-hover)',
    },
    boxShadow: 'none',
    fontSize: 'var(--fs-ui)',
    fontWeight: 550,
  },
  triggerOpen: {
    color: 'var(--text)',
    backgroundColor: 'var(--surface-hover)',
  },
  triggerLead: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  triggerText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  triggerIcon: {
    flexShrink: 0,
  },
  menu: {
    boxSizing: 'border-box',
    width: 'min(360px, calc(100vw - 32px))',
    maxHeight: 'min(380px, calc(100dvh - 36px))',
    display: 'flex',
    flexDirection: 'column',
    padding: 6,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border-strong)',
    borderRadius: 'var(--radius-lg)',
    color: 'var(--text)',
    backgroundColor: 'var(--surface-raised)',
    boxShadow: 'var(--shadow-popover)',
    overflow: 'hidden',
  },
  heading: {
    flexShrink: 0,
    paddingTop: 5,
    paddingRight: 7,
    paddingBottom: 6,
    paddingLeft: 7,
    color: 'var(--text-tertiary)',
    fontSize: 'var(--fs-micro)',
    fontWeight: 600,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
  },
  options: {
    flex: '1 1 auto',
    minHeight: 0,
    maxHeight: 210,
    overflowY: 'auto',
  },
  option: {
    width: '100%',
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    paddingBlock: 6,
    paddingInline: 7,
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    backgroundColor: {
      default: 'transparent',
      ':hover': 'var(--surface-hover)',
    },
    textAlign: 'left',
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  optionActive: {
    backgroundColor: 'var(--surface-hover)',
  },
  check: {
    width: 14,
    flexShrink: 0,
    display: 'inline-grid',
    placeItems: 'center',
    color: 'var(--accent)',
  },
  optionCopy: {
    minWidth: 0,
    display: 'grid',
    gap: 2,
  },
  optionTitle: {
    overflow: 'hidden',
    color: 'var(--text)',
    fontSize: 'var(--fs-ui)',
    fontWeight: 550,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  optionMeta: {
    overflow: 'hidden',
    color: 'var(--text-tertiary)',
    fontFamily: '"SFMono-Regular", Menlo, monospace',
    fontSize: 'var(--fs-micro)',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  empty: {
    display: 'block',
    padding: 8,
    color: 'var(--text-tertiary)',
    fontSize: 'var(--fs-meta)',
  },
  createForm: {
    flexShrink: 0,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 6,
    marginTop: 5,
    paddingTop: 8,
    paddingRight: 7,
    paddingBottom: 3,
    paddingLeft: 7,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: 'var(--border)',
  },
  createLabel: {
    color: 'var(--text-secondary)',
    fontSize: 'var(--fs-meta)',
    fontWeight: 600,
  },
  createRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
  },
  createField: {
    flex: '1 1 auto',
    minWidth: 0,
  },
  createControl: {
    height: 29,
    minHeight: 29,
    paddingInline: 8,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--surface-subtle)',
    boxShadow: 'none',
  },
  createSubmit: {
    minHeight: 29,
    height: 29,
    flexShrink: 0,
    paddingInline: 10,
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--fs-meta)',
    fontWeight: 600,
  },
  createError: {
    color: 'var(--danger)',
    fontSize: 'var(--fs-micro)',
  },
})

function checkoutLabel(catalog: CheckoutCatalog | undefined, fallback: string | undefined): string {
  if (!catalog) return fallback ?? 'Checkout'
  if (catalog.strategy === 'branch') return catalog.activeName || fallback || 'Checkout'
  const active = catalog.checkouts.find((worktree) => worktree.path === catalog.activePath)
    ?? catalog.checkouts.find((worktree) => worktree.current)
  return active?.branch ?? active?.name ?? fallback ?? 'Checkout'
}

export function useCheckoutPickerController() {
  return useMachine(checkoutPickerMachine)
}

export function CheckoutPicker(props: CheckoutPickerProps) {
  const controller = useCheckoutPickerController()
  return <CheckoutPickerFields {...props} controller={controller} />
}

export function CheckoutPickerFields({ catalog, fallbackLabel, loading = false, disabled = false, onExecute, controller }: CheckoutPickerProps & { controller: ReturnType<typeof useCheckoutPickerController> }) {
  const [snapshot, send, actor] = controller
  const [menuVisible, setMenuVisible] = useState(true)
  const busy = snapshot.matches({ open: 'busy' })
  const open = snapshot.matches('open') && menuVisible && Boolean(catalog)
  const creating = busy && snapshot.context.busyKind === 'create'
  const branch = snapshot.context.branch
  const error = snapshot.matches({ open: 'error' }) ? snapshot.context.error : ''
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const strategy = catalog?.strategy ?? 'worktree'

  const dismissMenu = useCallback((restoreFocus = false) => {
    if (actor.getSnapshot().matches({ open: 'busy' })) setMenuVisible(false)
    else if (actor.getSnapshot().matches('open')) send({ type: 'CLOSE' })
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }, [actor, send])

  const layer = useLayer({
    mode: 'context',
    lightDismiss: true,
    lazyMount: true,
    onHide: () => dismissMenu(false),
  })

  const attachTriggerRef = useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node
    layer.ref(node)
  }, [layer])

  useLayoutEffect(() => {
    if (open) {
      if (!layer.isOpen) layer.show()
    } else if (layer.isOpen) {
      layer.hide()
    }
  }, [layer, open])

  useLayerDismissal({
    isActive: open,
    onDismiss: () => {
      const focusedInside = Boolean(
        rootRef.current?.contains(document.activeElement) ||
        menuRef.current?.contains(document.activeElement),
      )
      dismissMenu(focusedInside)
    },
    getContainer: () => menuRef.current ?? rootRef.current,
  })

  useEffect(() => {
    if (!open || (typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function')) return
    const closeOutside = (event: MouseEvent) => {
      if (
        !(event.target instanceof Node) ||
        (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target))
      ) {
        dismissMenu(false)
      }
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [dismissMenu, open])

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
  const rootStylex = stylex.props(styles.root)
  const triggerTextStylex = stylex.props(styles.triggerText)
  const menuStylex = stylex.props(styles.menu, layerAnimations.below)

  return (
    <div
      className={`worktree-picker ${rootStylex.className ?? ''}`.trim()}
      style={rootStylex.style}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        event.stopPropagation()
        dismissMenu(true)
      }}
    >
      <ApexButton
        compact
        endIcon={<CaretDown className="worktree-picker__chevron" size={11} aria-hidden="true" />}
        label={`Checkout: ${label}`}
        type="button"
        ref={attachTriggerRef}
        className="worktree-picker__trigger"
        xstyle={[styles.trigger, open && styles.triggerOpen]}
        aria-label={`Checkout: ${label}`}
        title={`Checkout: ${label}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={!enabled}
        onClick={() => {
          if (busy) setMenuVisible((visible) => !visible)
          else {
            setMenuVisible(true)
            send({ type: 'TOGGLE' })
          }
        }}
      >
        <span {...stylex.props(styles.triggerLead)}>
          <FolderSimpleStar size={12} {...stylex.props(styles.triggerIcon)} aria-hidden="true" />
          <span
            className={`worktree-picker__label ${triggerTextStylex.className ?? ''}`.trim()}
            style={triggerTextStylex.style}
          >
            {label}
          </span>
        </span>
      </ApexButton>
      {layer.render(
        open && catalog ? (
          <LayerDepthProvider>
            <div
              ref={menuRef}
              className={`worktree-picker__menu ${menuStylex.className ?? ''}`.trim()}
              style={menuStylex.style}
              id={menuId}
              role="menu"
              aria-label={strategy === 'worktree' ? 'Git worktrees' : 'Git branches'}
            >
              <div {...stylex.props(styles.heading)}>Checkouts</div>
              <div {...stylex.props(styles.options)}>
                {loading ? (
                  <span {...stylex.props(styles.empty)}>Loading…</span>
                ) : catalog.checkouts.length === 0 ? (
                  <span {...stylex.props(styles.empty)}>No checkouts found</span>
                ) : catalog.strategy === 'worktree' ? (
                  catalog.checkouts.map((worktree) => {
                    const selected = worktree.path === catalog.activePath
                    const optionStylex = stylex.props(styles.option, selected && styles.optionActive)
                    return (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={`worktree-picker__option ${selected ? 'is-active' : ''} ${optionStylex.className ?? ''}`.trim()}
                        style={optionStylex.style}
                        key={worktree.path}
                        onClick={() => {
                          if (selected) send({ type: 'CLOSE' })
                          else void runAction({ strategy: 'worktree', operation: 'open', path: worktree.path }, 'SWITCH')
                        }}
                      >
                        <span {...stylex.props(styles.check)}>{selected ? <Check size={13} /> : null}</span>
                        <span {...stylex.props(styles.optionCopy)}>
                          <strong {...stylex.props(styles.optionTitle)}>{worktree.branch ?? worktree.name}</strong>
                          <span {...stylex.props(styles.optionMeta)} title={worktree.path}>{worktree.path}</span>
                        </span>
                      </button>
                    )
                  })
                ) : (
                  catalog.checkouts.map((localBranch) => {
                    const optionStylex = stylex.props(styles.option, localBranch.current && styles.optionActive)
                    return (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={localBranch.current}
                        className={`worktree-picker__option ${localBranch.current ? 'is-active' : ''} ${optionStylex.className ?? ''}`.trim()}
                        style={optionStylex.style}
                        key={localBranch.name}
                        onClick={() => {
                          if (localBranch.current) send({ type: 'CLOSE' })
                          else void runAction({ strategy: 'branch', operation: 'switch', branch: localBranch.name }, 'SWITCH')
                        }}
                      >
                        <span {...stylex.props(styles.check)}>{localBranch.current ? <Check size={13} /> : null}</span>
                        <span {...stylex.props(styles.optionCopy)}>
                          <strong {...stylex.props(styles.optionTitle)}>{localBranch.name}</strong>
                          <span {...stylex.props(styles.optionMeta)}>
                            {localBranch.current ? 'Current branch' : 'Local branch'}
                          </span>
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
              <form
                {...stylex.props(styles.createForm)}
                onSubmit={(event) => {
                  event.preventDefault()
                  create()
                }}
              >
                <label htmlFor={`${menuId}-branch`} {...stylex.props(styles.createLabel)}>
                  Create {strategy}
                </label>
                <div {...stylex.props(styles.createRow)}>
                  <TextInput
                    id={`${menuId}-branch`}
                    size="sm"
                    label={`Create ${strategy}`}
                    isLabelHidden
                    value={branch}
                    placeholder="New branch name"
                    onChange={(nextValue) => send({ type: 'SET_BRANCH', branch: nextValue })}
                    containerXstyle={styles.createField}
                    controlXstyle={styles.createControl}
                  />
                  <ApexButton
                    type="submit"
                    variant="primary"
                    compact
                    xstyle={styles.createSubmit}
                    disabled={!branch.trim() || busy}
                  >
                    {creating ? 'Creating…' : 'Create'}
                  </ApexButton>
                </div>
                {error ? <span role="alert" {...stylex.props(styles.createError)}>{error}</span> : null}
              </form>
            </div>
          </LayerDepthProvider>
        ) : null,
        { placement: 'below', alignment: 'start', offset: 6 },
      )}
    </div>
  )
}
