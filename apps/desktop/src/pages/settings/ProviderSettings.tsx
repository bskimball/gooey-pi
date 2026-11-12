import { Banner } from '@astryxdesign/core/Banner'
import { Button as AstryxButton } from '@astryxdesign/core/Button'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { TextInput } from '@astryxdesign/core/TextInput'
import * as stylex from '@stylexjs/stylex'
import { ArrowsClockwise, ArrowSquareOut, CaretRight, Gauge, Lightning, MagnifyingGlass } from '@/components/icons'
import { ApexButton, IconButton } from '@/components/ui'
import { useMemo, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import type { HarnessId, ApexModelCatalog, ApexModelDescriptor, } from '@/types/api'
import { HARNESS_AGENT_NAMES } from '@/lib/harness'

interface ProviderSettingsProps {
  /** Pi credentials stay CLI-owned; visibility toggles only affect Apex. */
  harness?: HarnessId
  catalog: ApexModelCatalog | null
  onRefresh(): Promise<void>
  onSetEnabled(providerId: string, enabled: boolean): Promise<void>
  onSetAllEnabled(): Promise<void>
  onSetAllDisabled(): Promise<void>
  onSetModelEnabled(modelKey: string, enabled: boolean): Promise<void>
  onOpenDocs(): void
}

const searchControlStyles = stylex.create({
  searchControl: {
    height: 34,
    minHeight: 34,
    marginBlock: '3px 8px',
    paddingInline: 9,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--surface-raised)',
  },
  groupHeading: {
    width: '100%',
    minHeight: 31,
    height: 'auto',
    justifyContent: 'flex-start',
    paddingInline: 8,
    paddingBlock: 0,
    borderRadius: 0,
    backgroundImage: 'none',
    boxShadow: 'none',
  },
})

function activeFirst<T extends { enabled?: boolean }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => Number(right.enabled !== false) - Number(left.enabled !== false))
}

export function ProviderSettings({ harness = 'pi', catalog, onRefresh, onSetEnabled, onSetAllEnabled, onSetAllDisabled, onSetModelEnabled, onOpenDocs }: ProviderSettingsProps) {
  const agentName = HARNESS_AGENT_NAMES[harness]
  const [view, setView] = useState<'providers' | 'models'>('providers')
  const [query, setQuery] = useState('')
  const [busyProvider, setBusyProvider] = useState<string | null>(null)
  const [collapsedModelProviders, setCollapsedModelProviders] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState('')
  const providers = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const matches = normalized
      ? (catalog?.providers ?? []).filter((provider) => `${provider.name} ${provider.id}`.toLowerCase().includes(normalized))
      : catalog?.providers ?? []
    return activeFirst(matches)
  }, [catalog, query])
  const providerNames = useMemo(() => new Map((catalog?.providers ?? []).map((provider) => [provider.id, provider.name])), [catalog])
  const modelGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const matches = normalized
      ? (catalog?.models ?? []).filter((model) => `${model.name} ${model.id} ${model.provider} ${providerNames.get(model.provider) ?? ''}`.toLowerCase().includes(normalized))
      : catalog?.models ?? []
    const byProvider = new Map<string, ApexModelDescriptor[]>()
    for (const model of matches) {
      const models = byProvider.get(model.provider)
      if (models) models.push(model)
      else byProvider.set(model.provider, [model])
    }
    const orderedProviders = activeFirst(catalog?.providers ?? [])
    const groups = orderedProviders.flatMap((provider) => {
      const models = byProvider.get(provider.id)
      if (!models?.length) return []
      byProvider.delete(provider.id)
      return [{ provider, models: activeFirst(models) }]
    })
    for (const [providerId, models] of byProvider) {
      groups.push({
        provider: { id: providerId, name: providerNames.get(providerId) ?? providerId, authMethod: 'external', configured: false, modelCount: models.length, availableModelCount: 0, enabled: models.some((model) => model.enabled !== false) },
        models: activeFirst(models),
      })
    }
    return groups
  }, [catalog, providerNames, query])

  const run = async (providerId: string, action: () => Promise<void>) => {
    setBusyProvider(providerId); setError('')
    try { await action() } catch (failure) { setError(errorMessage(failure)) } finally { setBusyProvider(null) }
  }

  const toggleModelProvider = (providerId: string) => setCollapsedModelProviders((current) => {
    const next = new Set(current)
    if (next.has(providerId)) next.delete(providerId)
    else next.add(providerId)
    return next
  })
  const enableAll = () => run('enable-all', onSetAllEnabled)
  const disableAll = () => run('disable-all', onSetAllDisabled)

  const providerCount = catalog?.providers.length ?? 0
  const modelCount = catalog?.models.length ?? 0
  const availableModelCount = catalog?.models.filter((model) => model.available && model.enabled !== false).length ?? 0
  const disabledCount = catalog?.providers.filter((provider) => !provider.enabled).length ?? 0

  const searchLabel = view === 'providers' ? 'Search providers' : 'Search models'

  return (
    <section className="settings-group provider-settings">
      <div className="settings-group__heading"><h2>{agentName} catalogue</h2><div className="provider-heading-actions">{catalog && disabledCount < providerCount ? <ApexButton variant="danger" disabled={Boolean(busyProvider)} onClick={() => void disableAll()}>Hide all</ApexButton> : null}{disabledCount ? <ApexButton disabled={Boolean(busyProvider)} onClick={() => void enableAll()}>Show all</ApexButton> : null}<IconButton className="button button--icon" label="Refresh providers" disabled={Boolean(busyProvider)} onClick={() => void run('refresh', onRefresh)}><ArrowsClockwise size={13} /></IconButton></div></div>
      <div className="provider-catalog-summary"><strong>{catalog ? `${providerCount.toLocaleString()} providers · ${modelCount.toLocaleString()} models` : 'Loading provider catalogue…'}</strong>{catalog ? <small>{`${availableModelCount.toLocaleString()} models are shown in Apex; ${agentName} checks credentials when you launch one`}</small> : null}</div>
      {catalog?.warning ? <Banner status="warning" role="status" className="provider-catalog-warning" title={catalog.warning} /> : null}
      <TabList
        value={view}
        onChange={(next) => {
          if (next === 'providers' || next === 'models') {
            setView(next)
            setQuery('')
          }
        }}
        role="tablist"
        aria-label="Provider catalogue view"
        size="sm"
        layout="fill"
        className="provider-catalog-tabs"
      >
        <Tab value="providers" label="Providers" endContent={<span>{providerCount.toLocaleString()}</span>} />
        <Tab value="models" label="Models" endContent={<span>{modelCount.toLocaleString()}</span>} />
      </TabList>
      <TextInput
        label={searchLabel}
        aria-label={searchLabel}
        isLabelHidden
        type="search"
        value={query}
        placeholder={searchLabel}
        startIcon={<MagnifyingGlass size={13} />}
        onChange={(nextValue) => setQuery(nextValue)}
        containerClassName="provider-search-field"
        controlClassName="provider-search"
        controlXstyle={searchControlStyles.searchControl}
      />
      {error ? <Banner status="error" role="alert" className="settings-error" title={error} /> : null}
      {view === 'providers' ? <div className="provider-list">
        {providers.map((provider) => {
          const busy = busyProvider === provider.id
          return <div className="provider-row" key={provider.id}>
            <CheckboxInput
              label=""
              aria-label={`Show ${provider.name} provider`}
              value={provider.enabled}
              isDisabled={busy}
              onChange={(checked) => void run(provider.id, () => onSetEnabled(provider.id, checked))}
              className="provider-row__toggle"
            />
            <div className="provider-row__identity"><strong>{provider.name}</strong><small>{`Credentials managed by the pi CLI · ${provider.availableModelCount.toLocaleString()} models`}</small></div>
            <div className="provider-row__actions"><ApexButton icon={<ArrowSquareOut size={13} />} onClick={onOpenDocs}>Credential setup</ApexButton></div>
          </div>
        })}
      </div> : <div className="provider-list provider-model-list">
        {modelGroups.map(({ provider, models }) => {
          const collapsed = collapsedModelProviders.has(provider.id)
          const contentId = `provider-models-${provider.id.replace(/[^a-z0-9_-]/gi, '-')}`
          return <div className={`provider-model-group${provider.enabled ? '' : ' is-disabled'}${collapsed ? ' is-collapsed' : ''}`} key={provider.id}>
          <AstryxButton
            label={provider.name}
            variant="ghost"
            size="sm"
            aria-expanded={!collapsed}
            aria-controls={contentId}
            className="provider-model-group__heading"
            xstyle={searchControlStyles.groupHeading}
            endContent={<CaretRight className="provider-model-group__chevron" size={13} aria-hidden="true" />}
            onClick={() => toggleModelProvider(provider.id)}
          >
            <strong>{provider.name}</strong>
            <small>{models.filter((model) => model.enabled !== false).length.toLocaleString()} of {models.length.toLocaleString()} on</small>
          </AstryxButton>
          <div id={contentId} className="provider-model-group__models" hidden={collapsed}>{models.map((model) => <div className={`provider-model-row${model.enabled === false ? ' is-disabled' : ''}`} key={model.key}>
            <div className="provider-row__identity"><strong>{model.name}</strong><small>{model.id}</small></div>
            <div className="provider-model-row__capabilities">
              {model.reasoning ? <span title={`${model.availableThinkingLevels.length} reasoning levels`}><Gauge size={11} /> Reasoning</span> : null}
              {model.fastModeSupported ? <span><Lightning size={11} /> Fast</span> : null}
              <span className={model.available && model.enabled !== false ? 'is-available' : ''}>{model.enabled === false ? 'Hidden' : 'Shown'}</span>
            </div>
            <CheckboxInput
              label=""
              aria-label={`Show ${model.name} model`}
              value={model.enabled !== false}
              isDisabled={busyProvider === `model:${model.key}`}
              onChange={(checked) => void run(`model:${model.key}`, () => onSetModelEnabled(model.key, checked))}
              className="provider-row__toggle provider-model-row__toggle"
            />
          </div>)}</div>
        </div>})}
      </div>}
      {catalog && view === 'providers' && !providers.length ? <p className="settings-empty">No providers match your search.</p> : null}
      {catalog && view === 'models' && !modelGroups.length ? <p className="settings-empty">No models match your search.</p> : null}
    </section>
  )
}

const PROVIDERS_PAGE_INTROS: Record<HarnessId, string> = {
  pi: 'Choose which Pi providers and models appear in Apex. These visibility settings do not change Pi itself; Pi provider authentication is managed by the pi CLI. You may need to log in to or out of providers in the Pi CLI before they appear on this screen.',
}

/** The Providers settings page: heading plus the provider/model catalog section. */
export function ProvidersSettings(props: ProviderSettingsProps) {
  return (
    <>
      <header><h1>Providers</h1><p>{PROVIDERS_PAGE_INTROS[props.harness ?? 'pi']}</p></header>
      <ProviderSettings {...props} />
    </>
  )
}
