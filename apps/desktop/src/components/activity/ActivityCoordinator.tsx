import { useCallback, useEffect, useState } from 'react'
import { Composer } from '@/components/Composer'
import { Transcript } from '@/components/Transcript'
import { ExtensionUiModal } from '@/components/ExtensionUiModal'
import { ApexButton } from '@/components/ui'
import { questionFromPendingExtensionUi } from '@/app/session-live'
import { useCoordinatorRuntime } from '@/hooks/useCoordinatorRuntime'
import { useProviderCatalog } from '@/hooks/useProviderCatalog'
import { EMPTY_GIT_STATUS } from '@/lib/workspace'
import type { ActivityControls } from '@/hooks/useActivityControls'
import type { ApexApi } from '@/types/api'
import { ActivityQuestionCard } from './ActivityQuestionCard'

interface ActivityCoordinatorProps {
  bridge: ApexApi | null
  controls?: ActivityControls
  showReasoning?: boolean
  showTools?: boolean
}

// Transcript requires both callbacks. Its welcome suggestions are hidden in this view,
// and EMPTY_GIT_STATUS prevents it from rendering any changes action.
const unreachableTranscriptAction = () => undefined

export function ActivityCoordinator({ bridge, controls, showReasoning, showTools }: ActivityCoordinatorProps) {
  const coordinator = useCoordinatorRuntime(bridge, controls?.onRecoverQuestion)
  const { state } = coordinator
  const ready = state.phase === 'ready'
  const runtime = ready ? state.attachment.runtime : null
  const reportError = useCallback((error: unknown) => controls?.reportError?.(error), [controls])
  const provider = useProviderCatalog({ bridge, harness: 'pi', runtime, activeSession: ready ? state.attachment.session : undefined, syncRuntime: coordinator.syncRuntime, reportError })
  const [showQuestionModal, setShowQuestionModal] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const livePending = runtime ? controls?.pendingByRuntime?.get(runtime.runtimeId) : undefined
  const pending = livePending ?? coordinator.pending
  const respond = livePending && controls?.onRespondQuestion ? controls.onRespondQuestion : coordinator.respond
  const busy = Boolean(runtime?.isStreaming || runtime?.isCompacting)

  useEffect(() => {
    if (!pending?.deadline) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [pending?.deadline])

  return <section className="activity-coordinator" aria-label="Chief of Staff">
    <header className="activity-peek__header"><div className="activity-peek__identity">
      <h2 className="activity-peek__title">Chief of Staff</h2>
      <span className="activity-coordinator__scope">All authorized projects</span>
    </div></header>
    <main className="conversation-pane activity-coordinator__conversation">
      {!bridge ? <p role="status">Chief of Staff requires the desktop app.</p> : null}
      {state.phase === 'opening' ? <p role="status">Opening Chief of Staff…</p> : null}
      {state.phase === 'error' ? <div role="alert"><p>{state.error}</p><ApexButton onClick={coordinator.reconnect}>Try again</ApexButton></div> : null}
      {ready && state.disconnected ? <div role="status"><p>The coordinator runtime has stopped. Its conversation is saved.</p><ApexButton onClick={coordinator.reconnect}>Reconnect</ApexButton></div> : null}
      {ready ? <div className={`activity-coordinator__transcript ${state.messages.length === 0 ? 'activity-coordinator__transcript--empty' : ''}`}>
        {state.messages.length === 0 ? <div className="activity-coordinator__empty">Ask Chief of Staff to check progress, direct a session, or launch work in a project.</div> : null}
        <Transcript messages={state.messages} git={EMPTY_GIT_STATUS} cwd={runtime?.cwd} harness="pi" active={busy} showReasoning={showReasoning} showTools={showTools} onOpenChanges={unreachableTranscriptAction} onSuggestion={unreachableTranscriptAction} showPinnedChanges={false} />
      </div> : null}
      {pending && pending.request.method !== 'questionnaire' ? <ActivityQuestionCard question={questionFromPendingExtensionUi(pending)} pendingUi={pending} now={now} onRespond={respond} onOpenModal={() => setShowQuestionModal(true)} /> : null}
      {showQuestionModal && pending && pending.request.method !== 'questionnaire' ? <ExtensionUiModal request={pending.request} deadline={pending.deadline} onRespond={(response) => { setShowQuestionModal(false); void respond(pending.runtimeId, response) }} /> : null}
      <div className="conversation-bottom-dock">
        {pending?.request.method === 'questionnaire' ? <ExtensionUiModal presentation="inline" request={pending.request} deadline={pending.deadline} onRespond={(response) => void respond(pending.runtimeId, response)} /> : null}
        <Composer draftKey="activity:global-chief" isolatedDraft conversationOnly busy={busy} admitting={coordinator.sending} disabled={!ready || state.disconnected} model={provider.model} effort={provider.effort} modelsByProvider={provider.modelsByProvider} providers={provider.catalog?.providers ?? []} reasoningLevels={provider.reasoningLevels} fast={provider.fast} fastSupported={false} fastAvailable={runtime?.fastModeAvailable !== false} agentName="Chief of Staff" shortName="Chief of Staff" harness="pi" imageInputSupported={runtime?.imageInputSupported ?? Boolean(provider.selectedModel?.input.includes('image'))} skills={[]} taskExcerpts={[]} onModelChange={provider.changeModel} onEffortChange={provider.changeEffort} onFastChange={provider.changeFast} onSend={coordinator.send} onStop={coordinator.stop} />
        {coordinator.error ? <p role="alert">{coordinator.error}</p> : null}
      </div>
    </main>
  </section>
}
