import { useCallback, useMemo, useRef, useState } from 'react'
import { addAnnotation, type BrowserAnnotationInput, createAnnotation, MAX_BROWSER_ANNOTATIONS, reconcileAnnotationsForUrl, removeAnnotation } from '@/lib/browser-annotations'
import type { AgentBrowserTabRecord, BrowserAnnotation } from '@/types/api'

export type BrowserTarget = Pick<AgentBrowserTabRecord, 'tabId' | 'url' | 'title' | 'sessionFile' | 'backend'>

export interface BrowserAnnotationsApi {
  annotations: BrowserAnnotation[]
  target?: BrowserTarget
  setTarget?(target: BrowserTarget): void
  focusSignal?: number
  focusComposer?(): void
  atCapacity: boolean
  /** Returns false when the 20-annotation cap blocks the add. */
  add(input: BrowserAnnotationInput): boolean
  remove(id: string): void
  clear(): void
  /** Marks annotations from other pages stale after a full navigation; returning to a page revives its markers. */
  handleNavigation(url: string): void
  /** Monotonic counter; each bump asks the composer to send the current draft immediately. */
  sendSignal: number
  /** Requests an immediate composer send (used by Ctrl/Cmd+Enter in the annotation popover). */
  requestSend(): void
}

/** Owns the browser annotation set shared by the inspector BrowserPanel (capture, markers) and the Composer (attachment, prompt payload). */
export function useBrowserAnnotations(scopeKey = 'default'): BrowserAnnotationsApi {
  // Returning to a session must not reactivate callbacks from its previous visit.
  const [scope, setScope] = useState({ key: scopeKey })
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const [annotations, setAnnotations] = useState<BrowserAnnotation[]>([])
  const [sendSignal, setSendSignal] = useState(0)
  const [focusSignal, setFocusSignal] = useState(0)
  const [target, setTargetState] = useState<BrowserTarget>()
  const focusComposer = useCallback(() => {
    if (scopeRef.current === scope) setFocusSignal((value) => value + 1)
  }, [scope])
  const setTarget = useCallback((next: BrowserTarget) => {
    if (scopeRef.current !== scope) return
    setTargetState((current) => current?.tabId === next.tabId && current.url === next.url && current.title === next.title && current.sessionFile === next.sessionFile ? current : next)
  }, [scope])
  const requestSend = useCallback(() => {
    if (scopeRef.current === scope) setSendSignal((current) => current + 1)
  }, [scope])
  const annotationsRef = useRef(annotations)
  if (scope.key !== scopeKey) {
    const nextScope = { key: scopeKey }
    scopeRef.current = nextScope
    setScope(nextScope)
    setAnnotations([])
    setSendSignal(0)
    setFocusSignal(0)
    setTargetState(undefined)
    annotationsRef.current = []
  }
  const commit = useCallback((next: BrowserAnnotation[]) => {
    if (scopeRef.current !== scope) return
    annotationsRef.current = next
    setAnnotations(next)
  }, [scope])

  const add = useCallback(
    (input: BrowserAnnotationInput) => {
      if (scopeRef.current !== scope) return false
      const result = addAnnotation(annotationsRef.current, createAnnotation(input, crypto.randomUUID(), Date.now()))
      if (!result.ok) return false
      commit(result.annotations)
      return true
    },
    [commit, scope],
  )
  const remove = useCallback((id: string) => commit(removeAnnotation(annotationsRef.current, id)), [commit])
  const clear = useCallback(() => commit([]), [commit])
  const handleNavigation = useCallback((url: string) => commit(reconcileAnnotationsForUrl(annotationsRef.current, url)), [commit])

  // Stable container identity so memoized consumers (Inspector, Composer) do
  // not re-render while an agent streams; fields update independently.
  return useMemo(() => ({ annotations, target, setTarget, focusSignal, focusComposer, atCapacity: annotations.length >= MAX_BROWSER_ANNOTATIONS, add, remove, clear, handleNavigation, sendSignal, requestSend }), [add, annotations, target, setTarget, focusSignal, focusComposer, clear, handleNavigation, remove, requestSend, sendSignal])
}
