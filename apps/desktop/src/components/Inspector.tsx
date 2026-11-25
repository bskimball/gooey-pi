import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex';
import * as stylex from '@stylexjs/stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { createContext, memo, type ReactNode, type Ref, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type AnimationPlaybackControls, AnimatePresence, animate, motion, useIsPresent, useReducedMotion } from "motion/react";
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
import { ArrowsInSimple, ArrowsOutSimple, SidebarRight } from "./icons";
import { BrowserPanel } from "./inspector/BrowserPanel";
import { ChangesPanel } from "./inspector/ChangesPanel";
import { FilesPanel } from "./inspector/FilesPanel";
import { SpecialistsPanel } from "./inspector/SpecialistsPanel";
import { SummaryPanel } from "./inspector/SummaryPanel";
import { createReadinessSelector } from "./inspector/readiness";
import { createSessionSummarySelector } from "./inspector/session-summary";
import { IconButton } from "./ui";
import { inspectorTabs as tabs } from "./inspector/tabs";
import { InspectorWindowButton } from "./InspectorWindow";
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
	instantShell?: boolean;
	onShellMotionComplete?(): void;
	expanded?: boolean;
	onToggleExpanded?(): void;
	browserActive?: boolean;
}


const tabIndex = (id: InspectorTab) => tabs.findIndex((tab) => tab.id === id);
const SLIDE_TRANSITION = { duration: 0.22, ease: [0.23, 1, 0.32, 1] as const };
const slideOffset = (dir: number) => `${dir * 100}%`;

const slideStyles = stylex.create({
	viewport: { position: "relative" },
	browserLeaving: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
});

/** Direction of the latest tab change in `tabs` order (+1 = toward the right). */
interface SlideNav { tab: InspectorTab; dir: -1 | 0 | 1; instant: boolean }
const SlideContext = createContext<SlideNav>({ tab: "summary", dir: 0, instant: true });

/**
 * One non-browser panel. Exiting copies read the live direction from context
 * so a rapid reversal exits the correct way, and turn inert the moment they
 * stop being the selected panel.
 */
function SlidePane({ children, ref }: { children: ReactNode; ref?: Ref<HTMLDivElement> }) {
	const isPresent = useIsPresent();
	const { dir, instant } = useContext(SlideContext);
	return (
		<motion.div
			ref={ref}
			{...stylex.props(inspectorStyles.inspectorPanelMotion)}
			inert={!isPresent}
			aria-hidden={isPresent ? undefined : true}
			initial={instant || dir === 0 ? false : { x: slideOffset(dir) }}
			animate={{ x: "0%" }}
			exit={instant ? { x: "0%", opacity: 0, transition: { duration: 0 } } : { x: slideOffset(-dir) }}
			transition={instant ? { duration: 0 } : SLIDE_TRANSITION}
		>
			{isPresent || !instant ? children : null}
		</motion.div>
	);
}

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
	instantShell = false,
	onShellMotionComplete,
	expanded = false,
	onToggleExpanded,
	browserActive = false,
	platform = "darwin",
	homeDir,
}: InspectorProps) {
	const [browserVisited, setBrowserVisited] = useState(activeTab === "browser");
	useEffect(() => { if (activeTab === "browser") setBrowserVisited(true); }, [activeTab]);
	const reducedMotion = Boolean(useReducedMotion()) || (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) || Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT);
	const instant = reducedMotion;
	const [shellViewport, setShellViewport] = useState<HTMLDivElement | null>(null);
	const [shellAnimating, setShellAnimating] = useState(false);
	const [shellSettledVisible, setShellSettledVisible] = useState(visible);
	const shellVisibleRef = useRef(visible);
	shellVisibleRef.current = visible;
	const shellSliding = !reducedMotion && !instantShell && (shellAnimating || shellSettledVisible !== visible);
	const startShellMotion = useCallback(() => setShellAnimating(true), []);
	const completeShellMotion = useCallback(() => {
		setShellAnimating(false);
		setShellSettledVisible(shellVisibleRef.current);
		onShellMotionComplete?.();
	}, [onShellMotionComplete]);
	// Keyboard tab moves switch instantly; pointer/programmatic moves slide.
	const keyboardNavRef = useRef(false);
	const [nav, setNav] = useState<SlideNav>({ tab: activeTab, dir: 0, instant: true });
	let slideNav = nav;
	if (nav.tab !== activeTab) {
		slideNav = { tab: activeTab, dir: Math.sign(tabIndex(activeTab) - tabIndex(nav.tab)) as SlideNav["dir"], instant: keyboardNavRef.current };
		setNav(slideNav);
	}
	if (instant && !slideNav.instant) slideNav = { ...slideNav, instant: true };
	// Cleared after commit (not during render) so StrictMode double renders agree.
	useEffect(() => { keyboardNavRef.current = false; }, [nav.tab]);
	const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
	const browserPaneRef = useRef<HTMLDivElement | null>(null);
	const browserAnimRef = useRef<AnimationPlaybackControls | null>(null);
	const browserWasActiveRef = useRef(activeTab === "browser");
	const [browserSliding, setBrowserSliding] = useState(false);
	const browserSelected = activeTab === "browser";
	// The Browser pane is never remounted: slide the persistent element itself.
	useLayoutEffect(() => {
		if (browserWasActiveRef.current === browserSelected) return;
		browserWasActiveRef.current = browserSelected;
		const pane = browserPaneRef.current;
		const running = browserAnimRef.current;
		running?.stop();
		browserAnimRef.current = null;
		if (!pane) return;
		if (slideNav.instant || slideNav.dir === 0) {
			animate(pane, { x: "0%" }, { duration: 0 });
			setBrowserSliding(false);
			return;
		}
		const target = browserSelected ? "0%" : slideOffset(-slideNav.dir);
		// A reversal mid-flight continues from the current offset.
		const keyframes = running || !browserSelected ? target : [slideOffset(slideNav.dir), target];
		const controls = animate(pane, { x: keyframes }, SLIDE_TRANSITION);
		browserAnimRef.current = controls;
		setBrowserSliding(true);
		void controls.then(() => {
			if (browserAnimRef.current !== controls) return;
			browserAnimRef.current = null;
			setBrowserSliding(false);
		});
	}, [browserSelected, slideNav]);
	useEffect(() => () => browserAnimRef.current?.stop(), []);
	const [selectSummary] = useState(createSessionSummarySelector);
	const summary = useMemo(() => selectSummary(messages), [messages, selectSummary]);
	const [selectReadiness] = useState(createReadinessSelector);
	const readiness = useMemo(() => selectReadiness(messages), [messages, selectReadiness]);
	const specialistCount = summary.specialists.length;
	const handleOpenFile = useCallback(
		(path: string) => onOpenExternal(pathToFileUrl(path)),
		[onOpenExternal],
	);
	const moveTab = (current: number, key: string, ownerDocument: Document) => {
		let next = current;
		if (key === "ArrowRight") next = (current + 1) % tabs.length;
		else if (key === "ArrowLeft")
			next = (current - 1 + tabs.length) % tabs.length;
		else if (key === "Home") next = 0;
		else if (key === "End") next = tabs.length - 1;
		else return;
		const tab = tabs[next];
		if (tab.id !== activeTab) keyboardNavRef.current = true;
		onTabChange(tab.id);
		requestAnimationFrame(() =>
			ownerDocument.getElementById(`inspector-tab-${tab.id}`)?.focus(),
		);
	};
	return (
		<InspectorShell visible={visible} overlay={overlay} onClose={onClose} label="Session inspector" instant={instantShell} onMotionStart={startShellMotion} onMotionComplete={completeShellMotion} viewportRef={setShellViewport}>
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
								moveTab(index, event.key, event.currentTarget.ownerDocument);
							}
						}}
						title={tab.label}
						onClick={(event) => {
							// detail 0 = Enter/Space/assistive activation: switch instantly; pointer clicks slide.
							keyboardNavRef.current = event.detail === 0 && tab.id !== activeTab;
							onTabChange(tab.id);
						}}
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
				<InspectorWindowButton />
				{onToggleExpanded && !overlay ? <IconButton xstyle={inspectorStyles.inspectorHeaderButton} label={expanded ? "Restore inspector width" : "Expand inspector"} onClick={onToggleExpanded}>{expanded ? <ArrowsInSimple size={16} /> : <ArrowsOutSimple size={16} />}</IconButton> : null}
				{overlay ? <IconButton xstyle={inspectorStyles.inspectorHeaderButton} label="Close inspector" onClick={onClose}>
					<SidebarRight size={16} />
				</IconButton> : null}
			</div>
			<SlideContext value={slideNav}>
			<div
				ref={setBodyEl}
				id={`inspector-panel-${activeTab}`}
				className={`inspector__body ${stylex.props(inspectorStyles.inspectorBody, slideStyles.viewport).className ?? ""}`}
				role="tabpanel"
				aria-labelledby={`inspector-tab-${activeTab}`}
				tabIndex={0}
			>
				<AnimatePresence initial={false} mode="popLayout">
				{activeTab !== "browser" ? (
					<SlidePane key={activeTab}>
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
					</SlidePane>
				) : null}
				</AnimatePresence>
				{activeTab === "browser" || browserVisited ? (
					<div ref={browserPaneRef} className={`inspector__browser-panel ${stylex.props(inspectorStyles.inspectorBrowserPanel, !browserSelected && browserSliding && slideStyles.browserLeaving).className ?? ""}`} hidden={!browserSelected && !browserSliding} inert={!browserSelected} aria-hidden={browserSelected ? undefined : true}>
					<BrowserPanel
						visible={visible && activeTab === "browser"}
						sliding={(visible && browserSliding) || (browserSelected && shellSliding)}
						slideViewport={bodyEl}
						shellViewport={overlay ? undefined : shellViewport}
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
			</SlideContext>
		</InspectorShell>
	);
});
