import * as stylex from '@stylexjs/stylex'
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

const styles = stylex.create({
  root: {
    display: 'grid',
    gap: 10,
  },
  sectionExecution: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: 'var(--border)',
    paddingTop: 12,
    marginTop: 2,
  },
  fields: {
    display: 'grid',
    gap: 10,
  },
  field: {
    display: 'grid',
    gridTemplateColumns: {
      default: '112px minmax(0, 1fr)',
      '@media (max-width: 380px)': 'minmax(0, 1fr)',
    },
    alignItems: 'center',
    gap: {
      default: 12,
      '@media (max-width: 380px)': 5,
    },
    minWidth: 0,
    color: 'var(--text-secondary)',
    fontSize: 'var(--fs-ui)',
  },
  fastToggle: {
    width: '100%',
    maxWidth: 'none',
    minWidth: 0,
    height: 32,
    minHeight: 32,
    justifyContent: 'flex-start',
    gap: 6,
    paddingBlock: 0,
    paddingInline: 9,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: {
      default: 'var(--text-secondary)',
      ':hover:not(:disabled)': 'var(--text)',
    },
    backgroundColor: {
      default: 'var(--surface-subtle)',
      ':hover:not(:disabled)': 'var(--surface-hover)',
    },
    boxShadow: 'none',
    fontSize: 'var(--fs-ui)',
    fontWeight: 550,
  },
  fastToggleActive: {
    borderColor: 'color-mix(in srgb, var(--accent) 40%, var(--border))',
    color: {
      default: 'var(--accent)',
      ':hover:not(:disabled)': 'var(--accent)',
    },
    backgroundColor: {
      default: 'color-mix(in srgb, var(--accent) 10%, var(--surface-subtle))',
      ':hover:not(:disabled)': 'color-mix(in srgb, var(--accent) 15%, var(--surface-subtle))',
    },
  },
  fusionPair: {
    display: 'contents',
  },
  modeStatus: {
    order: 1,
    flex: '1 0 100%',
    minWidth: 0,
    paddingInline: 4,
    color: 'var(--text-tertiary)',
    fontSize: 'var(--fs-meta)',
    lineHeight: 1.35,
  },
  modeStatusEmpty: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
  },
  fusionUnreported: {
    color: 'var(--text-tertiary)',
    fontSize: 'var(--fs-meta)',
    paddingInline: 4,
  },
})

const thinkingLabels: Record<ApexThinkingLevel, string> = {
  off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Standard', high: 'High', xhigh: 'Extra high', max: 'Max',
}

export const chatSettingsStyles = {
  fastToggle: styles.fastToggle,
  fastToggleActive: styles.fastToggleActive,
}

export function ChatSettings({ children }: { children: ReactNode }) {
  const rootStylex = stylex.props(styles.root)
  return (
    <div className={`chat-settings ${rootStylex.className ?? ''}`.trim()} style={rootStylex.style}>
      {children}
    </div>
  )
}

export function ChatSettingsSection({ divider = false, children }: { divider?: boolean; children: ReactNode }) {
  const sectionStylex = stylex.props(divider && styles.sectionExecution)
  const fieldsStylex = stylex.props(styles.fields)
  return (
    <section
      className={`chat-settings__section ${divider ? 'chat-settings__section--execution' : ''} ${sectionStylex.className ?? ''}`.trim()}
      style={sectionStylex.style}
    >
      <div className={`chat-settings__fields ${fieldsStylex.className ?? ''}`.trim()} style={fieldsStylex.style}>
        {children}
      </div>
    </section>
  )
}

export function ChatSettingsField({ label, children }: { label: string; children: ReactNode }) {
  const fieldStylex = stylex.props(styles.field)
  return (
    <div className={`chat-settings__field ${fieldStylex.className ?? ''}`.trim()} style={fieldStylex.style}>
      <span>{label}</span>
      {children}
    </div>
  )
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
  const statusText = pending === '/mode configure'
    ? 'Opening Fusion setup…'
    : pending === '/mode hydra sync'
      ? 'Syncing Hydra metrics…'
      : pending
        ? 'Updating Pi mode…'
        : ''
  const statusStylex = stylex.props(styles.modeStatus, !statusText && styles.modeStatusEmpty)
  const unreportedStylex = stylex.props(styles.fusionUnreported)
  return (
    <>
      <span className={`pi-mode-status ${statusStylex.className ?? ''}`.trim()} style={statusStylex.style} role="status">
        {statusText}
      </span>
      {mode === 'fusion' && !pair && (
        <span className={`pi-fusion-unreported ${unreportedStylex.className ?? ''}`.trim()} style={unreportedStylex.style} role="status">
          Pair not reported
        </span>
      )}
    </>
  )
}

export function PiModeFields({ controller, modelsByProvider, providers, children }: Pick<PiModeControlProps, 'modelsByProvider' | 'providers' | 'children'> & { controller: PiModeController }) {
  const { mode, hydraTier, pair, controlsDisabled, sendCommand, handleModeSelect } = controller
  const pairStylex = stylex.props(styles.fusionPair)
  return (
    <>
      <ChatSettingsSection>
        <ChatSettingsField label="Behavior mode">
          <SelectControl label="Behavior mode" compact fullWidth icon={<Command size={12} />} value={mode} disabled={controlsDisabled} onChange={(event) => handleModeSelect(event.target.value)}>
            {PI_BEHAVIOR_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value} title={option.detail}>{option.label}</option>)}
            <option value="configure" title="Choose lead and sidekick models">Configure Fusion…</option>
          </SelectControl>
        </ChatSettingsField>
        {mode === 'hydra' || mode === 'utopia' ? (
          <ChatSettingsField label="Hydra tier">
            <SelectControl label="Hydra tier" compact fullWidth icon={<Gauge size={12} />} value={hydraTier} disabled={controlsDisabled} onChange={(event) => sendCommand(`/mode hydra ${event.target.value}`)}>
              {PI_HYDRA_TIER_OPTIONS.map((option) => <option key={option.value} value={option.value} title={option.detail}>{option.label}</option>)}
              <option value="sync" title="Refresh Artificial Analysis metrics and quota snapshot">Sync metrics…</option>
              <option value="off" title="Disable automatic stats routing">{mode === 'utopia' ? 'Hydra: Off' : 'Turn off Hydra'}</option>
            </SelectControl>
          </ChatSettingsField>
        ) : null}
      </ChatSettingsSection>
      <ChatSettingsSection>
        {mode === 'fusion' && pair && (
          <div className={`pi-fusion-pair ${pairStylex.className ?? ''}`.trim()} style={pairStylex.style} aria-label="Fusion pair" role="group">
            {(['lead', 'sidekick'] as const).map((role) => {
              const label = role === 'lead' ? 'Lead' : 'Sidekick'
              const choice = pair[role]
              const identity = fusionModelIdentity(choice)
              const providerEnabled = providers.some((provider) => provider.id === choice.provider && provider.enabled)
              const model = providerEnabled ? modelsByProvider.get(choice.provider)?.find((candidate) => candidate.id === choice.modelId && candidate.enabled !== false) : undefined
              const levels = model?.available ? model.availableThinkingLevels : []
              return (
                <Fragment key={role}>
                  <ChatSettingsField label={`${label} model`}>
                    <ModelPicker
                      label={`${label} model`}
                      value={model?.key ?? identity}
                      unavailableLabel={`${identity} (unavailable)`}
                      modelsByProvider={modelsByProvider}
                      providers={providers}
                      disabled={controlsDisabled}
                      onChange={(key) => {
                        const next = [...modelsByProvider.values()].flat().find((candidate) => candidate.key === key)
                        if (next?.available) sendCommand(`/mode fusion-set ${role} model ${next.provider}/${next.id}`)
                      }}
                    />
                  </ChatSettingsField>
                  <ChatSettingsField label={`${label} thinking`}>
                    <SelectControl
                      label={`${label} thinking`}
                      compact
                      fullWidth
                      icon={<Gauge size={12} />}
                      value={choice.thinking}
                      disabled={controlsDisabled || !levels.length}
                      onChange={(event) => {
                        const level = levels.find((candidate) => candidate === event.target.value)
                        if (level) sendCommand(`/mode fusion-set ${role} thinking ${level}`)
                      }}
                    >
                      {!levels.includes(choice.thinking) ? <option value={choice.thinking} disabled>{`${label}: ${thinkingLabels[choice.thinking]} (unavailable)`}</option> : null}
                      {levels.map((level) => <option key={level} value={level}>{`${label}: ${thinkingLabels[level]}`}</option>)}
                    </SelectControl>
                  </ChatSettingsField>
                </Fragment>
              )
            })}
          </div>
        )}
        {mode !== 'fusion' && children}
      </ChatSettingsSection>
    </>
  )
}

export function PiModeControl({ disabled, onCommand, ...props }: PiModeControlProps) {
  const controller = usePiModeController(onCommand, disabled)
  return <><PiModeFields controller={controller} {...props} /><PiModeStatus controller={controller} /></>
}
