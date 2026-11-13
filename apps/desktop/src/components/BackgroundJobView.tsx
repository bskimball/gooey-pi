import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { BackgroundJob } from '@/types/api'
import type { BackgroundJobOutput } from '@/hooks/useBackgroundJobs'
import { terminalLinkOpensExternally } from '@/lib/terminal-links'
import { terminalTheme } from './terminalTheme'

interface BackgroundJobViewProps {
  job: BackgroundJob
  output: BackgroundJobOutput
  visible: boolean
  onOpenLink?(url: string, external: boolean): void
}

function statusLine(job: BackgroundJob): string | undefined {
  if (job.status === 'running') return undefined
  const exit = job.exitCode === null ? '' : ` with code ${job.exitCode}`
  const signal = job.signal ? ` (${job.signal})` : ''
  return `\r\n\x1b[90m[${job.id} ${job.status}${exit}${signal}]\x1b[0m`
}

/** Read-only xterm mirror of an agent background job; the agent extension owns the process. */
export function BackgroundJobView({ job, output, visible, onOpenLink }: BackgroundJobViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const announcedRef = useRef<string | undefined>(undefined)
  const visibleRef = useRef(visible)
  const onOpenLinkRef = useRef(onOpenLink)
  visibleRef.current = visible
  onOpenLinkRef.current = onOpenLink

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const terminal = new Terminal({
      disableStdin: true,
      convertEol: true,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'none',
      fontFamily: '"SFMono-Regular", "SF Mono", Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.45,
      scrollback: 5000,
      screenReaderMode: true,
      theme: terminalTheme(),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(new WebLinksAddon((event, uri) => onOpenLinkRef.current?.(uri, terminalLinkOpensExternally(event))))
    terminal.open(container)
    terminalRef.current = terminal
    fitRef.current = fit
    try { fit.fit() } catch { /* initial layout is not ready */ }

    terminal.writeln(`\x1b[90m$ ${job.command.replaceAll('\n', ' ')}\x1b[0m`)
    terminal.write(output.read(job.key))
    const off = output.subscribe(job.key, ({ reset, data }) => {
      if (reset) {
        terminal.reset()
        announcedRef.current = undefined
        terminal.writeln(`\x1b[90m$ ${job.command.replaceAll('\n', ' ')}\x1b[0m`)
      }
      terminal.write(data)
    })
    const themeObserver = new MutationObserver(() => { terminal.options.theme = terminalTheme() })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const resizeObserver = new ResizeObserver(() => {
      if (!visibleRef.current) return
      requestAnimationFrame(() => { try { fit.fit() } catch { /* drawer is transitioning */ } })
    })
    resizeObserver.observe(container)
    return () => {
      off()
      themeObserver.disconnect()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [job.key, output])

  useEffect(() => {
    const line = statusLine(job)
    const terminal = terminalRef.current
    if (!line || !terminal || announcedRef.current === line) return
    announcedRef.current = line
    terminal.writeln(line)
  }, [job.status, job.exitCode, job.signal])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => { try { fitRef.current?.fit() } catch { /* tab is transitioning */ } })
  }, [visible])

  return <div className="terminal-surface" ref={containerRef} hidden={!visible}/>
}
