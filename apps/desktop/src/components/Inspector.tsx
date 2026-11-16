import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex';
import * as stylex from '@stylexjs/stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { pathToFileUrl } from "@/lib/desktop-actions";
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
	ProjectRecord,
	RuntimeInfo,
	TranscriptMessage,
} from "@/types/api";
import type { AgentSlotRect } from "./AgentBrowserLayer";
import { ArrowsInSimple, ArrowsOutSimple, Folder, GitDiff, Globe, Info, Robot, SidebarRight } from "./icons";
import { BrowserPanel } from "./inspector/BrowserPanel";
import { ChangesPanel } from "./inspector/ChangesPanel";
import { FilesPanel } from "./inspector/FilesPanel";
import { SpecialistsPanel } from "./inspector/SpecialistsPanel";
import { SummaryPanel } from "./inspector/SummaryPanel";
import { createReadinessSelector } from "./inspector/readiness";
import { createSessionSummarySelector } from "./inspector/session-summary";
import { IconButton } from "./ui";
import { InspectorShell } from "./InspectorShell";

export interface InspectorProps {
	platform?: NodeJS.Platform;
	homeDir?: string;
	activeTab: InspectorTab;
	onTabChange(tab: InspectorTab): void;
	onClose(): void;
	selectedSpecialistId: string | null;
	onSelectSpecialist(id: string): void;
	/** Agent name for runtime status. */
	agentName?: string;
	/** Agent short name for working copy. */
	shortName?: string;
	project?: ProjectRecord;
	cwd?: string;
	runtime?: RuntimeInfo | null;
	/** Behavior mode reported for the active session, if any. */
	behaviorMode?: string;
	messages: TranscriptMessage[];
	git: GitStatus;
	automations: AutomationScheduleRecord[];
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
	visible?: boolean;
	expanded?: boolean;
	onToggleExpanded?(): void;
	browserActive?: boolean;
}

const tabs: Array<{ id: InspectorTab; label: string; Icon: typeof Info }> = [
	{ id: "changes", label: "Changes", Icon: GitDiff },
	{ id: "summary", label: "Overview", Icon: Info },
	{ id: "specialists", label: "Agents", Icon: Robot },
	{ id: "files", label: "Files", Icon: Folder },
	{ id: "browser", label: "Browser", Icon: Globe },
];

/** Memoized so streaming transcript updates (which this component no longer consumes outside the Summary tab) do not re-render the inspector shell. */
export const Inspector = memo(function Inspector({
	activeTab,
	onTabChange,
	onClose,
	selectedSpecialistId,
	onSelectSpecialist,
	project,
	cwd,
	runtime,
	behaviorMode,
	messages,
	git,
	automations,
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
	visible = true,
	expanded = false,
	onToggleExpanded,
	browserActive = false,
	platform = "darwin",
	homeDir,
}: InspectorProps) {
	const [browserVisited, setBrowserVisited] = useState(activeTab === "browser");
	useEffect(() => { if (activeTab === "browser") setBrowserVisited(true); }, [activeTab]);
	const instant = Boolean(useReducedMotion()) || (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) || Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT);
	const [selectSummary] = useState(createSessionSummarySelector);
	const summary = useMemo(() => selectSummary(messages), [messages, selectSummary]);
	const [selectReadiness] = useState(createReadinessSelector);
	const readiness = useMemo(() => selectReadiness(messages), [messages, selectReadiness]);
	const specialistCount = summary.specialists.length;
	const handleOpenFile = useCallback(
		(path: string) => onOpenExternal(pathToFileUrl(path)),
		[onOpenExternal],
	);
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
		<InspectorShell visible={visible} overlay={overlay} onClose={onClose} label="Session inspector">
			<div
				className={`inspector__tabs ${stylex.props(inspectorStyles.inspectorTabs, [responsiveStyles.inspectorTabs, responsiveLayoutStyles.inspectorTabs]).className ?? ""}`}
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
						className={[activeTab === tab.id ? "is-active" : "", stylex.props(inspectorStyles.inspectorTabButton).className].filter(Boolean).join(" ")}
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
						<tab.Icon size={16} aria-hidden="true" />
						<span className={`inspector__tab-label ${stylex.props(inspectorStyles.inspectorTabLabel).className ?? ""}`}>{tab.label}</span>
						{tab.id === "browser" && browserActive && activeTab !== "browser" ? <span className={`inspector__browser-activity ${stylex.props(inspectorStyles.inspectorBrowserActivity).className ?? ""}`} aria-label="Browser activity" /> : null}
						{tab.id === "changes" && git.files.length ? (
							<span className={`inspector__tab-count ${stylex.props(inspectorStyles.inspectorTabCount).className ?? ""}`}>{git.files.length}</span>
						) : tab.id === "specialists" && specialistCount ? (
							<span className={`inspector__tab-count ${stylex.props(inspectorStyles.inspectorTabCount).className ?? ""}`}>{specialistCount}</span>
						) : null}
						{activeTab === tab.id ? (
							<motion.span
								layoutId="inspector-active-tab"
								{...stylex.props(inspectorStyles.inspectorTabIndicator)}
								transition={instant ? { duration: 0 } : { type: 'spring', duration: 0.25, bounce: 0 }}
							/>
						) : null}
					</button>
				))}
				<span className={`inspector__tab-spacer ${stylex.props(inspectorStyles.inspectorTabSpacer).className ?? ""}`} />
				{onToggleExpanded && !overlay ? <IconButton xstyle={inspectorStyles.inspectorHeaderButton} label={expanded ? "Restore inspector width" : "Expand inspector"} onClick={onToggleExpanded}>{expanded ? <ArrowsInSimple size={16} /> : <ArrowsOutSimple size={16} />}</IconButton> : null}
				{overlay ? <IconButton xstyle={inspectorStyles.inspectorHeaderButton} label="Close inspector" onClick={onClose}>
					<SidebarRight size={16} />
				</IconButton> : null}
			</div>
			<div
				id={`inspector-panel-${activeTab}`}
				className={`inspector__body ${stylex.props(inspectorStyles.inspectorBody).className ?? ""}`}
				role="tabpanel"
				aria-labelledby={`inspector-tab-${activeTab}`}
				tabIndex={0}
			>
				{activeTab !== "browser" ? (
					<motion.div
						key={activeTab}
						{...stylex.props(inspectorStyles.inspectorPanelMotion)}
						initial={instant ? false : { opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={instant ? { duration: 0 } : { duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
					>
						{activeTab === "summary" ? (
							<div className={`inspector-scroll scroll-area ${stylex.props(baseStyles.scrollArea, inspectorStyles.inspectorScroll).className ?? ""}`}>
								<SummaryPanel
									runtime={runtime}
									behaviorMode={behaviorMode}
									cwd={cwd}
									sessionKey={agentSessionKey}
									summary={summary}
									readiness={readiness}
									git={git}
									automations={automations}
									onOpenAutomation={onOpenAutomation}
									onOpenSpecialist={(id) => {
										onSelectSpecialist(id);
										onTabChange("specialists");
									}}
								/>
							</div>
						) : null}
						{activeTab === "specialists" ? (
							<SpecialistsPanel
								key={agentSessionKey ?? "no-session"}
								cwd={cwd}
								messages={messages}
								selectedId={selectedSpecialistId}
								onSelect={onSelectSpecialist}
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
						{activeTab === "files" ? (
							<FilesPanel
								project={project}
								git={git}
								platform={platform}
								onOpen={handleOpenFile}
								onReveal={onRevealPath}
							/>
						) : null}
					</motion.div>
				) : null}
				{activeTab === "browser" || browserVisited ? (
					<div className={`inspector__browser-panel ${stylex.props(inspectorStyles.inspectorBrowserPanel).className ?? ""}`} hidden={activeTab !== "browser"} inert={activeTab !== "browser"}>
					<BrowserPanel
						visible={visible && activeTab === "browser"}
						key={`${cwd ?? ''}:${agentSessionKey ?? ''}`}
						cwd={cwd}
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
					</div>
				) : null}
			</div>
		</InspectorShell>
	);
});
