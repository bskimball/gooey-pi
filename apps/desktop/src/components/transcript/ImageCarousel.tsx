import { Carousel } from '@astryxdesign/core/Carousel'
import * as stylex from '@stylexjs/stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { Children, createContext, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useInstantMotion } from '../ContentMotion'
import { CaretRight, X } from '../icons'
import { IconButton, useAppShellOverlay, useFocusTrap } from '../ui'

const styles = stylex.create({
  gallery: { width: 'min(100%, 440px)', minWidth: 0, marginBlock: 10 },
  rail: { width: '100%', borderRadius: 'var(--radius-md)' },
  slide: {
    display: 'grid', width: '100%', minWidth: 0, aspectRatio: '16 / 10',
    placeItems: 'center', overflow: 'hidden', borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--surface-subtle)',
  },
  controls: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 4 },
  button: { minWidth: { default: 32, '@media (pointer: coarse)': 44 }, minHeight: { default: 32, '@media (pointer: coarse)': 44 } },
  disabled: { opacity: .4, cursor: 'default' },
  count: { minWidth: '5ch', textAlign: 'center', fontSize: 'var(--fs-meta)', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' },
  previous: { transform: 'rotate(180deg)' },
  expandedPanel: { flexDirection: 'column', gap: 8 },
  expandedStage: { display: 'grid', placeItems: 'center', maxWidth: '100%', minWidth: 120, minHeight: 80 },
  expandedControls: { paddingInline: 4, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-raised)' },
})

export const ImageSlideContext = createContext<{ expand(): void; expandedTarget: HTMLDivElement | null } | null>(null)

export function ImageLightbox({ children, onClose, onKeyDown }: { children: ReactNode; onClose(): void; onKeyDown?(event: KeyboardEvent<HTMLElement>): void }) {
  const titleId = useId()
  const ref = useFocusTrap<HTMLElement>(true, onClose)
  useAppShellOverlay(true)
  return createPortal(
    <div className={`image-lightbox ${stylex.props(transcriptStyles.imageLightbox).className}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={ref} className={`image-lightbox__panel ${stylex.props(transcriptStyles.imageLightboxPanel, styles.expandedPanel).className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <h2 id={titleId} {...stylex.props(baseStyles.srOnly)}>Expanded image</h2>
        <button type="button" className={`image-lightbox__close ${stylex.props(transcriptStyles.imageLightboxClose).className}`} aria-label="Close expanded image" onClick={onClose}><X size={18} /></button>
        {children}
      </section>
    </div>, document.body)
}

function ImageControls({ index, count, go, expanded = false }: { index: number; count: number; go(index: number): void; expanded?: boolean }) {
  return <div {...stylex.props(styles.controls, expanded && styles.expandedControls)}>
    <IconButton label="Previous image" size="small" aria-disabled={index === 0} xstyle={[styles.button, index === 0 && styles.disabled]} onClick={() => { if (index > 0) go(index - 1) }}><CaretRight {...stylex.props(styles.previous)} size={15} /></IconButton>
    <span {...stylex.props(styles.count)} aria-live="polite" aria-atomic="true">{index + 1} / {count}</span>
    <IconButton label="Next image" size="small" aria-disabled={index === count - 1} xstyle={[styles.button, index === count - 1 && styles.disabled]} onClick={() => { if (index < count - 1) go(index + 1) }}><CaretRight size={15} /></IconButton>
  </div>
}

export function ImageCarousel({ children }: { children: ReactNode[] }) {
  const rail = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(0)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [expandedTarget, setExpandedTarget] = useState<HTMLDivElement | null>(null)
  const instant = useInstantMotion()
  const count = children.length
  const last = count - 1
  if (count < 2) return children[0] ?? null
  const current = Math.min(visible, last)
  const zoomed = expanded === null ? null : Math.min(expanded, last)
  const go = (index: number, focusPreview = false) => {
    const track = rail.current?.querySelector<HTMLElement>('[aria-roledescription="slide"]')?.parentElement
    if (!track || index < 0 || index > last) return
    if (focusPreview) {
      const nextFocus = track.children[index]?.querySelector<HTMLElement>('.image-part__preview') ?? track
      nextFocus.focus({ preventScroll: true })
    }
    track.scrollTo({ left: index * track.clientWidth, behavior: instant || focusPreview ? 'instant' : 'smooth' })
  }
  const arrowKey = (event: KeyboardEvent, index: number, move: (next: number) => void) => {
    if (event.altKey || event.ctrlKey || event.metaKey || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return
    event.preventDefault()
    event.stopPropagation()
    move(Math.max(0, Math.min(last, index + (event.key === 'ArrowRight' ? 1 : -1))))
  }
  return <div className={`chat-image-carousel ${stylex.props(styles.gallery).className}`} dir="ltr">
    <div onKeyDown={(event) => arrowKey(event, current, (index) => go(index, event.target instanceof Element && Boolean(event.target.closest('.image-part__preview'))))} onScrollCapture={(event) => {
      const track = event.target
      if (track instanceof HTMLElement && track.clientWidth && track.firstElementChild?.getAttribute('aria-roledescription') === 'slide') {
        setVisible(Math.round(track.scrollLeft / track.clientWidth))
      }
    }}>
      <Carousel ref={rail} xstyle={styles.rail} aria-label="Chat images" gap={0} hasSnap hasEdgeFade={false} hasButtons={false}>
        {Children.map(children, (child, index) => <div {...stylex.props(styles.slide)}>
          <ImageSlideContext.Provider value={{ expand: () => setExpanded(index), expandedTarget: zoomed === index ? expandedTarget : null }}>
            {child}
          </ImageSlideContext.Provider>
        </div>)}
      </Carousel>
      <ImageControls index={current} count={count} go={go} />
    </div>
    {zoomed !== null && <ImageLightbox onClose={() => setExpanded(null)} onKeyDown={(event) => arrowKey(event, zoomed, setExpanded)}>
      <div className={`chat-image-carousel__expanded ${stylex.props(styles.expandedStage).className}`} ref={setExpandedTarget} />
      <ImageControls index={zoomed} count={count} go={setExpanded} expanded />
    </ImageLightbox>}
  </div>
}
