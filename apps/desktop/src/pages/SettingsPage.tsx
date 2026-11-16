import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex';
import { styles as settingsStyles } from 'apex-ui/styles/settings.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { Banner } from '@astryxdesign/core/Banner'
import { Button as AstryxButton } from '@astryxdesign/core/Button'
import * as stylex from '@stylexjs/stylex'
import { ArrowLeft, CaretRight, Cube, Info, LockKey, PawPrint, Robot, SlidersHorizontal, Sun, Terminal, Waveform } from '@/components/icons'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState, type ComponentType } from 'react'
import { errorMessage } from '@/lib/errors'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { detectRendererPlatform } from '@/lib/platform-shortcuts'
import { ApexButton, BrowserGlobe, Modal } from '@/components/ui'
import type { AppMeta, AppSettings, AppUpdateState, ApexModelCatalog, ApexApi } from '@/types/api'
import { AboutSettings } from './settings/AboutSettings'
import { AgentSettings } from './settings/AgentSettings'
import { AppearanceSettings } from './settings/AppearanceSettings'
import { BrowserSettings } from './settings/BrowserSettings'
import type { SettingsSection, SettingsUpdate } from './settings/contracts'
import { GeneralSettings } from './settings/GeneralSettings'
import { PrivacySettings } from './settings/PrivacySettings'
import { PetsSettings } from './settings/PetsSettings'
import { ProvidersSettings } from './settings/ProviderSettings'
import { TerminalSettings } from './settings/TerminalSettings'
import { VoiceSettings } from './settings/VoiceSettings'

const navStyles = stylex.create({
  itemWrap: {
    position: 'relative',
    width: '100%',
  },
  activePill: {
    position: 'absolute',
    inset: 0,
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--surface-selected)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  item: {
    position: 'relative',
    zIndex: 1,
    width: '100%',
    minHeight: 34,
    height: 34,
    justifyContent: 'flex-start',
    paddingInline: 9,
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-secondary)',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    boxShadow: 'none',
    fontWeight: 500,
    transitionProperty: 'transform, color, background-color',
    transitionDuration: '120ms',
    transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
    ':hover': {
      color: 'var(--text)',
      backgroundColor: 'var(--surface-hover)',
    },
    ':active:not(:disabled)': {
      transform: 'scale(0.98)',
    },
  },
  itemActive: {
    color: 'var(--text)',
    backgroundColor: 'transparent',
    ':hover': {
      color: 'var(--text)',
      backgroundColor: 'transparent',
    },
  },
  itemActiveStatic: {
    color: 'var(--text)',
    backgroundColor: 'var(--surface-selected)',
  },
  close: {
    marginBottom: 12,
  },
})

const sections: Array<{ id: SettingsSection; label: MessageKey; icon: ComponentType<{ size?: number }> }> = [
  { id: 'general', label: 'settings.general', icon: SlidersHorizontal },
  { id: 'appearance', label: 'settings.appearance', icon: Sun },
  { id: 'agent', label: 'settings.harness', icon: Robot },
  { id: 'providers', label: 'settings.providers', icon: Cube },
  { id: 'voice', label: 'settings.voice', icon: Waveform },
  { id: 'pets', label: 'settings.pets', icon: PawPrint },
  { id: 'browser', label: 'settings.browser', icon: BrowserGlobe },
  { id: 'terminal', label: 'settings.terminal', icon: Terminal },
  { id: 'privacy', label: 'settings.privacy', icon: LockKey },
  { id: 'about', label: 'settings.about', icon: Info },
]

interface SettingsPageProps {
  settings: AppSettings
  meta?: AppMeta | null
  providerCatalog: ApexModelCatalog | null
  voice: ApexApi['voice'] | null
  pets: ApexApi['pets'] | null
  updateState: AppUpdateState
  onUpdate: SettingsUpdate
  onClose(): void
  onCheckForUpdates(): Promise<void> | void
  onResetBrowser(): Promise<void> | void
  onOpenDocs(): void
  onRefreshProviders(): Promise<void>
  onRefreshHarnesses(): Promise<void>
  onSetProviderEnabled(providerId: string, enabled: boolean): Promise<void>
  onSetAllProvidersEnabled(): Promise<void>
  onSetAllProvidersDisabled(): Promise<void>
  onSetModelEnabled(modelKey: string, enabled: boolean): Promise<void>
  initialSection?: SettingsSection
  /** Re-applies initialSection for repeated navigation requests to the same section. */
  initialSectionRequestId?: number
}

export function SettingsPage({ settings, meta, providerCatalog, voice, pets, updateState, onCheckForUpdates, onClose, onUpdate, onResetBrowser, onOpenDocs, onRefreshProviders, onRefreshHarnesses, onSetProviderEnabled, onSetAllProvidersEnabled, onSetAllProvidersDisabled, onSetModelEnabled, initialSection = 'general', initialSectionRequestId = 0 }: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState('')
  const { t } = useI18n()
  const platform = meta?.platform ?? detectRendererPlatform()
  const instant = Boolean(useReducedMotion()) || (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) || Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)

  useEffect(() => { setSection(initialSection) }, [initialSection, initialSectionRequestId])

  const resetBrowser = async () => {
    setResetting(true)
    setResetError('')
    try {
      await onResetBrowser()
      setConfirmReset(false)
    } catch (error) {
      setResetError(errorMessage(error))
    } finally {
      setResetting(false)
    }
  }

  const content = (() => {
    switch (section) {
      case 'general': return <GeneralSettings settings={settings} onUpdate={onUpdate} platform={platform} />
      case 'appearance': return <AppearanceSettings settings={settings} onUpdate={onUpdate} />
      case 'agent': return <AgentSettings settings={settings} meta={meta} onUpdate={onUpdate} onRefreshHarnesses={onRefreshHarnesses} />
      case 'providers': return <ProvidersSettings harness={settings.activeHarness} catalog={providerCatalog} onRefresh={onRefreshProviders} onSetEnabled={onSetProviderEnabled} onSetAllEnabled={onSetAllProvidersEnabled} onSetAllDisabled={onSetAllProvidersDisabled} onSetModelEnabled={onSetModelEnabled} onOpenDocs={onOpenDocs} />
      case 'voice': return <VoiceSettings settings={settings} onUpdate={onUpdate} voice={voice} platform={platform} />
      case 'pets': return <PetsSettings settings={settings} onUpdate={onUpdate} pets={pets} />
      case 'browser': return <BrowserSettings settings={settings} onUpdate={onUpdate} onRequestReset={() => { setResetError(''); setConfirmReset(true) }} />
      case 'terminal': return <TerminalSettings settings={settings} onUpdate={onUpdate} platform={platform} />
      case 'privacy': return <PrivacySettings settings={settings} onUpdate={onUpdate} />
      case 'about': return <AboutSettings meta={meta} updateState={updateState} onCheckForUpdates={onCheckForUpdates} onOpenDocs={onOpenDocs} />
    }
  })()

  return (
    <div className={`settings-page ${stylex.props(settingsStyles.settingsPage, [responsiveStyles.settingsPage, responsiveLayoutStyles.settingsPage]).className ?? ""}`}>
      <nav className={`settings-nav ${stylex.props(settingsStyles.settingsNav, [responsiveStyles.settingsNav, responsiveLayoutStyles.settingsNav]).className ?? ""}`} aria-label={t('settings.sections')}>
        <AstryxButton
          label="Back to session"
          variant="ghost"
          size="sm"
          icon={<ArrowLeft size={14} />}
          className="settings-nav__close"
          xstyle={[settingsStyles.settingsNavClose, navStyles.item, navStyles.close, responsiveStyles.settingsNavClose]}
          onClick={onClose}
        >
          <span>Back to session</span>
        </AstryxButton>
        {sections.map((item) => {
          const Icon = item.icon
          const active = section === item.id
          return (
            <div key={item.id} {...stylex.props(navStyles.itemWrap)}>
              {active && !instant ? (
                <motion.span
                  layoutId="settings-active-pill"
                  aria-hidden="true"
                  {...stylex.props(navStyles.activePill)}
                  transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                />
              ) : null}
              <AstryxButton
                label={t(item.label)}
                variant="ghost"
                size="sm"
                icon={<Icon size={14} />}
                endContent={<CaretRight size={12} />}
                className={active ? 'is-active' : ''}
                xstyle={[navStyles.item, active && (instant ? navStyles.itemActiveStatic : navStyles.itemActive)]}
                onClick={() => setSection(item.id)}
              >
                <span>{t(item.label)}</span>
              </AstryxButton>
            </div>
          )
        })}
      </nav>
      <div className={`settings-content scroll-area ${stylex.props(baseStyles.scrollArea, settingsStyles.settingsContent).className ?? ""}`}>
        <div className={`settings-content__inner ${stylex.props(settingsStyles.settingsContentInner, [responsiveStyles.settingsContentInner, responsiveLayoutStyles.settingsContentInner]).className ?? ""}`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={section}
              initial={instant ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={instant ? undefined : { opacity: 0, y: -2 }}
              transition={{ duration: instant ? 0 : 0.15, ease: [0.23, 1, 0.32, 1] }}
            >
              {content}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      {confirmReset ? (
        <Modal
          title="Clear browser data?"
          onClose={() => { if (!resetting) setConfirmReset(false) }}
          footer={(
            <>
              <ApexButton variant="quiet" disabled={resetting} onClick={() => setConfirmReset(false)}>Cancel</ApexButton>
              <ApexButton variant="danger" disabled={resetting} onClick={() => { void resetBrowser() }}>{resetting ? 'Clearing…' : 'Clear browsing data'}</ApexButton>
            </>
          )}
        >
          <p>This signs you out of websites opened in Apex and removes history, cache, cookies, and saved permissions. This cannot be undone.</p>
          {resetError ? <Banner xstyle={[inspectorStyles.settingsError]} status="error" role="alert" className="settings-error" title={resetError} /> : null}
        </Modal>
      ) : null}
    </div>
  )
}
