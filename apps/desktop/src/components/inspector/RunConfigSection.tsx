import { useEffect, useState } from 'react'
import type { EffectiveRunConfig, RuntimeInfo } from '@/types/api'

const NOT_REPORTED = 'Not yet reported'

interface LoadedConfig { cwd: string; config: EffectiveRunConfig }

/** Reads the effective config once per project/session change; returns null until the result for the current cwd arrives, undefined when unavailable. */
function useEffectiveRunConfig(cwd: string | undefined, sessionKey: string | undefined): EffectiveRunConfig | null | undefined {
  const [loaded, setLoaded] = useState<LoadedConfig | null>(null)
  useEffect(() => {
    const read = typeof window !== 'undefined' ? window.prime?.runtime?.effectiveConfig : undefined
    if (!read || !cwd) { setLoaded(null); return }
    let current = true
    void read(cwd).then((next) => {
      if (current) setLoaded((previous) => previous?.cwd === cwd && JSON.stringify(previous.config) === JSON.stringify(next) ? previous : { cwd, config: next })
    }).catch(() => { if (current) setLoaded(null) })
    return () => { current = false }
  }, [cwd, sessionKey])
  if (!cwd || typeof window === 'undefined' || !window.prime?.runtime?.effectiveConfig) return undefined
  return loaded?.cwd === cwd ? loaded.config : null
}

function shortPath(path: string, cwd: string | undefined): string {
  const normalized = path.replaceAll('\\', '/')
  const root = cwd?.replaceAll('\\', '/').replace(/\/+$/, '')
  if (root && normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1)
  return normalized.split('/').slice(-3).join('/')
}

interface RunConfigSectionProps {
  runtime?: RuntimeInfo | null
  behaviorMode?: string
  cwd?: string
  sessionKey?: string
}

export function RunConfigSection({ runtime, behaviorMode, cwd, sessionKey }: RunConfigSectionProps) {
  const config = useEffectiveRunConfig(cwd, sessionKey)
  const model = runtime?.executingModel?.label ?? runtime?.model?.name ?? runtime?.model?.id
  return (
    <section className="summary-section run-config">
      <h3>Run configuration</h3>
      <dl className="run-config__list">
        <div><dt>Model</dt><dd>{model ?? NOT_REPORTED}</dd></div>
        <div><dt>Effort</dt><dd>{runtime?.thinkingLevel ?? NOT_REPORTED}</dd></div>
        <div><dt>Mode</dt><dd>{behaviorMode ?? NOT_REPORTED}</dd></div>
      </dl>
      {config === undefined ? null : config === null ? <p className="run-config__empty">Loading…</p> : (
        <>
          <h4>Instructions</h4>
          {config.instructionSources.length || config.skillDirs.length ? (
            <ul className="run-config__items">
              {config.instructionSources.map((source) => (
                <li key={source.path} title={source.path}><span>{source.scope === 'user' ? source.kind : shortPath(source.path, cwd)}</span><small>{source.scope} · {source.bytes} B</small></li>
              ))}
              {config.skillDirs.map((dir) => (
                <li key={dir.path} title={dir.path}><span>{shortPath(dir.path, cwd)}</span><small>{dir.count} {dir.count === 1 ? 'skill' : 'skills'}</small></li>
              ))}
            </ul>
          ) : <p className="run-config__empty">No instruction files found</p>}
          <h4>Bundled extensions</h4>
          <ul className="run-config__items">
            {config.injectedCapabilities.map((item) => (
              <li key={item.capability} title={item.filename} className={item.present ? '' : 'is-missing'}><span>{item.capability}</span><small>{item.present ? 'bundled' : 'missing'}</small></li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
