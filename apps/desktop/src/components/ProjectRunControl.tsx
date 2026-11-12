import { Banner } from '@astryxdesign/core/Banner'
import { TextArea } from '@astryxdesign/core/TextArea'
import { ArrowCounterClockwise, CaretDown, CheckCircle, CircleNotch, Play, Square, WarningCircle } from './icons'
import { StatusMark } from './activity/StatusMark'
import { ApexButton, IconButton } from './ui'
import { useEffect, useId, useRef, useState } from 'react'
import type { ProjectRecord } from '@/types/api'

export type ProjectScriptKind = 'setup' | 'run'

interface ProjectRunControlProps {
  project: ProjectRecord
  activeKind?: ProjectScriptKind
  setupError?: string
  onRun(kind: ProjectScriptKind): Promise<void> | void
  onStop(): void
  onSave(scripts: { setup: string; run: string }): Promise<void>
}

export function ProjectRunControl({ project, activeKind, setupError, onRun, onStop, onSave }: ProjectRunControlProps) {
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const runInputRef = useRef<HTMLTextAreaElement>(null)
  const [open, setOpen] = useState(false)
  const [setup, setSetup] = useState(project.scripts?.setup ?? '')
  const [run, setRun] = useState(project.scripts?.run ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const running = activeKind !== undefined

  useEffect(() => {
    setSetup(project.scripts?.setup ?? '')
    setRun(project.scripts?.run ?? '')
    setError('')
    setOpen(false)
  }, [project.id, project.scripts?.run, project.scripts?.setup])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', dismissOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', dismissOnEscape, true)
    }
  }, [open])

  const startScript = (kind: ProjectScriptKind) => {
    setError('')
    void Promise.resolve(onRun(kind)).catch((cause) => {
      setError(cause instanceof Error ? cause.message : `Could not start the ${kind} script`)
      setOpen(true)
    })
  }

  const runPrimary = () => {
    if (running) { onStop(); return }
    if (!project.scripts?.run.trim()) {
      setOpen(true)
      requestAnimationFrame(() => runInputRef.current?.focus())
      return
    }
    startScript('run')
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await onSave({ setup, run })
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save project scripts')
    } finally {
      setSaving(false)
    }
  }

  const setupStatus = (() => {
    const scripts = project.scripts
    if (!setup.trim()) return null
    if (activeKind === 'setup') return <span className="project-run-menu__status is-running"><StatusMark state="running" size={12} /> Setup running</span>
    if (scripts?.setup !== setup.trim() || scripts.setupLastRun !== scripts.setup) return <span className="project-run-menu__status">Runs automatically after save</span>
    if (setupError) return <span className="project-run-menu__status is-error"><WarningCircle size={12} /> Setup could not start: {setupError}</span>
    if (scripts.setupLastExitCode === 0) return <span className="project-run-menu__status is-success"><CheckCircle size={12} /> Setup completed</span>
    if (scripts.setupLastExitCode !== undefined) return <span className="project-run-menu__status is-error"><WarningCircle size={12} /> Setup exited with code {scripts.setupLastExitCode}</span>
    return <span className="project-run-menu__status">Setup did not finish</span>
  })()

  return (
    <div ref={rootRef} className="project-run-control">
      <div className={`project-run-split ${running ? 'is-running' : ''}`}>
        <IconButton
          size="small"
          title={running ? (activeKind === 'setup' ? 'Stop setup' : 'Stop project') : 'Run project'}
          className="project-run-split__primary"
          label={running ? `Stop ${activeKind} script` : 'Run project'}
          onClick={runPrimary}
        >
          {running ? <Square size={11} fill="currentColor" /> : <Play size={15} />}
        </IconButton>
        <IconButton
          size="small"
          title="Configure project scripts"
          className="project-run-split__menu"
          label="Configure project scripts"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          <CaretDown size={13} />
        </IconButton>
      </div>
      {open ? (
        <section id={menuId} className="project-run-menu" role="dialog" aria-label={`Scripts for ${project.name}`}>
          <header><strong>Project scripts</strong><small>{project.name}</small></header>
          <TextArea
            id={`${menuId}-setup`}
            label="Setup command"
            description="Runs once when first configured, and again whenever this command changes."
            rows={2}
            value={setup}
            placeholder="npm install"
            hasSpellCheck={false}
            controlClassName="mono"
            onChange={(value) => setSetup(value)}
          />
          {setupStatus}
          <TextArea
            ref={runInputRef}
            id={`${menuId}-run`}
            label="Run command"
            rows={2}
            value={run}
            placeholder="npm run dev"
            hasSpellCheck={false}
            controlClassName="mono"
            onChange={(value) => setRun(value)}
          />
          {error ? <Banner status="error" role="alert" className="project-run-menu__error" title={error} /> : null}
          <footer>
            <ApexButton variant="quiet" disabled={!project.scripts?.setup.trim() || running || saving} icon={<ArrowCounterClockwise size={13} />} onClick={() => startScript('setup')}>Run setup again</ApexButton>
            <ApexButton variant="primary" disabled={saving} icon={saving ? <CircleNotch className="spin" size={13} /> : undefined} onClick={() => void save()}>Save</ApexButton>
          </footer>
        </section>
      ) : null}
    </div>
  )
}
