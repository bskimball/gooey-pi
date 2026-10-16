import { useEffect, useState, type RefObject } from 'react'
import { ArrowUp, CircleNotch } from '../icons'
import { isOverlayOpen } from '@/lib/app-shortcuts'
import { shortcutLabel, detectRendererPlatform } from '@/lib/platform-shortcuts'

interface CurrentTurn {
  index: number
  text: string
}

function prompts(scroller: HTMLElement): HTMLElement[] {
  return [...scroller.querySelectorAll<HTMLElement>('.message--user')]
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.querySelector('.reduce-motion') !== null
}

/** Scrolls to the previous or next prompt relative to the top of the viewport. */
function jumpToTurn(scroller: HTMLElement, direction: -1 | 1): void {
  const top = scroller.getBoundingClientRect().top
  const list = prompts(scroller)
  const target = direction < 0
    ? list.filter((prompt) => prompt.getBoundingClientRect().top < top - 4).at(-1)
    // Past the scroll-margin a jump leaves, so a just-reached prompt is not re-selected.
    : list.find((prompt) => prompt.getBoundingClientRect().top > top + 24)
  target?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

/**
 * Keeps the prompt that owns the visible output pinned above a long turn, and lets
 * Primary+Alt+Arrow keys step between prompts the way a terminal's scrollback marks do.
 */
export function TurnNavigator({ scrollRef, active }: { scrollRef: RefObject<HTMLDivElement | null>; active: boolean }) {
  const [current, setCurrent] = useState<CurrentTurn | null>(null)
  const [isLast, setIsLast] = useState(false)

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let frame = 0
    const update = () => {
      frame = 0
      const top = scroller.getBoundingClientRect().top
      const list = prompts(scroller)
      let index = -1
      for (let candidate = 0; candidate < list.length; candidate += 1) {
        // A prompt resting just under the header's height still owns the view.
        if (list[candidate].getBoundingClientRect().top >= top + 40) break
        index = candidate
      }
      const prompt = list[index]
      // The header only stands in for a prompt that has scrolled fully out of view.
      if (!prompt || prompt.getBoundingClientRect().bottom > top + 8) {
        setCurrent(null)
        return
      }
      const text = prompt.querySelector('.user-bubble')?.textContent?.trim() ?? ''
      setIsLast(index === list.length - 1)
      setCurrent((previous) => previous?.index === index && previous.text === text ? previous : { index, text })
    }
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update) }
    // Streaming output grows the turn without scrolling, so content resizes re-evaluate too.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    resize?.observe(scroller.querySelector('.transcript__inner') ?? scroller)
    scroller.addEventListener('scroll', schedule, { passive: true })
    schedule()
    return () => {
      scroller.removeEventListener('scroll', schedule)
      resize?.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [scrollRef])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Overlays and focused widgets that consumed the key keep it, matching the app shortcut contract.
      if (event.defaultPrevented || isOverlayOpen()) return
      const primary = detectRendererPlatform() === 'darwin' ? event.metaKey : event.ctrlKey
      if (!primary || !event.altKey || event.shiftKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      const scroller = scrollRef.current
      if (!scroller || scroller.closest('[inert]')) return
      event.preventDefault()
      jumpToTurn(scroller, event.key === 'ArrowUp' ? -1 : 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [scrollRef])

  if (!current) return null
  const platform = detectRendererPlatform()
  const mac = platform === 'darwin'
  const jumpHint = `${shortcutLabel(platform, ['Primary'])}${mac ? '⌥' : '+Alt+'}↑`
  const running = active && isLast
  return (
    <div className="turn-header" role="navigation" aria-label="Current turn">
      <span className="turn-header__glyph" aria-hidden="true">❯</span>
      <span className="turn-header__prompt" title={current.text}>{current.text}</span>
      {running ? <span className="turn-header__state"><CircleNotch className="spin" size={12} /> running</span> : null}
      <button
        type="button"
        className="turn-header__jump"
        aria-label={`Scroll to this prompt (${jumpHint} for previous)`}
        title={`Scroll to this prompt · ${jumpHint} / ↓ steps between prompts`}
        onClick={() => {
          const prompt = scrollRef.current ? prompts(scrollRef.current)[current.index] : undefined
          prompt?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
        }}
      >
        <ArrowUp size={12} />
      </button>
    </div>
  )
}
