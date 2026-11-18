import { styles as workbenchStyles } from './styles/workbench.stylex'
import { styles as pagesStyles } from './styles/pages.stylex'
import { styles as settingsStyles } from './styles/settings.stylex'
import { motionMarker } from './styles/motion.stylex'
import { styles as logosStyles } from './styles/logos.stylex'
import { Button as AstryxButton } from '@astryxdesign/core/Button'
import { ButtonGroup } from '@astryxdesign/core/ButtonGroup'
import { EmptyState as AstryxEmptyState } from '@astryxdesign/core/EmptyState'
import { Selector, type SelectorOptionData } from '@astryxdesign/core/Selector'
import { defineTheme, registerTheme } from '@astryxdesign/core/theme'
import * as stylex from '@stylexjs/stylex'
import { CaretDown, Check, GlobeSimple, X } from './icons'
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  type SelectHTMLAttributes,
} from 'react'

export { Modal } from './Modal'

const apexAstryxTheme = defineTheme({
  name: 'apex',
  icons: {
    chevronDown: <CaretDown className="select-control__chevron" size={11} aria-hidden="true" />,
    check: <Check size={13} aria-hidden="true" />,
    close: <X size={16} aria-hidden="true" />,
  },
})
registerTheme(apexAstryxTheme)
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-astryx-theme', 'apex')
  const motionClass = stylex.props(motionMarker).className
  if (motionClass) document.documentElement.classList.add(motionClass)
}

const styles = stylex.create({
  iconButton: {
    position: 'relative',
    display: 'inline-grid',
    placeItems: 'center',
    flex: '0 0 auto',
    width: { default: 32, '@media (max-width: 720px)': 36 },
    height: { default: 32, '@media (max-width: 720px)': 36 },
    minWidth: 0,
    minHeight: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: 'var(--radius-sm)',
    color: {
      default: 'var(--text-secondary)',
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover': 'var(--text)',
      },
    },
    backgroundColor: {
      default: 'transparent',
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover': 'var(--surface-hover)',
      },
    },
    backgroundImage: 'none',
    boxShadow: 'none',
    cursor: 'pointer',
    transform: {
      default: null,
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':active:not(:disabled):not(:focus-visible)': 'scale(0.98)',
      },
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    transition: {
      default: 'transform 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color var(--fast), color var(--fast)',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  iconButtonSmall: {
    width: { default: 26, '@media (max-width: 720px)': 36 },
    height: { default: 26, '@media (max-width: 720px)': 36 },
  },
  button: {
    minHeight: 30,
    height: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBlock: 0,
    paddingInline: 11,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text)',
    // Gray tonal fill like the sidebar session actions, with a defined edge.
    backgroundColor: {
      default: 'var(--surface-hover)',
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover': 'var(--surface-selected)',
      },
    },
    backgroundImage: 'var(--gradient-apex)',
    boxShadow: {
      default: 'var(--shadow-control)',
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover:not(:disabled)': 'var(--shadow-control-hover)',
      },
    },
    fontSize: 'var(--fs-body)',
    fontWeight: 550,
    cursor: 'pointer',
    transform: {
      default: null,
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':active:not(:disabled):not(:focus-visible)': 'scale(0.98)',
      },
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    transition: {
      default: 'transform 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color var(--fast), color var(--fast), border-color var(--fast), box-shadow var(--fast)',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  buttonCompact: {
    minHeight: 28,
    borderRadius: 'var(--radius-sm)',
    paddingInline: 9,
  },
  // Primary: gray fill one step stronger, with apex gradient/border.
  buttonPrimary: {
    color: {
      default: 'var(--text)',
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover': 'var(--text)',
      },
    },
    backgroundColor: {
      default: 'var(--surface-selected)',
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover': 'color-mix(in srgb, var(--surface-selected) 82%, var(--text))',
      },
    },
    backgroundImage: 'var(--gradient-apex)',
    boxShadow: {
      default: 'var(--shadow-control)',
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover:not(:disabled)': 'var(--shadow-control-hover)',
      },
    },
    borderColor: {
      default: 'var(--border-apex)',
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover': 'var(--apex)',
      },
    },
    fontWeight: 600,
  },
  buttonDanger: {
    borderRadius: 999,
    paddingInline: 14,
    color: '#ffffff',
    backgroundColor: {
      default: 'var(--danger)',
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover': 'var(--danger)',
      },
    },
    borderColor: 'var(--danger)',
    backgroundImage: {
      default: 'none',
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover': 'none',
      },
    },
    boxShadow: 'none',
    filter: {
      default: null,
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover': 'brightness(0.94)',
      },
    },
  },
  buttonQuiet: {
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
    backgroundColor: {
      default: 'transparent',
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover': 'var(--surface-hover)',
      },
    },
    backgroundImage: {
      default: 'none',
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover': 'none',
      },
    },
    boxShadow: 'none',
    color: {
      default: 'var(--text-secondary)',
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':hover': 'var(--text)',
      },
    },
  },
  selectRoot: {
    position: 'relative',
    minWidth: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    flex: '0 1 auto',
    gap: 4,
    paddingInline: 7,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    backgroundColor: 'var(--surface-subtle)',
    backgroundImage: 'var(--gradient-apex)',
    boxShadow: 'var(--shadow-control)',
    cursor: 'pointer',
    transform: {
      default: null,
      '@media (hover: hover) and (pointer: fine)': {
        default: null,
        ':active:not(:has(:disabled)):not(:has(:focus-visible))': 'scale(0.98)',
      },
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    transition: {
      default: 'transform 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color var(--fast), color var(--fast), border-color var(--fast), box-shadow var(--fast)',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    '@media (hover: hover) and (pointer: fine)': {
      ':hover:not(:has(:disabled))': { color: 'var(--text)', borderColor: 'var(--border-apex)', backgroundColor: 'var(--surface-hover)', boxShadow: 'var(--shadow-control-hover)' },
    },
    ':focus-within': { color: 'var(--text)', borderColor: 'var(--border-apex)', boxShadow: 'var(--shadow-control-hover)', outlineWidth: 2, outlineStyle: 'solid', outlineColor: 'var(--focus)', outlineOffset: 1 },
  },
  selectRootOpen: { color: 'var(--text)', borderColor: 'var(--border-apex)', backgroundColor: 'var(--surface-hover)', boxShadow: 'var(--shadow-control-hover)' },
  selectRootDisabled: { opacity: 0.65, cursor: 'default' },
  selectIcon: { display: 'inline-grid', placeItems: 'center', flex: '0 0 auto', pointerEvents: 'none' },
  selectRootCompact: {
    height: 26,
    borderRadius: 999,
  },
  selectRootFullWidth: {
    width: '100%',
    height: 32,
    gap: 6,
    paddingInline: 9,
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--fs-ui)',
    fontWeight: 550,
  },
  selectorField: {
    position: 'static',
    display: 'inline-flex',
    flexDirection: 'row',
    alignItems: 'center',
    flex: '0 1 auto',
    minWidth: 0,
    height: '100%',
  },
  selectorFieldFullWidth: {
    flex: '1 1 auto',
    width: '100%',
  },
  selectorControl: {
    position: 'static',
    minHeight: 0,
    minWidth: 0,
    maxWidth: 122,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 'var(--fs-meta)',
    fontWeight: 550,
    cursor: 'pointer',
    height: '100%',
    paddingInline: 0,
    paddingBlock: 0,
    gap: 4,
    borderWidth: 0,
    borderRadius: 0,
    color: 'inherit',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    boxShadow: 'none',
    outlineStyle: 'none',
  },
  selectorControlFullWidth: {
    width: '100%',
    maxWidth: 'none',
    justifyContent: 'space-between',
    fontSize: 'inherit',
  },
  segmentedGroup: {
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0,
    padding: 2,
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--surface-hover)',
  },
  segmentedItem: {
    minHeight: 24,
    height: 24,
    paddingBlock: 0,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    boxShadow: 'none',
    fontSize: 'var(--fs-meta)',
    fontWeight: 500,
    cursor: 'pointer',
  },
  segmentedItemActive: {
    color: 'var(--text)',
    backgroundColor: 'var(--surface-raised)',
    backgroundImage: 'var(--gradient-apex)',
    borderRadius: 'var(--radius-xs)',
    boxShadow: 'inset 0 0 0 1px var(--border-apex), var(--shadow-control-hover)',
  },
  emptyState: {
    height: '100%',
    minHeight: 280,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: 0,
    padding: 32,
    textAlign: 'center',
    textWrap: 'pretty',
  },
  emptyStateDescription: {
    textWrap: 'pretty',
  },
})

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return
  if (typeof ref === 'function') ref(value)
  else (ref as { current: T | null }).current = value
}

function useSyncedAstryxButtonDom(disabled: boolean | undefined, title: string | undefined, externalRef?: Ref<HTMLButtonElement>) {
  const innerRef = useRef<HTMLButtonElement | null>(null)
  const attachRef = useCallback((node: HTMLButtonElement | null) => {
    innerRef.current = node
    assignRef(externalRef, node)
  }, [externalRef])

  useLayoutEffect(() => {
    const button = innerRef.current
    if (!button) return
    button.disabled = Boolean(disabled)
    if (title !== undefined) button.setAttribute('title', title)
    // Astryx Button mounts an empty polite live region for async loading labels;
    // remove the redundant role on non-loading buttons so screen readers and
    // `[role="status"]` queries only see real application status regions.
    const live = button.querySelector('[role="status"][aria-live="polite"]')
    if (live && !live.textContent) live.removeAttribute('role')
  }, [disabled, title])

  return attachRef
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  xstyle?: stylex.StyleXStyles
  size?: 'small' | 'regular'
  ref?: Ref<HTMLButtonElement>
}

export function IconButton({ label, xstyle, size = 'regular', className = '', disabled, title, type = 'button', children, ref, ...props }: IconButtonProps) {
  const buttonRef = useSyncedAstryxButtonDom(disabled, title ?? label, ref)
  // Extract HTML attributes Astryx BaseProps omits at the type level (`title`, `disabled`, etc.)
  const { form: _form, name: _name, value: _value, autoFocus: _autoFocus, ...safeProps } = props
  return (
    <AstryxButton
      {...safeProps}
      ref={buttonRef}
      type={type}
      label={label}
      isIconOnly
      variant="ghost"
      size={size === 'small' ? 'sm' : 'md'}
      isDisabled={disabled}
      icon={children}
      className={`icon-button icon-button--${size} ${className}`.trim()}
      xstyle={[workbenchStyles.iconButton, styles.iconButton, size === 'small' && styles.iconButtonSmall, xstyle]}
    />
  )
}

interface ApexButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'secondary' | 'primary' | 'danger' | 'quiet'
  compact?: boolean
  icon?: ReactNode
  endIcon?: ReactNode
  label?: string
  xstyle?: stylex.StyleXStyles
  ref?: Ref<HTMLButtonElement>
}

export function ApexButton({
  variant = 'secondary',
  compact = false,
  icon,
  endIcon,
  label,
  xstyle,
  className = '',
  disabled,
  title,
  type = 'button',
  children,
  ref,
  ...props
}: ApexButtonProps) {
  const buttonRef = useSyncedAstryxButtonDom(disabled, title, ref)
  const resolvedLabel = label ?? (typeof children === 'string' || typeof children === 'number' ? String(children) : props['aria-label'] ?? '')
  const variantClass = variant === 'primary'
    ? 'button--primary'
    : variant === 'danger'
      ? 'button--danger'
      : variant === 'quiet'
        ? 'button--quiet'
        : ''
  const astryxVariant = variant === 'primary'
    ? 'primary'
    : variant === 'danger'
      ? 'destructive'
      : variant === 'quiet'
        ? 'ghost'
        : 'secondary'
  const { form, name: _name, value: _value, autoFocus: _autoFocus, ...safeProps } = props
  const extraAttrs = form ? ({ form } as Record<string, unknown>) : undefined

  return (
    <AstryxButton
      {...safeProps}
      {...extraAttrs}
      ref={buttonRef}
      type={type}
      label={resolvedLabel}
      variant={astryxVariant}
      size={compact ? 'sm' : 'md'}
      isDisabled={disabled}
      icon={icon}
      endContent={endIcon}
      className={`button ${compact ? 'button--compact' : ''} ${variantClass} ${className}`.trim()}
      xstyle={[workbenchStyles.button, variant === 'quiet' && workbenchStyles.buttonQuiet, compact && workbenchStyles.buttonCompact, variant === 'primary' && workbenchStyles.buttonPrimary, (variant === 'primary' ? false : variant === 'danger') && workbenchStyles.buttonDanger, styles.button, compact && styles.buttonCompact, variant === 'primary' && styles.buttonPrimary, variant === 'danger' && styles.buttonDanger, variant === 'quiet' && styles.buttonQuiet, xstyle]}
    >
      {children}
    </AstryxButton>
  )
}

export function BrowserGlobe({ size = 18 }: { size?: number }) {
  return <GlobeSimple className="browser-globe" size={size} />
}

interface SelectControlProps extends SelectHTMLAttributes<HTMLSelectElement> {
  icon?: ReactNode
  compact?: boolean
  fullWidth?: boolean
  placement?: 'above' | 'below'
  xstyle?: stylex.StyleXStyles
  label: string
}

export function SelectControl({ icon, compact, fullWidth = false, placement = 'below', xstyle, className = '', label, value, disabled, onChange, children }: SelectControlProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    document.documentElement.setAttribute('data-astryx-theme', 'apex')
  }, [])
  useLayoutEffect(() => {
    if (triggerRef.current) triggerRef.current.disabled = Boolean(disabled)
  }, [disabled])

  const clampPopupToPane = useCallback(() => {
    const root = rootRef.current
    const trigger = triggerRef.current
    if (!root || !trigger || trigger.getAttribute('aria-expanded') !== 'true') return
    const listboxId = trigger.getAttribute('aria-controls')
    const listbox = listboxId ? document.getElementById(listboxId) : null
    const popup = listbox?.closest<HTMLElement>('.astryx-selector-popup')
    const pane = root.closest<HTMLElement>('.conversation-pane')
    if (!popup) return
    const paneRect = pane?.getBoundingClientRect() ?? { width: window.innerWidth, height: window.innerHeight, top: 0, right: window.innerWidth, bottom: window.innerHeight, left: 0 }
    const layer = popup.closest<HTMLElement>('[data-astryx-layer-root]')
    layer?.style.setProperty('--_astryx-layer-clearance', '12px')
    if (layer) layer.style.maxWidth = `${Math.min(320, paneRect.width - 24)}px`
    if (paneRect.width <= 0 || paneRect.height <= 0) return
    const maxWidth = Math.max(160, Math.min(320, Math.floor(paneRect.width - 24)))
    popup.style.width = `${maxWidth}px`
    popup.style.maxWidth = `${maxWidth}px`
    const triggerRect = root.getBoundingClientRect()
    const availableBlock = placement === 'above'
      ? triggerRect.top - paneRect.top - 16
      : paneRect.bottom - triggerRect.bottom - 16
    popup.style.maxHeight = `${Math.min(420, Math.max(100, Math.floor(availableBlock)))}px`
    popup.style.translate = '0px 0px'
    const popupRect = popup.getBoundingClientRect()
    let shiftX = 0
    const rightLimit = paneRect.right - 12
    const leftLimit = paneRect.left + 12
    if (popupRect.right > rightLimit) shiftX = rightLimit - popupRect.right
    if (popupRect.left + shiftX < leftLimit) shiftX = leftLimit - popupRect.left
    if (shiftX !== 0) popup.style.translate = `${Math.round(shiftX)}px 0px`
  }, [placement])

  useEffect(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const syncClamp = () => {
      const expanded = trigger.getAttribute('aria-expanded') === 'true'
      setOpen(expanded)
      if (!expanded) return
      clampPopupToPane()
      requestAnimationFrame(() => {
        clampPopupToPane()
        const listboxId = trigger.getAttribute('aria-controls')
        const popup = listboxId ? document.getElementById(listboxId)?.closest<HTMLElement>('.astryx-selector-popup') : null
        const layer = popup?.closest<HTMLElement>('[data-astryx-layer-root]')
        const anims = [...(popup?.getAnimations?.() ?? []), ...(layer?.getAnimations?.() ?? [])]
        for (const anim of anims) {
          void anim.finished.then(clampPopupToPane, () => undefined)
        }
      })
    }
    const observer = new MutationObserver(syncClamp)
    observer.observe(trigger, { attributes: true, attributeFilter: ['aria-expanded'] })
    window.addEventListener('resize', clampPopupToPane)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', clampPopupToPane)
    }
  }, [clampPopupToPane])
  const options = useMemo<SelectorOptionData[]>(
    () =>
      Children.toArray(children).flatMap((child) => {
        if (!isValidElement<{ value?: string | number; disabled?: boolean; title?: string; children?: ReactNode }>(child)) return []
        const optionValue = String(child.props.value ?? '')
        const optionLabel = typeof child.props.children === 'string' || typeof child.props.children === 'number'
          ? String(child.props.children)
          : optionValue
        return [{
          value: optionValue,
          label: optionLabel,
          description: child.props.title,
          disabled: Boolean(child.props.disabled),
        }]
      }),
    [children],
  )
  const selectedValue = String(value ?? options[0]?.value ?? '')
  const rootStylex = stylex.props(
    styles.selectRoot,
    open && styles.selectRootOpen,
    disabled && styles.selectRootDisabled,
    compact && styles.selectRootCompact,
    fullWidth && styles.selectRootFullWidth,
    xstyle,
  )

  return (
    <div
      ref={rootRef}
      className={`select-control ${compact ? 'select-control--compact' : ''} ${fullWidth ? 'select-control--full-width' : ''} ${className} ${rootStylex.className ?? ''}`.trim()}
      style={rootStylex.style}
      title={label}
    >
      <Selector
        ref={triggerRef}
        label={label}
        aria-label={label}
        isLabelHidden
        variant="ghost"
        size="sm"
        width={fullWidth ? '100%' : undefined}
        placement={placement}
        presentation="popover"
        isDisabled={disabled}
        value={selectedValue}
        options={options}
        startIcon={icon ? <span {...stylex.props(styles.selectIcon)} aria-hidden="true">{icon}</span> : undefined}
        onChange={(nextValue) => {
          onChange?.({ target: { value: nextValue }, currentTarget: { value: nextValue } } as ChangeEvent<HTMLSelectElement>)
        }}
        containerXstyle={[styles.selectorField, fullWidth && styles.selectorFieldFullWidth]}
        controlClassName="select-control__box"
        controlXstyle={[styles.selectorControl, fullWidth && styles.selectorControlFullWidth]}
      />
    </div>
  )
}

function SegmentedOptionButton({
  optionLabel,
  active,
  onSelect,
}: {
  optionLabel: string
  active: boolean
  onSelect(): void
}) {
  const buttonRef = useSyncedAstryxButtonDom(false, undefined)
  return (
    <AstryxButton
      ref={buttonRef}
      label={optionLabel}
      variant="ghost"
      size="sm"
      aria-pressed={active}
      onClick={onSelect}
      className={active ? 'is-active' : ''}
      xstyle={[styles.segmentedItem, active && styles.segmentedItemActive]}
    />
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange(value: T): void
  label: string
}) {
  return (
    <ButtonGroup
      label={label}
      size="sm"
      className="segmented"
      xstyle={styles.segmentedGroup}
    >
      {options.map((option) => (
        <SegmentedOptionButton
          key={option.value}
          optionLabel={option.label}
          active={value === option.value}
          onSelect={() => onChange(option.value)}
        />
      ))}
    </ButtonGroup>
  )
}

export function EmptyState({ icon, title, children, action, className = '', role }: { icon?: ReactNode; title: string; children: ReactNode; action?: ReactNode; className?: string; role?: string }) {
  const textDescription = typeof children === 'string' || typeof children === 'number' ? String(children) : undefined
  const actionsSlot = textDescription !== undefined
    ? (action ? <div className={`empty-state__action ${stylex.props(pagesStyles.emptyStateAction).className ?? ""}`}>{action}</div> : undefined)
    : (
        <>
          <div {...stylex.props(styles.emptyStateDescription)}>{children}</div>
          {action ? <div className={`empty-state__action ${stylex.props(pagesStyles.emptyStateAction).className ?? ""}`}>{action}</div> : null}
        </>
      )
  return (
    <AstryxEmptyState
      headingLevel={2}
      title={title}
      icon={icon ? <div className={`empty-state__icon ${stylex.props(pagesStyles.emptyStateIcon).className ?? ""}`}>{icon}</div> : undefined}
      description={textDescription}
      actions={actionsSlot}
      role={role}
      className={`empty-state ${className}`.trim()}
      xstyle={[pagesStyles.emptyState, styles.emptyState]}
    />
  )
}

export const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void): RefObject<T | null> {
  const containerRef = useRef<T>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape
  useEffect(() => {
    if (!active || !containerRef.current) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const container = containerRef.current
    const focusInitial = () => {
      const preferred = container.querySelector<HTMLElement>('[autofocus]')
      const first = preferred ?? container.querySelector<HTMLElement>(focusableSelector)
      first?.focus()
    }
    const frame = requestAnimationFrame(focusInitial)
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.target instanceof Node) || !container.contains(event.target)) return
      if (event.key === 'Escape' && escapeRef.current) { event.preventDefault(); escapeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter((item) => !item.hidden && item.getClientRects().length > 0)
      if (!items.length) { event.preventDefault(); container.focus(); return }
      const first = items[0]; const last = items.at(-1)!
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown, true)
      const restore = previousFocus.current
      requestAnimationFrame(() => { if (restore?.isConnected) restore.focus() })
    }
  }, [active])
  return containerRef
}

// Overlays (modals, the command palette) share one refcount so stacked or
// sibling overlays only toggle the app shell's inert state on 0<->1 transitions.
let appShellOverlayCount = 0

export function useAppShellOverlay(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const shell = document.querySelector<HTMLElement>('.app-shell')
    if (!shell) return
    appShellOverlayCount += 1
    if (appShellOverlayCount === 1) { shell.inert = true; shell.setAttribute('aria-hidden', 'true') }
    return () => {
      appShellOverlayCount -= 1
      if (appShellOverlayCount === 0) { shell.inert = false; shell.removeAttribute('aria-hidden') }
    }
  }, [active])
}

export function PiMark({ size = 24 }: { size?: number }) {
  // Option 2 ("The Apex Fang"): a razor-edged shark-tooth "A" silhouette with
  // a rolling wave-trough crossbar and under-crest accent.
  return (
    <span className={`pi-mark ${stylex.props(workbenchStyles.piMark).className ?? ""}`} style={{ width: size, height: size }} role="img" aria-label="Pi">
      <svg viewBox="0 0 100 100" fill="none" focusable="false" aria-hidden="true" {...stylex.props(logosStyles.markSvg)}>
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M50 8 C60 24 74 51 86 81 C87.6 85 84 88.8 80 86.8 L67 80 C61 68 55.5 64 50 64 C44.5 64 39 68 33 80 L20 86.8 C16 88.8 12.4 85 14 81 C26 51 40 24 50 8 Z M50 27 C45 37 40.5 46 37.5 54.5 C45 49.5 55 49.5 62.5 54.5 C59.5 46 55 37 50 27 Z"
          fill="currentColor"
        />
        <path
          d="M27 89 C37 78 46 76 54 81.5 C60.5 85.8 66.5 84.5 73 79.5 C66.5 90 56.5 92.5 47 87.8 C39.5 84 33.5 85.2 27 89 Z"
          fill="#38bdf8"
        />
      </svg>
    </span>
  )
}

export function PiWelcomeMark({ size = 88 }: { size?: number }) {
  // Option 3 ("Seigaiha Fin Mon"): Japanese circular kamon crest with layered
  // concentric Seigaiha ocean waves and a swept shark dorsal fin slicing upward.
  const clipId = useId()
  return (
    <span className={`pi-welcome-mark ${stylex.props(workbenchStyles.piWelcomeMark).className ?? ""}`} style={{ width: size, height: size }} role="img" aria-label="Apex wave crest">
      <svg viewBox="0 0 160 160" fill="none" focusable="false" aria-hidden="true" {...stylex.props(logosStyles.welcomeSvg)}>
        <defs>
          <clipPath id={clipId}>
            <circle cx="80" cy="80" r="67" {...stylex.props(logosStyles.shape)} />
          </clipPath>
        </defs>
        <circle cx="80" cy="80" r="74" fill="#0b1119" {...stylex.props(logosStyles.shape)} />
        <g clipPath={`url(#${clipId})`} {...stylex.props(logosStyles.shape)}>
          <g className={`pi-welcome-mark__moon ${stylex.props(logosStyles.shape, workbenchStyles.piWelcomeMarkMoon).className ?? ""}`}>
            <circle cx="50" cy="48" r="13" fill="#38bdf8" fillOpacity="0.14" {...stylex.props(logosStyles.shape)} />
            <circle cx="50" cy="48" r="9.5" stroke="#7dd3fc" strokeOpacity="0.45" strokeWidth="1.5" {...stylex.props(logosStyles.shape)} />
          </g>
          <g className={`pi-welcome-mark__fin ${stylex.props(logosStyles.shape, logosStyles.fin).className ?? ""}`}>
            <path
              d="M42 106 C45 68 63 38 99 20 C90 42 87 63 95 83 L86 87 L96 104 Z"
              fill="currentColor"
            />
            <path
              d="M55 96 C58 68 71 44 93 26"
              stroke="#0b1119"
              strokeWidth="2.6"
              strokeLinecap="round"
            />
            <path
              d="M66 78 L78 72 M63 86 L77 80 M60 94 L76 88"
              stroke="#0b1119"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </g>
          <g className={`pi-welcome-mark__wave pi-welcome-mark__wave--left ${stylex.props(logosStyles.shape, workbenchStyles.piWelcomeMarkWaveLeft).className ?? ""}`}>
            <circle cx="34" cy="118" r="42" fill="#0b1119" {...stylex.props(logosStyles.shape)} />
            <circle cx="34" cy="118" r="42" stroke="currentColor" strokeWidth="2.6" {...stylex.props(logosStyles.shape)} />
            <circle cx="34" cy="118" r="33" stroke="#7dd3fc" strokeOpacity="0.85" strokeWidth="2" {...stylex.props(logosStyles.shape)} />
            <circle cx="34" cy="118" r="24" stroke="#38bdf8" strokeOpacity="0.7" strokeWidth="1.8" {...stylex.props(logosStyles.shape)} />
            <circle cx="34" cy="118" r="15" stroke="#38bdf8" strokeOpacity="0.5" strokeWidth="1.6" {...stylex.props(logosStyles.shape)} />
          </g>
          <g className={`pi-welcome-mark__wave pi-welcome-mark__wave--right ${stylex.props(logosStyles.shape, workbenchStyles.piWelcomeMarkWaveRight).className ?? ""}`}>
            <circle cx="126" cy="118" r="42" fill="#0b1119" {...stylex.props(logosStyles.shape)} />
            <circle cx="126" cy="118" r="42" stroke="currentColor" strokeWidth="2.6" {...stylex.props(logosStyles.shape)} />
            <circle cx="126" cy="118" r="33" stroke="#7dd3fc" strokeOpacity="0.85" strokeWidth="2" {...stylex.props(logosStyles.shape)} />
            <circle cx="126" cy="118" r="24" stroke="#38bdf8" strokeOpacity="0.7" strokeWidth="1.8" {...stylex.props(logosStyles.shape)} />
            <circle cx="126" cy="118" r="15" stroke="#38bdf8" strokeOpacity="0.5" strokeWidth="1.6" {...stylex.props(logosStyles.shape)} />
          </g>
          <g className={`pi-welcome-mark__wave pi-welcome-mark__wave--front ${stylex.props(logosStyles.shape, workbenchStyles.piWelcomeMarkWaveFront).className ?? ""}`}>
            <circle cx="80" cy="136" r="46" fill="#0b1119" {...stylex.props(logosStyles.shape)} />
            <circle cx="80" cy="136" r="46" stroke="currentColor" strokeWidth="3" {...stylex.props(logosStyles.shape)} />
            <circle cx="80" cy="136" r="37" stroke="#7dd3fc" strokeOpacity="0.9" strokeWidth="2.2" {...stylex.props(logosStyles.shape)} />
            <circle cx="80" cy="136" r="28" stroke="#38bdf8" strokeOpacity="0.75" strokeWidth="2" {...stylex.props(logosStyles.shape)} />
            <circle cx="80" cy="136" r="19" stroke="#38bdf8" strokeOpacity="0.6" strokeWidth="1.8" {...stylex.props(logosStyles.shape)} />
            <circle cx="80" cy="136" r="10" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.6" {...stylex.props(logosStyles.shape)} />
          </g>
          <circle className={`pi-welcome-mark__spray ${stylex.props(logosStyles.shape, workbenchStyles.piWelcomeMarkSpray).className ?? ""}`} cx="105" cy="54" r="2.2" fill="currentColor" />
          <circle className={`pi-welcome-mark__spray pi-welcome-mark__spray--late ${stylex.props(logosStyles.shape, workbenchStyles.piWelcomeMarkSpray, workbenchStyles.piWelcomeMarkSprayLate).className ?? ""}`} cx="111" cy="62" r="1.6" fill="#7dd3fc" />
          <circle className={`pi-welcome-mark__spray pi-welcome-mark__spray--later ${stylex.props(logosStyles.shape, workbenchStyles.piWelcomeMarkSpray, workbenchStyles.piWelcomeMarkSprayLater).className ?? ""}`} cx="36" cy="70" r="1.8" fill="#7dd3fc" />
        </g>
        <circle cx="80" cy="80" r="73" stroke="currentColor" strokeWidth="3.5" {...stylex.props(logosStyles.shape)} />
        <circle className={`pi-welcome-mark__ring ${stylex.props(logosStyles.shape, workbenchStyles.piWelcomeMarkRing).className ?? ""}`} cx="80" cy="80" r="67" stroke="currentColor" strokeOpacity="0.32" strokeWidth="1.25" />
      </svg>
    </span>
  )
}

export function GooeyPiMark({ size = 24 }: { size?: number }) {
  return (
    <span className={`gooeypi-mark ${stylex.props(settingsStyles.gooeypiMark).className ?? ""}`} style={{ width: size, height: size }} role="img" aria-label="Apex">
      <img src="/gooeypi-mascot.png" alt="" aria-hidden="true" {...stylex.props(logosStyles.gooeyImage)} />
    </span>
  )
}
