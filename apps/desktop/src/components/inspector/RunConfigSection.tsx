import { useEffect, useId, useState } from 'react'
import { CaretRight, Check, WarningCircle } from '../icons'
import type { EffectiveCapability, EffectiveInstructionSource, EffectiveRunConfig, RuntimeInfo } from '@/types/api'

const NOT_REPORTED = 'Not yet reported'

const CAPABILITY_LABELS: Record<string, string> = {
  piFastMode: 'Fast mode',
  schedule: 'Schedules',
  browser: 'Browser',
  browserAgent: 'Browser agent',
  askUser: 'Ask user',
  collaboration: 'Collaboration',
}

const SCOPE_LABELS: Record<EffectiveInstructionSource['scope'], string> = {
  user: 'Global',
  project: 'Project',
  parent: 'Parent',
}

interface LoadedConfig { cwd: string; config: EffectiveRunConfig }

/** Reads the effective config once per project/session change; returns null until the result for the current cwd arrives, undefined when unavailable. */
function useEffectiveRunConfig(cwd: string | undefined, sessionKey: string | undefined): EffectiveRunConfig | null | undefined {
  const [loaded, setLoaded] = useState<LoadedConfig | null>(null)
  useEffect(() => {
    const read = typeof window !== 'undefined' ? window.apex?.runtime?.effectiveConfig : undefined
    if (!read || !cwd) { setLoaded(null); return }
    let current = true
    void read(cwd).then((next) => {
      if (current) setLoaded((previous) => previous?.cwd === cwd && JSON.stringify(previous.config) === JSON.stringify(next) ? previous : { cwd, config: next })
    }).catch(() => { if (current) setLoaded(null) })
    return () => { current = false }
  }, [cwd, sessionKey])
  if (!cwd || typeof window === 'undefined' || !window.apex?.runtime?.effectiveConfig) return undefined
  return loaded?.cwd === cwd ? loaded.config : null
}

function shortPath(path: string, cwd: string | undefined): string {
  const normalized = path.replaceAll('\\', '/')
  const root = cwd?.replaceAll('\\', '/').replace(/\/+$/, '')
  if (root && normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1)
  return normalized.split('/').slice(-3).join('/')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1).replace(/\.0$/, '')} KB`
}

function capabilityLabel({ capability }: EffectiveCapability): string {
  return CAPABILITY_LABELS[capability] ?? capability.replace(/([a-z])([A-Z])/g, '$1 $2')
}

interface RunConfigSectionProps {
  runtime?: RuntimeInfo | null
  behaviorMode?: string
  cwd?: string
  sessionKey?: string
}

export function RunConfigSection({ runtime, behaviorMode, cwd, sessionKey }: RunConfigSectionProps) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const config = useEffectiveRunConfig(cwd, sessionKey)
  const model = runtime?.executingModel?.label ?? runtime?.model?.name ?? runtime?.model?.id
  const effort = runtime?.thinkingLevel
  const summaryParts = [model, effort, behaviorMode].filter((value): value is string => Boolean(value))
  const totalSkills = config ? config.skillDirs.reduce((sum, dir) => sum + dir.count, 0) : 0
  const presentExtensions = config ? config.injectedCapabilities.filter((item) => item.present).length : 0
  const missingExtensions = config ? config.injectedCapabilities.length - presentExtensions : 0
  return (
    <section className={`summary-section run-config${open ? ' is-open' : ''}`}>
      <h3 className="run-config__heading">
        <button
          type="button"
          className="run-config__toggle"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          <CaretRight size={12} className="disclosure-caret" aria-hidden="true" />
          <span className="run-config__title">Run configuration</span>
          <span className="run-config__summary" title={summaryParts.join(' · ') || undefined}>
            {summaryParts.length ? summaryParts.join(' · ') : NOT_REPORTED}
          </span>
          {missingExtensions > 0 ? (
            <span className="run-config__alert" title={`${missingExtensions} bundled ${missingExtensions === 1 ? 'extension' : 'extensions'} missing`}>
              <WarningCircle size={12} aria-hidden="true" />
            </span>
          ) : null}
        </button>
      </h3>
      {open ? (
        <div id={bodyId} className="run-config__body">
          <dl className="run-config__grid">
            <div className="run-config__stat run-config__stat--wide">
              <dt>Model</dt>
              <dd title={model ?? undefined}>{model ?? NOT_REPORTED}</dd>
            </div>
            <div className="run-config__stat">
              <dt>Effort</dt>
              <dd>{effort ?? NOT_REPORTED}</dd>
            </div>
            <div className="run-config__stat">
              <dt>Mode</dt>
              <dd>{behaviorMode ?? NOT_REPORTED}</dd>
            </div>
          </dl>
          {config === undefined ? null : config === null ? <p className="run-config__empty">Loading…</p> : (
            <>
              <div className="run-config__subhead">
                <h4>Instructions &amp; skills</h4>
                <span>
                  {config.instructionSources.length} {config.instructionSources.length === 1 ? 'file' : 'files'}
                  {totalSkills > 0 ? ` · ${totalSkills} ${totalSkills === 1 ? 'skill' : 'skills'}` : ''}
                </span>
              </div>
              {config.instructionSources.length || config.skillDirs.length ? (
                <ul className="run-config__items">
                  {config.instructionSources.map((source) => (
                    <li key={source.path} title={source.path}>
                      <span className="run-config__path">{source.scope === 'user' ? source.kind : shortPath(source.path, cwd)}</span>
                      <span className={`run-config__scope is-${source.scope}`}>{SCOPE_LABELS[source.scope]}</span>
                      <small>{formatBytes(source.bytes)}</small>
                    </li>
                  ))}
                  {config.skillDirs.map((dir) => (
                    <li key={dir.path} title={dir.path}>
                      <span className="run-config__path">{shortPath(dir.path, cwd)}</span>
                      <span className="run-config__scope is-skills">Skills</span>
                      <small>{dir.count}</small>
                    </li>
                  ))}
                </ul>
              ) : <p className="run-config__empty">No instruction files found</p>}
              <div className="run-config__subhead">
                <h4>Bundled extensions</h4>
                <span>{presentExtensions}/{config.injectedCapabilities.length} bundled</span>
              </div>
              <ul className="run-config__chips">
                {config.injectedCapabilities.map((item) => (
                  <li key={item.capability} title={`${item.filename} (${item.present ? 'bundled' : 'missing'})`} className={item.present ? 'is-present' : 'is-missing'}>
                    {item.present ? <Check size={11} aria-hidden="true" /> : <WarningCircle size={11} aria-hidden="true" />}
                    <span>{capabilityLabel(item)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}
