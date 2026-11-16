import * as stylex from '@stylexjs/stylex'
import { styles as agentsStyles } from 'apex-ui/styles/agents.stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { styles as activityStyles } from 'apex-ui/styles/activity.stylex'
import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react'
import { isLiveSpecialist, shortModelName, specialistMarkState, specialistStatusLabel } from '@/lib/specialist-status'
import { ApexButton } from '../ui'
import { extractPiSpecialistSessions, type PiSpecialistSession } from '@/lib/specialist-records'
import { CaretRight, Question, WarningCircle } from '../icons'
import { StatusMark } from '../activity/StatusMark'
import type { MessagePart, TranscriptMessage } from '@/types/api'
import { coalesceAssistantTurns } from '../transcript/grouping'
import { MarkdownScopeContext, MarkdownText } from '../MarkdownText'
import { renderNarrativeWithActivity } from '../transcript/messages'
import { SpecialistFiles } from './SpecialistMatrix'
import { observedPath } from '@/lib/specialist-evidence'

export { extractPiSpecialistSessions, type PiSpecialistSession } from '@/lib/specialist-records'


/** Agents panel tab order: live agents in start order, then finished agents most recent first. */
export function orderSpecialistTabs<T extends { status: PiSpecialistSession['status'] }>(specialists: readonly T[]): T[] {
  return [
    ...specialists.filter((spec) => isLiveSpecialist(spec.status)),
    ...specialists.filter((spec) => !isLiveSpecialist(spec.status)).reverse(),
  ]
}

interface SpecialistsPanelProps {
  messages: TranscriptMessage[]
  selectedId: string | null
  onSelect(id: string): void
  homeDir?: string
  sessionKey?: string
  cwd?: string
}

function WorkOrderTurn({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const { label, body, lineCount } = useMemo(() => {
    const modeMatch = /^\*\*\[([^\]]+)\]\*\*\n\n([\s\S]*)$/.exec(text)
    const rawBody = (modeMatch ? modeMatch[2] : text) ?? text
    const trimmed = rawBody.trim()
    return {
      label: modeMatch?.[1] ? `Follow-up · ${modeMatch[1]}` : 'Work order',
      body: rawBody,
      lineCount: trimmed ? trimmed.split(/\r?\n/).length : 0,
    }
  }, [text])
  return (
    <article className={[`specialist-turn specialist-turn--user${open ? ' is-open' : ''}`, stylex.props(agentsStyles.specialistTurn, agentsStyles.specialistTurnUser).className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="specialist-turn__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <CaretRight size={12} aria-hidden="true" className={`disclosure-caret ${stylex.props(transcriptStyles.disclosureCaret).className ?? ""}`} />
        <span className={`specialist-turn__label ${stylex.props(agentsStyles.specialistTurnLabel).className ?? ""}`}>{label}</span>
        {lineCount > 0 ? <span className={`specialist-turn__meta ${stylex.props(agentsStyles.specialistTurnMeta).className ?? ""}`}>{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span> : null}
      </button>
      {open ? (
        <div className={`specialist-turn__content scroll-area ${stylex.props(baseStyles.scrollArea).className ?? ""}`}>
          <MarkdownText variant="workOrder" text={body} />
        </div>
      ) : null}
    </article>
  )
}

export const SpecialistsPanel = memo(function SpecialistsPanel({
  messages,
  selectedId,
  onSelect,
  homeDir,
  sessionKey,
  cwd,
}: SpecialistsPanelProps) {
  const specialists = useMemo(() => extractPiSpecialistSessions(messages), [messages])
  const tabs = useMemo(() => orderSpecialistTabs(specialists), [specialists])
  const liveTabCount = tabs.filter((spec) => isLiveSpecialist(spec.status)).length
  const active = useMemo(
    () => specialists.find((spec) => spec.id === selectedId) ?? specialists.find((spec) => isLiveSpecialist(spec.status)) ?? specialists.at(-1),
    [specialists, selectedId],
  )
  const [diskTranscript, setDiskTranscript] = useState<{
    sessionKey: string | undefined
    specId: string
    path: string
    status: PiSpecialistSession['status']
    messages: TranscriptMessage[]
  } | null>(null)

  const candidateSessionPath = useMemo(() => {
    if (!active) return undefined
    if (active.sessionFile) return active.sessionFile
    if (active.instanceId && homeDir) {
      return `${homeDir.replace(/\/+$/, '')}/.pi/agent/sessions/rpc-workers/${active.instanceId}/worker.jsonl`
    }
    return undefined
  }, [active, homeDir])

  useEffect(() => {
    if (!active || !candidateSessionPath || typeof window === 'undefined' || !window.apex?.sessions?.read) {
      setDiskTranscript(null)
      return
    }
    let cancelled = false
    const targetId = active.id
    const targetPath = candidateSessionPath
    const targetSessionKey = sessionKey
    const targetStatus = active.status
    setDiskTranscript((current) =>
      current && current.sessionKey === targetSessionKey && current.specId === targetId && current.path === targetPath
        ? current
        : null,
    )
    const load = () => {
      void window.apex.sessions.read(targetPath).then((loaded) => {
        if (cancelled) return
        if (Array.isArray(loaded) && loaded.length > 0) {
          setDiskTranscript({ sessionKey: targetSessionKey, specId: targetId, path: targetPath, status: targetStatus, messages: loaded })
        } else {
          setDiskTranscript((current) =>
            current?.sessionKey === targetSessionKey && current?.specId === targetId && current?.path === targetPath
              ? null
              : current,
          )
        }
      }).catch(() => {
        if (cancelled) return
        setDiskTranscript((current) =>
          current?.sessionKey === targetSessionKey && current?.specId === targetId && current?.path === targetPath
            ? null
            : current,
        )
      })
    }
    load()
    if (!isLiveSpecialist(active.status)) {
      return () => { cancelled = true }
    }
    const pushes = window.apex.specialists
    if (pushes?.watchWorkers && pushes.onWorkerChanged) {
      // The main process watches the worker's transcript and says when it changes.
      const unsubscribe = pushes.onWorkerChanged((change) => { if (change.workerFile === targetPath) load() })
      void pushes.watchWorkers([targetPath]).catch(() => undefined)
      // A slow safety net for filesystem events the platform drops.
      const timer = window.setInterval(load, 10_000)
      return () => {
        cancelled = true
        unsubscribe()
        window.clearInterval(timer)
        void pushes.watchWorkers([]).catch(() => undefined)
      }
    }
    const timer = window.setInterval(load, 1_200)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [active?.id, active?.status, active?.activity, active?.turns, candidateSessionPath, sessionKey])

  const tabstripRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLElement>(null)
  const pinnedToBottomRef = useRef(true)
  const awaitingReportRef = useRef(false)
  const positionedScrollTopRef = useRef<number | null>(null)
  const [following, setFollowing] = useState(true)
  const previousTargetRef = useRef<{ key: string; status: PiSpecialistSession['status'] } | null>(null)
  const matchedDiskTranscript =
    active !== undefined &&
    candidateSessionPath !== undefined &&
    diskTranscript !== null &&
    diskTranscript.sessionKey === sessionKey &&
    diskTranscript.specId === active.id &&
    diskTranscript.path === candidateSessionPath &&
    diskTranscript.messages.length > 0
      ? diskTranscript.messages
      : null
  const rawTranscript = active ? (matchedDiskTranscript ?? active.messages) : []
  const renderedMessages = useMemo(() => coalesceAssistantTurns(rawTranscript), [rawTranscript])
  const scrollTargetKey = active ? `${sessionKey ?? ''}:${active.id}` : null
  const finalReport = active?.status === 'done' ? active.finalReport : undefined
  const report = useMemo(() => {
    if (!finalReport) return null
    for (let index = renderedMessages.length - 1; index >= 0; index--) {
      const message = renderedMessages[index]
      if (message.role !== 'assistant') continue
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = message.parts[partIndex]
        if (part.type === 'text' && part.text.trim() === finalReport.trim()) return { messageId: message.id, partIndex }
      }
    }
    return null
  }, [finalReport, renderedMessages])

  useEffect(() => {
    if (!scrollTargetKey || !active) { previousTargetRef.current = null; return }
    const previous = previousTargetRef.current
    const switched = previous?.key !== scrollTargetKey
    const finished = previous !== null && isLiveSpecialist(previous.status) && !isLiveSpecialist(active.status)
    previousTargetRef.current = { key: scrollTargetKey, status: active.status }
    if (switched) {
      pinnedToBottomRef.current = isLiveSpecialist(active.status)
      awaitingReportRef.current = active.status === 'done'
      setFollowing(pinnedToBottomRef.current)
    }
    if (!switched && !awaitingReportRef.current && !(pinnedToBottomRef.current && (isLiveSpecialist(active.status) || finished))) return
    const position = () => {
      const scroller = scrollRef.current
      if (!scroller) return
      if (active.status === 'done' && resultRef.current) {
        if (!awaitingReportRef.current && !pinnedToBottomRef.current) return
        scroller.scrollTop += resultRef.current.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        awaitingReportRef.current = Boolean(candidateSessionPath && (!matchedDiskTranscript || diskTranscript?.status !== active.status))
        pinnedToBottomRef.current = false
        setFollowing(false)
      } else if (isLiveSpecialist(active.status)) {
        if (!pinnedToBottomRef.current) return
        scroller.scrollTop = scroller.scrollHeight
      } else scroller.scrollTop = 0
      positionedScrollTopRef.current = scroller.scrollTop
    }
    position()
    const frame = requestAnimationFrame(position)
    return () => cancelAnimationFrame(frame)
  }, [scrollTargetKey, renderedMessages, active?.activity, active?.status, finalReport, candidateSessionPath, matchedDiskTranscript, diskTranscript?.status])

  useEffect(() => {
    const activeTab = tabstripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    activeTab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active?.id])

  if (!specialists.length || !active) {
    return (
      <div className={`inspector-scroll scroll-area specialists-panel ${stylex.props(baseStyles.scrollArea, inspectorStyles.inspectorScroll, agentsStyles.specialistsPanel).className ?? ""}`}>
        <div className={`specialists-empty ${stylex.props(agentsStyles.specialistsEmpty).className ?? ""}`}>
          <p>No sub-agents have run in this session yet.</p>
          <small>When Pi delegates work via task or task_start, each specialist’s live session transcript appears here.</small>
        </div>
      </div>
    )
  }

  const failure = active.status === 'error' ? active.killReason ?? [...rawTranscript].reverse().find((message) => message.errorMessage)?.errorMessage : active.killReason
  const turnsBadge = active.turns !== undefined
    ? active.maxTurns !== undefined ? `${active.turns}/${active.maxTurns} turns` : `${active.turns} ${active.turns === 1 ? 'turn' : 'turns'}`
    : undefined
  const detailBadges = [
    !/^task_\d+$/.test(active.id) ? active.id : undefined,
    active.model,
    active.thinking ? `think:${active.thinking}` : undefined,
    active.generation !== undefined ? `gen ${active.generation}` : undefined,
  ].filter((item): item is string => Boolean(item))
  const hasUserTurn = renderedMessages.some((m) => m.role === 'user' && m.parts.some((p) => p.type === 'text' && Boolean(p.text.trim())))
  const activeStatus = specialistStatusLabel[active.status]
  let assistantTurnCount = 0

  return (
    <MarkdownScopeContext.Provider value="specialist"><div className={`specialists-panel ${stylex.props(agentsStyles.specialistsPanel).className ?? ""}`}>
      <div
        ref={tabstripRef}
        className={`specialist-tabstrip scroll-area ${stylex.props(baseStyles.scrollArea, agentsStyles.specialistTabstrip).className ?? ""}`}
        role="tablist"
        aria-label="Session specialists"
        onWheel={(event) => {
          const strip = event.currentTarget
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && strip.scrollWidth > strip.clientWidth) {
            strip.scrollLeft += event.deltaY
          }
        }}
      >
        {tabs.map((spec, index) => {
          const isSelected = spec.id === active.id
          const status = specialistStatusLabel[spec.status]
          const model = shortModelName(spec.model)
          return (
            <Fragment key={spec.id}>
            {index === liveTabCount && liveTabCount > 0 ? <span className={`specialist-tabstrip__divider ${stylex.props(agentsStyles.specialistTabDivider).className ?? ''}`} aria-hidden="true" /> : null}
            <button
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-label={`${spec.agent} ${spec.id}${model ? ` (${model})` : ''}: ${status}. ${spec.mission || 'No task recorded'}`}
              title={`${spec.mission} · ${model ? `${model} · ` : ''}${status}`}
              tabIndex={isSelected ? 0 : -1}
              onKeyDown={(event) => {
                const destinations: Record<string, number> = { ArrowRight: (index + 1) % tabs.length, ArrowDown: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length, ArrowUp: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }
                const next = destinations[event.key]
                if (next === undefined) return
                event.preventDefault()
                onSelect(tabs[next].id)
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
              }}
              className={[`specialist-tabstrip__item ${isSelected ? 'is-active' : ''} is-${spec.status}`, stylex.props(agentsStyles.specialistTabstripItem, (isSelected) && agentsStyles.specialistTabstripItemIsActive, ((spec.status === "running")) && agentsStyles.specialistTabstripItemIsRunning, ((spec.status === "waiting")) && agentsStyles.specialistTabstripItemIsWaiting, ((spec.status === "error")) && agentsStyles.specialistTabstripItemIsError).className].filter(Boolean).join(' ')}
              onClick={() => onSelect(spec.id)}
            >
              {spec.status === 'waiting' ? <Question size={12} /> : <StatusMark state={specialistMarkState(spec.status)} size={12} />}
              <strong>{spec.agent}</strong>
              {model ? <span>{model}</span> : /^task_\d+$/.test(spec.id) ? <span>{spec.id}</span> : null}
            </button>
            </Fragment>
          )
        })}
      </div>
      <header className={`specialist-header scroll-area ${stylex.props(baseStyles.scrollArea, agentsStyles.specialistHeader).className ?? ""}`} key={active.id}>
        <details className={`specialist-header__details ${stylex.props(agentsStyles.specialistHeaderDetails).className ?? ""}`}>
          <summary title="Show run details">
            <CaretRight size={12} aria-hidden="true" className={`specialist-header__caret ${stylex.props(agentsStyles.specialistHeaderCaret).className ?? ""}`} />
            <strong className={`specialist-header__agent ${stylex.props(agentsStyles.specialistHeaderAgent).className ?? ""}`}>{active.agent}</strong>
            {/^task_\d+$/.test(active.id) ? <span className={`specialist-header__handle mono ${stylex.props(agentsStyles.specialistHeaderHandle, activityStyles.mono).className ?? ""}`}>{active.id}</span> : null}
            {turnsBadge ? <span className={`specialist-header__turns ${stylex.props(agentsStyles.specialistHeaderTurns).className ?? ""}`}>{turnsBadge}</span> : null}
            <span className={[`run-state is-${active.status}`, stylex.props(agentsStyles.runState, ((active.status === "running")) && agentsStyles.runStateIsRunning, ((active.status === "waiting")) && agentsStyles.runStateIsWaiting, ((active.status === "error")) && agentsStyles.runStateIsError, ((active.status === "stopped")) && agentsStyles.runStateIsStopped, ((active.status === "closed")) && agentsStyles.runStateIsClosed).className].filter(Boolean).join(' ')}>{active.status === 'running' ? <StatusMark state="running" size={11} /> : null}{activeStatus}</span>
          </summary>
          <div className={`specialist-header__body ${stylex.props(agentsStyles.specialistHeaderBody).className ?? ""}`}>
            {detailBadges.length > 0 ? (
              <div className={`specialist-header__meta ${stylex.props(agentsStyles.specialistHeaderMeta).className ?? ""}`}>
                {detailBadges.map((badge) => <span key={badge} className={[badge === active.id ? 'mono' : undefined, stylex.props((badge === active.id) && activityStyles.mono).className].filter(Boolean).join(' ')}>{badge}</span>)}
              </div>
            ) : null}
            {active.mission ? <p className={`specialist-header__mission ${stylex.props(agentsStyles.specialistHeaderMission).className ?? ""}`} title={active.mission}>{active.mission}</p> : null}
            {!matchedDiskTranscript ? <small className={`specialist-header__source ${stylex.props(agentsStyles.specialistHeaderSource).className ?? ""}`}>Showing the parent session's recorded activity, not a live worker status.</small> : null}
            {!hasUserTurn && active.prompt ? <div className={`specialist-header__prompt scroll-area ${stylex.props(baseStyles.scrollArea, agentsStyles.specialistHeaderPrompt).className ?? ""}`}><MarkdownText variant="prompt" text={active.prompt} /></div> : null}
          </div>
        </details>
        <SpecialistFiles key={active.id} messages={rawTranscript} cwd={active.cwd ? observedPath(active.cwd, cwd) : cwd} />
        {failure ? <div className={`specialist-header__error ${stylex.props(agentsStyles.specialistHeaderError).className ?? ""}`}><WarningCircle size={12} /><span>{failure}</span></div> : null}
        {isLiveSpecialist(active.status) && active.activity && !matchedDiskTranscript ? <div className={`specialist-header__activity ${stylex.props(agentsStyles.specialistHeaderActivity).className ?? ""}`} title="Activity from the parent's last recorded update"><span>Last observed</span><code>{active.activity}</code></div> : null}
      </header>
      <div
        ref={scrollRef}
        className={`inspector-scroll scroll-area specialists-panel__body ${stylex.props(baseStyles.scrollArea, inspectorStyles.inspectorScroll, agentsStyles.specialistsPanelBody).className ?? ""}`}
        onScroll={() => {
          const scroller = scrollRef.current
          if (scroller) {
            const positioned = positionedScrollTopRef.current
            positionedScrollTopRef.current = null
            if (positioned !== null && Math.abs(scroller.scrollTop - positioned) < 1) return
            pinnedToBottomRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40
            awaitingReportRef.current = false
            setFollowing(pinnedToBottomRef.current)
          }
        }}
      >
        <div className={`specialist-transcript ${stylex.props(agentsStyles.specialistTranscript).className ?? ""}`} aria-label={`${active.agent} session transcript`}>
          {renderedMessages.map((message) => {
            if (message.role === 'user') {
              const text = message.parts
                .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
                .map((part) => part.text)
                .join('\n')
              if (!text) return null
              return <WorkOrderTurn key={`${active.id}:${message.id}`} text={text} />
            }
            if (message.parts.every((part) => part.type === 'text' && !part.text.trim()) && !message.streaming && !message.errorMessage) return null
            const isAssistant = message.role === 'assistant'
            if (isAssistant) assistantTurnCount += 1
            const reportIndex = report?.messageId === message.id ? report.partIndex : -1
            const reportPart = message.parts[reportIndex]
            const streaming = Boolean(message.streaming && isLiveSpecialist(active.status))
            return (
              <article key={message.id} className={`specialist-turn specialist-turn--assistant ${stylex.props(agentsStyles.specialistTurn, agentsStyles.specialistTurnAssistant).className ?? ""}`}>
                {isAssistant && assistantTurnCount > 1 ? <div className={`specialist-turn__divider ${stylex.props(agentsStyles.specialistTurnDivider).className ?? ""}`}><span>Turn {assistantTurnCount}</span></div> : null}
                {message.errorMessage ? <div className={`specialist-header__error ${stylex.props(agentsStyles.specialistHeaderError).className ?? ""}`} role="alert">{message.errorMessage}</div> : null}
                <MarkdownScopeContext.Provider value="specialist-assistant"><div className="specialist-turn__content">
                  {renderNarrativeWithActivity(reportIndex < 0 ? message.parts : message.parts.slice(0, reportIndex), message.id, true, true, streaming, 'current-step')}
                  {reportPart?.type === 'text' ? <section className={`specialist-result ${stylex.props(agentsStyles.specialistResult).className ?? ""}`} ref={resultRef}><h3>Result</h3><MarkdownText variant="report" text={reportPart.text} />{renderNarrativeWithActivity(message.parts.slice(reportIndex + 1), `${message.id}-after`, true, true, streaming, 'current-step')}</section> : null}
                </div></MarkdownScopeContext.Provider>
                {streaming && !message.parts.length ? (
                  <div className={`specialist-turn__working ${stylex.props(agentsStyles.specialistTurnWorking).className ?? ""}`}>
                    <StatusMark state="running" size={13} />
                    <span>Awaiting a recorded update…</span>
                  </div>
                ) : null}
              </article>
            )
          })}
          {finalReport && !report ? <section className={`specialist-result ${stylex.props(agentsStyles.specialistResult).className ?? ""}`} ref={resultRef}><h3>Result</h3><MarkdownText variant="report" text={finalReport} /></section> : null}
        </div>
      </div>
      {isLiveSpecialist(active.status) && !following ? <ApexButton xstyle={[agentsStyles.specialistJump]} compact className="specialist-jump" onClick={() => { pinnedToBottomRef.current = true; setFollowing(true); if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }}>Jump to latest</ApexButton> : null}
    </div></MarkdownScopeContext.Provider>
  )
})
