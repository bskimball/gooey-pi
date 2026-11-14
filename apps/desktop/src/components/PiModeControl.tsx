import { Fragment, useEffect, type ReactNode } from 'react'
import { useMachine } from '@xstate/react'
import { Command, Gauge } from './icons'
import { SelectControl } from './ui'
import { ModelPicker } from './ModelPicker'
import { piModeControlMachine } from './piModeControlMachine'
import type { ApexModelDescriptor, ApexProviderDescriptor, ApexThinkingLevel } from '@/types/api'
import {
  fusionModelIdentity,
  isPiHydraTier,
  isPiBehaviorMode,
  PI_BEHAVIOR_MODE_EVENT,
  PI_BEHAVIOR_MODE_OPTIONS,
  PI_FUSION_PAIR_EVENT,
  PI_HYDRA_TIER_EVENT,
  PI_HYDRA_TIER_OPTIONS,
  readActivePiFusionPair,
  readDefaultPiHydraTier,
} from '@/lib/harness'

interface PiModeControlProps {
  disabled: boolean
  modelsByProvider: ReadonlyMap<string, ApexModelDescriptor[]>
  providers: ApexProviderDescriptor[]
  /** Ordinary model/thinking controls, shown only outside Fusion. */
  children?: ReactNode
  /** Sends a `/mode …` command through the normal prompt path. */
  onCommand(command: string): Promise<void> | void
}

const thinkingLabels: Record<ApexThinkingLevel, string> = {
  off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Standard', high: 'High', xhigh: 'Extra high', max: 'Max',
}

/** Pi mode followed by either ordinary controls or the runtime-reported Fusion pair. */
export function usePiModeController(onCommand: PiModeControlProps['onCommand'], disabled: boolean) {
  const [snapshot, send, actor] = useMachine(piModeControlMachine)
  const { mode, hydraTier, pair, pendingCommand: pending } = snapshot.context

  useEffect(() => {
    const onModeChange = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (isPiBehaviorMode(detail)) send({ type: 'SYNC_MODE', mode: detail })
    }
    const onHydraTierChange = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (isPiHydraTier(detail)) send({ type: 'SYNC_HYDRA_TIER', hydraTier: detail })
    }
    const onPairChange = () => {
      send({ type: 'SYNC_PAIR', pair: readActivePiFusionPair() })
    }
    window.addEventListener(PI_BEHAVIOR_MODE_EVENT, onModeChange)
    window.addEventListener(PI_HYDRA_TIER_EVENT, onHydraTierChange)
    window.addEventListener(PI_FUSION_PAIR_EVENT, onPairChange)
    return () => {
      send({ type: 'RESET_PENDING' })
      window.removeEventListener(PI_BEHAVIOR_MODE_EVENT, onModeChange)
      window.removeEventListener(PI_HYDRA_TIER_EVENT, onHydraTierChange)
      window.removeEventListener(PI_FUSION_PAIR_EVENT, onPairChange)
    }
  }, [send])

  const sendCommand = (command: string) => {
    if (disabled || actor.getSnapshot().matches('pending')) return
    const token = Symbol()
    send({ type: 'SEND_COMMAND', command, token })
    void Promise.resolve()
      .then(() => onCommand(command))
      .catch(() => undefined) // The normal prompt path reports errors.
      .finally(() => {
        send({ type: 'SETTLE_COMMAND', token })
      })
  }
  const controlsDisabled = disabled || snapshot.matches('pending')

  const handleModeSelect = (nextValue: string) => {
    if (nextValue === 'hydra') {
      sendCommand(`/mode hydra ${hydraTier === 'off' ? readDefaultPiHydraTier() : hydraTier}`)
      return
    }
    sendCommand(`/mode ${nextValue}`)
  }

  return { mode, hydraTier, pair, pending, controlsDisabled, sendCommand, handleModeSelect }
}

type PiModeController = ReturnType<typeof usePiModeController>

export function PiModeStatus({ controller }: { controller: PiModeController }) {
  const { mode, pair, pending } = controller
  return <><span className="pi-mode-status" role="status">{pending === '/mode configure' ? 'Opening Fusion setup…' : pending === '/mode hydra sync' ? 'Syncing Hydra metrics…' : pending ? 'Updating Pi mode…' : ''}</span>
    {mode === 'fusion' && !pair && <span className="pi-fusion-unreported" role="status">Pair not reported</span>}</>
}

export function PiModeFields({ controller, modelsByProvider, providers, children }: Pick<PiModeControlProps, 'modelsByProvider' | 'providers' | 'children'> & { controller: PiModeController }) {
  const { mode, hydraTier, pair, controlsDisabled, sendCommand, handleModeSelect } = controller
  return (
    <>
      <section className="chat-settings__section"><div className="chat-settings__fields">
      <div className="chat-settings__field"><span>Behavior mode</span><SelectControl label="Behavior mode" compact icon={<Command size={12} />} value={mode} disabled={controlsDisabled} onChange={(event) => handleModeSelect(event.target.value)}>
        {PI_BEHAVIOR_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value} title={option.detail}>{option.label}</option>)}
        <option value="configure" title="Choose lead and sidekick models">Configure Fusion…</option>
      </SelectControl></div>
      {mode === 'hydra' || mode === 'utopia' ? (
        <div className="chat-settings__field"><span>Hydra tier</span><SelectControl label="Hydra tier" compact icon={<Gauge size={12} />} value={hydraTier} disabled={controlsDisabled} onChange={(event) => sendCommand(`/mode hydra ${event.target.value}`)}>
          {PI_HYDRA_TIER_OPTIONS.map((option) => <option key={option.value} value={option.value} title={option.detail}>{option.label}</option>)}
          <option value="sync" title="Refresh Artificial Analysis metrics and quota snapshot">Sync metrics…</option>
          <option value="off" title="Disable automatic stats routing">{mode === 'utopia' ? 'Hydra: Off' : 'Turn off Hydra'}</option>
        </SelectControl></div>
      ) : null}
      </div></section>
      <section className="chat-settings__section"><div className="chat-settings__fields">
      {mode === 'fusion' && pair && (
        <div className="pi-fusion-pair" aria-label="Fusion pair" role="group" style={{ display: 'contents' }}>
          {(['lead', 'sidekick'] as const).map((role) => {
            const label = role === 'lead' ? 'Lead' : 'Sidekick'
            const choice = pair[role]
            const identity = fusionModelIdentity(choice)
            const providerEnabled = providers.some((provider) => provider.id === choice.provider && provider.enabled)
            const model = providerEnabled ? modelsByProvider.get(choice.provider)?.find((candidate) => candidate.id === choice.modelId && candidate.enabled !== false) : undefined
            const levels = model?.available ? model.availableThinkingLevels : []
            return (
              <Fragment key={role}>
                <div className="chat-settings__field"><span>{label} model</span><ModelPicker label={`${label} model`} value={model?.key ?? identity} unavailableLabel={`${identity} (unavailable)`} modelsByProvider={modelsByProvider} providers={providers} disabled={controlsDisabled} onChange={(key) => {
                  const next = [...modelsByProvider.values()].flat().find((candidate) => candidate.key === key)
                  if (next?.available) sendCommand(`/mode fusion-set ${role} model ${next.provider}/${next.id}`)
                }} /></div>
                <div className="chat-settings__field"><span>{label} thinking</span><SelectControl label={`${label} thinking`} compact icon={<Gauge size={12} />} value={choice.thinking} disabled={controlsDisabled || !levels.length} onChange={(event) => {
                  const level = levels.find((candidate) => candidate === event.target.value)
                  if (level) sendCommand(`/mode fusion-set ${role} thinking ${level}`)
                }}>
                  {!levels.includes(choice.thinking) ? <option value={choice.thinking} disabled>{`${label}: ${thinkingLabels[choice.thinking]} (unavailable)`}</option> : null}
                  {levels.map((level) => <option key={level} value={level}>{`${label}: ${thinkingLabels[level]}`}</option>)}
                </SelectControl></div>
              </Fragment>
            )
          })}
        </div>
      )}
      {mode !== 'fusion' && children}
      </div></section>
    </>
  )
}

export function PiModeControl({ disabled, onCommand, ...props }: PiModeControlProps) {
  const controller = usePiModeController(onCommand, disabled)
  return <><PiModeFields controller={controller} {...props} /><PiModeStatus controller={controller} /></>
}
