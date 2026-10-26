// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSlotRect } from "../../apps/desktop/src/components/AgentBrowserLayer";
import { AgentBrowserLayer } from "../../apps/desktop/src/components/AgentBrowserLayer";
import { BrowserPanel } from "../../apps/desktop/src/components/inspector/BrowserPanel";
import type { ExtensionTabControls } from "../../apps/desktop/src/hooks/useAgentBrowserTabs";
import type { BrowserAnnotationsApi } from "../../apps/desktop/src/hooks/useBrowserAnnotations";
import type { AgentBrowserTabRecord } from "../../apps/desktop/src/types/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface MutableRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

class ResizeObserverMock {
	static instances: ResizeObserverMock[] = [];

	readonly observe = vi.fn();
	readonly unobserve = vi.fn();
	readonly disconnect = vi.fn();

	constructor(private readonly callback: ResizeObserverCallback) {
		ResizeObserverMock.instances.push(this);
	}

	fire() {
		this.callback([], this as unknown as ResizeObserver);
	}
}

const annotations: BrowserAnnotationsApi = {
	annotations: [],
	atCapacity: false,
	add: vi.fn(() => false),
	remove: vi.fn(),
	clear: vi.fn(),
	handleNavigation: vi.fn(),
	sendSignal: 0,
	requestSend: vi.fn(),
};

const agentTab: AgentBrowserTabRecord = {
	tabId: "agent-tab",
	sessionFile: "/sessions/active.jsonl",
	url: "https://example.com/",
	title: "Example",
	attached: true,
	active: true,
	canGoBack: false,
	canGoForward: false,
};

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;
let currentRect: MutableRect;
let onAgentSlotRect: ReturnType<
	typeof vi.fn<(rect: AgentSlotRect | null) => void>
>;

function domRect({ left, top, width, height }: MutableRect): DOMRect {
	return {
		x: left,
		y: top,
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	} as DOMRect;
}

async function renderPanel(previewSelected = false) {
	await act(async () => {
		root.render(
			<BrowserPanel
				home="https://example.com/"
				onOpenExternal={() => undefined}
				annotations={annotations}
				agentTabs={[agentTab]}
				activeAgentTabId={agentTab.tabId}
				previewSelected={previewSelected}
				onAgentSlotRect={onAgentSlotRect}
			/>,
		);
	});
}

function latestObserver() {
	const observer = ResizeObserverMock.instances.at(-1);
	if (!observer)
		throw new Error("BrowserPanel did not create a ResizeObserver");
	return observer;
}

async function pollOnce() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(400);
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	ResizeObserverMock.instances = [];
	vi.stubGlobal("ResizeObserver", ResizeObserverMock);
	currentRect = { left: 10.2, top: 20.3, width: 100.4, height: 50.49 };
	onAgentSlotRect = vi.fn<(rect: AgentSlotRect | null) => void>();
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			return domRect(
				this.classList.contains("browser-agent-slot")
					? currentRect
					: { left: 0, top: 0, width: 0, height: 0 },
			);
		},
	);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	mounted = true;
});

afterEach(async () => {
	if (mounted) await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("BrowserPanel agent slot measurement", () => {
	it("emits the initial rounded rectangle once and suppresses steady polling updates", async () => {
		await renderPanel();

		expect(onAgentSlotRect.mock.calls).toEqual([
			[{ left: 10, top: 20, width: 100, height: 50 }],
		]);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_600);
		});

		expect(onAgentSlotRect).toHaveBeenCalledTimes(1);
	});

	it("keeps polling as the geometry fallback when ResizeObserver is unavailable", async () => {
		vi.stubGlobal("ResizeObserver", undefined);
		await renderPanel();

		currentRect = { ...currentRect, top: 60 };
		await pollOnce();

		expect(ResizeObserverMock.instances).toHaveLength(0);
		expect(onAgentSlotRect.mock.calls).toEqual([
			[{ left: 10, top: 20, width: 100, height: 50 }],
			[{ left: 10, top: 60, width: 100, height: 50 }],
		]);
	});

	it("emits once for every changed field and shares rounded equality across all triggers", async () => {
		await renderPanel();
		const observer = latestObserver();

		currentRect = { ...currentRect, left: 10.49 };
		act(() => observer.fire());
		act(() => window.dispatchEvent(new Event("resize")));
		await pollOnce();
		expect(onAgentSlotRect).toHaveBeenCalledTimes(1);

		currentRect = { ...currentRect, left: 11.2 };
		act(() => observer.fire());
		expect(onAgentSlotRect).toHaveBeenLastCalledWith({
			left: 11,
			top: 20,
			width: 100,
			height: 50,
		});

		act(() => window.dispatchEvent(new Event("resize")));
		await pollOnce();
		expect(onAgentSlotRect).toHaveBeenCalledTimes(2);

		currentRect = { ...currentRect, top: 21.6 };
		act(() => window.dispatchEvent(new Event("resize")));
		expect(onAgentSlotRect).toHaveBeenLastCalledWith({
			left: 11,
			top: 22,
			width: 100,
			height: 50,
		});

		currentRect = { ...currentRect, width: 101.6 };
		await pollOnce();
		expect(onAgentSlotRect).toHaveBeenLastCalledWith({
			left: 11,
			top: 22,
			width: 102,
			height: 50,
		});

		currentRect = { ...currentRect, height: 51.6 };
		act(() => observer.fire());
		expect(onAgentSlotRect).toHaveBeenLastCalledWith({
			left: 11,
			top: 22,
			width: 102,
			height: 52,
		});
		expect(onAgentSlotRect).toHaveBeenCalledTimes(5);

		act(() => window.dispatchEvent(new Event("resize")));
		act(() => observer.fire());
		await pollOnce();
		expect(onAgentSlotRect).toHaveBeenCalledTimes(5);
	});

	it("emits null once on hide and resets so re-show reports current geometry", async () => {
		await renderPanel();
		const visibleObserver = latestObserver();
		await renderPanel(true);

		expect(onAgentSlotRect.mock.calls).toEqual([
			[{ left: 10, top: 20, width: 100, height: 50 }],
			[null],
		]);
		expect(container.querySelector(".browser-agent-slot")).toBeNull();
		expect(visibleObserver.disconnect).toHaveBeenCalledOnce();

		currentRect = { left: 30, top: 40, width: 200, height: 90 };
		await renderPanel();

		expect(onAgentSlotRect.mock.calls).toEqual([
			[{ left: 10, top: 20, width: 100, height: 50 }],
			[null],
			[{ left: 30, top: 40, width: 200, height: 90 }],
		]);
		expect(container.querySelector(".browser-agent-slot")).not.toBeNull();
	});

	it("emits null exactly once when an active slot unmounts", async () => {
		await renderPanel();

		await act(async () => root.unmount());
		mounted = false;

		expect(onAgentSlotRect.mock.calls).toEqual([
			[{ left: 10, top: 20, width: 100, height: 50 }],
			[null],
		]);
		expect(latestObserver().disconnect).toHaveBeenCalledOnce();
	});
});

const extensionTab: AgentBrowserTabRecord = {
	...agentTab,
	tabId: "extension-tab",
	title: "Shared Docs",
	url: "https://docs.example.com/",
	backend: "extension",
	pairedByUser: true,
	paused: false,
	chromeTabId: 7,
};

function extensionControls(connected: boolean): ExtensionTabControls {
	return {
		status: {
			connected,
			extensionPath: "/ext",
			bridgePort: connected ? 29301 : null,
			activeSessionKey: null,
			pairedTabCount: 1,
		},
		setPaused: vi.fn(),
		popOut: vi.fn(),
		focus: vi.fn(),
	};
}

async function renderWithExtension(
	tab: AgentBrowserTabRecord,
	extension: ExtensionTabControls,
) {
	await act(async () => {
		root.render(
			<BrowserPanel
				home="https://example.com/"
				onOpenExternal={() => undefined}
				annotations={annotations}
				agentTabs={[tab]}
				activeAgentTabId={tab.tabId}
				previewSelected={false}
				onAgentSlotRect={onAgentSlotRect}
				extension={extension}
			/>,
		);
	});
}

function button(label: string): HTMLButtonElement {
	const match = [...container.querySelectorAll("button")].find((item) =>
		item.textContent?.includes(label),
	);
	if (!match) throw new Error(`No button labelled ${label}`);
	return match;
}

describe("BrowserPanel extension-backed tabs", () => {
	it("renders the extension card in place of the agent webview slot and routes its controls", async () => {
		const extension = extensionControls(true);
		await renderWithExtension(extensionTab, extension);

		const card = container.querySelector('[data-testid="extension-tab-card"]');
		expect(card?.textContent).toContain("Shared Docs");
		expect(card?.textContent).toContain("https://docs.example.com/");
		expect(card?.textContent).toContain("Shared from Browser");
		expect(card?.textContent).toContain("Agent active");
		expect(container.querySelector(".browser-agent-slot")).toBeNull();
		expect(container.querySelector(".browser-agent-area webview")).toBeNull();
		expect(
			container.querySelector('[data-testid="browser-pop-out-button"]'),
		).toBeNull();
		expect(container.textContent).toContain("Extension connected");
		expect(onAgentSlotRect).not.toHaveBeenCalledWith(
			expect.objectContaining({ width: expect.any(Number) }),
		);

		act(() => button("Pause Agent").click());
		expect(extension.setPaused).toHaveBeenCalledWith(extensionTab, true);
		act(() => button("Focus in Browser").click());
		expect(extension.focus).toHaveBeenCalledWith(extensionTab);

		await renderWithExtension(
			{ ...extensionTab, paused: true, pairedByUser: false },
			extension,
		);
		expect(container.textContent).toContain("Paused by user");
		expect(container.textContent).toContain("Apex Tab Group");
		act(() => button("Resume Agent").click());
		expect(extension.setPaused).toHaveBeenLastCalledWith(
			expect.objectContaining({ tabId: "extension-tab" }),
			false,
		);
	});

	it("offers Pop out to Browser on in-app tabs only while the extension is connected", async () => {
		const connected = extensionControls(true);
		await renderWithExtension(agentTab, connected);
		const popOut = container.querySelector<HTMLButtonElement>(
			'[data-testid="browser-pop-out-button"]',
		);
		expect(popOut).not.toBeNull();
		act(() => popOut!.click());
		expect(connected.popOut).toHaveBeenCalledWith(agentTab);

		await renderWithExtension(agentTab, extensionControls(false));
		expect(
			container.querySelector('[data-testid="browser-pop-out-button"]'),
		).toBeNull();
		expect(container.textContent).toContain("Extension offline");
	});

	it("mounts webview guests only for in-app tabs in the agent browser layer", async () => {
		await act(async () => {
			root.render(
				<AgentBrowserLayer
					tabs={[agentTab, extensionTab]}
					visibleTabId={null}
					rect={null}
					pointerEvent={null}
					onAttach={() => undefined}
				/>,
			);
		});
		expect(container.querySelectorAll("webview")).toHaveLength(1);
	});
});
