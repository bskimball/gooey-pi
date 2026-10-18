import { memo, useMemo, useState } from "react";
import type {
	ExtensionTabControls,
	StampedPointerEvent,
} from "@/hooks/useAgentBrowserTabs";
import type { BrowserAnnotationsApi } from "@/hooks/useBrowserAnnotations";
import type {
	AgentBrowserTabRecord,
	AutomationScheduleRecord,
	GitStatus,
	InspectorTab,
	NativeHeartbeatRecord,
	ProjectRecord,
	RuntimeInfo,
	TranscriptMessage,
} from "@/types/api";
import type { AgentSlotRect } from "./AgentBrowserLayer";
import { Folder, GitDiff, Globe, Info, Robot, SidebarRight } from "./icons";
import { BrowserPanel } from "./inspector/BrowserPanel";
import { ChangesPanel } from "./inspector/ChangesPanel";
import { FilesPanel } from "./inspector/FilesPanel";
import { SpecialistsPanel } from "./inspector/SpecialistsPanel";
import { SummaryPanel } from "./inspector/SummaryPanel";
import { createSessionSummarySelector } from "./inspector/session-summary";
import { IconButton, useFocusTrap } from "./ui";

export interface InspectorProps {
	platform?: NodeJS.Platform;
	homeDir?: string;
	activeTab: InspectorTab;
	onTabChange(tab: InspectorTab): void;
	onClose(): void;
	/** Active harness agent name ("Prime Agent" / "OMP"). */
	agentName?: string;
	/** Short harness name for working copy ("Prime" / "OMP"). */
	shortName?: string;
	project?: ProjectRecord;
	cwd?: string;
	runtime?: RuntimeInfo | null;
	messages: TranscriptMessage[];
	git: GitStatus;
	automations: AutomationScheduleRecord[];
	heartbeats: NativeHeartbeatRecord[];
	onOpenAutomation(id: string): void;
	browserHome: string;
	browserNavigationRequest?: { id: number; url: string };
	onBrowserNavigationRequestHandled?(id: number): void;
	browserAnnotations: BrowserAnnotationsApi;
	agentBrowserTabs: AgentBrowserTabRecord[];
	activeAgentTabId: string | null;
	agentPreviewSelected: boolean;
	onSelectAgentTab(tabId: string): void;
	onCloseAgentTab(tabId: string): void;
	onShowBrowserPreview(): void;
	onAgentSlotRect(rect: AgentSlotRect | null): void;
	agentSessionKey?: string;
	onPreviewContext(
		webContentsId: number | null,
		sessionFile: string | null,
	): void;
	previewPointerEvent: StampedPointerEvent | null;
	onNavigateAgentTab(
		tabId: string,
		action: "back" | "forward" | "reload",
	): void;
	agentBrowserExtension?: ExtensionTabControls;
	onRefreshGit(): Promise<void> | void;
	onOpenExternal(url: string): void;
	onRevealPath(path: string): void;
	onGrantProject(): Promise<void> | void;
	overlay?: boolean;
}

const tabs: Array<{ id: InspectorTab; label: string; Icon: typeof Info }> = [
	{ id: "summary", label: "Summary", Icon: Info },
	{ id: "specialists", label: "Specialists", Icon: Robot },
	{ id: "changes", label: "Changes", Icon: GitDiff },
	{ id: "browser", label: "Browser", Icon: Globe },
	{ id: "files", label: "Files", Icon: Folder },
];

/** Memoized so streaming transcript updates (which this component no longer consumes outside the Summary tab) do not re-render the inspector shell. */
export const Inspector = memo(function Inspector({
	activeTab,
	onTabChange,
	onClose,
	agentName,
	shortName,
	project,
	cwd,
	runtime,
	messages,
	git,
	automations,
	heartbeats,
	onOpenAutomation,
	browserHome,
	browserNavigationRequest,
	onBrowserNavigationRequestHandled,
	browserAnnotations,
	agentBrowserTabs,
	activeAgentTabId,
	agentPreviewSelected,
	onSelectAgentTab,
	onCloseAgentTab,
	onShowBrowserPreview,
	onAgentSlotRect,
	agentSessionKey,
	onPreviewContext,
	previewPointerEvent,
	onNavigateAgentTab,
	agentBrowserExtension,
	onRefreshGit,
	onOpenExternal,
	onRevealPath,
	onGrantProject,
	overlay = false,
	platform = "darwin",
	homeDir,
}: InspectorProps) {
	const inspectorRef = useFocusTrap<HTMLElement>(overlay, onClose);
	const [selectedSpecialistId, setSelectedSpecialistId] = useState<
		string | null
	>(null);
	const [selectSummary] = useState(createSessionSummarySelector);
	const summary = useMemo(() => selectSummary(messages), [messages, selectSummary]);
	const specialistCount = summary.specialists.length;
	const moveTab = (current: number, key: string) => {
		let next = current;
		if (key === "ArrowRight") next = (current + 1) % tabs.length;
		else if (key === "ArrowLeft")
			next = (current - 1 + tabs.length) % tabs.length;
		else if (key === "Home") next = 0;
		else if (key === "End") next = tabs.length - 1;
		else return;
		const tab = tabs[next];
		onTabChange(tab.id);
		requestAnimationFrame(() =>
			document.getElementById(`inspector-tab-${tab.id}`)?.focus(),
		);
	};
	return (
		<aside
			ref={inspectorRef}
			className="inspector"
			aria-label="Session inspector"
			tabIndex={overlay ? -1 : undefined}
		>
			<div
				className="inspector__tabs"
				role="tablist"
				aria-label="Inspector views"
			>
				{tabs.map((tab, index) => (
					<button
						id={`inspector-tab-${tab.id}`}
						type="button"
						role="tab"
						aria-selected={activeTab === tab.id}
						aria-controls={`inspector-panel-${tab.id}`}
						tabIndex={activeTab === tab.id ? 0 : -1}
						className={activeTab === tab.id ? "is-active" : ""}
						key={tab.id}
						onKeyDown={(event) => {
							if (
								["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)
							) {
								event.preventDefault();
								moveTab(index, event.key);
							}
						}}
						title={tab.label}
						onClick={() => onTabChange(tab.id)}
					>
						<tab.Icon size={15} aria-hidden="true" />
						<span className="inspector__tab-label">{tab.label}</span>
						{tab.id === "changes" && git.files.length ? (
							<span className="inspector__tab-count">{git.files.length}</span>
						) : tab.id === "specialists" && specialistCount ? (
							<span className="inspector__tab-count">{specialistCount}</span>
						) : null}
					</button>
				))}
				<span className="inspector__tab-spacer" />
				<IconButton label="Close inspector" onClick={onClose}>
					<SidebarRight size={15} />
				</IconButton>
			</div>
			<div
				id={`inspector-panel-${activeTab}`}
				className="inspector__body"
				role="tabpanel"
				aria-labelledby={`inspector-tab-${activeTab}`}
				tabIndex={0}
			>
				{activeTab === "summary" ? (
					<SummaryPanel
						agentName={agentName}
						shortName={shortName}
						project={project}
						runtime={runtime}
						summary={summary}
						git={git}
						automations={automations}
						heartbeats={heartbeats}
						onOpenAutomation={onOpenAutomation}
						onOpenSpecialist={(id) => {
							setSelectedSpecialistId(id);
							onTabChange("specialists");
						}}
					/>
				) : null}
				{activeTab === "specialists" ? (
					<SpecialistsPanel
						key={agentSessionKey ?? "no-session"}
						messages={messages}
						selectedId={selectedSpecialistId}
						onSelect={setSelectedSpecialistId}
						homeDir={homeDir}
						sessionKey={agentSessionKey}
					/>
				) : null}
				{activeTab === "changes" ? (
					<ChangesPanel
						key={cwd ?? "no-workspace"}
						cwd={cwd}
						git={git}
						readOnly={project?.readOnly === true}
						onGrantProject={onGrantProject}
						onRefreshGit={onRefreshGit}
					/>
				) : null}
				{activeTab === "browser" ? (
					<BrowserPanel
						platform={platform}
						home={browserHome}
						navigationRequest={browserNavigationRequest}
						onNavigationRequestHandled={onBrowserNavigationRequestHandled}
						onOpenExternal={onOpenExternal}
						annotations={browserAnnotations}
						agentTabs={agentBrowserTabs}
						activeAgentTabId={activeAgentTabId}
						previewSelected={agentPreviewSelected}
						onSelectAgentTab={onSelectAgentTab}
						onCloseAgentTab={onCloseAgentTab}
						onShowPreview={onShowBrowserPreview}
						onAgentSlotRect={onAgentSlotRect}
						agentSessionKey={agentSessionKey}
						onPreviewContext={onPreviewContext}
						previewPointerEvent={previewPointerEvent}
						onNavigateAgentTab={onNavigateAgentTab}
						extension={agentBrowserExtension}
					/>
				) : null}
				{activeTab === "files" ? (
					<FilesPanel project={project} git={git} onReveal={onRevealPath} />
				) : null}
			</div>
		</aside>
	);
});
