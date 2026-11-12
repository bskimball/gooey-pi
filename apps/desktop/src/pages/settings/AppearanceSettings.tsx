import { Button as AstryxButton } from '@astryxdesign/core/Button'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Check, Laptop, Moon, Sun } from '@/components/icons'
import { useRef, type KeyboardEvent } from 'react'
import { useI18n, type MessageKey } from '@/lib/i18n'
import type { InterfaceFontScale, LocalePreference, ThemeMode } from '@/types/api'
import type { SettingsSectionProps } from './contracts'
import { SettingsToggle } from './SettingsToggle'

const themes: Array<{ id: ThemeMode; label: MessageKey; icon: typeof Sun }> = [
  { id: 'system', label: 'appearance.theme.system', icon: Laptop },
  { id: 'light', label: 'appearance.theme.light', icon: Sun },
  { id: 'dark', label: 'appearance.theme.dark', icon: Moon },
]

const fontScales: Array<{ value: InterfaceFontScale; label: MessageKey }> = [
  { value: 105, label: 'appearance.text.smaller' },
  { value: 110, label: 'appearance.text.default' },
  { value: 115, label: 'appearance.text.larger' },
]

const locales: Array<{ value: LocalePreference; label: MessageKey }> = [
  { value: 'system', label: 'appearance.language.system' },
  { value: 'en', label: 'appearance.language.english' },
  { value: 'zh-CN', label: 'appearance.language.chinese' },
]

function nextScaleIndex(key: string, current: number, count: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % count
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

export function AppearanceSettings({ settings, onUpdate }: SettingsSectionProps) {
  const { t } = useI18n()
  const keyDrivenRef = useRef(false)
  const selectedScale = Math.max(0, fontScales.findIndex((option) => option.value === settings.interfaceFontScale))
  const onScaleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextScaleIndex(event.key, selectedScale, fontScales.length)
    if (next === null) return
    event.preventDefault()
    const target = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]
    keyDrivenRef.current = true
    target?.focus()
    keyDrivenRef.current = false
    void onUpdate({ interfaceFontScale: fontScales[next].value })
  }
  return (
    <>
      <header><h1>{t('appearance.title')}</h1><p>{t('appearance.description')}</p></header>
      <section className="settings-group">
        <h2>{t('appearance.theme.title')}</h2>
        <div className="theme-options">
          {themes.map((item) => {
            const Icon = item.icon
            const active = settings.theme === item.id
            return (
              <AstryxButton
                key={item.id}
                label={t(item.label)}
                variant="ghost"
                aria-pressed={active}
                className={active ? 'is-active' : ''}
                onClick={() => { void onUpdate({ theme: item.id }) }}
              >
                <span><Icon size={17} /></span><strong>{t(item.label)}</strong>{active ? <Check size={13} /> : null}
              </AstryxButton>
            )
          })}
        </div>
      </section>
      <section className="settings-group">
        <h2>{t('appearance.language.title')}</h2>
        <label className="settings-row">
          <span><strong>{t('appearance.language.label')}</strong><small>{t('appearance.language.description')} {t('appearance.language.available', { count: locales.length - 1 })}</small></span>
          <select value={settings.locale} onChange={(event) => { void onUpdate({ locale: event.target.value as LocalePreference }) }}>
            {locales.map((locale) => <option key={locale.value} value={locale.value}>{t(locale.label)}</option>)}
          </select>
        </label>
      </section>
      <section className="settings-group">
        <h2>{t('appearance.text.title')}</h2>
        <div className="settings-row settings-row--text-size">
          <span><strong>{t('appearance.text.label')}</strong><small>{t('appearance.text.description')}</small></span>
          <SegmentedControl
            label={t('appearance.text.aria')}
            size="sm"
            value={String(settings.interfaceFontScale)}
            onChange={(next) => {
              if (keyDrivenRef.current) return
              const parsed = Number(next) as InterfaceFontScale
              if (fontScales.some((option) => option.value === parsed)) void onUpdate({ interfaceFontScale: parsed })
            }}
            onKeyDown={onScaleKeyDown}
            className="text-size-options"
          >
            {fontScales.map((option) => (
              <SegmentedControlItem
                key={option.value}
                value={String(option.value)}
                label={t(option.label)}
                className={settings.interfaceFontScale === option.value ? 'is-active' : ''}
              />
            ))}
          </SegmentedControl>
        </div>
      </section>
      <section className="settings-group">
        <h2>{t('appearance.motion.title')}</h2>
        <SettingsToggle checked={settings.reduceMotion} onChange={(reduceMotion) => { void onUpdate({ reduceMotion }) }} label={t('appearance.motion.reduce')} description={t('appearance.motion.description')} />
      </section>
    </>
  )
}
