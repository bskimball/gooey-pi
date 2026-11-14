import { LayerDepthProvider, layerAnimations, useLayer, useLayerDismissal } from '@astryxdesign/core/Layer'
import { TextInput } from '@astryxdesign/core/TextInput'
import * as stylex from '@stylexjs/stylex'
import { Brain, CaretDown, Check, MagnifyingGlass } from './icons'
import { ApexButton } from './ui'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ApexModelDescriptor, ApexProviderDescriptor } from '@/types/api'

interface ModelPickerProps {
  value: string
  modelsByProvider: ReadonlyMap<string, ApexModelDescriptor[]>
  providers: ApexProviderDescriptor[]
  onChange(value: string): void
  label?: string
  disabled?: boolean
  unavailableLabel?: string
}

interface ModelGroup {
  provider: ApexProviderDescriptor
  models: ApexModelDescriptor[]
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
  popover: {
    boxSizing: 'border-box',
    width: 'min(420px, calc(100vw - 32px))',
    maxHeight: 'min(420px, calc(100dvh - 36px))',
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
  searchRow: {
    flexShrink: 0,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 7,
    marginBottom: 6,
    paddingInlineEnd: 8,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: 'var(--border)',
      ':focus-within': 'var(--focus)',
    },
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--surface-subtle)',
    boxShadow: {
      default: 'none',
      ':focus-within': '0 0 0 2px color-mix(in srgb, var(--focus) 14%, transparent)',
    },
  },
  searchField: {
    minWidth: 0,
    width: '100%',
  },
  searchControl: {
    height: 32,
    minHeight: 32,
    paddingInlineStart: 9,
    paddingInlineEnd: 4,
    borderWidth: 0,
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    boxShadow: 'none',
    outlineStyle: 'none',
  },
  count: {
    flexShrink: 0,
    color: 'var(--text-tertiary)',
    fontSize: 'var(--fs-micro)',
    fontVariantNumeric: 'tabular-nums',
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
  },
  providers: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    paddingBottom: 6,
    overflowX: 'auto',
  },
  providerChip: {
    minHeight: 24,
    height: 24,
    flexShrink: 0,
    paddingBlock: 0,
    paddingInline: 8,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: 999,
    color: {
      default: 'var(--text-tertiary)',
      ':hover': 'var(--text)',
    },
    backgroundColor: {
      default: 'transparent',
      ':hover': 'var(--surface-hover)',
    },
    fontSize: 'var(--fs-micro)',
    fontWeight: 550,
  },
  providerChipActive: {
    borderColor: 'color-mix(in srgb, var(--accent) 30%, var(--border))',
    color: {
      default: 'var(--accent)',
      ':hover': 'var(--accent)',
    },
    backgroundColor: {
      default: 'color-mix(in srgb, var(--accent) 9%, var(--surface-subtle))',
      ':hover': 'color-mix(in srgb, var(--accent) 14%, var(--surface-subtle))',
    },
  },
  results: {
    flex: '1 1 auto',
    minHeight: 0,
    overflowY: 'auto',
    scrollPaddingBlockStart: 27,
    scrollPaddingBlockEnd: 0,
  },
  groupHeading: {
    position: 'sticky',
    zIndex: 1,
    top: 0,
    minHeight: 27,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingInline: 7,
    color: 'var(--text-secondary)',
    backgroundColor: 'color-mix(in srgb, var(--surface-raised) 94%, transparent)',
    backdropFilter: 'blur(8px)',
  },
  groupHeadingTitle: {
    fontSize: 'var(--fs-micro)',
    fontWeight: 600,
    letterSpacing: '0.03em',
  },
  groupHeadingMeta: {
    color: 'var(--text-tertiary)',
    fontSize: 'var(--fs-micro)',
    fontWeight: 400,
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
  optionSelected: {
    color: 'var(--text)',
  },
  optionUnavailable: {
    opacity: 0.5,
    cursor: 'default',
  },
  check: {
    width: 14,
    flexShrink: 0,
    display: 'inline-grid',
    placeItems: 'center',
    color: 'var(--accent)',
  },
  identity: {
    flex: '1 1 auto',
    minWidth: 0,
    display: 'grid',
    gap: 2,
  },
  identityName: {
    overflow: 'hidden',
    color: 'var(--text)',
    fontSize: 'var(--fs-ui)',
    fontWeight: 550,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  identityId: {
    overflow: 'hidden',
    color: 'var(--text-tertiary)',
    fontFamily: '"SFMono-Regular", Menlo, monospace',
    fontSize: 'var(--fs-micro)',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  availability: {
    flexShrink: 0,
    color: 'var(--text-tertiary)',
    fontSize: 'var(--fs-micro)',
  },
  empty: {
    paddingBlock: 22,
    paddingInline: 10,
    color: 'var(--text-tertiary)',
    fontSize: 'var(--fs-meta)',
    textAlign: 'center',
  },
})

export const ModelPicker = memo(function ModelPicker({
  value,
  modelsByProvider,
  providers,
  onChange,
  label = 'Model',
  disabled = false,
  unavailableLabel = 'No model available',
}: ModelPickerProps) {
  const [query, setQuery] = useState('')
  // null, not a string sentinel: harness catalogs are user-authored, so a
  // provider whose id is literally "all" must still filter to itself.
  const [providerFilter, setProviderFilter] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const layer = useLayer({
    mode: 'context',
    lightDismiss: true,
    lazyMount: true,
  })
  const open = layer.isOpen && !disabled

  const attachTriggerRef = useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node
    layer.ref(node)
  }, [layer])

  const close = useCallback((restoreFocus = false) => {
    layer.hide()
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }, [layer])

  useLayerDismissal({
    isActive: open,
    onDismiss: () => {
      const focusedInside = Boolean(
        rootRef.current?.contains(document.activeElement) ||
        popoverRef.current?.contains(document.activeElement),
      )
      close(focusedInside)
    },
    getContainer: () => popoverRef.current ?? rootRef.current,
  })

  const groups = useMemo<ModelGroup[]>(() => providers
    .filter((provider) => provider.enabled && (modelsByProvider.get(provider.id)?.length ?? 0) > 0)
    .map((provider) => ({ provider, models: modelsByProvider.get(provider.id) ?? [] })), [modelsByProvider, providers])
  const selected = useMemo(() => groups.flatMap((group) => group.models).find((model) => model.key === value), [groups, value])
  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return groups.flatMap((group) => {
      if (providerFilter !== null && providerFilter !== group.provider.id) return []
      const providerText = `${group.provider.name} ${group.provider.id}`.toLocaleLowerCase()
      const models = needle
        ? group.models.filter((model) => `${model.name} ${model.id} ${model.key} ${providerText}`.toLocaleLowerCase().includes(needle))
        : group.models
      return models.length ? [{ provider: group.provider, models }] : []
    })
  }, [groups, providerFilter, query])
  const visibleModels = useMemo(() => visibleGroups.flatMap((group) => group.models), [visibleGroups])
  const navigableModels = useMemo(() => visibleModels.filter((model) => model.available), [visibleModels])
  // The open reset reads the catalog through a ref: a background catalog
  // refresh must not wipe a query the user is still typing.
  const catalogRef = useRef({ groups, selected })
  catalogRef.current = { groups, selected }

  const choose = (model: ApexModelDescriptor | undefined) => {
    if (disabled || !model?.available) return
    onChange(model.key)
    close(true)
  }
  const moveActive = (direction: 1 | -1) => {
    if (!navigableModels.length) return
    const current = navigableModels.findIndex((model) => model.key === activeKey)
    const next = current < 0
      ? direction > 0 ? 0 : navigableModels.length - 1
      : (current + direction + navigableModels.length) % navigableModels.length
    setActiveKey(navigableModels[next].key)
  }

  useEffect(() => {
    if (!open) return
    const { groups: openGroups, selected: openSelected } = catalogRef.current
    setQuery('')
    setProviderFilter(null)
    setActiveKey(openSelected?.available
      ? openSelected.key
      : openGroups.flatMap((group) => group.models).find((model) => model.available)?.key ?? null)
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!navigableModels.some((model) => model.key === activeKey)) setActiveKey(navigableModels[0]?.key ?? null)
  }, [activeKey, navigableModels, open])

  useEffect(() => {
    if (disabled && layer.isOpen) layer.hide()
  }, [disabled, layer])

  useEffect(() => {
    if (!open || !activeKey) return
    document.getElementById(`${listId}-${activeKey}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeKey, listId, open])

  useEffect(() => {
    if (!open || (typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function')) return
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target) &&
        !popoverRef.current?.contains(event.target)
      ) {
        close()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [close, open])

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1) }
    else if (event.key === 'Home') { event.preventDefault(); setActiveKey(navigableModels[0]?.key ?? null) }
    else if (event.key === 'End') { event.preventDefault(); setActiveKey(navigableModels.at(-1)?.key ?? null) }
    else if (event.key === 'Enter') { event.preventDefault(); choose(navigableModels.find((model) => model.key === activeKey)) }
    // Escape is owned by the picker layer so it also dismisses from the
    // provider filters and the options without closing an enclosing dialog.
  }

  const resultCount = visibleModels.length
  const displayName = `${label === 'Model' ? '' : `${label}: `}${selected?.name ?? unavailableLabel}`
  const accessibleLabel = `${label}: ${selected?.name ?? unavailableLabel}`
  const rootStylex = stylex.props(styles.root)
  const popoverStylex = stylex.props(styles.popover, layerAnimations.below)
  const providersStylex = stylex.props(styles.providers)
  const resultsStylex = stylex.props(styles.results)

  return (
    <div
      className={`model-picker ${rootStylex.className ?? ''}`.trim()}
      style={rootStylex.style}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        event.stopPropagation()
        close(true)
      }}
    >
      <ApexButton
        compact
        endIcon={<CaretDown size={11} aria-hidden="true" />}
        label={accessibleLabel}
        ref={attachTriggerRef}
        type="button"
        className="model-picker__trigger"
        xstyle={[styles.trigger, open && styles.triggerOpen]}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled || !groups.length}
        onClick={() => {
          if (open) close()
          else layer.show()
        }}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            layer.show()
          }
        }}
      >
        <span {...stylex.props(styles.triggerLead)}>
          <Brain size={14} {...stylex.props(styles.triggerIcon)} aria-hidden="true" />
          <span {...stylex.props(styles.triggerText)}>{displayName}</span>
        </span>
      </ApexButton>
      {layer.render(
        open ? (
          <LayerDepthProvider>
            <div
              ref={popoverRef}
              className={`model-picker__popover ${popoverStylex.className ?? ''}`.trim()}
              style={popoverStylex.style}
              onBlur={(event) => {
                // Tabbing past the filters must dismiss like the native select did.
                // A null relatedTarget means focus left the document entirely (app
                // switch), which keeps the popover and the typed query alive.
                const next = event.relatedTarget
                if (
                  next instanceof Node &&
                  !rootRef.current?.contains(next) &&
                  !popoverRef.current?.contains(next)
                ) {
                  close()
                }
              }}
            >
              <div {...stylex.props(styles.searchRow)}>
                <TextInput
                  ref={searchRef}
                  type="search"
                  size="sm"
                  label="Search models"
                  isLabelHidden
                  aria-label="Search models"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-activedescendant={activeKey ? `${listId}-${activeKey}` : undefined}
                  placeholder="Search models"
                  startIcon={<MagnifyingGlass size={14} aria-hidden="true" />}
                  value={query}
                  onChange={setQuery}
                  onKeyDown={onSearchKeyDown}
                  containerXstyle={styles.searchField}
                  controlXstyle={styles.searchControl}
                />
                <span {...stylex.props(styles.count)} aria-live="polite">
                  <span aria-hidden="true">{resultCount}</span>
                  <span {...stylex.props(styles.srOnly)}>{resultCount} {resultCount === 1 ? 'model' : 'models'} listed</span>
                </span>
              </div>
              <div
                className={`model-picker__providers ${providersStylex.className ?? ''}`.trim()}
                style={providersStylex.style}
                role="group"
                aria-label="Filter models by provider"
              >
                <ApexButton
                  variant="quiet"
                  compact
                  className={providerFilter === null ? 'is-active' : ''}
                  xstyle={[styles.providerChip, providerFilter === null && styles.providerChipActive]}
                  aria-pressed={providerFilter === null}
                  onClick={() => setProviderFilter(null)}
                >
                  All
                </ApexButton>
                {groups.map(({ provider }) => {
                  const isActiveFilter = providerFilter === provider.id
                  return (
                    <ApexButton
                      variant="quiet"
                      compact
                      key={provider.id}
                      className={isActiveFilter ? 'is-active' : ''}
                      xstyle={[styles.providerChip, isActiveFilter && styles.providerChipActive]}
                      aria-pressed={isActiveFilter}
                      onClick={() => setProviderFilter(provider.id)}
                    >
                      {provider.name}
                    </ApexButton>
                  )
                })}
              </div>
              <div
                className={`model-picker__results ${resultsStylex.className ?? ''}`.trim()}
                style={resultsStylex.style}
                id={listId}
                role="listbox"
                aria-label="Models"
              >
                {visibleGroups.map(({ provider, models }) => {
                  const headingStylex = stylex.props(styles.groupHeading)
                  return (
                    <div role="group" aria-label={provider.name} key={provider.id}>
                      <div
                        className={`model-picker__group-heading ${headingStylex.className ?? ''}`.trim()}
                        style={headingStylex.style}
                      >
                        <span {...stylex.props(styles.groupHeadingTitle)}>{provider.name}</span>
                        <small {...stylex.props(styles.groupHeadingMeta)}>
                          {provider.configured ? `${models.length} model${models.length === 1 ? '' : 's'}` : 'Not connected'}
                        </small>
                      </div>
                      {models.map((candidate) => {
                        const isSelected = candidate.key === value
                        const isActive = candidate.key === activeKey
                        const optionStylex = stylex.props(
                          styles.option,
                          isActive && styles.optionActive,
                          isSelected && styles.optionSelected,
                          !candidate.available && styles.optionUnavailable,
                        )
                        return (
                          <button
                            type="button"
                            tabIndex={-1}
                            role="option"
                            id={`${listId}-${candidate.key}`}
                            key={candidate.key}
                            aria-selected={isSelected}
                            aria-disabled={!candidate.available}
                            className={`model-picker__option${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''} ${optionStylex.className ?? ''}`.trim()}
                            style={optionStylex.style}
                            onMouseMove={() => { if (candidate.available) setActiveKey(candidate.key) }}
                            onClick={() => choose(candidate)}
                          >
                            <span {...stylex.props(styles.check)}>{isSelected ? <Check size={13} /> : null}</span>
                            <span {...stylex.props(styles.identity)}>
                              <strong {...stylex.props(styles.identityName)}>{candidate.name}</strong>
                              {candidate.id !== candidate.name ? <small {...stylex.props(styles.identityId)}>{candidate.id}</small> : null}
                            </span>
                            {!candidate.available ? <span {...stylex.props(styles.availability)}>Connect</span> : null}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
                {!resultCount ? (
                  <div {...stylex.props(styles.empty)}>
                    {query.trim() ? 'No models match this search.' : 'No models for this provider.'}
                  </div>
                ) : null}
              </div>
            </div>
          </LayerDepthProvider>
        ) : null,
        { placement: 'below', alignment: 'start', offset: 6 },
      )}
    </div>
  )
})
