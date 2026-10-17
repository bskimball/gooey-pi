import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import type { ExtensionBrowserBridge } from "./extension-bridge";
import { isAllowedTabUrl, type TabState } from "./service-support";

export async function routeExtensionNavigation(
	bridge: ExtensionBrowserBridge | undefined,
	tab: TabState,
	url: string,
	push: () => void,
): Promise<void> {
	if (!isAllowedTabUrl(url))
		throw new Error(
			"Only credential-free http(s) URLs can be opened in the GooeyPi browser",
		);
	if (isLocalPreviewUrl(url) && !tab.pairedByUser) {
		const chromeTabId = tab.chromeTabId;
		// onRemoved may reach the bridge before close_tab's result. Retain the registry record.
		tab.chromeTabId = undefined;
		try {
			if (chromeTabId !== undefined)
				await bridge?.call("close_tab", { chromeTabId });
		} catch (error) {
			tab.chromeTabId = chromeTabId;
			throw error;
		}
		tab.backend = "webview";
		tab.url = url;
		push();
	} else if (tab.chromeTabId === undefined) {
		const id = await bridge?.call("create_tab", { url });
		if (!Number.isSafeInteger(id)) throw new Error("Invalid Chrome tab id");
		tab.chromeTabId = id as number;
		tab.url = url;
	}
}

export const PAUSED_MESSAGE =
	"Tab is paused by the user. Ask the user to resume agent control or wait until they finish.";
export function isLocalPreviewUrl(raw: string): boolean {
	try {
		const host = new URL(raw).hostname.toLowerCase();
		return (
			host === "localhost" ||
			host.endsWith(".localhost") ||
			["127.0.0.1", "[::1]", "0.0.0.0"].includes(host)
		);
	} catch {
		return false;
	}
}

export interface ExtensionTab {
	chromeTabId?: number;
	paused?: boolean;
	url: string;
	title: string;
}

/** Adapts the existing guest action pipeline to background CDP without changing page scripts. */
export function extensionGuest(
	bridge: ExtensionBrowserBridge,
	tab: ExtensionTab,
	imageFromDataURL: (url: string) => Electron.NativeImage,
): WebContents {
	const events = new EventEmitter();
	const call = (method: string, params: Record<string, unknown> = {}) => {
		if (tab.paused) throw new Error(PAUSED_MESSAGE);
		return bridge.call(method, { ...params, chromeTabId: tab.chromeTabId });
	};
	const guest = Object.assign(events, {
		id: -(tab.chromeTabId ?? 1),
		isDestroyed: () => !bridge.isConnected(),
		getURL: () => tab.url,
		getTitle: () => tab.title,
		isLoading: () => false,
		canGoBack: () => true,
		canGoForward: () => true,
		focus: () => undefined,
		loadURL: async (url: string) => {
			await call("navigate", { url });
			tab.url = url;
		},
		goBack: () => {
			void call("navigate", { action: "back" }).catch(() => undefined);
		},
		goForward: () => {
			void call("navigate", { action: "forward" }).catch(() => undefined);
		},
		reload: () => {
			void call("navigate", { action: "reload" }).catch(() => undefined);
		},
		executeJavaScript: async (script: string) => {
			if (tab.paused) throw new Error(PAUSED_MESSAGE);
			const result = await bridge.call("evaluate", {
				chromeTabId: tab.chromeTabId,
				script,
			});
			return result;
		},
		insertText: async (text: string) => {
			await call("cdp", { method: "Input.insertText", params: { text } });
		},
		capturePage: async () => {
			const result = await bridge.call("screenshot", {
				chromeTabId: tab.chromeTabId,
			});
			if (typeof result !== "string")
				throw new Error("Invalid extension screenshot");
			return imageFromDataURL(`data:image/jpeg;base64,${result}`);
		},
		debugger: {
			isAttached: () => true,
			attach: () => undefined,
			sendCommand: (method: string, params: Record<string, unknown>) =>
				call("cdp", { method, params }),
		},
	});
	// The adapter implements only the WebContents surface consumed by AgentBrowserService.
	return guest as unknown as WebContents;
}
