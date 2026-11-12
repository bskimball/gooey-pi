import { useCallback, useEffect, useRef, useState } from 'react'
import { initialTransition, transition } from 'xstate'
import type { InspectorTab, WorkspaceView } from '@/types/api'
import { inspectorRestoreMachine } from './inspectorRestoreMachine'

export const INSPECTOR_MIN = 340
export const INSPECTOR_DEFAULT = 410
export const CHAT_MIN = 360
export const TERMINAL_MIN = 170
export const TERMINAL_DEFAULT = 310
export const WORKSPACE_ROW_MIN = 220
export const SMALLEST_LAYOUT_BREAKPOINT = 720
export const INSPECTOR_INITIAL_RATIO = 0.44

const readSavedPanelSize = (key: string): number | null => {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(key)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

const readPanelSize = (key: string, fallback: number) => readSavedPanelSize(key) ?? fallback

export const getInitialInspectorWidth = (rowWidth: number, maxWidth: number) => {
  if (rowWidth <= 0) return Math.min(maxWidth, Math.max(INSPECTOR_MIN, INSPECTOR_DEFAULT))
  const proportional = Math.min(INSPECTOR_DEFAULT, Math.round(rowWidth * INSPECTOR_INITIAL_RATIO))
  return Math.min(maxWidth, Math.max(INSPECTOR_MIN, proportional))
}

interface UsePanelLayoutOptions {
  sidebarOpen: boolean
  setSidebarOpen(value: boolean): void
  inspectorOpen: boolean
  inspectorTab?: InspectorTab
  setInspectorOpen(value: boolean): void
  closeSmallestPanels(patch: { sidebarOpen?: false; inspectorOpen?: false }): void
  terminalOpen: boolean
  view: WorkspaceView
}

export function usePanelLayout({
  sidebarOpen,
  setSidebarOpen,
  inspectorOpen,
  inspectorTab,
  setInspectorOpen,
  closeSmallestPanels,
  terminalOpen,
  view,
}: UsePanelLayoutOptions) {
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia('(max-width: 980px)').matches)
  const [smallestLayout, setSmallestLayout] = useState(() => window.matchMedia(`(max-width: ${SMALLEST_LAYOUT_BREAKPOINT}px)`).matches)
  const [smallestSidebarAllowed, setSmallestSidebarAllowed] = useState(false)
  const [smallestInspectorAllowed, setSmallestInspectorAllowed] = useState(false)
  const savedInspectorWidthRef = useRef(readSavedPanelSize('prime-work.inspector-width') !== null)
  const [inspectorWidth, setInspectorWidth] = useState(() => readPanelSize('prime-work.inspector-width', INSPECTOR_DEFAULT))
  const savedBrowserWidthRef = useRef(readSavedPanelSize('prime-work.browser-width') !== null)
  const [browserWidth, setBrowserWidth] = useState(() => readPanelSize('prime-work.browser-width', INSPECTOR_DEFAULT))
  const [inspectorExpanded, setInspectorExpanded] = useState(false)
  const browserSelected = inspectorTab === 'browser'
  const changeInspectorWidth = useCallback((width: number) => {
    setInspectorExpanded(false)
    if (browserSelected) setBrowserWidth(width)
    else setInspectorWidth(width)
  }, [browserSelected])
  const toggleInspectorExpanded = useCallback(() => {
    if (!inspectorExpanded && browserSelected && !compactLayout) setSidebarOpen(false)
    setInspectorExpanded((value) => !value)
  }, [browserSelected, compactLayout, inspectorExpanded, setSidebarOpen])
  const [terminalHeight, setTerminalHeight] = useState(() => readPanelSize('prime-work.terminal-height', TERMINAL_DEFAULT))
  const [inspectorMax, setInspectorMax] = useState(660)
  const [terminalMax, setTerminalMax] = useState(520)
  const workspaceRowRef = useRef<HTMLDivElement>(null)
  const sessionWorkspaceRef = useRef<HTMLDivElement>(null)
  // Mirrors the restore machine for useWorkspaceActions, which clears it on explicit toggles.
  const compactRestoreRef = useRef<'inspector' | null>(null)
  const restoreSnapshotRef = useRef(initialTransition(inspectorRestoreMachine)[0])
  const sidebarSuppressed = smallestLayout && sidebarOpen && !smallestSidebarAllowed
  const inspectorSuppressed = smallestLayout && inspectorOpen && !smallestInspectorAllowed
  const visibleSidebarOpen = sidebarOpen && !sidebarSuppressed
  const visibleInspectorOpen = inspectorOpen && !inspectorSuppressed

  useEffect(() => {
    const sync = () => {
      const smallestLayout = window.innerWidth <= SMALLEST_LAYOUT_BREAKPOINT
      setCompactLayout(window.innerWidth <= 980)
      setSmallestLayout(smallestLayout)
      if (smallestLayout) {
        setSmallestSidebarAllowed(false)
        setSmallestInspectorAllowed(false)
      }
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  useEffect(() => {
    if (!smallestLayout) return
    const patch: { sidebarOpen?: false; inspectorOpen?: false } = {}
    if (sidebarSuppressed) patch.sidebarOpen = false
    if (inspectorSuppressed) patch.inspectorOpen = false
    if (patch.sidebarOpen === false || patch.inspectorOpen === false) closeSmallestPanels(patch)
  }, [closeSmallestPanels, inspectorSuppressed, sidebarSuppressed, smallestLayout])

  useEffect(() => {
    const sendRestore = (event: { type: 'HIDE' | 'CLEAR' }) => {
      restoreSnapshotRef.current = transition(inspectorRestoreMachine, restoreSnapshotRef.current, event)[0]
      compactRestoreRef.current = restoreSnapshotRef.current.matches('compactHidden') ? 'inspector' : null
    }
    // An external clear (toggle) or a user reopen while hidden both end the pending restore.
    if (compactRestoreRef.current === null || inspectorOpen) sendRestore({ type: 'CLEAR' })
    if (compactLayout && visibleSidebarOpen && visibleInspectorOpen) {
      sendRestore({ type: 'HIDE' })
      setInspectorOpen(false)
    } else if (!compactLayout && restoreSnapshotRef.current.matches('compactHidden') && visibleSidebarOpen && !visibleInspectorOpen) {
      sendRestore({ type: 'CLEAR' })
      setInspectorOpen(true)
    }
  }, [compactLayout, inspectorOpen, setInspectorOpen, visibleInspectorOpen, visibleSidebarOpen])

  useEffect(() => {
    if (!compactLayout || !visibleInspectorOpen) return
    // The title toolbar stays live so the toggle that opened the drawer can also close it.
    const targets = [...document.querySelectorAll<HTMLElement>('.conversation-pane, .terminal-drawer, .session-workspace > .resize-handle')]
    for (const target of targets) target.inert = true
    return () => { for (const target of targets) target.inert = false }
  }, [compactLayout, terminalOpen, visibleInspectorOpen])

  useEffect(() => {
    const row = workspaceRowRef.current
    const workspace = sessionWorkspaceRef.current
    if (!row || !workspace) return
    const syncBounds = () => {
      if (!window.matchMedia('(max-width: 980px)').matches) {
        const nextMax = Math.max(INSPECTOR_MIN, row.clientWidth - CHAT_MIN)
        setInspectorMax(nextMax)
        if (!savedBrowserWidthRef.current && row.clientWidth > 0) {
          savedBrowserWidthRef.current = true
          setBrowserWidth(Math.min(nextMax, Math.max(INSPECTOR_MIN, Math.round(row.clientWidth / 2))))
        }
        if (!savedInspectorWidthRef.current && row.clientWidth > 0) {
          savedInspectorWidthRef.current = true
          setInspectorWidth(getInitialInspectorWidth(row.clientWidth, nextMax))
        }
      }
      setTerminalMax(Math.max(TERMINAL_MIN, workspace.clientHeight - WORKSPACE_ROW_MIN))
    }
    syncBounds()
    const observer = new ResizeObserver(syncBounds)
    observer.observe(row)
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [inspectorOpen, terminalOpen, view])

  useEffect(() => {
    setInspectorWidth((value) => Math.min(inspectorMax, Math.max(INSPECTOR_MIN, value)))
    setBrowserWidth((value) => Math.min(inspectorMax, Math.max(INSPECTOR_MIN, value)))
  }, [inspectorMax])
  useEffect(() => setTerminalHeight((value) => Math.min(terminalMax, Math.max(TERMINAL_MIN, value))), [terminalMax])
  useEffect(() => { window.localStorage.setItem('prime-work.inspector-width', String(inspectorWidth)) }, [inspectorWidth])
  useEffect(() => { window.localStorage.setItem('prime-work.browser-width', String(browserWidth)) }, [browserWidth])
  useEffect(() => { window.localStorage.setItem('prime-work.terminal-height', String(terminalHeight)) }, [terminalHeight])

  const selectedInspectorWidth = browserSelected ? browserWidth : inspectorWidth
  return {
    compactLayout,
    sidebarSuppressed,
    inspectorSuppressed,
    setSmallestSidebarAllowed,
    setSmallestInspectorAllowed,
    compactRestoreRef,
    inspectorWidth: inspectorExpanded ? inspectorMax : selectedInspectorWidth,
    setInspectorWidth: changeInspectorWidth,
    inspectorDefaultWidth: browserSelected ? Math.max(INSPECTOR_MIN, Math.round((workspaceRowRef.current?.clientWidth ?? 820) / 2)) : INSPECTOR_DEFAULT,
    inspectorExpanded,
    toggleInspectorExpanded,
    terminalHeight,
    setTerminalHeight,
    inspectorMax,
    terminalMax,
    workspaceRowRef,
    sessionWorkspaceRef,
  }
}
