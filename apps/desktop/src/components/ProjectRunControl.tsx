import * as stylex from '@stylexjs/stylex'
import { styles as workbenchStyles } from 'apex-ui/styles/workbench.stylex'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CaretDown, Check, Play, Square } from './icons'
import { IconButton } from './ui'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { availableProjectScripts, resolveSelectedProjectScript } from '@/lib/project-scripts'
import type { DiscoveredProjectScript, ProjectRecord } from '@/types/api'

export type ProjectScriptKind = 'setup' | 'run'
export type ProjectScriptTarget = ProjectScriptKind | { command: string; label?: string }

interface ProjectRunControlProps {
  project: ProjectRecord
  activeKind?: ProjectScriptKind
  onRun(target: ProjectScriptTarget): Promise<void> | void
  onStop(): void
}

function readStoredScriptName(projectId: string): string | null {
  try {
    return window.localStorage.getItem(`apex.project-script:${projectId}`)
  } catch {
    return null
  }
}

function writeStoredScriptName(projectId: string, name: string): void {
  try {
    window.localStorage.setItem(`apex.project-script:${projectId}`, name)
  } catch {
    // Ignore storage errors in restricted environments.
  }
}

export function ProjectRunControl({ project, activeKind, onRun, onStop }: ProjectRunControlProps) {
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [selectedName, setSelectedName] = useState<string | null>(() => readStoredScriptName(project.id))
  const prefersReducedMotion = useReducedMotion()
  const instant = Boolean(prefersReducedMotion)
    || Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)

  const running = activeKind !== undefined
  const availableScripts = useMemo(
    () => availableProjectScripts(project),
    [project.discoveredScripts, project.scripts],
  )
  const selected = useMemo(
    () => resolveSelectedProjectScript(availableScripts, selectedName),
    [availableScripts, selectedName],
  )

  useEffect(() => {
    setSelectedName(readStoredScriptName(project.id))
    setOpen(false)
  }, [project.id])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', dismissOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', dismissOnEscape, true)
    }
  }, [open])

  if (availableScripts.length === 0 && !running) return null

  const startScript = (script: DiscoveredProjectScript) => {
    void Promise.resolve(onRun({ command: script.command, label: script.name })).catch(() => undefined)
  }

  const selectScript = (script: DiscoveredProjectScript) => {
    setSelectedName(script.name)
    writeStoredScriptName(project.id, script.name)
  }

  const runPrimary = () => {
    if (running) {
      onStop()
      return
    }
    if (!selected) return
    startScript(selected)
  }

  const hasMenu = availableScripts.length > 1

  return (
    <div ref={rootRef} className={`project-run-control ${stylex.props(workbenchStyles.projectRunControl).className ?? ''}`}>
      <div className={[`project-run-split ${running ? 'is-running' : ''}`, stylex.props(workbenchStyles.projectRunSplit, running && workbenchStyles.projectRunSplitIsRunning).className].filter(Boolean).join(' ')}>
        <IconButton
          xstyle={[workbenchStyles.projectRunSplitPrimary]}
          title={running ? 'Stop project' : (selected ? `Run ${selected.name} (${selected.command})` : 'Run project')}
          className="project-run-split__primary"
          label={running ? 'Stop project script' : (selected ? `Run ${selected.name}` : 'Run project')}
          onClick={runPrimary}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={running ? 'stop' : 'run'}
              style={{ display: 'inline-flex' }}
              initial={instant ? false : { opacity: 0, scale: 0.5, filter: 'blur(3px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={instant ? undefined : { opacity: 0, scale: 0.5, filter: 'blur(3px)' }}
              transition={instant ? { duration: 0 } : { type: 'spring', duration: 0.25, bounce: 0 }}
            >
              {running ? <Square size={16} fill="currentColor" /> : <Play size={16} />}
            </motion.span>
          </AnimatePresence>
        </IconButton>
        {hasMenu ? (
          <IconButton
            xstyle={[workbenchStyles.projectRunSplitMenu]}
            title="Select project script"
            className="project-run-split__menu"
            label="Select project script"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={() => setOpen((value) => !value)}
          >
            <CaretDown size={14} />
          </IconButton>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {open && hasMenu ? (
          <motion.div
            id={menuId}
            role="menu"
            aria-label={`Scripts for ${project.name}`}
            className={`project-run-menu project-run-menu--scripts ${stylex.props(workbenchStyles.projectRunMenu).className ?? ''}`}
            style={{ transformOrigin: 'top right' }}
            initial={instant ? false : { opacity: 0, scale: 0.96, y: -2 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={instant ? undefined : { opacity: 0, scale: 0.96, y: -2, transition: { duration: 0.10, ease: [0.2, 0, 0, 1] } }}
            transition={instant ? { duration: 0 } : { duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
          >
            {availableScripts.map((script) => {
              const isSelected = selected?.name === script.name
              return (
                <button
                  key={script.name}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  className={`project-run-menu__item${isSelected ? ' is-selected' : ''}`}
                  onClick={() => {
                    selectScript(script)
                    setOpen(false)
                    startScript(script)
                  }}
                >
                  <span className="project-run-menu__item-text">
                    <strong>{script.name}</strong>
                    <code className="mono">{script.command}</code>
                  </span>
                  <span className="project-run-menu__item-check" aria-hidden="true">
                    {isSelected ? <Check size={12} /> : null}
                  </span>
                </button>
              )
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
