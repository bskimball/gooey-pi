import { assign, setup } from "xstate";

export type WebviewElement = HTMLElement & {
	loadURL(url: string): Promise<void>;
	getURL(): string;
	getTitle(): string;
	getWebContentsId(): number;
	goBack(): void;
	goForward(): void;
	canGoBack(): boolean;
	canGoForward(): boolean;
	reload(): void;
	stop(): void;
	executeJavaScript(code: string): Promise<unknown>;
	addEventListener(type: string, listener: EventListener): void;
	removeEventListener(type: string, listener: EventListener): void;
};

/**
 * Electron's webview.executeJavaScript throws synchronously (not a rejected
 * promise) until the guest emits dom-ready, so a bare call from a mount
 * effect crashes the renderer. Route every call through this guard.
 */
export function runInPage(view: WebviewElement, code: string): Promise<unknown> {
	try {
		return view.executeJavaScript(code).catch(() => undefined);
	} catch {
		return Promise.resolve(undefined);
	}
}

export function normalizeUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "about:blank";
	if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("about:"))
		return trimmed;
	if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(trimmed))
		return `http://${trimmed}`;
	if (trimmed.includes(".") && !trimmed.includes(" "))
		return `https://${trimmed}`;
	return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export interface BrowserPreviewInput {
	home: string;
}

export interface BrowserPreviewContext {
	address: string;
	currentUrl: string;
	canBack: boolean;
	canForward: boolean;
	history: string[];
	previewWebContentsId: number | null;
}

export type BrowserPreviewEvent =
	| { type: "DOM_READY"; webContentsId: number | null }
	| { type: "DID_START_LOADING" }
	| {
			type: "DID_STOP_LOADING";
			url?: string;
			canBack?: boolean;
			canForward?: boolean;
	  }
	| {
			type: "DID_NAVIGATE";
			url?: string;
			canBack?: boolean;
			canForward?: boolean;
	  }
	| { type: "SET_ADDRESS"; address: string }
	| { type: "NAVIGATE"; url: string }
	| { type: "TOGGLE_HISTORY" }
	| { type: "CLOSE_HISTORY" }
	| { type: "CLEAR_HISTORY" }
	| { type: "ARM_SELECTION" }
	| { type: "DISARM_SELECTION" }
	| { type: "CAPTURE_SELECTION_START" }
	| { type: "CAPTURE_SELECTION_DONE" };

export const browserPreviewMachine = setup({
	types: {
		input: {} as BrowserPreviewInput,
		context: {} as BrowserPreviewContext,
		events: {} as BrowserPreviewEvent,
	},
	actions: {
		syncNavigation: assign(({ context, event }) => {
			if (
				(event.type !== "DID_STOP_LOADING" && event.type !== "DID_NAVIGATE") ||
				event.url === undefined
			) {
				return {};
			}
			const nextHistory =
				context.history.at(-1) === event.url
					? context.history
					: [...context.history.slice(-19), event.url];
			return {
				currentUrl: event.url,
				address: event.url,
				canBack: event.canBack ?? context.canBack,
				canForward: event.canForward ?? context.canForward,
				history: nextHistory,
			};
		}),
	},
}).createMachine({
	id: "browserPreview",
	context: ({ input }) => ({
		address: input.home,
		currentUrl: input.home,
		canBack: false,
		canForward: false,
		history: [input.home],
		previewWebContentsId: null,
	}),
	type: "parallel",
	on: {
		DID_NAVIGATE: {
			actions: "syncNavigation",
		},
		SET_ADDRESS: {
			actions: assign(({ event }) => ({ address: event.address })),
		},
		NAVIGATE: {
			actions: assign(({ event }) => ({
				address: event.url,
				currentUrl: event.url,
			})),
		},
		CLEAR_HISTORY: {
			actions: assign({ history: [] }),
		},
	},
	states: {
		dom: {
			initial: "mounting",
			states: {
				mounting: {
					on: {
						DOM_READY: {
							target: "ready",
							actions: assign(({ event }) => ({
								previewWebContentsId: event.webContentsId,
							})),
						},
					},
				},
				ready: {
					on: {
						DOM_READY: {
							actions: assign(({ event }) => ({
								previewWebContentsId: event.webContentsId,
							})),
						},
					},
				},
			},
		},
		network: {
			initial: "idle",
			states: {
				idle: {
					on: {
						DID_START_LOADING: "loading",
					},
				},
				loading: {
					on: {
						DID_STOP_LOADING: {
							target: "idle",
							actions: "syncNavigation",
						},
					},
				},
			},
		},
		historyPanel: {
			initial: "closed",
			states: {
				closed: {
					on: {
						TOGGLE_HISTORY: "open",
					},
				},
				open: {
					on: {
						TOGGLE_HISTORY: "closed",
						CLOSE_HISTORY: "closed",
						NAVIGATE: "closed",
					},
				},
			},
		},
		selectionCapture: {
			initial: "idle",
			states: {
				idle: {
					on: {
						ARM_SELECTION: "armed",
					},
				},
				armed: {
					on: {
						DISARM_SELECTION: "idle",
						DID_NAVIGATE: "idle",
						CAPTURE_SELECTION_START: "capturingSelection",
					},
				},
				capturingSelection: {
					on: {
						CAPTURE_SELECTION_DONE: "idle",
					},
				},
			},
		},
	},
});
