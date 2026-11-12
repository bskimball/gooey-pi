export interface PanelSettings {
  sidebarOpen: boolean
  inspectorOpen: boolean
  terminalOpen: boolean
}

export type PanelSettingKey = keyof PanelSettings

export const PANEL_SETTING_KEYS: PanelSettingKey[] = ['sidebarOpen', 'inspectorOpen', 'terminalOpen']
