import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex';
import * as stylex from '@stylexjs/stylex'
import { styles as terminalStyles, contextStyles as terminalContext, terminalTabMarker } from 'apex-ui/styles/terminal.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { ArrowsInSimple, ArrowsOutSimple, Lightning, Plus, Square, Terminal as TerminalIcon, Trash, X } from './icons'
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useMachine } from '@xstate/react'
import { terminalViewMachine } from './terminalViewMachine'
import { applyTerminalStyles, terminalTheme } from './terminalTheme'
import { BackgroundJobView } from './BackgroundJobView'
import type { BackgroundJobOutput } from '@/hooks/useBackgroundJobs'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { boundTerminalText, TERMINAL_CONTEXT_MAX_CHARS, TERMINAL_SELECTION_MAX_CHARS } from '@/lib/terminal-context'
import { openExternalUrl } from '@/lib/desktop-actions'
import { terminalLinkOpensExternally } from '@/lib/terminal-links'
import type { BackgroundJob, TerminalPromptContext } from '@/types/api'
import { IconButton } from './ui'
import { ResizeHandle } from './ResizeHandle'

interface TerminalDrawerProps {
  visible?: boolean
  instant?: boolean
  cwd?: string
  sessionPath?: string
  shell?: string
  initialCommand?: { id: string; command: string; label: string; onExit(outcome: TerminalCommandOutcome): void }
  /** Open without a shell tab; used when the drawer opens to show an agent background job. */
  startEmpty?: boolean
  jobs?: BackgroundJob[]
  jobOutput?: BackgroundJobOutput
  onStopJob?(key: string): void
  onDismissJob?(key: string): void
  height: number
  minHeight: number
  maxHeight: number
  defaultHeight: number
  onHeightChange(height: number): void
  onClose(): void
  onError?(message: string): void
  onOpenLink?(url: string, external: boolean): void
  onInitialCommandConsumed?(): void
  onReady?(): void
  onSelectionChange?(selection?: TerminalPromptContext): void
}

export type TerminalCommandOutcome = { exitCode: number } | { error: string } | { cancelled: true }

interface TerminalTab {
  id: string
  number: number
  shellName: string
  connected: boolean
  command?: string
  label?: string
}

interface TerminalViewHandle {
  fit(): void
  clear(): void
  clearSelection(): void
  readSelection(): Pick<TerminalPromptContext, 'text' | 'truncated'>
}

interface TerminalViewProps {
  cwd?: string
  sessionPath?: string
  shell?: string
  command?: string
  label: string
  visible: boolean
  onStateChange(state: Pick<TerminalTab, 'shellName' | 'connected'>): void
  onSelectionChange(text: string, truncated: boolean): void
  onError?(message: string): void
  onOpenLink?(url: string, external: boolean): void
  onExit?(outcome: TerminalCommandOutcome): void
}

export interface TerminalDrawerHandle {
  clearSelection(): void
  readSelectionContext(): TerminalPromptContext | undefined
  runCommand(command: string, label: string, onExit: (outcome: TerminalCommandOutcome) => void): string
  stopCommand(tabId: string): void
}

const MAX_TERMINAL_TABS = 8

function readTerminalContent(terminal: Terminal): { content: string; contentTruncated: boolean } {
  const buffer = terminal.buffer.active
  const lines: string[] = []
  let current = ''
  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index)
    if (!line) continue
    const text = line.translateToString(true)
    if (line.isWrapped) current += text
    else {
      if (current) lines.push(current)
      current = text
    }
  }
  if (current) lines.push(current)
  const bounded = boundTerminalText(lines.join('\n'), TERMINAL_CONTEXT_MAX_CHARS)
  return { content: bounded.text, contentTruncated: bounded.truncated }
}


const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView({ cwd, sessionPath, shell, command, label, visible, onStateChange, onSelectionChange, onError, onOpenLink, onExit }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const terminalIdRef = useRef<string | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionPathRef = useRef(sessionPath)
  const visibleRef = useRef(visible)
  const onStateChangeRef = useRef(onStateChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onErrorRef = useRef(onError)
  const onExitRef = useRef(onExit)
  const onOpenLinkRef = useRef(onOpenLink)
  const labelRef = useRef(label)
  const activeContextTimerRef = useRef<number | undefined>(undefined)
  visibleRef.current = visible
  sessionPathRef.current = sessionPath
  onStateChangeRef.current = onStateChange
  onSelectionChangeRef.current = onSelectionChange
  onErrorRef.current = onError
  onExitRef.current = onExit
  onOpenLinkRef.current = onOpenLink
  labelRef.current = label

  useImperativeHandle(ref, () => ({
    fit: () => { try { fitRef.current?.fit() } catch { /* drawer is transitioning */ } },
    clear: () => terminalRef.current?.clear(),
    clearSelection: () => terminalRef.current?.clearSelection(),
    readSelection: () => {
      const terminal = terminalRef.current
      return terminal ? boundTerminalText(terminal.getSelection(), TERMINAL_SELECTION_MAX_CHARS) : { text: '', truncated: false }
    },
  }), [])

  const publishActiveContext = () => {
    const terminal = terminalRef.current
    const terminalId = terminalIdRef.current
    if (!visibleRef.current || !terminal || !terminalId || !window.apex) return
    const content = readTerminalContent(terminal)
    window.apex.terminal.setActiveContext(terminalId, { label: labelRef.current, content: content.content, truncated: content.contentTruncated })
  }

  const scheduleActiveContext = () => {
    if (activeContextTimerRef.current !== undefined) return
    activeContextTimerRef.current = window.setTimeout(() => {
      activeContextTimerRef.current = undefined
      publishActiveContext()
    }, 100)
  }

  useEffect(() => {
    if (!visible) {
      const terminalId = terminalIdRef.current
      if (terminalId && window.apex) window.apex.terminal.clearActiveContext(terminalId)
      return
    }
    requestAnimationFrame(() => {
      try { fitRef.current?.fit() } catch { /* tab is transitioning */ }
      terminalRef.current?.focus()
      scheduleActiveContext()
    })
  }, [visible, label])

  useEffect(() => {
    const terminalId = terminalIdRef.current
    if (!terminalId || !window.apex) return
    void window.apex.terminal.bindSession(terminalId, sessionPath ?? null).then(() => scheduleActiveContext()).catch(() => undefined)
  }, [sessionPath])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"SFMono-Regular", "SF Mono", Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.45,
      scrollback: 5000,
      allowProposedApi: false,
      screenReaderMode: true,
      theme: terminalTheme(),
    })
    const fit = new FitAddon()
    const webLinks = new WebLinksAddon((event, uri) => {
      if (onOpenLinkRef.current) {
        onOpenLinkRef.current(uri, terminalLinkOpensExternally(event))
        return
      }
      if (!window.apex) return
      void openExternalUrl(window.apex.app, uri).then((failure) => {
        if (failure) onErrorRef.current?.(failure)
      })
    })
    terminal.loadAddon(fit)
    terminal.loadAddon(webLinks)
    terminal.open(container)
    applyTerminalStyles(terminal)
    terminalRef.current = terminal
    fitRef.current = fit
    // Spawn the shell at the drawer's real dimensions. Creating the PTY at
    // xterm's 80x24 default and fitting on the next frame makes zsh redraw its
    // first prompt, leaving its reverse-video `%` end-of-line marker behind.
    try { fit.fit() } catch { /* initial layout is not ready */ }
    requestAnimationFrame(() => { try { fit.fit() } catch { /* initial layout is not ready */ } })

    const themeObserver = new MutationObserver(() => { terminal.options.theme = terminalTheme() })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    let offData: (() => void) | undefined
    let offExit: (() => void) | undefined
    const announceExit = (exitCode: number) => {
      terminal.writeln(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m`)
      onStateChangeRef.current({ shellName: shell?.split('/').at(-1) ?? 'terminal', connected: false })
      onExitRef.current?.({ exitCode })
    }
    const inputDisposable = terminal.onData((data) => {
      const id = terminalIdRef.current
      if (id && window.apex) window.apex.terminal.input(id, data)
    })
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      const id = terminalIdRef.current
      if (id && window.apex) window.apex.terminal.resize(id, cols, rows)
    })
    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = boundTerminalText(terminal.getSelection(), TERMINAL_SELECTION_MAX_CHARS)
      onSelectionChangeRef.current(selection.text, selection.truncated)
    })

    if (window.apex && cwd) {
      // Subscribe before create resolves: a fast shell can emit its prompt or exit before the IPC reply.
      offData = window.apex.terminal.onData((event) => send({ type: 'DATA', event }))
      offExit = window.apex.terminal.onExit((event) => send({ type: 'EXIT', event }))
      send({ type: 'START', session: {
        create: () => window.apex.terminal.create({ cwd, shell, command, cols: terminal.cols, rows: terminal.rows }),
        kill: (terminalId) => { if (window.apex) void window.apex.terminal.kill(terminalId) },
        attach: ({ terminalId, shell: actualShell }, initialOutput) => {
          terminalIdRef.current = terminalId
          onStateChangeRef.current({ shellName: actualShell.split('/').at(-1) ?? actualShell, connected: true })
          const bindCurrentSession = async () => {
            if (sessionPathRef.current) await window.apex.terminal.bindSession(terminalId, sessionPathRef.current)
            scheduleActiveContext()
          }
          if (initialOutput) terminal.write(initialOutput, () => { void bindCurrentSession().catch(() => undefined) })
          else void bindCurrentSession().catch(() => undefined)
        },
        write: (data) => terminal.write(data, scheduleActiveContext),
        announceExit,
        fail: (error) => {
          const message = error instanceof Error ? error.message : 'Unable to start terminal'
          terminal.writeln(`\x1b[31m${message}\x1b[0m`)
          onErrorRef.current?.(message)
          onExitRef.current?.({ error: message })
        },
      } })
    } else {
      terminal.writeln('\x1b[38;5;141mGooeyPi terminal\x1b[0m')
      terminal.writeln('\x1b[90mA live PTY will connect when the desktop bridge and project are available.\x1b[0m')
      terminal.write('\r\n\x1b[32m➜\x1b[0m \x1b[36mapex\x1b[0m \x1b[90mgit:(main)\x1b[0m ')
    }

    const observer = new ResizeObserver(() => {
      if (!visibleRef.current) return
      requestAnimationFrame(() => { try { fit.fit() } catch { /* drawer is transitioning */ } })
    })
    observer.observe(container)
    return () => {
      themeObserver.disconnect()
      observer.disconnect()
      offData?.()
      offExit?.()
      inputDisposable.dispose()
      resizeDisposable.dispose()
      selectionDisposable.dispose()
      if (activeContextTimerRef.current !== undefined) window.clearTimeout(activeContextTimerRef.current)
      terminalIdRef.current = null
      send({ type: 'DISPOSE' })
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [command, cwd, shell])

  // Register actor cleanup after the xterm effect so DISPOSE runs before the actor stops.
  const [, send] = useMachine(terminalViewMachine)

  return <div className={`terminal-surface ${stylex.props(terminalStyles.terminalSurface, !visible && terminalContext.hidden).className ?? ""}`} ref={containerRef} hidden={!visible}/>
})

function createTab(number: number, shell?: string, command?: string, label?: string, id: string = crypto.randomUUID()): TerminalTab {
  return {
    id,
    number,
    shellName: shell?.split('/').at(-1) ?? 'zsh',
    connected: false,
    command,
    label,
  }
}
export const TerminalDrawer = forwardRef<TerminalDrawerHandle, TerminalDrawerProps>(function TerminalDrawer({ visible = true, instant: instantProp = false, cwd, sessionPath, shell, initialCommand, startEmpty = false, jobs = [], jobOutput, onStopJob, onDismissJob, height, minHeight, maxHeight, defaultHeight, onHeightChange, onClose, onError, onInitialCommandConsumed, onOpenLink, onReady, onSelectionChange }, ref) {
  const drawerInstanceId = useId()
  const instant = Boolean(useReducedMotion()) || (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) || Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)
  const firstTabRef = useRef<TerminalTab | null | undefined>(undefined)
  const commandExitsRef = useRef(new Map<string, (outcome: TerminalCommandOutcome) => void>())
  if (firstTabRef.current === undefined) {
    firstTabRef.current = startEmpty && !initialCommand ? null : createTab(1, shell, initialCommand?.command, initialCommand?.label, initialCommand?.id)
    if (initialCommand) commandExitsRef.current.set(initialCommand.id, initialCommand.onExit)
  }
  const nextNumberRef = useRef(2)
  const viewRefs = useRef(new Map<string, TerminalViewHandle>())
  const [tabs, setTabs] = useState<TerminalTab[]>(() => firstTabRef.current ? [firstTabRef.current] : [])
  const [activeTabId, setActiveTabId] = useState(() => firstTabRef.current?.id ?? '')
  const [maximized, setMaximized] = useState(false)
  const [prevVisible, setPrevVisible] = useState(visible)
  const [instantDrawer, setInstantDrawer] = useState(instant || instantProp)
  const [closing, setClosing] = useState(false)
  if (visible !== prevVisible) {
    const skip = instant || instantProp
    setPrevVisible(visible)
    setInstantDrawer(skip)
    setClosing(prevVisible && !visible && !skip)
  }
  useEffect(() => {
    if (instant && closing) setClosing(false)
  }, [instant, closing])
  const [hiddenJobKeys, setHiddenJobKeys] = useState<ReadonlySet<string>>(() => new Set())
  const knownJobKeysRef = useRef(new Set<string>())
  const visibleJobs = jobs.filter((job) => !hiddenJobKeys.has(job.key))
  const activeJob = visibleJobs.find((job) => job.key === activeTabId)

  // Newly started jobs take focus; jobs that already existed when the drawer mounted do not.
  useEffect(() => {
    const fresh = jobs.filter((job) => !knownJobKeysRef.current.has(job.key))
    for (const job of fresh) knownJobKeysRef.current.add(job.key)
    const focus = fresh.filter((job) => job.status === 'running' && Date.now() - job.startedAt < 15_000).at(-1)
    if (focus) setActiveTabId(focus.key)
  }, [jobs])

  // Keep a valid selection when the active job tab is removed or hidden.
  useEffect(() => {
    if (tabs.some((tab) => tab.id === activeTabId) || visibleJobs.some((job) => job.key === activeTabId)) return
    const fallback = tabs.at(-1)?.id ?? visibleJobs.at(-1)?.key
    if (fallback) setActiveTabId(fallback)
  }, [activeTabId, tabs, visibleJobs])
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const onSelectionChangeRef = useRef(onSelectionChange)
  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId
  onSelectionChangeRef.current = onSelectionChange

  useEffect(() => {
    if (initialCommand) onInitialCommandConsumed?.()
  }, [])
  useEffect(() => { onReady?.() }, [])
  // The one shape every selection consumer sees: what the composer shows is what it sends.
  const selectionContext = (tab: TerminalTab, value: { text: string; truncated: boolean }): TerminalPromptContext =>
    ({ tabId: tab.id, label: tab.label ?? `${tab.shellName} ${tab.number}`, cwd, text: value.text, truncated: value.truncated })
  const currentSelection = (tabId: string): TerminalPromptContext | undefined => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
    const value = viewRefs.current.get(tabId)?.readSelection()
    return tab && value?.text ? selectionContext(tab, value) : undefined
  }

  useImperativeHandle(ref, () => ({
    clearSelection: () => viewRefs.current.get(activeTabIdRef.current)?.clearSelection(),
    readSelectionContext: () => currentSelection(activeTabIdRef.current),
    runCommand: (command, label, onExit) => {
      if (tabsRef.current.length >= MAX_TERMINAL_TABS) throw new Error(`Apex supports at most ${MAX_TERMINAL_TABS} concurrent terminals.`)
      const tab = createTab(nextNumberRef.current++, shell, command, label)
      commandExitsRef.current.set(tab.id, onExit)
      setTabs((current) => [...current, tab])
      setActiveTabId(tab.id)
      return tab.id
    },
    stopCommand: (tabId) => closeTerminal(tabId),
  }), [cwd, shell, tabs])

  useEffect(() => {
    onSelectionChangeRef.current?.(visible ? currentSelection(activeTabId) : undefined)
  }, [activeTabId, visible])

  useEffect(() => () => onSelectionChangeRef.current?.(undefined), [])

  const addTerminal = () => {
    if (tabs.length >= MAX_TERMINAL_TABS) {
      onError?.(`Apex supports at most ${MAX_TERMINAL_TABS} concurrent terminals.`)
      return
    }
    const tab = createTab(nextNumberRef.current++, shell)
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
  }

  const closeTerminal = (tabId: string) => {
    const index = tabs.findIndex((tab) => tab.id === tabId)
    if (index === -1) return
    finishCommand(tabId, { cancelled: true })
    if (tabs.length + visibleJobs.length === 1) {
      onClose()
      return
    }
    const nextTabs = tabs.filter((candidate) => candidate.id !== tabId)
    setTabs(nextTabs)
    viewRefs.current.delete(tabId)
    if (activeTabId === tabId) setActiveTabId(nextTabs[Math.min(index, nextTabs.length - 1)]?.id ?? visibleJobs.at(-1)?.key ?? '')
  }

  // Closing a running job's tab only hides it; the agent still owns the process.
  const closeJob = (job: BackgroundJob) => {
    if (tabs.length + visibleJobs.length === 1) onClose()
    if (job.status === 'running') setHiddenJobKeys((current) => new Set(current).add(job.key))
    else onDismissJob?.(job.key)
  }

  const updateTab = (tabId: string, state: Pick<TerminalTab, 'shellName' | 'connected'>) => {
    setTabs((current) => current.map((tab) => tab.id === tabId ? { ...tab, ...state } : tab))
  }

  const finishCommand = (tabId: string, outcome: TerminalCommandOutcome) => {
    const callback = commandExitsRef.current.get(tabId)
    if (!callback) return
    commandExitsRef.current.delete(tabId)
    callback(outcome)
  }

  return (
    <motion.section className={[`terminal-drawer ${maximized ? 'is-maximized' : ''}`, stylex.props(terminalStyles.terminalDrawer, (maximized) && terminalStyles.terminalDrawerIsMaximized, [responsiveStyles.terminalDrawer, (maximized ? responsiveLayoutStyles.terminalDrawerMaximized : responsiveLayoutStyles.terminalDrawer)], (!visible && !closing) && terminalContext.hidden).className].filter(Boolean).join(' ')} aria-label="Integrated terminal" hidden={!visible && !closing} inert={!visible || undefined} initial={instantDrawer ? false : { opacity: 0, y: 8 }} animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }} transition={instantDrawer ? { duration: 0 } : { duration: visible ? 0.18 : 0.13, ease: [0.32, 0.72, 0, 1] }} onAnimationComplete={() => { if (!visible) setClosing(false); else viewRefs.current.get(activeTabIdRef.current)?.fit() }}>
      {!maximized ? <ResizeHandle orientation="horizontal" label="Resize terminal" value={height} min={minHeight} max={maxHeight} defaultValue={defaultHeight} onChange={onHeightChange} /> : null}
      <div className={`terminal-toolbar ${stylex.props(terminalStyles.terminalToolbar).className ?? ""}`}>
        <div className={`terminal-tabs ${stylex.props(terminalStyles.terminalTabs).className ?? ""}`} role="tablist" aria-label="Terminal tabs">
          {(() => {
            const tabElements = [
              ...tabs.map((tab) => (
                <motion.div
                  layout="position"
                  initial={instant ? false : { opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={instant ? undefined : { opacity: 0, scale: 0.95 }}
                  transition={instant ? { duration: 0 } : { duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                  className={[`terminal-tab ${tab.id === activeTabId ? 'is-active' : ''}`, stylex.props(terminalStyles.terminalTab, (tab.id === activeTabId) && terminalStyles.terminalTabIsActive, terminalTabMarker).className].filter(Boolean).join(' ')}
                  key={tab.id}
                >
                  {tab.id === activeTabId ? (
                    <motion.span
                      layoutId={`terminal-tab-active-${drawerInstanceId}`}
                      {...stylex.props(terminalStyles.terminalTabIndicator)}
                      transition={instant ? { duration: 0 } : { type: 'spring', duration: 0.24, bounce: 0 }}
                    />
                  ) : null}
                  <button type="button" {...stylex.props(terminalContext.tabButton)} role="tab" aria-selected={tab.id === activeTabId} onClick={() => setActiveTabId(tab.id)}>
                    <TerminalIcon size={14}/>

                    <span>{tab.label ?? `${tab.shellName} ${tab.number}`}</span>
                    <span className={[`terminal-live-dot ${tab.connected ? 'is-connected' : ''}`, stylex.props(terminalStyles.terminalLiveDot, (tab.connected) && terminalStyles.terminalLiveDotIsConnected).className].filter(Boolean).join(' ')}/>
                  </button>
                  <button type="button" className={`terminal-tab__close ${stylex.props(terminalStyles.terminalTabClose, tab.id === activeTabId && terminalContext.closeActive).className ?? ""}`} aria-label={`Close tab ${tab.number}`} onClick={() => closeTerminal(tab.id)}><X size={11}/></button>
                </motion.div>
              )),
              ...visibleJobs.map((job) => (
                <motion.div
                  layout="position"
                  initial={instant ? false : { opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={instant ? undefined : { opacity: 0, scale: 0.95 }}
                  transition={instant ? { duration: 0 } : { duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                  className={[`terminal-tab ${job.key === activeTabId ? 'is-active' : ''}`, stylex.props(terminalStyles.terminalTab, (job.key === activeTabId) && terminalStyles.terminalTabIsActive, terminalTabMarker).className].filter(Boolean).join(' ')}
                  key={job.key}
                >
                  {job.key === activeTabId ? (
                    <motion.span
                      layoutId={`terminal-tab-active-${drawerInstanceId}`}
                      {...stylex.props(terminalStyles.terminalTabIndicator)}
                      transition={instant ? { duration: 0 } : { type: 'spring', duration: 0.24, bounce: 0 }}
                    />
                  ) : null}
                  <button type="button" {...stylex.props(terminalContext.tabButton)} role="tab" aria-selected={job.key === activeTabId} title={`${job.id} · ${job.command}`} onClick={() => setActiveTabId(job.key)}>
                    <Lightning size={14}/>
                    <span>{job.title}</span>
                    <span className={[`terminal-live-dot ${job.status === 'running' ? 'is-connected' : ''}`, stylex.props(terminalStyles.terminalLiveDot, (job.status === 'running') && terminalStyles.terminalLiveDotIsConnected).className].filter(Boolean).join(' ')}/>
                  </button>
                  <button type="button" className={`terminal-tab__close ${stylex.props(terminalStyles.terminalTabClose, job.key === activeTabId && terminalContext.closeActive).className ?? ""}`} aria-label={job.status === 'running' ? `Hide ${job.id}` : `Dismiss ${job.id}`} onClick={() => closeJob(job)}><X size={11}/></button>
                </motion.div>
              )),
            ]
            return instant ? tabElements : <AnimatePresence initial={false}>{tabElements}</AnimatePresence>
          })()}
          <IconButton label="New terminal" size="small" disabled={tabs.length >= MAX_TERMINAL_TABS} onClick={addTerminal}><Plus size={14}/></IconButton>
        </div>
        <div className={`terminal-actions ${stylex.props(terminalStyles.terminalActions).className ?? ""}`}>
          <span className={`terminal-cwd ${stylex.props(terminalStyles.terminalCwd, responsiveStyles.terminalCwd).className ?? ""}`} title={cwd}>{cwd?.split('/').at(-1) ?? 'No project'}</span>
          {activeJob?.status === 'running' ? <IconButton xstyle={terminalStyles.terminalHeaderButton} label={activeJob.stopping ? `Stopping ${activeJob.id}` : `Stop ${activeJob.id}`} disabled={activeJob.stopping || !activeJob.connected} onClick={() => onStopJob?.(activeJob.key)}><Square size={16}/></IconButton> : null}
          <IconButton xstyle={terminalStyles.terminalHeaderButton} label="Clear terminal" onClick={() => viewRefs.current.get(activeTabId)?.clear()}><Trash size={16}/></IconButton>
          <IconButton xstyle={terminalStyles.terminalHeaderButton} label={maximized ? 'Restore terminal' : 'Maximize terminal'} onClick={() => setMaximized((value) => !value)}>{maximized ? <ArrowsInSimple size={16}/> : <ArrowsOutSimple size={16}/>}</IconButton>
          <IconButton xstyle={terminalStyles.terminalHeaderButton} label="Close terminal" onClick={onClose}><X size={16}/></IconButton>
        </div>
      </div>
      <div className={`terminal-views ${stylex.props(terminalStyles.terminalViews).className ?? ""}`}>
        {tabs.map((tab) => (
          <TerminalView
            key={tab.id}
            ref={(handle) => { if (handle) viewRefs.current.set(tab.id, handle); else viewRefs.current.delete(tab.id) }}
            cwd={cwd}
            sessionPath={sessionPath}
            shell={shell}
            command={tab.command}
            label={tab.label ?? `${tab.shellName} ${tab.number}`}
            visible={visible && tab.id === activeTabId}
            onStateChange={(state) => updateTab(tab.id, state)}
            onSelectionChange={(text, truncated) => {
              if (activeTabIdRef.current !== tab.id) return
              onSelectionChangeRef.current?.(text ? selectionContext(tab, { text, truncated }) : undefined)
            }}
            onError={onError}
            onOpenLink={onOpenLink}
            onExit={(outcome) => finishCommand(tab.id, outcome)}
          />
        ))}
        {jobOutput ? visibleJobs.map((job) => (
          <BackgroundJobView key={job.key} job={job} output={jobOutput} visible={visible && job.key === activeTabId} onOpenLink={onOpenLink}/>
        )) : null}
      </div>
    </motion.section>
  )
})
