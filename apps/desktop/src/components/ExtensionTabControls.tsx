import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { styles as browserReferencesStyles } from 'apex-ui/styles/browser-references.stylex'
import { styles as extensionStyles, selectionDetailsMarker } from 'apex-ui/styles/extension-controls.stylex'
import { styles as workbenchStyles } from 'apex-ui/styles/workbench.stylex'
import type { ExtensionTabControls } from '@/hooks/useAgentBrowserTabs'
import { annotationElementLabel } from '@/lib/browser-annotations'
import type { AgentBrowserExtensionStatus, AgentBrowserTabRecord, BrowserAnnotationElement } from '@/types/api'
import { ArrowSquareOut, Pause, Play } from './icons'
import { ImageParts } from './transcript/TranscriptImage'
import * as stylex from '@stylexjs/stylex'

const pillStyles = stylex.create({
  root: { minWidth: 0, maxWidth: '100%', height: 28, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 3px 0 9px', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface-subtle)', fontSize: 'var(--fs-meta)', flex: '0 1 auto' },
  dot: { flex: '0 0 6px', width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--success)' },
  pausedDot: { backgroundColor: 'var(--warning)' },
  label: { minWidth: 0, maxWidth: 220, overflow: 'hidden', color: 'var(--text)', fontWeight: 550, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  host: { flex: '0 1 auto', minWidth: 0, overflow: 'hidden', color: 'var(--text-tertiary)', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  state: { flex: '0 0 auto', paddingBlock: 1, paddingInline: 6, borderRadius: 999, color: 'var(--success)', backgroundColor: 'var(--success-soft)', fontSize: 'var(--fs-micro)', fontWeight: 600 },
  pausedState: { color: 'var(--warning)', backgroundColor: 'var(--warning-soft)' },
  selectingState: { color: 'var(--apex)', backgroundColor: 'var(--apex-soft)' },
  selection: { minWidth: 0, maxWidth: 140, overflow: 'hidden', color: 'var(--text)', fontWeight: 550, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  button: { position: 'relative', flex: '0 0 20px', width: 22, height: 22, display: 'grid', placeItems: 'center', padding: 0, borderRadius: '50%', color: { default: 'var(--text-tertiary)', ':hover': 'var(--text)' }, backgroundColor: { default: 'transparent', ':hover': 'var(--surface-hover)' }, transition: 'color var(--fast), background-color var(--fast)', '::after': { content: '""', position: 'absolute', inset: '-5px -2px' } },
})

export function tabHost(tab: AgentBrowserTabRecord): string {
  try {
    return new URL(tab.url).hostname
  } catch {
    return ''
  }
}

function tabTitle(tab: AgentBrowserTabRecord): string {
  return tab.title || tabHost(tab) || 'Browser tab'
}

function selectionLabel(element: BrowserAnnotationElement): string {
  return element.component || annotationElementLabel(element)
}

/** Tab strip status for the Apex browser extension bridge. */
export function ExtensionStatusIndicator({ status }: { status: AgentBrowserExtensionStatus }) {
  return (
    <span className={[`extension-status ${status.connected ? 'is-connected' : ''}`, stylex.props(inspectorStyles.extensionStatus, (status.connected) && inspectorStyles.extensionStatusIsConnected).className].filter(Boolean).join(' ')} role="status">
      <span className={`extension-status__dot ${stylex.props(inspectorStyles.extensionStatusDot, status.connected && extensionStyles.connectedDot).className ?? ""}`} aria-hidden="true" />
      {status.connected ? 'Extension connected' : 'Extension offline'}
    </span>
  )
}

/**
 * Stands in for the webview when the selected agent tab lives in the user's
 * Chrome: the page itself is over there, so this card names it and hands the
 * user the controls that matter, pausing the agent and jumping to the tab.
 */
export function ExtensionTabCard({ tab, extension }: { tab: AgentBrowserTabRecord; extension: ExtensionTabControls }) {
  const paused = tab.paused === true
  const offline = extension.status?.connected === false
  return (
    <section className={`extension-tab-card ${stylex.props(inspectorStyles.extensionTabCard, browserReferencesStyles.extensionTabCard).className ?? ""}`} aria-label="Browser extension tab" data-testid="extension-tab-card">
      <span className={[`extension-tab-card__badge ${tab.pairedByUser ? 'is-shared' : ''}`, stylex.props(inspectorStyles.extensionTabCardBadge, (tab.pairedByUser) && inspectorStyles.extensionTabCardBadgeIsShared).className].filter(Boolean).join(' ')}>{tab.pairedByUser ? 'Shared from Browser' : 'Apex Tab Group'}</span>
      <h3 className={`extension-tab-card__title ${stylex.props(inspectorStyles.extensionTabCardTitle).className ?? ""}`}>{tabTitle(tab)}</h3>
      <p className={`extension-tab-card__url ${stylex.props(inspectorStyles.extensionTabCardUrl).className ?? ""}`} title={tab.url}>
        {tab.url || 'about:blank'}
      </p>
      <p className={[`extension-tab-state ${paused ? 'is-paused' : ''}`, stylex.props(inspectorStyles.extensionTabState, extensionStyles.cardState).className].filter(Boolean).join(' ')} role="status">
        <span className={`extension-tab-state__dot ${stylex.props(inspectorStyles.extensionTabStateDot, paused && extensionStyles.pausedDot, extensionStyles.cardDot).className ?? ""}`} aria-hidden="true" />
        {paused ? 'Agent control paused' : 'Agent control enabled'}
      </p>
      <p className={`extension-tab-card__hint ${stylex.props(inspectorStyles.extensionTabCardHint, browserReferencesStyles.extensionTabCardHint).className ?? ""}`}>{tab.picking ? 'Click one element in Chrome to attach it to chat.' : 'This page is open in Chrome, not embedded here.'}</p>
      <div className={`extension-tab-card__actions ${stylex.props(inspectorStyles.extensionTabCardActions, browserReferencesStyles.extensionTabCardActions).className ?? ""}`}>
        {extension.setPicking ? (
          <button type="button" className={`button button--primary ${stylex.props(workbenchStyles.button, workbenchStyles.buttonPrimary, extensionStyles.actionButton, tab.picking && extensionStyles.pressedButton).className ?? ""}`} aria-pressed={tab.picking === true} disabled={offline} onClick={() => extension.setPicking?.(tab, tab.picking !== true)}>
            {tab.picking ? 'Stop selecting' : 'Select element'}
          </button>
        ) : null}
        <button type="button" className={`button ${stylex.props(workbenchStyles.button, extensionStyles.actionButton, paused && extensionStyles.pressedButton).className ?? ""}`} aria-pressed={paused} disabled={offline} onClick={() => extension.setPaused(tab, !paused)}>
          {paused ? <Play size={13} weight="fill" /> : <Pause size={13} weight="fill" />}
          {paused ? 'Resume Agent' : 'Pause Agent'}
        </button>
        <button type="button" className={`button ${stylex.props(workbenchStyles.button, extensionStyles.actionButton).className ?? ""}`} disabled={offline} onClick={() => extension.focus(tab)}>
          <ArrowSquareOut size={13} />
          Focus in Browser
        </button>
      </div>
      {tab.selection ? (
        <div className={`extension-tab-card__selection ${stylex.props(inspectorStyles.extensionTabCardSelection).className ?? ""}`} data-testid="extension-tab-selection">
          <span {...stylex.props(extensionStyles.selectionLabel)}>Selected</span>
          <strong {...stylex.props(extensionStyles.selectionTitle)}>{selectionLabel(tab.selection)}</strong>
          <details {...stylex.props(selectionDetailsMarker, extensionStyles.selectionDetails)}>
            <summary {...stylex.props(extensionStyles.selectionSummary)}>Element details</summary>
            <code {...stylex.props(extensionStyles.selectionCode)}>{tab.selection.selector}</code>
          </details>
        </div>
      ) : null}
      {tab.selection?.preview ? (
        <div className={`extension-tab-card__capture ${stylex.props(browserReferencesStyles.extensionTabCardCapture).className ?? ""}`}>
          <ImageParts images={[tab.selection.preview]} alt="Captured browser selection" xstyle={extensionStyles.capturePreview} />
          <small {...stylex.props(extensionStyles.captureLabel)}>Captured selection · not a live view</small>
        </div>
      ) : null}
      {offline ? <p className={`extension-tab-card__offline ${stylex.props(inspectorStyles.extensionTabCardOffline).className ?? ""}`}>Extension offline. Open Chrome with the Apex extension to reconnect.</p> : null}
    </section>
  )
}

/** Composer context bar entry for the active thread's extension-backed tab. */
export function ExtensionTabPill({ tab, extension }: { tab: AgentBrowserTabRecord; extension: ExtensionTabControls }) {
  const paused = tab.paused === true
  const label = tabTitle(tab)
  return (
    <div {...stylex.props(pillStyles.root)} data-testid="composer-extension-tab-pill">
      <span {...stylex.props(pillStyles.dot, paused && pillStyles.pausedDot)} aria-hidden="true" />
      <span {...stylex.props(pillStyles.label)} title={tab.url}>
        {label}
      </span>
      {tabHost(tab) && tabHost(tab) !== label ? <span {...stylex.props(pillStyles.host)}>{tabHost(tab)}</span> : null}
      <span {...stylex.props(pillStyles.state, paused && pillStyles.pausedState, tab.picking && pillStyles.selectingState)}>{tab.picking ? 'Selecting' : paused ? 'Paused' : 'Active'}</span>
      {tab.selection ? (
        <span {...stylex.props(pillStyles.selection)} title={tab.selection.selector}>
          {selectionLabel(tab.selection)}
        </span>
      ) : null}
      <button type="button" {...stylex.props(pillStyles.button)} aria-label={`${paused ? 'Resume' : 'Pause'} agent in ${label}`} title={paused ? 'Resume agent' : 'Pause agent'} onClick={() => extension.setPaused(tab, !paused)}>
        {paused ? <Play size={11} weight="fill" /> : <Pause size={11} weight="fill" />}
      </button>
      <button type="button" {...stylex.props(pillStyles.button)} aria-label={`Focus ${label} in browser`} title="Focus in browser" onClick={() => extension.focus(tab)}>
        <ArrowSquareOut size={11} />
      </button>
    </div>
  )
}
