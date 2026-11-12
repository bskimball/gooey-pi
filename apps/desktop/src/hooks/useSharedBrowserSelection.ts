import { useEffect, useMemo, useState } from 'react'
import { createAnnotation } from '@/lib/browser-annotations'
import type { AgentBrowserTabRecord, BrowserAnnotation, BrowserSourceResult, PromptImage } from '@/types/api'

// Composer remounts on thread switches; delivery state must outlive that instance.
const consumedCaptures = new Map<string, string>()

export function useSharedBrowserSelection(tab: AgentBrowserTabRecord | undefined, cwd: string | undefined) {
  const element = tab?.selection
  const captureKey = tab && element ? JSON.stringify([cwd, tab.sessionFile, tab.tabId, element.captureId ?? [element.selector, element.rect]]) : ''
  const [, setDeliveryRevision] = useState(0)
  const [resolved, setResolved] = useState<{ key: string; source: BrowserSourceResult }>()
  const [capture, setCapture] = useState<{ key: string; preview?: PromptImage; error?: string }>()
  const [clearError, setClearError] = useState<{ key: string; error: string }>()
  const { kind, path, line } = element?.sourceHint ?? {}
  const hint = useMemo(() => kind && path ? { kind, path, ...(line === undefined ? {} : { line }) } : undefined, [kind, path, line])
  const sourceKey = JSON.stringify([cwd, hint])
  const active = Boolean(tab && element && captureKey !== consumedCaptures.get(tab.tabId))
  const captureSelection = typeof window.apex?.browser?.captureSelection === 'function' ? window.apex.browser.captureSelection : undefined
  useEffect(() => {
    const resolveSource = window.apex?.app?.resolveBrowserSource
    if (!hint || !cwd || !resolveSource) return
    let cancelled = false
    void resolveSource(cwd, hint)?.then((source) => { if (!cancelled) setResolved({ key: sourceKey, source }) }, () => {})
    return () => { cancelled = true }
  }, [hint, cwd, sourceKey])
  useEffect(() => {
    if (!active || !tab || !element) return
    setClearError(undefined)
    if (!captureSelection || element.preview) return
    let cancelled = false
    void captureSelection(tab.sessionFile, tab.tabId, tab.url, element.selector)?.then(
      (preview) => { if (!cancelled) setCapture({ key: captureKey, preview }) },
      (err: unknown) => { if (!cancelled) setCapture({ key: captureKey, error: err instanceof Error ? err.message : String(err) }) },
    )
    return () => { cancelled = true }
  }, [active, captureKey, captureSelection, tab?.sessionFile, tab?.tabId, tab?.url, element?.selector, element?.preview])
  const processing = Boolean(active && captureSelection && !element?.preview && capture?.key !== captureKey)
  const preview = element?.preview ?? (capture?.key === captureKey ? capture.preview : undefined)
  const annotation: BrowserAnnotation | undefined = active && !processing && tab && element ? {
    ...createAnnotation({
      comment: '',
      tabId: tab.tabId,
      element, pageUrl: tab.url, pageTitle: tab.title,
      source: resolved?.key === sourceKey ? resolved.source : { kind: 'unknown', reason: 'No workspace-validated source location is available. Locate the owning code using the selector, classes, text, and reported component; do not infer a file path from the component name alone.' },
    }, `shared-${tab.tabId}`, 0),
    ...(preview ? { preview } : {}),
  } : undefined
  return {
    annotation, processing, error: (capture?.key === captureKey && !element?.preview ? capture.error : undefined) ?? (clearError?.key === captureKey ? clearError.error : undefined),
    consume: () => {
      if (!tab) return
      consumedCaptures.set(tab.tabId, captureKey)
      setDeliveryRevision((revision) => revision + 1)
      void window.apex?.browser?.clearSelection?.(tab.sessionFile, tab.tabId, element?.captureId)?.catch(
        (err: unknown) => setClearError({ key: captureKey, error: err instanceof Error ? err.message : String(err) }),
      )
    },
  }
}
