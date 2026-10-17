import type { ExtensionTabControls } from "@/hooks/useAgentBrowserTabs";
import type {
	AgentBrowserExtensionStatus,
	AgentBrowserTabRecord,
} from "@/types/api";
import { ArrowSquareOut, Pause, Play } from "./icons";

export function tabHost(tab: AgentBrowserTabRecord): string {
	try {
		return new URL(tab.url).hostname;
	} catch {
		return "";
	}
}

function tabTitle(tab: AgentBrowserTabRecord): string {
	return tab.title || tabHost(tab) || "Browser tab";
}

/** Tab strip status for the Apex browser extension bridge. */
export function ExtensionStatusIndicator({
	status,
}: {
	status: AgentBrowserExtensionStatus;
}) {
	return (
		<span
			className={`extension-status ${status.connected ? "is-connected" : ""}`}
			role="status"
		>
			<span className="extension-status__dot" aria-hidden="true" />
			{status.connected ? "Extension connected" : "Extension offline"}
		</span>
	);
}

/**
 * Stands in for the webview when the selected agent tab lives in the user's
 * Chrome: the page itself is over there, so this card names it and hands the
 * user the controls that matter, pausing the agent and jumping to the tab.
 */
export function ExtensionTabCard({
	tab,
	extension,
}: {
	tab: AgentBrowserTabRecord;
	extension: ExtensionTabControls;
}) {
	const paused = tab.paused === true;
	const offline = extension.status?.connected === false;
	return (
		<section
			className="extension-tab-card"
			aria-label="Browser extension tab"
			data-testid="extension-tab-card"
		>
			<span
				className={`extension-tab-card__badge ${tab.pairedByUser ? "is-shared" : ""}`}
			>
				{tab.pairedByUser ? "Shared from Browser" : "Apex Tab Group"}
			</span>
			<h3 className="extension-tab-card__title">{tabTitle(tab)}</h3>
			<p className="extension-tab-card__url" title={tab.url}>
				{tab.url || "about:blank"}
			</p>
			<p
				className={`extension-tab-state ${paused ? "is-paused" : ""}`}
				role="status"
			>
				<span className="extension-tab-state__dot" aria-hidden="true" />
				{paused ? "Paused by user" : "Agent active"}
			</p>
			<p className="extension-tab-card__hint">
				{paused
					? "You have control in your browser. Resume when the agent can continue."
					: "The agent is driving this tab in your browser. Clicking or typing on the page there pauses it."}
			</p>
			<div className="extension-tab-card__actions">
				<button
					type="button"
					className="button button--primary"
					aria-pressed={paused}
					onClick={() => extension.setPaused(tab, !paused)}
				>
					{paused ? (
						<Play size={13} weight="fill" />
					) : (
						<Pause size={13} weight="fill" />
					)}
					{paused ? "Resume Agent" : "Pause Agent"}
				</button>
				<button
					type="button"
					className="button"
					disabled={offline}
					onClick={() => extension.focus(tab)}
				>
					<ArrowSquareOut size={13} />
					Focus in Browser
				</button>
			</div>
			{offline ? (
				<p className="extension-tab-card__offline">
					Extension offline. Open Chrome with the Apex extension to reconnect.
				</p>
			) : null}
		</section>
	);
}

/** Composer context bar entry for the active thread's extension-backed tab. */
export function ExtensionTabPill({
	tab,
	extension,
}: {
	tab: AgentBrowserTabRecord;
	extension: ExtensionTabControls;
}) {
	const paused = tab.paused === true;
	const label = tabTitle(tab);
	return (
		<div
			className={`composer-extension-pill ${paused ? "is-paused" : ""}`}
			data-testid="composer-extension-tab-pill"
		>
			<span className="composer-extension-pill__dot" aria-hidden="true" />
			<span className="composer-extension-pill__label" title={tab.url}>
				{label}
			</span>
			{tabHost(tab) && tabHost(tab) !== label ? (
				<span className="composer-extension-pill__host">{tabHost(tab)}</span>
			) : null}
			<span className="composer-extension-pill__state">
				{paused ? "Paused" : "Active"}
			</span>
			<button
				type="button"
				aria-label={`${paused ? "Resume" : "Pause"} agent in ${label}`}
				title={paused ? "Resume agent" : "Pause agent"}
				onClick={() => extension.setPaused(tab, !paused)}
			>
				{paused ? (
					<Play size={11} weight="fill" />
				) : (
					<Pause size={11} weight="fill" />
				)}
			</button>
			<button
				type="button"
				aria-label={`Focus ${label} in browser`}
				title="Focus in browser"
				onClick={() => extension.focus(tab)}
			>
				<ArrowSquareOut size={11} />
			</button>
		</div>
	);
}
