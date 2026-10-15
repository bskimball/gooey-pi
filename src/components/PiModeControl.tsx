import { useEffect, useRef, useState } from 'react'
import { Command } from './icons'
import { SelectControl } from './ui'
import {
  fusionModelIdentity,
  isPiBehaviorMode,
  PI_BEHAVIOR_MODE_EVENT,
  PI_BEHAVIOR_MODE_OPTIONS,
  PI_FUSION_PAIR_EVENT,
  type PiBehaviorMode,
  type PiFusionModelChoice,
  type PiFusionPair,
  readActivePiFusionPair,
  readSavedPiBehaviorMode,
} from '@/lib/harness'

interface PiModeControlProps {
  disabled: boolean
  /** Sends a `/mode …` command through the normal prompt path. */
  onCommand(command: string): Promise<void> | void
}

function PairModel({ label, choice }: { label: string; choice: PiFusionModelChoice }) {
  const identity = fusionModelIdentity(choice)
  return (
    <span className="pi-fusion-pair__model" title={`${identity} · ${choice.thinking} thinking`}>
      {label} <span className="sr-only">{choice.provider}/</span>{choice.modelId}
    </span>
  )
}

/** Pi behavior mode selector plus the active runtime's reported Fusion pair. */
export function PiModeControl({ disabled, onCommand }: PiModeControlProps) {
  const [mode, setMode] = useState<PiBehaviorMode>(readSavedPiBehaviorMode)
  const [pair, setPair] = useState<PiFusionPair | null>(readActivePiFusionPair)
  const [configuring, setConfiguring] = useState(false)
  const configuringRef = useRef(false)

  useEffect(() => {
    const onModeChange = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (isPiBehaviorMode(detail)) setMode(detail)
    }
    const onPairChange = () => setPair(readActivePiFusionPair())
    window.addEventListener(PI_BEHAVIOR_MODE_EVENT, onModeChange)
    window.addEventListener(PI_FUSION_PAIR_EVENT, onPairChange)
    return () => {
      window.removeEventListener(PI_BEHAVIOR_MODE_EVENT, onModeChange)
      window.removeEventListener(PI_FUSION_PAIR_EVENT, onPairChange)
    }
  }, [])

  return (
    <>
      <SelectControl label="Behavior mode" compact icon={<Command size={12} />} value={mode} disabled={disabled || configuring} onChange={(event) => {
        const value = event.target.value
        if (value !== 'configure') {
          void Promise.resolve(onCommand(`/mode ${value}`)).catch(() => undefined)
          return
        }
        // A fresh runtime can take seconds to show the setup dialog; say so and
        // refuse a second launch until this command settles.
        if (configuringRef.current) return
        configuringRef.current = true
        setConfiguring(true)
        void Promise.resolve()
          .then(() => onCommand('/mode configure'))
          .catch(() => undefined)
          .finally(() => {
            configuringRef.current = false
            setConfiguring(false)
          })
      }}>
        {PI_BEHAVIOR_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value} title={option.detail}>{option.label}</option>)}
        <option value="configure" title="Choose lead and sidekick models">Configure Fusion…</option>
      </SelectControl>
      <span className="pi-mode-status" role="status">{configuring ? 'Opening Fusion setup…' : ''}</span>
      {mode === 'fusion' && pair ? (
        <span className="pi-fusion-pair" aria-label="Fusion pair" role="group">
          <PairModel label="Lead" choice={pair.lead} />
          <span className="pi-fusion-pair__separator" aria-hidden="true">·</span>
          <PairModel label="Sidekick" choice={pair.sidekick} />
        </span>
      ) : null}
    </>
  )
}
