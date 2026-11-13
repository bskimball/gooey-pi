import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { MarkdownText } from '@/components/MarkdownText'
import { ExtensionUiModal } from '@/components/ExtensionUiModal'
import { ApexButton } from '@/components/ui'
import { questionFromPendingExtensionUi } from '@/app/session-live'
import type { ActivityControls } from '@/hooks/useActivityControls'
import { useCoordinatorRuntime } from '@/hooks/useCoordinatorRuntime'
import type { ApexApi, ProjectRecord } from '@/types/api'
import { ActivityQuestionCard } from './ActivityQuestionCard'

interface ActivityCoordinatorProps {
  bridge: ApexApi | null
  project?: ProjectRecord
  controls?: ActivityControls
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export function ActivityCoordinator({ bridge, project, controls, textareaRef }: ActivityCoordinatorProps) {
  const coordinator = useCoordinatorRuntime(bridge, project?.id)
  const { state } = coordinator
  const [draft, setDraft] = useState('')
  const [intent, setIntent] = useState<'queue' | 'steer'>('queue')
  const [showQuestionModal, setShowQuestionModal] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const ready = state.phase === 'ready' && state.projectId === project?.id
  const runtimeId = ready ? state.attachment.runtime.runtimeId : undefined
  const livePending = runtimeId ? controls?.pendingByRuntime?.get(runtimeId) : undefined
  const pending = livePending ?? coordinator.pending
  const busy = ready && (state.attachment.runtime.isStreaming || state.attachment.runtime.isCompacting)
  const respond = livePending && controls?.onRespondQuestion ? controls.onRespondQuestion : coordinator.respond

  useEffect(() => {
    if (!pending?.deadline) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [pending?.deadline])

  useEffect(() => {
    if (stickToBottomRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [state])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const message = draft.trim()
    if (!message || !ready || coordinator.sending) return
    if (await coordinator.send(message, intent)) setDraft('')
  }

  return (
    <section className="activity-coordinator" aria-label="Chief of Staff">
      <header className="activity-peek__header">
        <div className="activity-peek__identity">
          <h2 className="activity-peek__title">Chief of Staff</h2>
          <span className="activity-coordinator__scope">{project?.name ?? 'Choose a project to coordinate'}</span>
        </div>
        {busy ? <ApexButton compact onClick={() => void coordinator.stop()}>Stop coordinator</ApexButton> : null}
      </header>
      <p className="activity-coordinator__boundary">Creates and monitors sessions in this project. Questions and permissions stay with you.</p>
      <div className="activity-coordinator__messages scroll-area" ref={scrollRef} onScroll={() => {
        const element = scrollRef.current
        if (element) stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
      }}>
        {!project ? <p className="activity-coordinator__empty">Select a granted project using the project filter. Each project has its own Chief of Staff conversation.</p>
          : !bridge ? <p className="activity-coordinator__empty">Chief of Staff requires the desktop app.</p>
          : state.phase === 'opening' ? <p role="status">Opening this project's coordinator…</p>
          : state.phase === 'error' ? <div role="alert"><p>{state.error}</p><ApexButton onClick={coordinator.reconnect}>Try again</ApexButton></div>
          : ready ? <>
            {state.messages.length === 0 ? <div className="activity-coordinator__empty"><p>What needs doing in {project.name}?</p><p>Ask to split a task into implementor sessions, check their progress, or synthesize their results.</p></div> : null}
            {state.messages.map((message) => {
              const text = message.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n\n')
              const tools = message.parts.filter((part) => part.type === 'toolCall').map((part) => part.name)
              if (!text && !tools.length) return null
              return <article className={`activity-coordinator__message activity-coordinator__message--${message.role}`} key={message.id}>
                <span className="activity-tail-role">{message.role === 'user' ? 'You' : 'Chief of Staff'}</span>
                {text ? <MarkdownText text={text} streaming={message.streaming} /> : null}
                {tools.length ? <p className="activity-coordinator__tools">{tools.join(' · ')}</p> : null}
              </article>
            })}
            {busy ? <p className="activity-coordinator__status" role="status">{pending ? 'Waiting for your decision' : 'Coordinating…'}</p> : null}
            {state.disconnected ? <div role="status"><p>The coordinator runtime has stopped. Its conversation is saved.</p><ApexButton onClick={coordinator.reconnect}>Reconnect</ApexButton></div> : null}
          </> : null}
      </div>
      {pending ? <ActivityQuestionCard question={questionFromPendingExtensionUi(pending)} pendingUi={pending} now={now} onRespond={respond} onOpenModal={() => setShowQuestionModal(true)} /> : null}
      {showQuestionModal && pending ? <ExtensionUiModal request={pending.request} deadline={pending.deadline} onRespond={(response) => {
        setShowQuestionModal(false)
        void respond(pending.runtimeId, response)
      }} /> : null}
      <form className="activity-reply" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="activity-coordinator-message">Message Chief of Staff</label>
        <div className="activity-reply__box">
          <textarea id="activity-coordinator-message" ref={textareaRef} className="activity-reply__input" rows={3} value={draft} placeholder={project ? 'Delegate a task or ask for a status update…' : 'Select a project first'} disabled={!ready || state.disconnected || coordinator.sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }} />
          <ApexButton type="submit" compact variant="primary" disabled={!ready || state.disconnected || coordinator.sending || !draft.trim()}>{coordinator.sending ? 'Sending…' : 'Send'}</ApexButton>
        </div>
        <div className="activity-reply__footer">
          {busy ? <label className="activity-coordinator__delivery">Delivery <select aria-label="Coordinator message delivery" value={intent} onChange={(event) => setIntent(event.target.value === 'steer' ? 'steer' : 'queue')}><option value="queue">Follow-up</option><option value="steer">Steer now</option></select></label> : <span className="activity-reply__hint">Enter to send · Shift+Enter for a new line</span>}
        </div>
        {coordinator.error ? <p className="activity-reply__status activity-reply__status--error" role="alert">{coordinator.error}</p> : null}
      </form>
    </section>
  )
}
