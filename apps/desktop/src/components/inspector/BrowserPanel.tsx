import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { useActorRef, useMachine, useSelector } from "@xstate/react";
import type {
	ExtensionTabControls,
	StampedPointerEvent,
} from "@/hooks/useAgentBrowserTabs";
import type { BrowserAnnotationsApi } from "@/hooks/useBrowserAnnotations";
import { captureBrowserSelection } from "@/lib/capture-browser-selection";
import {
	annotationMarkersScript,
	annotationPickerScript,
	annotationTakeScript,
} from "@/lib/annotation-picker";
import {
	MAX_BROWSER_ANNOTATIONS,
	sanitizeCapturedElement,
} from "@/lib/browser-annotations";
import {
	detectRendererPlatform,
} from "@/lib/platform-shortcuts";
import {
	type AgentBrowserTabRecord,
	BROWSER_PARTITION,
	type BrowserSourceResult,
} from "@/types/api";
import { AgentCursorOverlay, type AgentSlotRect } from "../AgentBrowserLayer";
import {
	ExtensionStatusIndicator,
	ExtensionTabCard,
} from "../ExtensionTabControls";
import {
	ArrowLeft,
	ArrowRight,
	ArrowSquareOut,
	ArrowsClockwise,
	ChatCircleText,
	ClockCounterClockwise,
	Crosshair,
	Globe,
	Robot,
	ShieldCheck,
	X,
} from "../icons";
import { Banner } from "@astryxdesign/core/Banner";
import { IconButton } from "../ui";
import { BrowserAnnotationPopover } from "./BrowserAnnotationPopover";
import { browserAnnotationMachine } from "./browserAnnotationMachine";
import {
	browserPreviewMachine,
	normalizeUrl,
	runInPage,
	type WebviewElement,
} from "./browserPreviewMachine";

interface BrowserPanelProps {
	cwd?: string;
	navigationRequest?: { id: number; url: string };
	onNavigationRequestHandled?(id: number): void;
	platform?: NodeJS.Platform;
	home: string;
	onOpenExternal(url: string): void;
	annotations: BrowserAnnotationsApi;
	/** Agent-controlled tabs for the active session; empty hides the tab strip entirely. */
	agentTabs?: AgentBrowserTabRecord[];
	activeAgentTabId?: string | null;
	previewSelected?: boolean;
	onSelectAgentTab?(tabId: string): void;
	onCloseAgentTab?(tabId: string): void;
	onShowPreview?(): void;
	/** Reports the rectangle the always-mounted AgentBrowserLayer should cover, or null when hidden. */
	onAgentSlotRect?(rect: AgentSlotRect | null): void;
	/** Session key of the active thread, so the agent can adopt the Preview webview as its "preview" tab. */
	agentSessionKey?: string;
	/** Reports the Preview webview identity and owning session to the main process (null on teardown). */
	onPreviewContext?(
		webContentsId: number | null,
		sessionFile: string | null,
	): void;
	/** Latest agent pointer movement targeting the "preview" tab, for the cursor overlay. */
	previewPointerEvent?: StampedPointerEvent | null;
	/** User navigation on an agent tab; routed through the main process to the guest. */
	onNavigateAgentTab?(
		tabId: string,
		action: "back" | "forward" | "reload" | "url",
		url?: string,
	): void;
	/** Browser extension status and controls; extension-backed tabs render a control card instead of a webview. */
	extension?: ExtensionTabControls;
	/** Test hook: how often to poll the page for a clicked element while picking. */
	pollIntervalMs?: number;
	visible?: boolean;
}

function agentTabLabel(tab: AgentBrowserTabRecord): string {
	if (tab.title) return tab.title;
	try {
		const host = new URL(tab.url).hostname;
		if (host) return host;
	} catch {
		/* about:blank and friends */
	}
	return "New tab";
}

export function BrowserPanel({
	home,
	cwd,
	navigationRequest,
	onNavigationRequestHandled,
	onOpenExternal,
	annotations,
	agentTabs = [],
	activeAgentTabId = null,
	previewSelected = true,
	onSelectAgentTab,
	onCloseAgentTab,
	onShowPreview,
	onAgentSlotRect,
	agentSessionKey,
	onPreviewContext,
	previewPointerEvent = null,
	onNavigateAgentTab,
	extension,
	pollIntervalMs = 350,
	visible = true,
	platform = detectRendererPlatform(),
}: BrowserPanelProps) {
	const webviewRef = useRef<WebviewElement | null>(null);
	const previewActorRef = useActorRef(browserPreviewMachine, { input: { home } });
	const previewSnapshot = useSelector(previewActorRef, (snapshot) => snapshot);
	const { address, currentUrl, canBack, canForward, history, previewWebContentsId } = previewSnapshot.context;
	const loading = previewSnapshot.matches({ network: "loading" });
	const domReady = previewSnapshot.matches({ dom: "ready" });
	const historyOpen = previewSnapshot.matches({ historyPanel: "open" });
	const isDirectArmed = previewSnapshot.matches({ selectionCapture: "armed" });
	const capturingSelection = previewSnapshot.matches({ selectionCapture: "capturingSelection" });
	const [annotationSnapshot, sendAnnotation] = useMachine(browserAnnotationMachine);
	const picking = annotationSnapshot.matches({ mode: "picking" });
	const { pendingElement, annotationText, notice } = annotationSnapshot.context;
	const annotationsRef = useRef(annotations);
	annotationsRef.current = annotations;
	const lastMarkersRef = useRef("");
	const activeAgentTab =
		agentTabs.find((tab) => tab.tabId === activeAgentTabId) ?? null;
	const showAgentTab = !previewSelected && activeAgentTab !== null;
	const showExtensionTab =
		showAgentTab && activeAgentTab?.backend === "extension";
	const showAgentWebview = visible && showAgentTab && !showExtensionTab;
	const slotRef = useRef<HTMLDivElement | null>(null);
	const onAgentSlotRectRef = useRef(onAgentSlotRect);
	onAgentSlotRectRef.current = onAgentSlotRect;
	const lastAgentSlotRectRef = useRef<AgentSlotRect | null | undefined>(
		undefined,
	);
	const onPreviewContextRef = useRef(onPreviewContext);
	onPreviewContextRef.current = onPreviewContext;
	const [agentAddress, setAgentAddress] = useState("");
	const agentAddressEditingRef = useRef(false);

	// Keep the agent tab's address field following the page unless the user is
	// actively editing it.
	useEffect(() => {
		if (!agentAddressEditingRef.current)
			setAgentAddress(activeAgentTab?.url ?? "");
	}, [activeAgentTab?.url, activeAgentTabId]);

	// Bind the Preview guest to the active thread so its agent can adopt it as
	// the "preview" tab; clear the binding when the panel goes away.
	useEffect(() => {
		if (previewWebContentsId === null || !agentSessionKey) return;
		onPreviewContextRef.current?.(previewWebContentsId, agentSessionKey);
	}, [previewWebContentsId, agentSessionKey]);
	useEffect(
		() => () => {
			onPreviewContextRef.current?.(null, null);
		},
		[],
	);

	// The agent webviews live in the always-mounted AgentBrowserLayer, not in
	// this panel; report where the layer should overlay while an agent tab is
	// shown. Position can shift without a resize (sidebar toggle), so a slow
	// poll backs up the observer.
	useEffect(() => {
		const publish = (next: AgentSlotRect | null) => {
			const previous = lastAgentSlotRectRef.current;
			const unchanged =
				next === null
					? previous === null
					: previous !== null &&
						previous !== undefined &&
						previous.left === next.left &&
						previous.top === next.top &&
						previous.width === next.width &&
						previous.height === next.height;
			if (unchanged) return;
			lastAgentSlotRectRef.current = next;
			onAgentSlotRectRef.current?.(next);
		};
		if (!showAgentWebview) {
			publish(null);
			return;
		}
		const report = () => {
			const slot = slotRef.current;
			if (!slot) return;
			const rect = slot.getBoundingClientRect();
			publish({
				left: Math.round(rect.left),
				top: Math.round(rect.top),
				width: Math.round(rect.width),
				height: Math.round(rect.height),
			});
		};
		report();
		const observer =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
		if (observer && slotRef.current) observer.observe(slotRef.current);
		window.addEventListener("resize", report);
		const interval = window.setInterval(report, 400);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", report);
			window.clearInterval(interval);
			publish(null);
		};
	}, [showAgentWebview]);

	useEffect(() => {
		const view = webviewRef.current;
		if (!view) return;
		const readNavigation = () => {
			try {
				return {
					url: view.getURL() || home,
					canBack: view.canGoBack(),
					canForward: view.canGoForward(),
				};
			} catch {
				return {};
			}
		};
		const didStart = () => previewActorRef.send({ type: "DID_START_LOADING" });
		const didStop = () =>
			previewActorRef.send({ type: "DID_STOP_LOADING", ...readNavigation() });
		// A full navigation replaces the document: the injected picker and markers
		// are gone, and annotations captured on other pages become stale.
		const didNavigate = () => {
			previewActorRef.send({ type: "DID_NAVIGATE", ...readNavigation() });
			lastMarkersRef.current = "";
			sendAnnotation({ type: "NAVIGATED" });
			try {
				annotationsRef.current.handleNavigation(view.getURL());
			} catch {
				/* webview not ready */
			}
		};
		// dom-ready is the earliest point at which executeJavaScript is legal;
		// it fires again for every subsequent document, so markers re-apply.
		const onDomReady = () => {
			lastMarkersRef.current = "";
			let webContentsId: number | null = null;
			try {
				webContentsId = view.getWebContentsId();
			} catch {
				/* guest not attached yet */
			}
			previewActorRef.send({ type: "DOM_READY", webContentsId });
		};
		view.addEventListener("dom-ready", onDomReady);
		view.addEventListener("did-start-loading", didStart);
		view.addEventListener("did-stop-loading", didStop);
		view.addEventListener("did-navigate", didNavigate);
		view.addEventListener("did-navigate-in-page", didNavigate);
		return () => {
			view.removeEventListener("dom-ready", onDomReady);
			view.removeEventListener("did-start-loading", didStart);
			view.removeEventListener("did-stop-loading", didStop);
			view.removeEventListener("did-navigate", didNavigate);
			view.removeEventListener("did-navigate-in-page", didNavigate);
		};
	}, [home, previewActorRef, sendAnnotation]);

	// While annotation mode is on, the picker runs inside the page; poll it for
	// the element the user clicked. Stopping cleans up the page-side listeners.
	useEffect(() => {
		const view = webviewRef.current;
		if (!visible || !picking || !view || !domReady) return;
		let disposed = false;
		let inFlight = false;
		void runInPage(view, annotationPickerScript("start"));
		const interval = window.setInterval(() => {
			if (inFlight) return;
			inFlight = true;
			runInPage(view, annotationTakeScript())
				.then((payload) => {
					inFlight = false;
					if (disposed || typeof payload !== "string") return;
					let parsed: unknown;
					try {
						parsed = JSON.parse(payload);
					} catch {
						return;
					}
					const first = Array.isArray(parsed) ? parsed[0] : null;
					if (first && typeof first === "object" && "cancelled" in first && first.cancelled === true) {
						previewActorRef.send({ type: "DISARM_SELECTION" });
						sendAnnotation({ type: "CANCEL" });
						return;
					}
					const element = Array.isArray(parsed)
						? sanitizeCapturedElement(parsed[0])
						: null;
					if (!element) return;
					if (
						previewActorRef.getSnapshot().matches({ selectionCapture: "armed" }) &&
						agentSessionKey &&
						window.apex
					) {
						const owner = annotationsRef.current;
						const pageUrl = view.getURL();
						previewActorRef.send({ type: "CAPTURE_SELECTION_START" });
						sendAnnotation({ type: "CANCEL" });
						void captureBrowserSelection({ bridge: window.apex, sessionKey: agentSessionKey, tabId: "preview", pageUrl, pageTitle: view.getTitle(), cwd, element }).then(({ input, warning }) => {
							if (view.getURL() !== pageUrl || annotationsRef.current.add !== owner.add) return;
							if (owner.add(input)) owner.focusComposer?.();
							if (warning) sendAnnotation({ type: "CAPACITY_BLOCKED", notice: warning });
						}).catch(() => sendAnnotation({ type: "CAPACITY_BLOCKED", notice: "The selected page is no longer available. Select the element again." })).finally(() => previewActorRef.send({ type: "CAPTURE_SELECTION_DONE" }));
					} else sendAnnotation({ type: "ELEMENT_CAPTURED", element });
				})
				.catch(() => {
					inFlight = false;
				});
		}, pollIntervalMs);
		return () => {
			disposed = true;
			window.clearInterval(interval);
			void runInPage(view, annotationPickerScript("stop"));
		};
	}, [visible, picking, pollIntervalMs, domReady, previewActorRef, sendAnnotation, agentSessionKey, cwd]);

	// Persistent numbered markers for every live annotation on the current page.
	const markers = annotations.annotations.flatMap((annotation, index) =>
		annotation.stale
			? []
			: [{ selector: annotation.element.selector, index: index + 1 }],
	);
	const markerSignature = `${currentUrl}|${markers.map((marker) => `${marker.index}:${marker.selector}`).join("|")}`;
	useEffect(() => {
		const view = webviewRef.current;
		if (
			!view ||
			!domReady ||
			loading ||
			lastMarkersRef.current === markerSignature
		)
			return;
		lastMarkersRef.current = markerSignature;
		void runInPage(view, annotationMarkersScript(markers));
	}, [markerSignature, loading, domReady]);

	const navigate = useCallback((value: string) => {
		const url = normalizeUrl(value);
		previewActorRef.send({ type: "NAVIGATE", url });
		void webviewRef.current?.loadURL(url).catch((error: unknown) => {
			if (!String(error).includes("ERR_ABORTED"))
				console.error("Browser navigation failed", error);
		});
	}, [previewActorRef]);
	useEffect(() => {
		if (!navigationRequest || !domReady) return;
		navigate(navigationRequest.url);
		onNavigationRequestHandled?.(navigationRequest.id);
	}, [domReady, navigate, navigationRequest, onNavigationRequestHandled]);

	const capacityNotice = `Apex keeps at most ${MAX_BROWSER_ANNOTATIONS} annotations. Remove one from the composer attachment to add more.`;

	const toggleAnnotation = () => {
		previewActorRef.send({ type: "DISARM_SELECTION" });
		sendAnnotation({
			type: "TOGGLE",
			atCapacity: annotationsRef.current.atCapacity,
			capacityNotice,
		});
	};

	const toggleDirectSelection = () => {
		const atCapacity = annotationsRef.current.atCapacity;
		if (isDirectArmed) {
			previewActorRef.send({ type: "DISARM_SELECTION" });
		} else if (!atCapacity) {
			previewActorRef.send({ type: "ARM_SELECTION" });
		}
		sendAnnotation({
			type: "TOGGLE",
			atCapacity,
			capacityNotice,
		});
	};

	const saveAnnotation = (source: BrowserSourceResult): boolean => {
		const view = webviewRef.current;
		if (!pendingElement || !annotationText.trim()) return false;
		let pageTitle = "";
		let pageUrl = currentUrl;
		try {
			pageTitle = view?.getTitle() ?? "";
			pageUrl = view?.getURL() || currentUrl;
		} catch {
			/* webview not ready */
		}
		if (
			!annotationsRef.current.add({
				comment: annotationText,
				element: pendingElement,
				source,
				pageUrl,
				pageTitle,
			})
		) {
			sendAnnotation({ type: "CAPACITY_BLOCKED", notice: capacityNotice });
			return false;
		}
		sendAnnotation({ type: "SAVED" });
		return true;
	};

	const webview = createElement("webview" as never, {
		ref: (node: WebviewElement | null) => {
			webviewRef.current = node;
		},
		src: home,
		className: "browser-webview",
		partition: BROWSER_PARTITION,
		webpreferences: "contextIsolation=yes,sandbox=yes,nodeIntegration=no",
	});

	const count = annotations.annotations.length;
	const staleCount = annotations.annotations.filter(
		(annotation) => annotation.stale,
	).length;

	return (
		<div className="browser-panel">
			{agentTabs.length ? (
				<div
					className="browser-tabstrip"
					role="tablist"
					aria-label="Browser tabs"
				>
					<button
						type="button"
						role="tab"
						aria-selected={!showAgentTab}
						className={showAgentTab ? "" : "is-active"}
						onClick={() => onShowPreview?.()}
					>
						Preview
					</button>
					{agentTabs.map((tab) => (
						<div
							key={tab.tabId}
							role="tab"
							tabIndex={0}
							aria-selected={showAgentTab && tab.tabId === activeAgentTabId}
							className={`browser-tabstrip__agent ${showAgentTab && tab.tabId === activeAgentTabId ? "is-active" : ""}`}
							title={tab.url}
							onClick={() => onSelectAgentTab?.(tab.tabId)}
							onKeyDown={(event) => {
								if (event.key !== "Enter" && event.key !== " ") return;
								event.preventDefault();
								onSelectAgentTab?.(tab.tabId);
							}}
						>
							{tab.backend === "extension" ? (
								<Globe size={11} aria-label="In your browser" />
							) : (
								<Robot size={11} aria-hidden />
							)}
							<span>{agentTabLabel(tab)}</span>
							<button
								type="button"
								aria-label={`Close agent tab ${agentTabLabel(tab)}`}
								onClick={(event) => {
									event.stopPropagation();
									onCloseAgentTab?.(tab.tabId);
								}}
							>
								<X size={11} />
							</button>
						</div>
					))}
					{extension?.status ? (
						<ExtensionStatusIndicator status={extension.status} />
					) : null}
				</div>
			) : null}
			<div
				className={`browser-preview ${showAgentTab ? "browser-preview--hidden" : ""}`}
				inert={showAgentTab ? true : undefined}
			>
				<div className="browser-toolbar">
					<IconButton
						label="Back"
						disabled={!canBack}
						onClick={() => webviewRef.current?.goBack()}
					>
						<ArrowLeft size={14} />
					</IconButton>
					<IconButton
						label="Forward"
						disabled={!canForward}
						onClick={() => webviewRef.current?.goForward()}
					>
						<ArrowRight size={14} />
					</IconButton>
					<IconButton
						label={loading ? "Stop loading" : "Reload"}
						onClick={() =>
							loading
								? webviewRef.current?.stop()
								: webviewRef.current?.reload()
						}
					>
						{loading ? <X size={14} /> : <ArrowsClockwise size={14} />}
					</IconButton>
					<form
						className="address-field"
						onSubmit={(event) => {
							event.preventDefault();
							navigate(address);
						}}
					>
						<ShieldCheck size={12} />
						<input
							value={address}
							onChange={(event) =>
								previewActorRef.send({
									type: "SET_ADDRESS",
									address: event.target.value,
								})
							}
							aria-label="Browser address"
							spellCheck={false}
						/>
						<button
							type="button"
							aria-label="Browser history"
							onClick={() => previewActorRef.send({ type: "TOGGLE_HISTORY" })}
						>
							<ClockCounterClockwise size={13} />
						</button>
					</form>
					<IconButton
						label={picking && isDirectArmed ? "Stop selecting" : "Select element"}
						aria-pressed={picking && isDirectArmed}
						className={picking && isDirectArmed ? "is-active" : ""}
						onClick={toggleDirectSelection}
					>
						<Crosshair size={15} />
					</IconButton>
					<IconButton
						className={
							picking || pendingElement ? "is-active annotation-active" : ""
						}
						label={picking ? "Stop annotating" : "Annotate page"}
						aria-pressed={picking}
						onClick={toggleAnnotation}
					>
						<ChatCircleText size={15} />
					</IconButton>
					<IconButton
						label="Open in default browser"
						onClick={() => onOpenExternal(currentUrl)}
					>
						<ArrowSquareOut size={14} />
					</IconButton>
				</div>
				{historyOpen ? (
					<div className="browser-history">
						<div>
							<strong>Recent pages</strong>
							<button
								type="button"
								onClick={() => previewActorRef.send({ type: "CLEAR_HISTORY" })}
							>
								Clear
							</button>
						</div>
						{history
							.slice()
							.reverse()
							.map((url, index) => (
								<button
									type="button"
									key={`${url}-${index}`}
									onClick={() => navigate(url)}
								>
									<ClockCounterClockwise size={12} />
									<span>{url}</span>
								</button>
							))}
					</div>
				) : null}
				<div className={`browser-viewport ${picking ? "is-annotating" : ""}`}>
					{webview}
					{picking || capturingSelection ? (
						<div className="annotation-hint" role="status">
							<Crosshair size={12} /> {capturingSelection ? "Preparing element preview…" : isDirectArmed ? "Click an element to attach it to chat. Escape cancels." : "Click an element in the page to comment on it"}
						</div>
					) : null}
					{pendingElement ? (
						<BrowserAnnotationPopover
							element={pendingElement} cwd={cwd} index={count + 1} platform={platform}
							text={annotationText} onTextChange={(text) => sendAnnotation({ type: "SET_TEXT", text })} onSave={saveAnnotation}
							onCancel={() => sendAnnotation({ type: "CANCEL" })}
							onRequestSend={() => annotationsRef.current.requestSend()}
						/>
					) : null}
					{count ? (
						<div className="annotation-count">
							<ChatCircleText size={12} /> {count} of {MAX_BROWSER_ANNOTATIONS}{" "}
							annotation{count === 1 ? "" : "s"}
							{staleCount ? ` · ${staleCount} from earlier pages` : ""}
						</div>
					) : null}
					{notice ? (
						<Banner status="warning" role="alert" className="annotation-notice" title={notice} />
					) : null}
					<AgentCursorOverlay pointerEvent={previewPointerEvent} />
				</div>
			</div>
			{activeAgentTab && showExtensionTab && extension ? (
				<div className="browser-agent-area browser-agent-area--extension">
					<ExtensionTabCard tab={activeAgentTab} extension={extension} />
				</div>
			) : showAgentTab && activeAgentTab ? (
				<div className="browser-agent-area">
					<div className="browser-agent-urlbar">
						<IconButton
							label="Back"
							disabled={!activeAgentTab.canGoBack}
							onClick={() => onNavigateAgentTab?.(activeAgentTab.tabId, "back")}
						>
							<ArrowLeft size={14} />
						</IconButton>
						<IconButton
							label="Forward"
							disabled={!activeAgentTab.canGoForward}
							onClick={() =>
								onNavigateAgentTab?.(activeAgentTab.tabId, "forward")
							}
						>
							<ArrowRight size={14} />
						</IconButton>
						<IconButton
							label="Reload"
							onClick={() =>
								onNavigateAgentTab?.(activeAgentTab.tabId, "reload")
							}
						>
							<ArrowsClockwise size={14} />
						</IconButton>
						<form
							className="address-field"
							onSubmit={(event) => {
								event.preventDefault();
								agentAddressEditingRef.current = false;
								onNavigateAgentTab?.(
									activeAgentTab.tabId,
									"url",
									normalizeUrl(agentAddress),
								);
							}}
						>
							<Robot size={12} aria-hidden />
							<input
								value={agentAddress}
								onChange={(event) => {
									agentAddressEditingRef.current = true;
									setAgentAddress(event.target.value);
								}}
								onBlur={() => {
									agentAddressEditingRef.current = false;
								}}
								aria-label="Agent tab address"
								spellCheck={false}
							/>
						</form>
						{!activeAgentTab.attached ? <em>connecting…</em> : null}
						{extension?.status?.connected ? (
							<button
								type="button"
								className="browser-pop-out"
								data-testid="browser-pop-out-button"
								title="Move this tab into your browser, where the agent keeps driving it"
								onClick={() => extension.popOut(activeAgentTab)}
							>
								<ArrowSquareOut size={13} />
								Pop out to Browser
							</button>
						) : null}
					</div>
					<div
						className="browser-agent-slot"
						ref={slotRef}
						aria-label="Agent-controlled browser tab"
					/>
				</div>
			) : null}
		</div>
	);
}
