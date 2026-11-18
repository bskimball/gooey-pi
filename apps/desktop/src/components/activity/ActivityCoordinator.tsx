import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex'
import * as stylex from '@stylexjs/stylex'
import { styles as activityStyles } from 'apex-ui/styles/activity.stylex'
import { styles as workbenchStyles } from 'apex-ui/styles/workbench.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { AnimatePresence } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Composer } from '@/components/Composer'
import { Transcript } from '@/components/Transcript'
import { InteractiveChatProvider } from '@/components/InteractiveChatContext'
import { ExtensionUiModal } from '@/components/ExtensionUiModal'
import { Banner } from '@astryxdesign/core/Banner'
import { ApexButton, IconButton, Modal } from '@/components/ui'
import { questionFromPendingExtensionUi } from '@/app/session-live'
import { useCoordinatorRuntime } from '@/hooks/useCoordinatorRuntime'
import { useProviderCatalog } from '@/hooks/useProviderCatalog'
import { EMPTY_GIT_STATUS } from '@/lib/workspace'
import type { ActivityControls } from '@/hooks/useActivityControls'
import type { ApexApi } from '@/types/api'
import { ArrowCounterClockwise, ArrowsClockwise, ChatCircleDots, WarningCircle } from '@/components/icons'
import { ActivityQuestionCard } from './ActivityQuestionCard'
import { ChiefOfStaffOpening } from './ChiefOfStaffOpening'
import { styles as chiefStyles } from './chief-of-staff.stylex'

interface ActivityCoordinatorProps {
  bridge: ApexApi | null
  controls?: ActivityControls
  showReasoning?: boolean
  showTools?: boolean
  spaceId?: string
  projectName?: string
  embedded?: boolean
  /** Host toolbar slot for chat actions when embedded, so they sit inline instead of on their own row. */
  actionsTarget?: HTMLElement | null
}

const spaceStyles = stylex.create({
  root: { backgroundColor: 'transparent' },
  // Minimal single-line heading: title and scope share a row.
  header: { paddingBlock: 8, paddingInline: 16, alignItems: 'center' },
  identity: { flexDirection: 'row', alignItems: 'baseline', columnGap: 8 },
  scope: { color: 'var(--text-tertiary)', fontSize: 'var(--fs-meta)' },
  pane: { minWidth: 0, backgroundColor: 'transparent', backgroundImage: 'none' },
  dock: { maxWidth: 800, paddingInline: 0, paddingBottom: 0 },
  headerActions: { marginLeft: 'auto' },
})

// The empty coordinator has its own prompt; Transcript renders once messages exist.
// EMPTY_GIT_STATUS prevents it from rendering any changes action.
const unreachableTranscriptAction = () => undefined

export function ActivityCoordinator({ bridge, controls, showReasoning, showTools, spaceId, projectName, embedded = false, actionsTarget }: ActivityCoordinatorProps) {
  const coordinator = useCoordinatorRuntime(bridge, controls?.onRecoverQuestion, spaceId)
  const { state } = coordinator
  const ready = state.phase === 'ready'
  const runtime = ready ? state.attachment.runtime : null
  const history = ready ? { session: state.attachment.session, messages: state.messages } : state.phase === 'opening' ? state.history : undefined
  const reportError = useCallback((error: unknown) => controls?.reportError?.(error), [controls])
  const provider = useProviderCatalog({ bridge, harness: 'pi', runtime, activeSession: ready ? state.attachment.session : undefined, syncRuntime: coordinator.syncRuntime, reportError })
  const [showQuestionModal, setShowQuestionModal] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const livePending = runtime ? controls?.pendingByRuntime?.get(runtime.runtimeId) : undefined
  const pending = livePending ?? coordinator.pending
  const respond = livePending && controls?.onRespondQuestion ? controls.onRespondQuestion : coordinator.respond
  const busy = Boolean(runtime?.isStreaming || runtime?.isCompacting)
  const [confirmClear, setConfirmClear] = useState(false)
  const canClear = ready && state.messages.length > 0 && !busy && !coordinator.clearing
  const clearButton =
    ready && state.messages.length > 0 ? (
      <IconButton size="small" label={busy ? 'Stop the current run before clearing' : 'Clear chat'} disabled={!canClear} onClick={() => setConfirmClear(true)}>
        <ArrowCounterClockwise size={14} />
      </IconButton>
    ) : null

  useEffect(() => {
    if (!pending?.deadline) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [pending?.deadline])

  return (
    <section className={`activity-coordinator ${stylex.props(activityStyles.activityCoordinator, embedded && spaceStyles.root).className ?? ''}`} aria-label="Chief of Staff">
      {!embedded ? (
        <header className={`activity-peek__header ${stylex.props(activityStyles.activityPeekHeader, spaceStyles.header).className ?? ''}`}>
          <div className={`activity-peek__identity ${stylex.props(activityStyles.activityPeekIdentity, spaceStyles.identity).className ?? ''}`}>
            <h2 className={`activity-peek__title ${stylex.props(activityStyles.activityPeekTitle).className ?? ''}`}>Chief of Staff</h2>
            <span className={`activity-coordinator__scope ${stylex.props(activityStyles.activityCoordinatorScope, spaceStyles.scope).className ?? ''}`}>
              {spaceId ? `Project: ${projectName ?? 'Unknown'}` : 'All authorized projects'}
            </span>
          </div>
          {clearButton ? <div {...stylex.props(spaceStyles.headerActions)}>{clearButton}</div> : null}
        </header>
      ) : clearButton && actionsTarget ? (
        createPortal(clearButton, actionsTarget)
      ) : null}
      <AnimatePresence initial={false}>
        {confirmClear ? (
          <Modal
            key="confirm-clear-chief"
            title="Clear Chief of Staff chat?"
            onClose={() => setConfirmClear(false)}
            footer={
              <>
                <ApexButton variant="quiet" onClick={() => setConfirmClear(false)}>
                  Cancel
                </ApexButton>
                <ApexButton
                  variant="primary"
                  onClick={() => {
                    setConfirmClear(false)
                    void coordinator.clear()
                  }}
                >
                  Clear chat
                </ApexButton>
              </>
            }
          >
            <p>This starts a fresh conversation. The current one is archived, not deleted, so you can still find it under archived sessions.</p>
          </Modal>
        ) : null}
      </AnimatePresence>
      <main
        className={`conversation-pane activity-coordinator__conversation ${stylex.props(workbenchStyles.conversationPane, activityStyles.activityCoordinatorConversation, [responsiveStyles.conversationPane, responsiveLayoutStyles.conversationPane], embedded && spaceStyles.pane).className ?? ''}`}
      >
        {!bridge ? (
          <div role="status" className={`activity-coordinator__empty ${stylex.props(chiefStyles.empty, chiefStyles.enter).className ?? ''}`}>
            <span {...stylex.props(chiefStyles.emptyIcon)}>
              <ChatCircleDots size={22} aria-hidden="true" />
            </span>
            <h3 {...stylex.props(chiefStyles.emptyTitle)}>Desktop app required</h3>
            <p {...stylex.props(chiefStyles.emptyCopy)}>Chief of Staff requires the desktop app.</p>
          </div>
        ) : null}
        {state.phase === 'opening' && !history ? <ChiefOfStaffOpening /> : null}
        {state.phase === 'error' ? (
          <div role="alert" className={`activity-coordinator__error ${stylex.props(chiefStyles.empty, chiefStyles.enter).className ?? ''}`}>
            <span {...stylex.props(chiefStyles.emptyIcon, chiefStyles.errorIcon)}>
              <WarningCircle size={22} aria-hidden="true" />
            </span>
            <h3 {...stylex.props(chiefStyles.emptyTitle)}>Unable to open Chief of Staff</h3>
            <p {...stylex.props(chiefStyles.emptyCopy)}>{state.error}</p>
            <div {...stylex.props(chiefStyles.emptyAction)}>
              <ApexButton icon={<ArrowsClockwise size={13} />} onClick={coordinator.reconnect}>
                Try again
              </ApexButton>
            </div>
          </div>
        ) : null}
        {ready && state.disconnected ? (
          <div role="status" {...stylex.props(chiefStyles.noticeBar)}>
            <div {...stylex.props(chiefStyles.noticeLead)}>
              <WarningCircle size={15} aria-hidden="true" {...stylex.props(chiefStyles.noticeIcon)} />
              <p {...stylex.props(chiefStyles.noticeCopy)}>The coordinator runtime has stopped. Its conversation is saved.</p>
            </div>
            <ApexButton compact icon={<ArrowsClockwise size={12} />} onClick={coordinator.reconnect}>
              Reconnect
            </ApexButton>
          </div>
        ) : null}
        {history ? (
          <div
            className={[
              `activity-coordinator__transcript ${history.messages.length === 0 ? 'activity-coordinator__transcript--empty' : ''}`,
              stylex.props(activityStyles.activityCoordinatorTranscript).className,
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {history.messages.length === 0 ? (
              embedded ? (
                <div className={`activity-coordinator__empty ${stylex.props(chiefStyles.empty).className ?? ''}`}>
                  <span {...stylex.props(chiefStyles.emptyIcon)}>
                    <ChatCircleDots size={22} />
                  </span>
                  <h3 {...stylex.props(chiefStyles.emptyTitle, chiefStyles.enter)}>What should we move forward?</h3>
                  <p {...stylex.props(chiefStyles.emptyCopy, chiefStyles.enter)}>Plan the next step, check progress, or ask Chief of Staff to coordinate the work.</p>
                </div>
              ) : (
                <div className={`activity-coordinator__empty ${stylex.props(activityStyles.activityCoordinatorEmpty).className ?? ''}`}>
                  Ask Chief of Staff to check progress, direct a session, or launch work in a project.
                </div>
              )
            ) : null}
            {history.messages.length > 0 ? (
              <InteractiveChatProvider sessionKey={history.session.id} disabled={!ready || state.disconnected} onSendFeedback={async (text) => coordinator.send(text, [])}>
                <Transcript
                  messages={history.messages}
                  git={EMPTY_GIT_STATUS}
                  cwd={runtime?.cwd ?? history.session.projectPath}
                  harness="pi"
                  active={busy}
                  showReasoning={showReasoning}
                  showTools={showTools}
                  onOpenChanges={unreachableTranscriptAction}
                  onSuggestion={unreachableTranscriptAction}
                  showPinnedChanges={false}
                  variant="chat"
                  shortName="Chief of Staff"
                />
              </InteractiveChatProvider>
            ) : null}
          </div>
        ) : null}
        <AnimatePresence initial={false}>
          {pending && pending.request.method !== 'questionnaire' ? (
            <ActivityQuestionCard key={`${pending.runtimeId}:${pending.request.id}`} question={questionFromPendingExtensionUi(pending)} pendingUi={pending} now={now} onRespond={respond} onOpenModal={() => setShowQuestionModal(true)} />
          ) : null}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {showQuestionModal && pending && pending.request.method !== 'questionnaire' ? (
            <ExtensionUiModal
              key={`modal:${pending.runtimeId}:${pending.request.id}`}
              request={pending.request}
              deadline={pending.deadline}
              onRespond={(response) => {
                setShowQuestionModal(false)
                void respond(pending.runtimeId, response)
              }}
            />
          ) : null}
        </AnimatePresence>
        <div
          className={`conversation-bottom-dock ${stylex.props(workbenchStyles.conversationBottomDock, [responsiveStyles.conversationBottomDock, responsiveLayoutStyles.conversationBottomDock], embedded && spaceStyles.dock).className ?? ''}`}
        >
          {state.phase === 'opening' && history ? (
            <div role="status" {...stylex.props(chiefStyles.noticeBar)}>
              <p {...stylex.props(chiefStyles.noticeCopy)}>Connecting to Chief of Staff…</p>
            </div>
          ) : null}
          {pending?.request.method === 'questionnaire' ? (
            <ExtensionUiModal presentation="inline" request={pending.request} deadline={pending.deadline} onRespond={(response) => void respond(pending.runtimeId, response)} />
          ) : null}
          <Composer
            draftKey={`activity:${spaceId ?? 'global-chief'}`}
            isolatedDraft
            conversationOnly
            busy={busy}
            admitting={coordinator.sending}
            disabled={!ready || state.disconnected}
            model={provider.model}
            effort={provider.effort}
            modelsByProvider={provider.modelsByProvider}
            providers={provider.catalog?.providers ?? []}
            reasoningLevels={provider.reasoningLevels}
            fast={provider.fast}
            fastSupported={false}
            fastAvailable={runtime?.fastModeAvailable !== false}
            agentName="Chief of Staff"
            shortName="Chief of Staff"
            harness="pi"
            imageInputSupported={runtime?.imageInputSupported ?? Boolean(provider.selectedModel?.input.includes('image'))}
            skills={[]}
            taskExcerpts={[]}
            onModelChange={provider.changeModel}
            onEffortChange={provider.changeEffort}
            onFastChange={provider.changeFast}
            onSend={coordinator.send}
            onStop={coordinator.stop}
          />
          {coordinator.error ? (
            <div {...stylex.props(chiefStyles.dockBanner)}>
              <Banner status="error" role="alert" title={coordinator.error} />
            </div>
          ) : null}
        </div>
      </main>
    </section>
  )
}
