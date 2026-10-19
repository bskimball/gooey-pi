import { CaretDown, Check, GlobeSimple, X } from './icons'
import { Children, isValidElement, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, type SelectHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'small' | 'regular'
}

export function IconButton({ label, size = 'regular', className = '', children, ...props }: IconButtonProps) {
  return (
    <button type="button" className={`icon-button icon-button--${size} ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  )
}

export function BrowserGlobe({ size = 18 }: { size?: number }) {
  return <GlobeSimple className="browser-globe" size={size} />
}

interface SelectControlProps extends SelectHTMLAttributes<HTMLSelectElement> {
  icon?: ReactNode
  compact?: boolean
  label: string
}

export function SelectControl({ icon, compact, className = '', label, value, disabled, onChange, children }: SelectControlProps) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const pendingFocusIndexRef = useRef<number | null>(null)
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; title?: string; children?: ReactNode }>(child)) return []
    const optionValue = String(child.props.value ?? '')
    const optionLabel = typeof child.props.children === 'string' || typeof child.props.children === 'number'
      ? String(child.props.children)
      : optionValue
    return [{ value: optionValue, label: optionLabel, detail: child.props.title, disabled: Boolean(child.props.disabled) }]
  })
  const selectedValue = String(value ?? options[0]?.value ?? '')
  const selectedOption = options.find((option) => option.value === selectedValue) ?? options[0]

  const updateMenuBounds = () => {
    const root = rootRef.current
    const menu = menuRef.current
    if (!root || !menu) return
    const rootRect = root.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (!vw || !vh || (rootRect.width === 0 && rootRect.height === 0)) return
    const paneRect = root.closest('.conversation-pane')?.getBoundingClientRect()
    const hasPaneBounds = Boolean(paneRect && (paneRect.width > 0 || paneRect.height > 0))
    const leftBound = hasPaneBounds ? Math.max(16, paneRect!.left + 12) : 16
    const rightBound = hasPaneBounds ? Math.min(vw - 16, paneRect!.right - 12) : vw - 16
    const topBound = hasPaneBounds ? Math.max(16, paneRect!.top + 12) : 16
    const availableWidth = Math.max(180, Math.floor(rightBound - leftBound))
    const menuWidth = Math.min(320, availableWidth)
    let offsetLeft = 0
    if (rootRect.left + menuWidth > rightBound) {
      offsetLeft = Math.floor(rightBound - (rootRect.left + menuWidth))
    }
    if (rootRect.left + offsetLeft < leftBound) {
      offsetLeft = Math.ceil(leftBound - rootRect.left)
    }
    const availableAbove = Math.max(0, Math.floor(rootRect.top - 7 - topBound))
    menu.style.setProperty('--select-menu-width', `${menuWidth}px`)
    menu.style.setProperty('--select-menu-left', `${offsetLeft}px`)
    menu.style.setProperty('--select-menu-max-height', `${availableAbove}px`)
  }

  const close = (restoreFocus = false) => {
    pendingFocusIndexRef.current = null
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const selectOption = (nextValue: string) => {
    close(true)
    onChange?.({ target: { value: nextValue }, currentTarget: { value: nextValue } } as ChangeEvent<HTMLSelectElement>)
  }

  const applyFocusToOption = (targetIndex: number) => {
    const items = rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')
    if (!items?.length) return
    const bounded = ((targetIndex % items.length) + items.length) % items.length
    const target = items[bounded]
    target?.focus()
    target?.scrollIntoView?.({ block: 'nearest' })
  }

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) return
    updateMenuBounds()
    if (pendingFocusIndexRef.current !== null) {
      const targetIndex = pendingFocusIndexRef.current
      pendingFocusIndexRef.current = null
      applyFocusToOption(targetIndex)
    } else {
      rootRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onEscape)
    window.addEventListener('resize', updateMenuBounds)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onEscape)
      window.removeEventListener('resize', updateMenuBounds)
    }
  }, [open])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      if (!open) {
        setOpen(true)
        return
      }
      const items = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])]
      const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement)
      const enabledOptions = options.filter((option) => !option.disabled)
      if (activeIndex >= 0 && enabledOptions[activeIndex]) {
        selectOption(enabledOptions[activeIndex].value)
      } else {
        close(true)
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      const enabledOptions = options.filter((option) => !option.disabled)
      if (!enabledOptions.length) return
      if (!open) {
        const currentIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === selectedValue))
        const initialIndex = event.key === 'Home' ? 0 : event.key === 'End' ? enabledOptions.length - 1 : currentIndex
        pendingFocusIndexRef.current = initialIndex
        setOpen(true)
        return
      }
      const items = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])]
      const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement)
      const currentIndex = activeIndex >= 0 ? activeIndex : Math.max(0, enabledOptions.findIndex((option) => option.value === selectedValue))
      if (event.key === 'Home') applyFocusToOption(0)
      else if (event.key === 'End') applyFocusToOption(items.length - 1)
      else applyFocusToOption(currentIndex + (event.key === 'ArrowDown' ? 1 : -1))
    }
  }

  return (
    <div
      ref={rootRef}
      className={`select-control ${compact ? 'select-control--compact' : ''} ${className}`}
      title={label}
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement | null
        if (!target?.closest('.select-control__menu') && !target?.closest('.select-control__trigger')) {
          event.preventDefault()
        }
      }}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
      onClick={(event) => {
        if (disabled) return
        const target = event.target as HTMLElement | null
        if (target?.closest('.select-control__menu') || target?.closest('.select-control__trigger')) return
        triggerRef.current?.focus()
        setOpen((current) => !current)
      }}
    >
      {icon ? <span className="select-control__icon" aria-hidden="true">{icon}</span> : null}
      <span className="sr-only">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className="select-control__trigger"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {selectedOption?.label ?? selectedValue}
      </button>
      <CaretDown className="select-control__chevron" size={11} aria-hidden="true" />
      {open && !disabled ? (
        <div
          ref={(node) => {
            menuRef.current = node
            if (node) updateMenuBounds()
          }}
          className="worktree-picker__menu select-control__menu"
          id={menuId}
          role="listbox"
          aria-label={label}
        >
          <div className="worktree-picker__heading">{label}</div>
          <div className="worktree-picker__options">
            {options.map((option) => {
              const selected = option.value === selectedValue
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  className={`worktree-picker__option ${selected ? 'is-active' : ''}`}
                  key={option.value}
                  onClick={() => selectOption(option.value)}
                >
                  <span className="worktree-picker__check">{selected ? <Check size={13} /> : null}</span>
                  <span className="worktree-picker__option-copy">
                    <strong>{option.label}</strong>
                    {option.detail ? <span>{option.detail}</span> : null}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange(value: T): void
  label: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? 'is-active' : ''}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-state__icon">{icon}</div> : null}
      <h2>{title}</h2>
      <p>{children}</p>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  )
}

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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

export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose(): void; footer?: ReactNode }) {
  const titleId = useId()
  const modalRef = useFocusTrap<HTMLElement>(true, onClose)
  useAppShellOverlay(true)
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal__header"><h2 id={titleId}>{title}</h2><IconButton label="Close" onClick={onClose}><X size={16} /></IconButton></div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </section>
    </div>, document.body
  )
}

export function PiMark({ size = 24 }: { size?: number }) {
  // Option 2 ("The Apex Fang"): a razor-edged shark-tooth "A" silhouette with
  // a rolling wave-trough crossbar and under-crest accent.
  return (
    <span className="pi-mark" style={{ width: size, height: size }} role="img" aria-label="Pi">
      <svg viewBox="0 0 100 100" fill="none" focusable="false" aria-hidden="true">
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
    <span className="pi-welcome-mark" style={{ width: size, height: size }} role="img" aria-label="Apex wave crest">
      <svg viewBox="0 0 160 160" fill="none" focusable="false" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <circle cx="80" cy="80" r="67" />
          </clipPath>
        </defs>
        <circle cx="80" cy="80" r="74" fill="#0b1119" />
        <g clipPath={`url(#${clipId})`}>
          {/* Distant moon / sun disc in upper-left sky */}
          <circle cx="50" cy="48" r="13" fill="#38bdf8" fillOpacity="0.14" />
          <circle cx="50" cy="48" r="9.5" stroke="#7dd3fc" strokeOpacity="0.45" strokeWidth="1.5" />

          {/* Swept shark dorsal fin slicing through the center */}
          <path
            d="M42 106 C45 68 63 38 99 20 C90 42 87 63 95 83 L86 87 L96 104 Z"
            fill="currentColor"
          />
          {/* Woodblock inner bevel and gill-slit hatches on the dorsal fin */}
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

          {/* Left Seigaiha concentric wave mound */}
          <circle cx="34" cy="118" r="42" fill="#0b1119" />
          <circle cx="34" cy="118" r="42" stroke="currentColor" strokeWidth="2.6" />
          <circle cx="34" cy="118" r="33" stroke="#7dd3fc" strokeOpacity="0.85" strokeWidth="2" />
          <circle cx="34" cy="118" r="24" stroke="#38bdf8" strokeOpacity="0.7" strokeWidth="1.8" />
          <circle cx="34" cy="118" r="15" stroke="#38bdf8" strokeOpacity="0.5" strokeWidth="1.6" />

          {/* Right Seigaiha concentric wave mound */}
          <circle cx="126" cy="118" r="42" fill="#0b1119" />
          <circle cx="126" cy="118" r="42" stroke="currentColor" strokeWidth="2.6" />
          <circle cx="126" cy="118" r="33" stroke="#7dd3fc" strokeOpacity="0.85" strokeWidth="2" />
          <circle cx="126" cy="118" r="24" stroke="#38bdf8" strokeOpacity="0.7" strokeWidth="1.8" />
          <circle cx="126" cy="118" r="15" stroke="#38bdf8" strokeOpacity="0.5" strokeWidth="1.6" />

          {/* Foreground center Seigaiha wave crest */}
          <circle cx="80" cy="136" r="46" fill="#0b1119" />
          <circle cx="80" cy="136" r="46" stroke="currentColor" strokeWidth="3" />
          <circle cx="80" cy="136" r="37" stroke="#7dd3fc" strokeOpacity="0.9" strokeWidth="2.2" />
          <circle cx="80" cy="136" r="28" stroke="#38bdf8" strokeOpacity="0.75" strokeWidth="2" />
          <circle cx="80" cy="136" r="19" stroke="#38bdf8" strokeOpacity="0.6" strokeWidth="1.8" />
          <circle cx="80" cy="136" r="10" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.6" />

          {/* Ukiyo-e spray droplets around the fin */}
          <circle cx="105" cy="54" r="2.2" fill="currentColor" />
          <circle cx="111" cy="62" r="1.6" fill="#7dd3fc" />
          <circle cx="36" cy="70" r="1.8" fill="#7dd3fc" />
        </g>
        {/* Kamon outer and inner crest rings */}
        <circle cx="80" cy="80" r="73" stroke="currentColor" strokeWidth="3.5" />
        <circle cx="80" cy="80" r="67" stroke="currentColor" strokeOpacity="0.32" strokeWidth="1.25" />
      </svg>
    </span>
  )
}

export function GooeyPiMark({ size = 24 }: { size?: number }) {
  return (
    <span className="gooeypi-mark" style={{ width: size, height: size }} role="img" aria-label="GooeyPi">
      <img src="/gooeypi-mascot.png" alt="" aria-hidden="true" />
    </span>
  )
}
