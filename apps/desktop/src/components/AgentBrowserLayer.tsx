import * as stylex from '@stylexjs/stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { createElement, memo, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InspectorWindowContext } from "./InspectorWindow";
import type { StampedPointerEvent } from "@/hooks/useAgentBrowserTabs";
import { type AgentBrowserTabRecord, BROWSER_PARTITION } from "@/types/api";

export interface AgentSlotRect {
	left: number;
	top: number;
	width: number;
	height: number;
	/**
	 * Presentation-only viewport (same coordinate space) the layer must not paint
	 * outside. Set only while the inspector slides the Browser pane in or out.
	 */
	clip?: { left: number; top: number; width: number; height: number };
}

/** CSS clip-path that limits `rect` to its `clip` viewport, or undefined when unclipped. */
export function agentSlotClipPath(rect: AgentSlotRect): string | undefined {
	const { clip } = rect;
	if (!clip) return undefined;
	const top = Math.max(0, clip.top - rect.top);
	const left = Math.max(0, clip.left - rect.left);
	const right = Math.max(0, rect.left + rect.width - (clip.left + clip.width));
	const bottom = Math.max(0, rect.top + rect.height - (clip.top + clip.height));
	return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

type AgentWebviewElement = HTMLElement & {
	getWebContentsId(): number;
	addEventListener(type: string, listener: EventListener): void;
	removeEventListener(type: string, listener: EventListener): void;
};

interface AgentBrowserLayerProps {
	tabs: AgentBrowserTabRecord[];
	visibleTabId: string | null;
	interactive?: boolean;
	rect: AgentSlotRect | null;
	pointerEvent: StampedPointerEvent | null;
	onAttach(tabId: string, webContentsId: number): void;
}

const CURSOR_EASING = "cubic-bezier(.32,.72,.35,1)";
const CURSOR_IDLE_MS = 3_500;

/**
 * Hosts one webview guest per agent browser tab, for every session. This
 * layer stays mounted at the app shell so guests survive inspector and view
 * switches while the agent drives them; unmounting a webview destroys its
 * page. It is positioned over the Browser panel's slot when that panel shows
 * an agent tab, and kept laid out but invisible otherwise (display:none would
 * tear down the guest). Tabs driven through the browser extension have no
 * guest here.
 */
export function AgentBrowserLayer(props: AgentBrowserLayerProps) {
	const { popup } = useContext(InspectorWindowContext);
	const [moved, setMoved] = useState<ReadonlySet<string>>(() => new Set());
	const activeId = props.visibleTabId;
	useEffect(() => {
		if (!popup) {
			if (moved.size) setMoved(new Set());
		} else if (activeId && !moved.has(activeId)) {
			// Keep background guests in their original window while other sessions are running.
			setMoved(new Set([...moved, activeId]));
		}
	}, [popup, activeId, moved]);
	const floating = popup && !popup.closed;
	const inPopup = floating && activeId !== null && moved.has(activeId);
	return <>
		<GuestLayer {...props} tabs={floating ? props.tabs.filter((tab) => !moved.has(tab.tabId)) : props.tabs} rect={floating ? null : props.rect} />
		{floating && createPortal(
			<GuestLayer {...props} tabs={props.tabs.filter((tab) => moved.has(tab.tabId))} rect={inPopup ? props.rect : null} />,
			popup.document.body,
		)}
	</>;
}

function GuestLayer({
	tabs,
	visibleTabId,
	interactive = true,
	rect,
	pointerEvent,
	onAttach,
}: AgentBrowserLayerProps) {
	const style = rect
		? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, clipPath: agentSlotClipPath(rect), pointerEvents: interactive ? undefined : 'none' as const }
		: undefined;
	return (
		<div
			className={[`agent-browser-layer ${rect ? "is-visible" : ""}`, stylex.props(inspectorStyles.agentBrowserLayer, (rect) && inspectorStyles.agentBrowserLayerIsVisible).className].filter(Boolean).join(' ')}
			style={style}
			inert={!rect || !interactive}
			aria-hidden={!rect || !interactive || undefined}
		>
			{/* Extension-backed tabs live in the user's Chrome; only in-app tabs need a guest. */}
			{tabs
				.filter((tab) => tab.backend !== "extension")
				.map((tab) => (
					<AgentTabView
						key={tab.tabId}
						tabId={tab.tabId}
						visible={rect !== null && tab.tabId === visibleTabId}
						pointerEvent={
							pointerEvent?.tabId === tab.tabId ? pointerEvent : null
						}
						onAttach={onAttach}
					/>
				))}
		</div>
	);
}

interface AgentTabViewProps {
	tabId: string;
	visible: boolean;
	pointerEvent: StampedPointerEvent | null;
	onAttach(tabId: string, webContentsId: number): void;
}

/**
 * Synthetic cursor overlay: an arrow pointer that animates along the exact
 * path and duration the main process used for the real input glide, a trail
 * line that draws and fades behind it, and a ripple pulse on clicks. Mounted
 * over both agent tabs and the user's Preview webview.
 */
export function AgentCursorOverlay({
	pointerEvent,
}: {
	pointerEvent: StampedPointerEvent | null;
}) {
	const cursorRef = useRef<HTMLDivElement | null>(null);
	const overlayRef = useRef<HTMLDivElement | null>(null);
	const trailRef = useRef<SVGSVGElement | null>(null);
	const idleTimerRef = useRef<number | null>(null);

	useEffect(() => {
		const event = pointerEvent;
		const cursor = cursorRef.current;
		const overlay = overlayRef.current;
		const trail = trailRef.current;
		if (
			!event ||
			!cursor ||
			!overlay ||
			!trail ||
			typeof cursor.animate !== "function"
		)
			return;
		const { from, to, durationMs } = event;
		cursor.classList.add("is-active");
		cursor.classList.remove("is-idle");
		if (idleTimerRef.current !== null)
			window.clearTimeout(idleTimerRef.current);
		idleTimerRef.current = window.setTimeout(
			() => cursor.classList.add("is-idle"),
			CURSOR_IDLE_MS,
		);
		const glide = from !== null && durationMs > 0;
		if (glide) {
			cursor.animate(
				[
					{ transform: `translate(${from.x}px, ${from.y}px)` },
					{ transform: `translate(${to.x}px, ${to.y}px)` },
				],
				{ duration: durationMs, easing: CURSOR_EASING, fill: "forwards" },
			);
			const line = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"line",
			);
			line.setAttribute("x1", String(from.x));
			line.setAttribute("y1", String(from.y));
			line.setAttribute("x2", String(to.x));
			line.setAttribute("y2", String(to.y));
			line.setAttribute("class", "agent-cursor-trail__line");
			const length = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
			line.style.strokeDasharray = String(length);
			trail.appendChild(line);
			line.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
				duration: durationMs,
				easing: CURSOR_EASING,
				fill: "forwards",
			});
			const fade = line.animate([{ opacity: 1 }, { opacity: 0 }], {
				duration: 450,
				delay: durationMs,
				fill: "forwards",
			});
			fade.finished.then(
				() => line.remove(),
				() => line.remove(),
			);
		} else {
			cursor.animate(
				[
					{ transform: `translate(${to.x}px, ${to.y}px)`, opacity: 0 },
					{ transform: `translate(${to.x}px, ${to.y}px)`, opacity: 1 },
				],
				{ duration: 140, fill: "forwards" },
			);
		}
		if (event.action === "click") {
			const ripple = document.createElement("div");
			ripple.className = "agent-cursor-ripple";
			ripple.style.left = `${to.x}px`;
			ripple.style.top = `${to.y}px`;
			overlay.appendChild(ripple);
			const pulse = ripple.animate(
				[
					{ transform: "translate(-50%, -50%) scale(.3)", opacity: 0.55 },
					{ transform: "translate(-50%, -50%) scale(1.6)", opacity: 0 },
				],
				{
					duration: 450,
					delay: glide ? durationMs : 0,
					easing: "ease-out",
					fill: "forwards",
				},
			);
			pulse.finished.then(
				() => ripple.remove(),
				() => ripple.remove(),
			);
		}
	}, [pointerEvent]);

	useEffect(
		() => () => {
			if (idleTimerRef.current !== null)
				window.clearTimeout(idleTimerRef.current);
		},
		[],
	);

	return (
		<div ref={overlayRef} className={`agent-cursor-layer ${stylex.props(inspectorStyles.agentCursorLayer).className ?? ""}`} aria-hidden>
			<svg ref={trailRef} className={`agent-cursor-trail ${stylex.props(inspectorStyles.agentCursorTrail).className ?? ""}`} aria-hidden="true" />
			<div ref={cursorRef} className={`agent-cursor ${stylex.props(inspectorStyles.agentCursor).className ?? ""}`}>
				<svg
					className={`agent-cursor__arrow ${stylex.props(inspectorStyles.agentCursorArrow).className ?? ""}`}
					viewBox="0 0 20 22"
					width="20"
					height="22"
					aria-hidden="true"
				>
					<path d="M4 1.4 L4 17.2 L8.1 13.6 L10.7 19.6 L13.5 18.4 L10.9 12.5 L16.3 12.5 Z" />
				</svg>
			</div>
		</div>
	);
}

const AgentTabView = memo(function AgentTabView({
	tabId,
	visible,
	pointerEvent,
	onAttach,
}: AgentTabViewProps) {
	const viewRef = useRef<AgentWebviewElement | null>(null);
	const reportedRef = useRef(false);
	const onAttachRef = useRef(onAttach);
	onAttachRef.current = onAttach;

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		// dom-ready is the earliest point where getWebContentsId is valid; it
		// fires again per document, so report only once per mounted guest.
		const report = () => {
			if (reportedRef.current) return;
			try {
				const webContentsId = view.getWebContentsId();
				reportedRef.current = true;
				onAttachRef.current(tabId, webContentsId);
			} catch {
				/* guest not attached yet; a later dom-ready will report */
			}
		};
		view.addEventListener("dom-ready", report);
		return () => view.removeEventListener("dom-ready", report);
	}, [tabId]);

	// src stays about:blank permanently: the main process drives all navigation,
	// and rewriting src on re-render would reload the guest.
	return (
		<div className={[`agent-browser-tab ${visible ? "is-visible" : ""}`, stylex.props(inspectorStyles.agentBrowserTab, visible && inspectorStyles.agentBrowserTabIsVisible).className].filter(Boolean).join(' ')}>
			{createElement("webview" as never, {
				ref: (node: AgentWebviewElement | null) => {
					viewRef.current = node;
				},
				src: "about:blank",
				className: "browser-webview",
				partition: BROWSER_PARTITION,
				webpreferences: "contextIsolation=yes,sandbox=yes,nodeIntegration=no",
			})}
			<AgentCursorOverlay pointerEvent={pointerEvent} />
		</div>
	);
});
