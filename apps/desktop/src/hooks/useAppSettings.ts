import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS } from '@/lib/data'
import { PANEL_SETTING_KEYS, type PanelSettingKey } from '@/lib/settings-state'
import type { AppSettings, InspectorTab, PrimeWorkApi } from '@/types/api'

interface UseAppSettingsOptions {
  bridge: PrimeWorkApi | null
  reportError(error: unknown): void
}

export function useAppSettings({ bridge, reportError }: UseAppSettingsOptions) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [initialized, setInitialized] = useState(!bridge)
  // A panel is either showing its persisted setting or a local-only value (e.g. a compact-layout close)
  // that no save overwrites until that panel itself is persisted or settings are reconciled externally.
  const [panelOverrides, setPanelOverrides] = useState<Partial<Record<PanelSettingKey, boolean>>>({})
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('summary')
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const confirmedSettingsRef = useRef(settings)
  const settingsMutationRef = useRef(0)
  const settingsQueueRef = useRef<Promise<void>>(Promise.resolve())
  const inspectorTabTouchedRef = useRef(false)

  const overridePanel = useCallback((key: PanelSettingKey, value: boolean) => {
    setPanelOverrides((current) => current[key] === value ? current : { ...current, [key]: value })
  }, [])
  const setSidebarOpen = useCallback((value: boolean) => overridePanel('sidebarOpen', value), [overridePanel])
  const setInspectorOpen = useCallback((value: boolean) => overridePanel('inspectorOpen', value), [overridePanel])
  const setTerminalOpen = useCallback((value: boolean) => overridePanel('terminalOpen', value), [overridePanel])

  /** Persisting a panel (or reconciling everything) returns it to its persisted value. */
  const dropOverrides = useCallback((keys: readonly PanelSettingKey[]) => {
    setPanelOverrides((current) => {
      if (!keys.some((key) => key in current)) return current
      const next = { ...current }
      for (const key of keys) delete next[key]
      return next
    })
  }, [])

  const applySettings = useCallback((next: AppSettings) => {
    settingsRef.current = next
    setSettings(next)
  }, [])

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const mutation = ++settingsMutationRef.current
    const previous = settingsRef.current
    dropOverrides(PANEL_SETTING_KEYS.filter((key) => key in patch))
    applySettings({ ...previous, ...patch })
    if (!bridge) {
      confirmedSettingsRef.current = settingsRef.current
      return
    }
    const operation = settingsQueueRef.current.catch(() => undefined).then(async () => {
      const saved = await bridge.settings.update(patch)
      confirmedSettingsRef.current = saved
      if (settingsMutationRef.current === mutation) applySettings(saved)
    })
    settingsQueueRef.current = operation.catch(() => undefined)
    try {
      await operation
    } catch (error) {
      if (settingsMutationRef.current === mutation) applySettings(confirmedSettingsRef.current)
      reportError(error)
    }
  }, [applySettings, bridge, dropOverrides, reportError])

  const reconcileExternalSettings = useCallback(async <T extends { settings: AppSettings }>(
    operation: () => Promise<T | null>,
  ): Promise<T | null> => {
    // Start the external transaction only after locally queued settings have
    // persisted, so its returned snapshot cannot predate them.
    await settingsQueueRef.current
    const revision = settingsMutationRef.current
    const result = await operation()
    if (!result) return null
    confirmedSettingsRef.current = result.settings
    // A new optimistic mutation started while the external operation ran.
    // Keep it visible; its queued result will become the next authority.
    if (settingsMutationRef.current === revision) {
      dropOverrides(PANEL_SETTING_KEYS)
      applySettings(result.settings)
    }
    return result
  }, [applySettings, dropOverrides])

  useEffect(() => {
    if (!bridge) {
      setInitialized(true)
      return
    }
    setInitialized(false)
    let cancelled = false
    const startupRevision = settingsMutationRef.current
    void bridge.settings.get().then((value) => {
      if (cancelled || settingsMutationRef.current !== startupRevision) return
      confirmedSettingsRef.current = value
      dropOverrides(PANEL_SETTING_KEYS)
      applySettings(value)
      if (!inspectorTabTouchedRef.current) setInspectorTab(value.defaultInspectorTab)
    }).catch((error) => { if (!cancelled) reportError(error) }).finally(() => {
      if (!cancelled) setInitialized(true)
    })
    return () => { cancelled = true }
  }, [applySettings, bridge, dropOverrides, reportError])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = (theme: 'light' | 'dark') => {
      document.documentElement.dataset.theme = theme
      void bridge?.app?.setTitleBarTheme?.(theme)?.catch(() => undefined)
    }
    applyTheme(settings.theme === 'system' ? media.matches ? 'dark' : 'light' : settings.theme)
    document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion)
    const sync = () => {
      if (settings.theme === 'system') applyTheme(media.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [bridge, settings.reduceMotion, settings.theme])

  const selectInspectorTab = useCallback((tab: InspectorTab) => {
    inspectorTabTouchedRef.current = true
    setInspectorTab(tab)
  }, [])

  const sidebarOpen = panelOverrides.sidebarOpen ?? settings.sidebarOpen
  const inspectorOpen = panelOverrides.inspectorOpen ?? settings.inspectorOpen
  const terminalOpen = panelOverrides.terminalOpen ?? settings.terminalOpen

  return {
    settings,
    initialized,
    sidebarOpen,
    setSidebarOpen,
    inspectorOpen,
    setInspectorOpen,
    terminalOpen,
    setTerminalOpen,
    inspectorTab,
    selectInspectorTab,
    updateSettings,
    reconcileExternalSettings,
  }
}
