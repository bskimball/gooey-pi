import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Command, Gauge } from './icons'
import { SelectControl } from './ui'
import { ModelPicker } from './ModelPicker'
import type { PrimeModelDescriptor, PrimeProviderDescriptor, PrimeThinkingLevel } from '@/types/api'
import {
  type ActivePiHydraTier,
  fusionModelIdentity,
  isActivePiHydraTier,
  isPiBehaviorMode,
  PI_BEHAVIOR_MODE_EVENT,
  PI_BEHAVIOR_MODE_OPTIONS,
  PI_FUSION_PAIR_EVENT,
  PI_HYDRA_TIER_EVENT,
  PI_HYDRA_TIER_OPTIONS,
  type PiBehaviorMode,
  type PiFusionPair,
  readActivePiFusionPair,
  readSavedPiBehaviorMode,
  readSavedPiHydraTier,
} from '@/lib/harness'

interface PiModeControlProps {
  disabled: boolean
  modelsByProvider: ReadonlyMap<string, PrimeModelDescriptor[]>
  providers: PrimeProviderDescriptor[]
  /** Ordinary model/thinking controls, shown only outside Fusion. */
  children?: ReactNode
  /** Sends a `/mode …` command through the normal prompt path. */
  onCommand(command: string): Promise<void> | void
}

const thinkingLabels: Record<PrimeThinkingLevel, string> = {
  off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Standard', high: 'High', xhigh: 'Extra high', max: 'Max',
}

/** Pi mode followed by either ordinary controls or the runtime-reported Fusion pair. */
export function PiModeControl({ disabled, modelsByProvider, providers, children, onCommand }: PiModeControlProps) {
  const [mode, setMode] = useState<PiBehaviorMode>(readSavedPiBehaviorMode)
  const [hydraTier, setHydraTier] = useState<ActivePiHydraTier>(readSavedPiHydraTier)
  const [pair, setPair] = useState<PiFusionPair | null>(readActivePiFusionPair)
  const [pending, setPending] = useState<string | null>(null)
  const pendingRef = useRef<symbol | null>(null)

  useEffect(() => {
    const resetPending = () => {
      pendingRef.current = null
      setPending(null)
    }
    const onModeChange = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (isPiBehaviorMode(detail)) {
        setMode(detail)
        resetPending()
      }
    }
    const onHydraTierChange = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (isActivePiHydraTier(detail)) {
        setHydraTier(detail)
        resetPending()
      }
    }
    const onPairChange = () => {
      setPair(readActivePiFusionPair())
      resetPending()
    }
    window.addEventListener(PI_BEHAVIOR_MODE_EVENT, onModeChange)
    window.addEventListener(PI_HYDRA_TIER_EVENT, onHydraTierChange)
    window.addEventListener(PI_FUSION_PAIR_EVENT, onPairChange)
    return () => {
      pendingRef.current = null
      window.removeEventListener(PI_BEHAVIOR_MODE_EVENT, onModeChange)
      window.removeEventListener(PI_HYDRA_TIER_EVENT, onHydraTierChange)
      window.removeEventListener(PI_FUSION_PAIR_EVENT, onPairChange)
    }
  }, [])

  const sendCommand = (command: string) => {
    if (disabled || pendingRef.current) return
    const request = Symbol()
    pendingRef.current = request
    setPending(command)
    void Promise.resolve()
      .then(() => onCommand(command))
      .catch(() => undefined) // The normal prompt path reports errors.
      .finally(() => {
        if (pendingRef.current !== request) return
        pendingRef.current = null
        setPending(null)
      })
  }
  const controlsDisabled = disabled || pending !== null

  const handleModeSelect = (nextValue: string) => {
    if (nextValue === 'hydra') {
      sendCommand(`/mode hydra ${hydraTier}`)
      return
    }
    sendCommand(`/mode ${nextValue}`)
  }

  return (
    <>
      <SelectControl label="Behavior mode" compact icon={<Command size={12} />} value={mode} disabled={controlsDisabled} onChange={(event) => handleModeSelect(event.target.value)}>
        {PI_BEHAVIOR_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value} title={option.detail}>{option.label}</option>)}
        <option value="configure" title="Choose lead and sidekick models">Configure Fusion…</option>
      </SelectControl>
      {mode === 'hydra' ? (
        <SelectControl label="Hydra tier" compact icon={<Gauge size={12} />} value={hydraTier} disabled={controlsDisabled} onChange={(event) => sendCommand(`/mode hydra ${event.target.value}`)}>
          {PI_HYDRA_TIER_OPTIONS.map((option) => <option key={option.value} value={option.value} title={option.detail}>{option.label}</option>)}
          <option value="sync" title="Refresh Artificial Analysis metrics and quota snapshot">Sync metrics…</option>
          <option value="off" title="Disable automatic stats routing">Turn off Hydra</option>
        </SelectControl>
      ) : null}
      <span className="pi-mode-status" role="status">{pending === '/mode configure' ? 'Opening Fusion setup…' : pending === '/mode hydra sync' ? 'Syncing Hydra metrics…' : pending ? 'Updating Pi mode…' : ''}</span>
      {mode === 'fusion' ? (
        // Flatten the old full-row readout so these controls follow mode in the footer's flex order.
        <div className="pi-fusion-pair" aria-label="Fusion pair" role="group" style={{ display: 'contents' }}>
          {(['lead', 'sidekick'] as const).map((role) => {
            const label = role === 'lead' ? 'Lead' : 'Sidekick'
            const choice = pair?.[role]
            const identity = choice ? fusionModelIdentity(choice) : ''
            const providerEnabled = providers.some((provider) => provider.id === choice?.provider && provider.enabled)
            const model = choice && providerEnabled ? modelsByProvider.get(choice.provider)?.find((candidate) => candidate.id === choice.modelId && candidate.enabled !== false) : undefined
            const levels = model?.available ? model.availableThinkingLevels : []
            return (
              <Fragment key={role}>
                <ModelPicker label={`${label} model`} value={model?.key ?? identity} unavailableLabel={choice ? `${identity} (unavailable)` : 'Not reported'} modelsByProvider={modelsByProvider} providers={providers} disabled={controlsDisabled || !pair} onChange={(key) => {
                  const next = [...modelsByProvider.values()].flat().find((candidate) => candidate.key === key)
                  if (next?.available) sendCommand(`/mode fusion-set ${role} model ${next.provider}/${next.id}`)
                }} />
                <SelectControl label={`${label} thinking`} compact icon={<Gauge size={12} />} value={choice?.thinking ?? ''} disabled={controlsDisabled || !pair || !levels.length} onChange={(event) => {
                  const level = levels.find((candidate) => candidate === event.target.value)
                  if (level) sendCommand(`/mode fusion-set ${role} thinking ${level}`)
                }}>
                  {!choice ? <option value="" disabled>{`${label}: Not reported`}</option> : !levels.includes(choice.thinking) ? <option value={choice.thinking} disabled>{`${label}: ${thinkingLabels[choice.thinking]} (unavailable)`}</option> : null}
                  {levels.map((level) => <option key={level} value={level}>{`${label}: ${thinkingLabels[level]}`}</option>)}
                </SelectControl>
              </Fragment>
            )
          })}
        </div>
      ) : children}
    </>
  )
}
