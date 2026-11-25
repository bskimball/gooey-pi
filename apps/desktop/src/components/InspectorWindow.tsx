import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import type { ApexApi } from '@/types/api'
import { ArrowSquareOut, SidebarRight } from './icons'
import { IconButton, ModalContainerContext } from './ui'

function mirrorAppearance(popup: Window) {
  const doc = popup.document
  doc.body.style.setProperty('--inspector-width', '100vw')
  const syncTheme = () => {
    for (const name of ['class', 'lang', 'dir', 'style', 'data-theme', 'data-astryx-theme']) {
      const value = document.documentElement.getAttribute(name)
      if (value === null) doc.documentElement.removeAttribute(name)
      else doc.documentElement.setAttribute(name, value)
    }
  }
  const syncStyles = () => {
    const copies = Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'), (source) => {
      const copy = doc.importNode(source, true)
      if (source instanceof HTMLLinkElement) copy.setAttribute('href', source.href)
      return copy
    })
    doc.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => node.remove())
    doc.head.append(...copies)
  }
  syncTheme()
  syncStyles()
  const theme = new MutationObserver(syncTheme)
  theme.observe(document.documentElement, { attributes: true })
  const styles = new MutationObserver(syncStyles)
  styles.observe(document.head, { childList: true, subtree: true, characterData: true })
  return () => { theme.disconnect(); styles.disconnect() }
}

export function useInspectorWindow(app: ApexApi['app'] | undefined, title: string | null, onDock: () => void, reportError: (error: unknown) => void) {
  const [popup, setPopup] = useState<Window | null>(null)
  const current = useRef<Window | null>(null)
  const opening = useRef(false)
  const active = useRef(title !== null)
  useLayoutEffect(() => {
    active.current = title !== null
    if (popup && !popup.closed) {
      if (title) popup.document.title = title
      else popup.close()
    }
    return () => { active.current = false }
  }, [popup, title])
  useEffect(() => () => { current.current?.close() }, [])

  const toggle = useCallback(async () => {
    if (current.current && !current.current.closed) { current.current.close(); return }
    if (!app || opening.current) return
    opening.current = true
    let child: Window | null = null
    try {
      const name = await app.prepareInspectorWindow()
      if (!active.current) return
      child = window.open('about:blank', name)
      if (!child) throw new Error('The inspector window could not be opened.')
      const cleanup = mirrorAppearance(child)
      current.current = child
      child.addEventListener('pagehide', () => {
        cleanup()
        current.current = null
        // Chromium discards listeners owned by the closing document after pagehide.
        // Move the live panel back while both documents are still available.
        flushSync(() => {
          if (active.current) onDock()
          setPopup(null)
        })
      }, { once: true })
      setPopup(child)
    } catch (error) {
      child?.close()
      reportError(error)
    } finally {
      opening.current = false
    }
  }, [app, onDock, reportError])
  return useMemo(() => ({ popup, toggle: app?.prepareInspectorWindow ? toggle : undefined }), [app, popup, toggle])
}

export const InspectorWindowContext = createContext<ReturnType<typeof useInspectorWindow>>({ popup: null, toggle: undefined })

export function InspectorWindowButton() {
  const { popup, toggle } = useContext(InspectorWindowContext)
  if (!toggle) return null
  return <IconButton xstyle={inspectorStyles.inspectorHeaderButton} label={popup ? 'Dock inspector' : 'Detach inspector'} onClick={toggle}>
    {popup ? <SidebarRight size={16} /> : <ArrowSquareOut size={16} />}
  </IconButton>
}

/** Keep the portal target stable so a window move preserves panel drafts, selection and scroll. */
export function InspectorWindowMount({ children }: { children: ReactNode }) {
  const { popup } = useContext(InspectorWindowContext)
  const dock = useRef<HTMLDivElement>(null)
  const [host] = useState(() => document.createElement('div'))
  useLayoutEffect(() => {
    const target = popup && !popup.closed ? popup.document.body : dock.current
    host.style.display = 'contents'
    target?.append(host)
    return () => host.remove()
  }, [host, popup])
  return <><div ref={dock} style={{ display: 'contents' }} />{createPortal(
    <ModalContainerContext value={popup && !popup.closed ? popup.document.body : null}>{children}</ModalContainerContext>, host,
  )}</>
}
