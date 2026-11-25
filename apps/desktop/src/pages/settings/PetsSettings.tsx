import * as stylex from '@stylexjs/stylex'
import { styles as petContext } from 'apex-ui/styles/pets-context.stylex'
import { styles as petsStyles } from 'apex-ui/styles/pets.stylex'
import { styles as settingsStyles } from 'apex-ui/styles/settings.stylex'
import { styles as activityStyles } from 'apex-ui/styles/activity.stylex'
import { styles as overlaysStyles } from 'apex-ui/styles/overlays.stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { Banner } from '@astryxdesign/core/Banner'
import { ArrowsClockwise, PawPrint } from '@/components/icons'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { PetAvatar } from '@/components/PetAvatar'
import { ApexButton } from '@/components/ui'
import type { PetDefinition, ApexApi } from '@/types/api'
import type { SettingsSectionProps } from './contracts'
import { SettingsToggle } from './SettingsToggle'

const BUILT_INS: PetDefinition[] = [
  { id: 'orb', petId: 'orb', displayName: 'Orb', description: 'A fluid voice orb that shifts with Apex activity.', source: 'built-in', kind: 'orb' },
  { id: 'gooey-pi', petId: 'gooey-pi', displayName: 'Apex', description: 'A friendly purple jelly pet shaped like the mathematical pi symbol.', source: 'built-in', kind: 'spritesheet' },
]

export function PetsSettings({ settings, onUpdate, pets }: SettingsSectionProps & { pets: ApexApi['pets'] | null }) {
  const [available, setAvailable] = useState<PetDefinition[]>(BUILT_INS)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const refresh = useCallback(async () => {
    if (!pets) return
    setLoading(true)
    setLoadError('')
    try {
      const items = await pets.list()
      setAvailable(items.length ? items : BUILT_INS)
    } catch {
      setLoadError('Codex pets could not be refreshed. The built-in pets are still available.')
      setAvailable(BUILT_INS)
    } finally { setLoading(false) }
  }, [pets])
  useEffect(() => { void refresh() }, [refresh])
  const selected = useMemo(() => available.find((item) => item.id === settings.petId) ?? available.find((item) => item.id === 'orb') ?? BUILT_INS[0], [available, settings.petId])
  const codexCount = available.filter((item) => item.source === 'codex').length

  return (
    <>
      <header><h1>Pets</h1><p>Choose a companion that reacts while Pi works.</p></header>
      <section className={`pet-hero ${stylex.props(petsStyles.petHero).className ?? ""}`}>
        <div className={`pet-hero__stage ${stylex.props(petsStyles.petHeroStage).className ?? ""}`}><PetAvatar pet={selected} pets={pets} activity="speaking" size={Math.round(96 * settings.petSize / 100)} reduceMotion={settings.reduceMotion} /></div>
        <div><h2 {...stylex.props(petContext.heroHeading)}>{selected.displayName}</h2><p {...stylex.props(petContext.heroDescription)}>{selected.description}</p></div>
      </section>
      <section className={`settings-group ${stylex.props(settingsStyles.settingsGroup).className ?? ""}`}>
        <h2>Companion</h2>
        <SettingsToggle checked={settings.petEnabled} onChange={(petEnabled) => { void onUpdate({ petEnabled }) }} label="Show desktop pet" description="Keep your selected companion floating above the workspace." />
        <div className={`settings-row pet-size-row ${stylex.props(petsStyles.petSizeRow, settingsStyles.settingsRow).className ?? ""}`}>
          <span><label htmlFor="pet-size"><strong>Pet size</strong></label><small>Adjust the size of the floating pet.</small></span>
          <div className={`pet-size-control ${stylex.props(petsStyles.petSizeControl).className ?? ""}`}>
            <input {...stylex.props(petContext.sizeInput, petContext.sizeTrack, petContext.sizeThumb)} id="pet-size" type="range" min="50" max="125" step="5" value={settings.petSize} style={{ '--pet-size-progress': `${(settings.petSize - 50) / .75}%` } as CSSProperties} onChange={(event) => { void onUpdate({ petSize: Number(event.target.value) }) }} />
            <output {...stylex.props(petContext.sizeOutput)} htmlFor="pet-size">{settings.petSize}%</output>
          </div>
        </div>
        <div className={`pet-grid ${stylex.props(petsStyles.petGrid).className ?? ""}`} role="radiogroup" aria-label="Desktop pet">
          {available.map((pet) => (
            <button
              type="button"
              role="radio"
              aria-checked={pet.id === selected.id}
              className={[pet.id === selected.id ? 'pet-choice is-active' : 'pet-choice', stylex.props(petsStyles.petChoice, pet.id === selected.id && petsStyles.petChoiceIsActive).className].filter(Boolean).join(' ')}
              key={pet.id}
              onClick={() => { void onUpdate({ petId: pet.id, petEnabled: true }) }}
            >
              <span className={`pet-choice__art ${stylex.props(petsStyles.petChoiceArt).className ?? ""}`}>
                {pet.id === 'gooey-pi' ? <img {...stylex.props(petContext.choiceImage)} src="/gooeypi-mascot.png" alt="" /> : pet.kind === 'orb' ? <PetAvatar pet={pet} pets={pets} size={48} reduceMotion={settings.reduceMotion} /> : <PawPrint size={24} />}
              </span>
              <span {...stylex.props(petContext.choiceCopy)}><strong {...stylex.props(petContext.choiceName)}>{pet.displayName}</strong><small {...stylex.props(petContext.choiceSource)}>{pet.source === 'built-in' ? 'Built into Apex' : 'Codex pet'}</small></span>
            </button>
          ))}
        </div>
      </section>
      <section className={`settings-group ${stylex.props(settingsStyles.settingsGroup).className ?? ""}`}>
        <div className={`settings-group__heading ${stylex.props(settingsStyles.settingsGroupHeading).className ?? ""}`}><h2>Codex Pets</h2><ApexButton compact disabled={!pets || loading} icon={<ArrowsClockwise size={12} className={[loading ? 'spin' : '', stylex.props((loading) && activityStyles.spin, (loading) && overlaysStyles.spin).className].filter(Boolean).join(' ')} />} onClick={() => { void refresh() }}>Refresh</ApexButton></div>
        <p className={`settings-group__description ${stylex.props(settingsStyles.settingsGroupDescription).className ?? ""}`}>Refresh to find companions installed in <code>~/.codex/pets</code>.</p>
        <div className={`settings-row ${stylex.props(settingsStyles.settingsRow).className ?? ""}`}><span><strong>{codexCount ? `${codexCount} Codex ${codexCount === 1 ? 'pet' : 'pets'} found` : 'No additional Codex pets found'}</strong><small>{codexCount ? 'They are available in the companion picker above.' : 'Install or hatch pets later, then refresh this list.'}</small></span></div>
        {loadError ? <Banner xstyle={[inspectorStyles.settingsError]} status="error" role="alert" className="settings-error" title={loadError} /> : null}
      </section>
    </>
  )
}
