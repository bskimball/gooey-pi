import { randomBytes } from "node:crypto";
import type { NativeImage, WebContents } from "electron";
import {
	extensionGuest,
	isLocalPreviewUrl,
	PAUSED_MESSAGE,
	routeExtensionNavigation,
} from "apex-core/browser/extension-tab-driver";

export { isLocalPreviewUrl } from "apex-core/browser/extension-tab-driver";

import type {
	AgentBrowserActivityEvent,
	AgentBrowserPointerEvent,
	AgentBrowserState,
	AgentBrowserTabRecord,
} from "../../../src/types/api";
import { canonicalSessionPath } from "apex-core/session-paths";
import { requireString } from "apex-core/validation";
import {
	ACTION_REVOKED_MESSAGE,
	type AgentBrowserServiceOptions as CoreBrowserServiceOptions,
	ATTACH_TIMEOUT_MS,
	CDP_BUTTON_MASKS,
	type CdpKey,
	delay,
	dispatchDrag,
	GLIDE_MAX_MS,
	GLIDE_MIN_MS,
	GLIDE_STEP_MS,
	isAllowedTabUrl,
	LOAD_TIMEOUT_MS,
	logNavigationFailure,
	MAX_EVALUATE_CHARS,
	MAX_EVALUATE_RESULT_CHARS,
	MAX_READ_ELEMENTS,
	MAX_READ_TEXT_CHARS,
	MAX_SCREENSHOT_BYTES,
	MAX_TABS_PER_SESSION,
	MAX_TABS_TOTAL,
	MAX_TYPE_CHARS,
	type PageInfo,
	PRESS_KEYS,
	PRESS_MODIFIER_BITS,
	parseScriptJson,
	SCREENSHOT_JPEG_QUALITY,
	SETTLE_MS,
	type TabActionSerial,
	type TabState,
} from "apex-core/browser/service-support";

export type { PageInfo } from "apex-core/browser/service-support";

export interface AgentBrowserServiceOptions extends Omit<CoreBrowserServiceOptions, "getGuest" | "imageFromDataURL"> {
	getGuest(webContentsId: number): WebContents | undefined;
	imageFromDataURL?: (url: string) => NativeImage;
}

import {
	ACTION_TIMEOUT_MS,
	guardGuestCall,
	QUEUE_RELEASE_GRACE_MS,
	releaseQueueEventually,
} from "apex-core/browser/guest-call-guard";

/** The user's own Preview webview, adoptable by the active thread's agent. */
export const PREVIEW_TAB_ID = "preview";

import {
	cursorMarkerScript,
	elementAtPointScript,
	evaluateScript,
	pageInfoScript,
	readPageScript,
	refPointScript,
	removeCursorMarkerScript,
	scrollByScript,
} from "apex-core/browser/page-scripts";

/**
 * Owns the agent-controlled browser tabs. The registry (which tabs exist, per
 * session) lives here in the main process; the renderer only hosts the
 * webview guests and mirrors this state. Every guest handed to an action has
 * already passed the will-attach-webview hardening gate and the approval set
 * maintained via approveGuest().
 */
export class AgentBrowserService {
	private readonly tabs = new Map<string, TabState>();
	private readonly activeBySession = new Map<string, string>();
	private previewTab: TabState | null = null;
	private readonly previewSerial: TabActionSerial = { tail: Promise.resolve() };
	private nextGeneration = 1;
	private readonly approvedGuests = new Set<number>();
	private readonly changeListeners = new Set<
		(state: AgentBrowserState) => void
	>();
	private readonly pointerListeners = new Set<
		(event: AgentBrowserPointerEvent) => void
	>();
	private readonly activityListeners = new Set<
		(event: AgentBrowserActivityEvent) => void
	>();
	private readonly attachTimeoutMs: number;
	private readonly loadTimeoutMs: number;
	private readonly actionTimeoutMs: number;
	private closed = false;

	constructor(private readonly options: AgentBrowserServiceOptions) {
		this.attachTimeoutMs = options.attachTimeoutMs ?? ATTACH_TIMEOUT_MS;
		this.loadTimeoutMs = options.loadTimeoutMs ?? LOAD_TIMEOUT_MS;
		this.actionTimeoutMs = options.actionTimeoutMs ?? ACTION_TIMEOUT_MS;
		options.extensionBridge?.setContext(() => ({
			activeSessionKey: this.activeSessionKey,
			tabs: this.state().tabs.filter((tab) => tab.backend === "extension"),
		}));
		options.extensionBridge?.onEvent((event) => this.extensionEvent(event));
	}

	private activeSessionKey: string | null = null;
	getExtensionStatus() {
		return {
			connected: this.options.extensionBridge?.isConnected() ?? false,
			extensionPath: this.options.extensionPath ?? "",
			bridgePort: this.options.extensionBridge?.port ?? null,
			activeSessionKey: this.activeSessionKey,
			pairedTabCount: [...this.tabs.values()].filter(
				(tab) => tab.chromeTabId !== undefined,
			).length,
		};
	}
	onExtensionStatusChanged(
		listener: (
			status: ReturnType<AgentBrowserService["getExtensionStatus"]>,
		) => void,
	): () => void {
		const notify = () => listener(this.getExtensionStatus());
		const off = this.options.extensionBridge?.onChanged(notify);
		const offTabs = this.onDidChange(notify);
		return () => {
			off?.();
			offTabs();
		};
	}
	async refreshExtensionState(): Promise<void> {
		await this.options.extensionBridge?.refreshState();
	}
	async setActiveSession(value: unknown): Promise<void> {
		this.activeSessionKey =
			value === null
				? null
				: canonicalSessionPath(
						requireString(value, "sessionKey", { min: 1, max: 4096 }),
					);
		await this.options.extensionBridge?.setActiveSession(this.activeSessionKey);
		if (this.options.extensionBridge?.isConnected())
			await this.options.extensionBridge.call("sync_tab_state", {
				activeSessionKey: this.activeSessionKey,
				tabs: this.state().tabs,
			});
		this.push();
	}
	async setTabPaused(
		session: string,
		id: string,
		paused: unknown,
	): Promise<AgentBrowserTabRecord | null> {
		if (typeof paused !== "boolean")
			throw new TypeError("paused must be a boolean");
		const tab = this.requireSessionTab(canonicalSessionPath(session), id);
		if (tab.backend !== "extension") return null;
		tab.paused = paused;
		tab.generation = this.nextGeneration++;
		this.push();
		await this.options.extensionBridge?.call("sync_tab_state", {
			chromeTabId: tab.chromeTabId,
			paused,
		});
		return this.state().tabs.find((item) => item.tabId === id) ?? null;
	}
	async focusExtensionTab(session: string, id: string): Promise<boolean> {
		const tab = this.requireSessionTab(canonicalSessionPath(session), id);
		if (tab.chromeTabId === undefined) return false;
		await this.options.extensionBridge?.call("focus_tab", {
			chromeTabId: tab.chromeTabId,
		});
		return true;
	}
	async popOutTab(
		session: string,
		id: string,
	): Promise<AgentBrowserTabRecord | null> {
		const tab = this.requireSessionTab(canonicalSessionPath(session), id);
		if (!this.options.extensionBridge?.isConnected())
			throw new Error("Browser extension is not connected");
		if (tab.backend !== "extension") {
			const chromeTabId = await this.options.extensionBridge.call(
				"create_tab",
				{ url: tab.url },
				tab.sessionKey,
			);
			if (!Number.isSafeInteger(chromeTabId))
				throw new Error("Invalid Chrome tab id");
			this.detachTab(tab, false);
			tab.backend = "extension";
			tab.chromeTabId = chromeTabId as number;
			this.push();
		}
		return this.state().tabs.find((item) => item.tabId === id) ?? null;
	}
	private extensionEvent(event: Record<string, unknown>): void {
		this.requireOpen();
		if (!Number.isSafeInteger(event.chromeTabId))
			throw new TypeError("chromeTabId must be an integer");
		let tab = [...this.tabs.values()].find(
			(item) => item.chromeTabId === event.chromeTabId,
		);
		if (event.type === "tab_paired") {
			const session = event.sessionKey ?? this.activeSessionKey;
			if (typeof session !== "string")
				throw new Error("Select a thread in Apex before sharing this tab");
			const serial = tab?.serial;
			if (tab) {
				tab.pairedByUser = true;
				this.removeTab(tab);
			}
			tab = this.newTab(
				canonicalSessionPath(session),
				typeof event.url === "string" ? event.url : "",
				"extension",
			);
			tab.chromeTabId = event.chromeTabId as number;
			if (serial) tab.serial = serial;
			tab.pairedByUser = true;
		}
		if (!tab) return;
		if (event.type === "tab_closed" || event.type === "tab_unpaired") {
			tab.pairedByUser = true;
			this.removeTab(tab);
			return;
		}
		if (typeof event.url === "string") tab.url = event.url;
		if (typeof event.title === "string") tab.title = event.title;
		if (event.type === "tab_pause_changed") {
			if (typeof event.paused !== "boolean")
				throw new TypeError("paused must be a boolean");
			tab.paused = event.paused;
			tab.generation = this.nextGeneration++;
		}
		this.push();
	}
	private newTab(
		sessionKey: string,
		url: string,
		backend: "webview" | "extension",
	): TabState {
		const tab: TabState = {
			tabId: `bt-${randomBytes(6).toString("hex")}`,
			sessionKey,
			url,
			backend,
			webContentsId: null,
			title: "",
			pointer: null,
			generation: this.nextGeneration++,
			revoked: false,
			serial: { tail: Promise.resolve() },
			attachWaiters: [],
			unbindGuest: null,
		};
		this.tabs.set(tab.tabId, tab);
		this.activeBySession.set(sessionKey, tab.tabId);
		return tab;
	}
	// ---- lifecycle -----------------------------------------------------------

	beginShutdown(): void {
		this.closed = true;
		for (const tab of this.tabs.values()) this.releaseTab(tab);
		if (this.previewTab) this.revokeTab(this.previewTab);
		this.tabs.clear();
		this.activeBySession.clear();
		this.changeListeners.clear();
		this.pointerListeners.clear();
		this.activityListeners.clear();
		this.previewTab = null;
	}

	/** Called from the will/did-attach-webview hardening path for every guest of the trusted partition. */
	approveGuest(contents: WebContents): void {
		if (this.closed) return;
		this.approvedGuests.add(contents.id);
		contents.once("destroyed", () => {
			this.approvedGuests.delete(contents.id);
			if (this.previewTab?.webContentsId === contents.id) {
				this.revokeTab(this.previewTab);
				this.previewTab = null;
			}
			for (const tab of this.tabs.values()) {
				if (tab.webContentsId === contents.id) this.detachTab(tab);
			}
		});
	}

	onDidChange(listener: (state: AgentBrowserState) => void): () => void {
		this.changeListeners.add(listener);
		return () => {
			this.changeListeners.delete(listener);
		};
	}

	onPointer(listener: (event: AgentBrowserPointerEvent) => void): () => void {
		this.pointerListeners.add(listener);
		return () => {
			this.pointerListeners.delete(listener);
		};
	}

	onActivity(listener: (event: AgentBrowserActivityEvent) => void): () => void {
		this.activityListeners.add(listener);
		return () => {
			this.activityListeners.delete(listener);
		};
	}

	// ---- renderer-facing API -------------------------------------------------

	state(): AgentBrowserState {
		const tabs: AgentBrowserTabRecord[] = [...this.tabs.values()].map((tab) => {
			const guest =
				tab.webContentsId === null
					? undefined
					: this.options.getGuest(tab.webContentsId);
			const alive = guest !== undefined && !guest.isDestroyed();
			return {
				backend: tab.backend ?? "webview",
				pairedByUser: tab.pairedByUser,
				paused: tab.paused,
				chromeTabId: tab.chromeTabId,
				tabId: tab.tabId,
				sessionFile: tab.sessionKey,
				url: tab.url,
				title: tab.title,
				attached:
					tab.backend === "extension"
						? tab.chromeTabId !== undefined &&
							!!this.options.extensionBridge?.isConnected()
						: tab.webContentsId !== null,
				active: this.activeBySession.get(tab.sessionKey) === tab.tabId,
				canGoBack: alive && guest.canGoBack(),
				canGoForward: alive && guest.canGoForward(),
			};
		});
		return { tabs };
	}

	/** User-initiated navigation from the tab strip toolbar and address bar. */
	navigateTab(
		tabIdValue: unknown,
		actionValue: unknown,
		urlValue?: unknown,
	): boolean {
		const tab = this.requireTab(tabIdValue);
		const action = requireString(actionValue, "action", {
			min: 1,
			max: 16,
			trim: true,
		});
		const guest =
			tab.webContentsId === null
				? undefined
				: this.options.getGuest(tab.webContentsId);
		if (!guest || guest.isDestroyed()) return false;
		if (action === "back") {
			if (guest.canGoBack()) guest.goBack();
		} else if (action === "forward") {
			if (guest.canGoForward()) guest.goForward();
		} else if (action === "reload") guest.reload();
		else if (action === "url") {
			const url = requireString(urlValue, "url", {
				min: 1,
				max: 2048,
				trim: true,
			});
			if (!isAllowedTabUrl(url))
				throw new Error(
					"Only credential-free http(s) URLs can be opened in the Apex browser",
				);
			guest
				.loadURL(url)
				.catch((error: unknown) => logNavigationFailure(url, error));
		} else throw new TypeError("action must be back, forward, reload, or url");
		return true;
	}

	attachTab(tabIdValue: unknown, webContentsIdValue: unknown): boolean {
		const tab = this.requireTab(tabIdValue);
		if (tab.backend === "extension")
			throw new Error("Extension tabs cannot attach a webview guest");
		if (!Number.isSafeInteger(webContentsIdValue))
			throw new TypeError("webContentsId must be an integer");
		const webContentsId = webContentsIdValue as number;
		if (!this.approvedGuests.has(webContentsId))
			throw new Error("The web contents is not an approved browser guest");
		const guest = this.options.getGuest(webContentsId);
		if (!guest || guest.isDestroyed())
			throw new Error("The browser guest is no longer alive");
		for (const other of this.tabs.values()) {
			if (other !== tab && other.webContentsId === webContentsId)
				throw new Error("The browser guest is already bound to another tab");
		}
		if (tab.webContentsId === webContentsId) return true;
		if (tab.unbindGuest) this.detachTab(tab, false);
		tab.webContentsId = webContentsId;
		this.bindGuestEvents(tab, guest);
		guest.setBackgroundThrottling(false);
		// A recreated webview (renderer reload) starts at about:blank; restore the
		// tab's last known location so the registry stays authoritative.
		if (tab.url && tab.url !== "about:blank" && guest.getURL() !== tab.url) {
			guest
				.loadURL(tab.url)
				.catch((error: unknown) => logNavigationFailure(tab.url, error));
		}
		for (const waiter of tab.attachWaiters.splice(0)) {
			clearTimeout(waiter.timer);
			waiter.resolve();
		}
		this.push();
		return true;
	}

	selectTab(tabIdValue: unknown): boolean {
		const tab = this.requireTab(tabIdValue);
		this.activeBySession.set(tab.sessionKey, tab.tabId);
		this.push();
		return true;
	}

	/**
	 * The renderer reports which session's workspace currently owns the user's
	 * Preview webview (and which guest it is). Null clears the binding. Agent
	 * calls resolve the binding at call time, so a session switch immediately
	 * moves control.
	 */
	setPreviewContext(
		webContentsIdValue: unknown,
		sessionFileValue: unknown,
	): boolean {
		if (this.closed) return false;
		if (
			webContentsIdValue === null ||
			sessionFileValue === null ||
			sessionFileValue === undefined
		) {
			if (this.previewTab) this.revokeTab(this.previewTab);
			this.previewTab = null;
			return true;
		}
		if (!Number.isSafeInteger(webContentsIdValue))
			throw new TypeError("webContentsId must be an integer");
		const webContentsId = webContentsIdValue as number;
		if (!this.approvedGuests.has(webContentsId))
			throw new Error("The web contents is not an approved browser guest");
		const sessionKey = canonicalSessionPath(
			requireString(sessionFileValue, "sessionFile", { min: 1, max: 4096 }),
		);
		const previous = this.previewTab;
		if (
			previous &&
			previous.webContentsId === webContentsId &&
			previous.sessionKey === sessionKey
		)
			return true;
		if (previous) this.revokeTab(previous);
		this.previewTab = {
			tabId: PREVIEW_TAB_ID,
			sessionKey,
			webContentsId,
			url: "",
			title: "",
			pointer:
				previous?.webContentsId === webContentsId ? previous.pointer : null,
			generation: this.nextGeneration++,
			revoked: false,
			// Keep only the sequencing barrier across owners. The binding generation,
			// not this shared tail, is the authority to access the Preview guest.
			serial: this.previewSerial,
			attachWaiters: [],
			unbindGuest: null,
		};
		return true;
	}

	closeTab(tabIdValue: unknown): boolean {
		const tab = this.requireTab(tabIdValue);
		this.removeTab(tab);
		return true;
	}

	/**
	 * Permanently releases every browser guest owned by a session. Archiving is
	 * a lifecycle boundary, so merely dropping the tab records is insufficient:
	 * hidden webview guests can keep media, timers, workers, and renderer
	 * processes alive after their thread disappears from the UI.
	 */
	closeForSession(sessionKeyValue: unknown): boolean {
		if (this.closed) return false;
		const sessionKey = canonicalSessionPath(
			requireString(sessionKeyValue, "sessionFile", { min: 1, max: 4096 }),
		);
		const guests = new Map<number, WebContents>();
		const ownedTabs = [...this.tabs.values()].filter(
			(tab) => tab.sessionKey === sessionKey,
		);
		for (const tab of ownedTabs) {
			if (tab.chromeTabId !== undefined && !tab.pairedByUser)
				void this.options.extensionBridge
					?.call("close_tab", { chromeTabId: tab.chromeTabId })
					.catch(() => undefined);
			const guest =
				tab.webContentsId === null
					? undefined
					: this.options.getGuest(tab.webContentsId);
			if (guest && !guest.isDestroyed()) guests.set(guest.id, guest);
			this.releaseTab(tab);
			this.tabs.delete(tab.tabId);
		}
		const preview =
			this.previewTab?.sessionKey === sessionKey ? this.previewTab : null;
		if (preview) {
			const guest =
				preview.webContentsId === null
					? undefined
					: this.options.getGuest(preview.webContentsId);
			if (guest && !guest.isDestroyed()) guests.set(guest.id, guest);
			this.revokeTab(preview);
			this.previewTab = null;
		}
		if (!ownedTabs.length && !preview) return false;
		this.activeBySession.delete(sessionKey);
		for (const guest of guests.values()) {
			// Mute first so cleanup is immediately observable even if Chromium
			// takes a moment to finish tearing down the page and its subprocesses.
			try {
				guest.setAudioMuted(true);
			} catch {
				/* guest raced with teardown */
			}
			try {
				guest.close({ waitForBeforeUnload: false });
			} catch {
				/* guest raced with teardown */
			}
		}
		this.push();
		return true;
	}

	// ---- agent-facing API (always scoped to a session key) -------------------

	async openTab(
		sessionKey: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		this.requireOpen();
		const url =
			params.url === undefined
				? "about:blank"
				: requireString(params.url, "url", { min: 1, max: 2048, trim: true });
		if (!isAllowedTabUrl(url))
			throw new Error(
				"Only credential-free http(s) URLs can be opened in the Apex browser",
			);
		const sessionTabs = [...this.tabs.values()].filter(
			(tab) => tab.sessionKey === sessionKey,
		);
		if (this.options.extensionBridge?.isConnected()) {
			const paired =
				params.url === undefined && sessionTabs.find((tab) => tab.pairedByUser);
			if (paired) {
				this.selectTab(paired.tabId);
				return {
					...this.state().tabs.find((tab) => tab.tabId === paired.tabId),
				};
			}
			if (params.url === undefined || !isLocalPreviewUrl(url)) {
				if (
					sessionTabs.length >= MAX_TABS_PER_SESSION ||
					this.tabs.size >= MAX_TABS_TOTAL
				)
					throw new Error("Close unused browser tabs before opening another");
				const tab = this.newTab(
					sessionKey,
					params.url === undefined ? "" : url,
					"extension",
				);
				try {
					if (params.url !== undefined) {
						const id = await this.options.extensionBridge.call("create_tab", { url }, sessionKey);
						if (!Number.isSafeInteger(id))
							throw new Error("Invalid Chrome tab id");
						tab.chromeTabId = id as number;
					}
					this.push();
					return {
						...this.state().tabs.find((item) => item.tabId === tab.tabId),
					};
				} catch (error) {
					this.removeTab(tab);
					throw error;
				}
			}
		}
		if (sessionTabs.length >= MAX_TABS_PER_SESSION)
			throw new Error(
				`This thread already has ${MAX_TABS_PER_SESSION} browser tabs. Close one with browser_tabs before opening another.`,
			);
		if (this.tabs.size >= MAX_TABS_TOTAL)
			throw new Error(
				"Apex has too many open agent browser tabs. Close unused tabs first.",
			);
		const tab = this.newTab(sessionKey, url, "webview");
		this.emitActivity(tab);
		this.push();
		try {
			const guest = await this.waitForGuest(tab);
			if (url !== "about:blank") await this.loadAndSettle(guest, url);
			return { tabId: tab.tabId, ...(await this.describe(tab, guest)) };
		} catch (error) {
			this.removeTab(tab);
			throw error;
		}
	}

	async listTabs(sessionKey: string): Promise<Record<string, unknown>> {
		const active = this.activeBySession.get(sessionKey);
		const tabs: Array<Record<string, unknown>> = [...this.tabs.values()]
			.filter((tab) => tab.sessionKey === sessionKey)
			.map((tab) => ({
				backend: tab.backend ?? "webview",
				pairedByUser: tab.pairedByUser,
				paused: tab.paused,
				chromeTabId: tab.chromeTabId,
				tabId: tab.tabId,
				url: tab.url,
				title: tab.title,
				attached: tab.webContentsId !== null,
				active: active === tab.tabId,
			}));
		const preview = this.previewFor(sessionKey);
		if (preview) {
			tabs.unshift({
				tabId: PREVIEW_TAB_ID,
				url: preview.guest.getURL(),
				title: preview.guest.getTitle(),
				attached: true,
				active: active === PREVIEW_TAB_ID || active === undefined,
				note: "The user's own Preview tab; prefer it when the page you need is already open here.",
			});
		}
		return { tabs };
	}

	async closeTabScoped(
		sessionKey: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const tabId = requireString(params.tabId, "tabId", { min: 1, max: 64 });
		if (tabId === PREVIEW_TAB_ID)
			throw new Error(
				"The Preview tab belongs to the user and cannot be closed by the agent",
			);
		const tab = this.requireSessionTab(sessionKey, tabId);
		this.removeTab(tab);
		return this.listTabs(sessionKey);
	}

	async selectTabScoped(
		sessionKey: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const tabId = requireString(params.tabId, "tabId", { min: 1, max: 64 });
		if (tabId === PREVIEW_TAB_ID) {
			if (!this.previewFor(sessionKey))
				throw new Error(
					"The user's Preview tab is not open for this thread right now",
				);
			this.activeBySession.set(sessionKey, PREVIEW_TAB_ID);
		} else {
			const tab = this.requireSessionTab(sessionKey, tabId);
			this.activeBySession.set(sessionKey, tab.tabId);
		}
		this.push();
		return this.listTabs(sessionKey);
	}

	async navigate(
		sessionKey: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		return this.withTab(sessionKey, params, async (tab, guest) => {
			if (tab.backend === "extension") {
				const url =
					params.url === undefined
						? undefined
						: requireString(params.url, "url", {
								min: 1,
								max: 2048,
								trim: true,
							});
				if (url !== undefined && !isAllowedTabUrl(url))
					throw new Error(
						"Only credential-free http(s) URLs can be opened in the Apex browser",
					);
				const action =
					url === undefined
						? requireString(params.action, "action", { min: 1, max: 16 })
						: undefined;
				if (
					action !== undefined &&
					!["back", "forward", "reload"].includes(action)
				)
					throw new TypeError("action must be back, forward, or reload");
				await this.options.extensionBridge?.call("navigate", {
					chromeTabId: tab.chromeTabId,
					url,
					action,
				});
				return this.describe(tab, guest);
			}
			if (params.url !== undefined) {
				const url = requireString(params.url, "url", {
					min: 1,
					max: 2048,
					trim: true,
				});
				if (!isAllowedTabUrl(url))
					throw new Error(
						"Only credential-free http(s) URLs can be opened in the Apex browser",
					);
				await this.loadAndSettle(guest, url);
			} else {
				const action = requireString(params.action, "action", {
					min: 1,
					max: 16,
					trim: true,
				});
				if (action === "back") {
					if (!guest.canGoBack())
						throw new Error("There is no page to go back to");
					guest.goBack();
				} else if (action === "forward") {
					if (!guest.canGoForward())
						throw new Error("There is no page to go forward to");
					guest.goForward();
				} else if (action === "reload") guest.reload();
				else throw new TypeError("action must be back, forward, or reload");
				await this.waitForLoad(guest);
			}
			return this.describe(tab, guest);
		});
	}

	async screenshot(
		sessionKey: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		return this.withTab(sessionKey, params, async (tab, guest) => {
			const info = await this.pageInfo(guest);
			// Show the agent its own pointer in the capture so it can calibrate.
			if (tab.pointer)
				await guardGuestCall(
					guest,
					guest.executeJavaScript(
						cursorMarkerScript(tab.pointer.x, tab.pointer.y),
					),
					this.actionTimeoutMs,
				).catch(() => undefined);
			let image: Electron.NativeImage;
			try {
				image = await guardGuestCall(
					guest,
					guest.capturePage(undefined, { stayHidden: true, stayAwake: true }),
					this.actionTimeoutMs,
				);
			} finally {
				if (tab.pointer)
					void guardGuestCall(
						guest,
						guest.executeJavaScript(removeCursorMarkerScript()),
						this.actionTimeoutMs,
					).catch(() => undefined);
			}
			const size = image.getSize();
			if (!size.width || !size.height)
				throw new Error(
					"The browser tab has no visible content to capture yet",
				);
			// capturePage reports DIP dimensions but encodes at device pixels
			// (2x on Retina); always resize to the CSS viewport so screenshot
			// pixels map 1:1 onto click coordinates regardless of display scale.
			const targetWidth =
				info.innerWidth > 0
					? Math.min(info.innerWidth, size.width)
					: size.width;
			const targetHeight =
				info.innerHeight > 0
					? Math.min(info.innerHeight, size.height)
					: size.height;
			image = image.resize({ width: targetWidth, height: targetHeight });
			let quality = SCREENSHOT_JPEG_QUALITY;
			let buffer = image.toJPEG(quality);
			while (buffer.byteLength > MAX_SCREENSHOT_BYTES && quality > 30) {
				quality -= 20;
				buffer = image.toJPEG(quality);
			}
			return {
				...(await this.describe(tab, guest)),
				mimeType: "image/jpeg",
				data: buffer.toString("base64"),
				width: targetWidth,
				height: targetHeight,
			};
		});
	}

	async click(
		sessionKey: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		return this.withTab(sessionKey, params, async (tab, guest) => {
			if (params.glide !== undefined && typeof params.glide !== "boolean")
				throw new TypeError("glide must be a boolean");
			const point = await this.resolvePoint(guest, params, false);
			const button =
				params.button === undefined
					? "left"
					: requireString(params.button, "button", { min: 1, max: 8 });
			if (!["left", "right", "middle"].includes(button))
				throw new TypeError("button must be left, right, or middle");
			const clickCount = params.double === true ? 2 : 1;
			guest.focus();
			await this.glidePointer(tab, guest, point, "click", params.glide === false);
			// Hovering along the glide can shift layout (menus, sticky headers);
			// for ref clicks re-resolve the element position before pressing.
			let target = point;
			if (params.ref !== undefined && params.glide !== false) {
				try {
					target = await this.resolvePoint(guest, params, false);
					tab.pointer = { ...target };
				} catch {
					/* the pre-glide point remains the best estimate */
				}
			}
			const hit = await this.elementAt(guest, target);
			for (let press = 0; press < clickCount; press += 1) {
				await this.dispatchInput(guest, "Input.dispatchMouseEvent", {
					type: "mousePressed",
					x: target.x,
					y: target.y,
					button,
					buttons: CDP_BUTTON_MASKS[button],
					clickCount: press + 1,
				});
				await this.dispatchInput(guest, "Input.dispatchMouseEvent", {
					type: "mouseReleased",
					x: target.x,
					y: target.y,
					button,
					buttons: 0,
					clickCount: press + 1,
				});
			}
			// A click may start a navigation; give the page a moment before reporting.
			await delay(SETTLE_MS);
			await this.waitForLoad(guest, 2_000);
			return {
				...(await this.describe(tab, guest)),
				clicked: hit ?? undefined,
			};
		});
	}

	async drag(sessionKey: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
		return this.withTab(sessionKey, params, async (tab, guest) => {
			const from = await this.resolvePoint(guest, params, false);
			const to = await this.resolvePoint(guest, { ref: params.to_ref, x: params.to_x, y: params.to_y }, false, false);
			const steps = params.steps ?? 12;
			if (typeof steps !== "number" || !Number.isInteger(steps) || steps < 1 || steps > 50)
				throw new TypeError("steps must be an integer from 1 to 50");
			const button = params.button ?? "left";
			if (typeof button !== "string" || !["left", "right", "middle"].includes(button))
				throw new TypeError("button must be left, right, or middle");
			guest.focus();
			await dispatchDrag((event) => this.dispatchInput(guest, "Input.dispatchMouseEvent", event), from, to, steps, button);
			tab.pointer = { ...to };
			return this.describe(tab, guest);
		});
	}

	async type(
		sessionKey: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		return this.withTab(sessionKey, params, async (tab, guest) => {
			if (params.glide !== undefined && typeof params.glide !== "boolean")
				throw new TypeError("glide must be a boolean");
			const text = requireString(params.text, "text", {
				min: 0,
				max: MAX_TYPE_CHARS,
			});
			if (params.ref !== undefined) {
				const point = await this.resolvePoint(guest, params, true);
				await this.glidePointer(tab, guest, point, "move", params.glide === false);
			}
			guest.focus();
			try {
				await this.dispatchInput(guest, "Input.insertText", { text });
			} catch {
				await guest.insertText(text);
			}
			if (params.submit === true) {
				await delay(50);
				await this.sendKey(guest, PRESS_KEYS.enter, []);
				await delay(SETTLE_MS);
				await this.waitForLoad(guest, 2_000);
			}
			return this.describe(tab, guest);
		});
	}

	async pressKey(
		sessionKey: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		return this.withTab(sessionKey, params, async (tab, guest) => {
			const rawKey = requireString(params.key, "key", {
				min: 1,
				max: 24,
				trim: true,
			});
			const key =
				rawKey.length === 1
					? {
							key: rawKey,
							code: "",
							keyCode: rawKey.toUpperCase().charCodeAt(0),
							text: rawKey,
						}
					: PRESS_KEYS[rawKey.toLowerCase()];
			if (!key)
				throw new TypeError(
					`key must be a single character or one of: ${Object.keys(PRESS_KEYS).join(", ")}`,
				);
			const modifiers: string[] = [];
			if (params.modifiers !== undefined) {
				if (!Array.isArray(params.modifiers))
					throw new TypeError("modifiers must be an array");
				for (const modifier of params.modifiers.slice(0, 4)) {
					const name = requireString(modifier, "modifier", {
						min: 1,
						max: 12,
						trim: true,
					}).toLowerCase();
					if (PRESS_MODIFIER_BITS[name] === undefined)
						throw new TypeError(
							"modifiers may only include shift, control, alt, meta",
						);
					modifiers.push(name);
				}
			}
			const repeat = params.repeat ?? 1;
			if (typeof repeat !== "number" || !Number.isInteger(repeat) || repeat < 1 || repeat > 200)
				throw new TypeError("repeat must be an integer from 1 to 200");
			guest.focus();
			for (let n = 0; n < repeat; n += 1) await this.sendKey(guest, key, modifiers);
			if (key.key === "Enter" || key.key === " " || modifiers.length > 0) {
				await delay(SETTLE_MS);
				await this.waitForLoad(guest, 2_000);
			}
			return this.describe(tab, guest);
		});
	}

	async scroll(
		sessionKey: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		return this.withTab(sessionKey, params, async (tab, guest) => {
			const direction = requireString(params.direction, "direction", {
				min: 1,
				max: 8,
				trim: true,
			});
			if (!["up", "down", "left", "right"].includes(direction))
				throw new TypeError("direction must be up, down, left, or right");
			let amount = 600;
			if (params.amount !== undefined) {
				if (
					!Number.isSafeInteger(params.amount) ||
					(params.amount as number) < 1 ||
					(params.amount as number) > 20_000
				)
					throw new TypeError(
						"amount must be an integer between 1 and 20000 pixels",
					);
				amount = params.amount as number;
			}
			const deltaX =
				direction === "left" ? -amount : direction === "right" ? amount : 0;
			const deltaY =
				direction === "up" ? -amount : direction === "down" ? amount : 0;
			if (Number.isSafeInteger(params.x) && Number.isSafeInteger(params.y)) {
				// A wheel event at a point reaches nested scroll containers that
				// window.scrollBy cannot; CDP wheel deltas follow DOM semantics
				// (positive scrolls down/right).
				await this.glidePointer(
					tab,
					guest,
					{ x: params.x as number, y: params.y as number },
					"scroll",
				);
				await this.dispatchInput(guest, "Input.dispatchMouseEvent", {
					type: "mouseWheel",
					x: params.x as number,
					y: params.y as number,
					deltaX,
					deltaY,
				});
				await delay(SETTLE_MS);
				return this.describe(tab, guest);
			}
			const payload = await this.runPageScript(
				guest,
				scrollByScript(deltaX, deltaY),
				"scroll",
			);
			return { ...(await this.describe(tab, guest)), ...payload };
		});
	}

	async readPage(
		sessionKey: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		return this.withTab(sessionKey, params, async (_tab, guest) => {
			const mode =
				params.mode === undefined
					? "interactive"
					: requireString(params.mode, "mode", { min: 1, max: 16, trim: true });
			if (mode !== "interactive" && mode !== "text")
				throw new TypeError("mode must be interactive or text");
			return this.runPageScript(
				guest,
				readPageScript(mode, MAX_READ_TEXT_CHARS, MAX_READ_ELEMENTS),
				"read_page",
			);
		});
	}

	async evaluate(
		sessionKey: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		return this.withTab(sessionKey, params, async (_tab, guest) => {
			const code = requireString(params.code, "code", {
				min: 1,
				max: MAX_EVALUATE_CHARS,
			});
			return this.runPageScript(
				guest,
				evaluateScript(code, MAX_EVALUATE_RESULT_CHARS),
				"evaluate",
			);
		});
	}

	// ---- internals -----------------------------------------------------------

	private requireOpen(): void {
		if (this.closed) throw new Error("Apex is shutting down");
	}

	private requireTab(tabIdValue: unknown): TabState {
		const tabId = requireString(tabIdValue, "tabId", { min: 1, max: 64 });
		const tab = this.tabs.get(tabId);
		if (!tab) throw new Error("That browser tab no longer exists");
		return tab;
	}

	private requireSessionTab(sessionKey: string, tabId: string): TabState {
		const tab = this.tabs.get(tabId);
		if (!tab || tab.sessionKey !== sessionKey)
			throw new Error("That browser tab does not belong to this thread");
		return tab;
	}

	private async withTab(
		sessionKey: string,
		params: Record<string, unknown>,
		action: (
			tab: TabState,
			guest: WebContents,
		) => Promise<Record<string, unknown>>,
	): Promise<Record<string, unknown>> {
		this.requireOpen();
		let tab: TabState;
		if (params.tabId !== undefined) {
			const tabId = requireString(params.tabId, "tabId", { min: 1, max: 64 });
			if (tabId === PREVIEW_TAB_ID) {
				const preview = this.previewFor(sessionKey);
				if (!preview)
					throw new Error(
						"The user's Preview tab is not open for this thread right now. Open a tab with browser_tabs instead.",
					);
				tab = preview.tab;
			} else tab = this.requireSessionTab(sessionKey, tabId);
		} else {
			const activeId = this.activeBySession.get(sessionKey);
			const active =
				activeId === PREVIEW_TAB_ID
					? this.previewFor(sessionKey)?.tab
					: activeId
						? this.tabs.get(activeId)
						: undefined;
			// With no agent tab selected, fall back to the user's Preview tab: when
			// the page is already on screen the agent should act on it rather than
			// opening a duplicate.
			const fallback = active ?? this.previewFor(sessionKey)?.tab;
			if (!fallback)
				throw new Error(
					'This thread has no browser tab yet. Open one with browser_tabs {"action":"open"} first.',
				);
			tab = fallback;
		}
		if (tab.backend === "extension" && tab.paused)
			throw new Error(PAUSED_MESSAGE);
		const generation = tab.generation;
		// Serialize actions per tab so concurrent tool calls cannot interleave input events.
		const run = tab.serial.tail.then(async () => {
			this.assertActionAuthority(tab, sessionKey, generation);
			if (tab.backend === "extension" && typeof params.url === "string")
				await routeExtensionNavigation(
					this.options.extensionBridge,
					tab,
					params.url,
					() => this.push(),
				);
			this.assertActionAuthority(tab, sessionKey, generation);
			// Routing may convert an extension tab to a webview. Announce its
			// actual backend before waiting for the renderer to attach it.
			this.emitActivity(tab);
			const guest = await this.waitForGuest(tab);
			this.assertActionAuthority(tab, sessionKey, generation);
			if (
				(tab.backend !== "extension" && tab.webContentsId !== guest.id) ||
				guest.isDestroyed()
			)
				throw new Error(ACTION_REVOKED_MESSAGE);
			// Revocation after this point does not attempt to cancel an operation
			// already using Electron's guest APIs; it may finish or fail naturally.
			return action(tab, guest);
		});
		tab.serial.tail = releaseQueueEventually(
			run,
			this.actionTimeoutMs + QUEUE_RELEASE_GRACE_MS,
		);
		return run;
	}
	private assertActionAuthority(
		tab: TabState,
		sessionKey: string,
		generation: number,
	): void {
		if (tab.backend === "extension" && tab.paused)
			throw new Error(PAUSED_MESSAGE);
		const current =
			tab.tabId === PREVIEW_TAB_ID ? this.previewTab : this.tabs.get(tab.tabId);
		if (
			this.closed ||
			tab.revoked ||
			tab.generation !== generation ||
			tab.sessionKey !== sessionKey ||
			current !== tab
		) {
			throw new Error(ACTION_REVOKED_MESSAGE);
		}
	}

	private async runPageScript(
		guest: WebContents,
		script: string,
		label: string,
	): Promise<Record<string, unknown>> {
		return parseScriptJson(
			await guardGuestCall(
				guest,
				guest.executeJavaScript(script),
				this.actionTimeoutMs,
			),
			label,
		);
	}
	private emitActivity(tab: TabState): void {
		const event: AgentBrowserActivityEvent = {
			sessionFile: tab.sessionKey,
			tabId: tab.tabId,
		};
		for (const listener of this.activityListeners) {
			try {
				listener(event);
			} catch {
				/* one bad listener must not break the rest */
			}
		}
	}

	private previewFor(
		sessionKey: string,
	): { tab: TabState; guest: WebContents } | null {
		const tab = this.previewTab;
		if (!tab || tab.sessionKey !== sessionKey || tab.webContentsId === null)
			return null;
		const guest = this.options.getGuest(tab.webContentsId);
		if (!guest || guest.isDestroyed()) return null;
		return { tab, guest };
	}
	private async waitForGuest(tab: TabState): Promise<WebContents> {
		if (tab.backend === "extension") {
			if (tab.chromeTabId === undefined)
				throw new Error("Navigate this pending tab to a URL first");
			const bridge = this.options.extensionBridge;
			if (!bridge?.isConnected())
				throw new Error("Browser extension is not connected");
			// The shared CDP adapter implements the guest operations used below.
			return extensionGuest(
				bridge,
				tab,
				this.options.imageFromDataURL ??
					(() => {
						throw new Error("Screenshot decoder is unavailable");
					}),
			) as unknown as WebContents;
		}
		const existing =
			tab.webContentsId === null
				? undefined
				: this.options.getGuest(tab.webContentsId);
		if (existing && !existing.isDestroyed()) return existing;
		// The Preview guest is renderer-owned and never re-attaches under the same
		// tab record; fail fast instead of waiting.
		if (tab.tabId === PREVIEW_TAB_ID)
			throw new Error(
				"The user's Preview tab closed. Open a tab with browser_tabs instead.",
			);
		await new Promise<void>((resolveAttach, reject) => {
			const waiter = {
				resolve: resolveAttach,
				reject,
				timer: setTimeout(() => {
					tab.attachWaiters = tab.attachWaiters.filter(
						(candidate) => candidate !== waiter,
					);
					reject(
						new Error(
							"The Apex browser pane did not attach this tab. Make sure the Apex window is open.",
						),
					);
				}, this.attachTimeoutMs),
			};
			waiter.timer.unref?.();
			tab.attachWaiters.push(waiter);
		});
		const guest =
			tab.webContentsId === null
				? undefined
				: this.options.getGuest(tab.webContentsId);
		if (!guest || guest.isDestroyed())
			throw new Error("The browser tab is not available");
		return guest;
	}

	private bindGuestEvents(tab: TabState, guest: WebContents): void {
		const sync = () => {
			if (guest.isDestroyed()) return;
			tab.url = guest.getURL() || tab.url;
			tab.title = guest.getTitle() || tab.title;
			this.push();
		};
		guest.on("did-navigate", sync);
		guest.on("did-navigate-in-page", sync);
		guest.on("page-title-updated", sync);
		tab.unbindGuest = () => {
			guest.removeListener("did-navigate", sync);
			guest.removeListener("did-navigate-in-page", sync);
			guest.removeListener("page-title-updated", sync);
		};
	}

	private detachTab(tab: TabState, notify = true): void {
		tab.unbindGuest?.();
		tab.unbindGuest = null;
		tab.webContentsId = null;
		// Detachment ends this guest incarnation's authority without revoking the
		// tab itself. Work queued afterward may wait for and use a replacement,
		// while work that captured the destroyed/replaced guest is rejected.
		tab.generation = this.nextGeneration++;
		if (notify) this.push();
	}

	private releaseTab(tab: TabState): void {
		this.revokeTab(tab);
		tab.unbindGuest?.();
		tab.unbindGuest = null;
	}

	private revokeTab(tab: TabState): void {
		if (tab.revoked) return;
		tab.revoked = true;
		tab.generation = this.nextGeneration++;
		for (const waiter of tab.attachWaiters.splice(0)) {
			clearTimeout(waiter.timer);
			waiter.reject(new Error(ACTION_REVOKED_MESSAGE));
		}
	}

	private removeTab(tab: TabState): void {
		if (tab.chromeTabId !== undefined && !tab.pairedByUser)
			void this.options.extensionBridge
				?.call("close_tab", { chromeTabId: tab.chromeTabId })
				.catch(() => undefined);
		this.releaseTab(tab);
		this.tabs.delete(tab.tabId);
		if (this.activeBySession.get(tab.sessionKey) === tab.tabId) {
			const fallback = [...this.tabs.values()].find(
				(candidate) => candidate.sessionKey === tab.sessionKey,
			);
			if (fallback) this.activeBySession.set(tab.sessionKey, fallback.tabId);
			else this.activeBySession.delete(tab.sessionKey);
		}
		this.push();
	}

	private async loadAndSettle(guest: WebContents, url: string): Promise<void> {
		const loading = guest.loadURL(url);
		const loaded = this.waitForLoad(guest);
		await loading.catch((error: unknown) => {
			// ERR_ABORTED covers in-flight replacement navigations; anything else is real.
			if (!String(error).includes("ERR_ABORTED"))
				throw new Error(`Navigation failed: ${String(error).slice(0, 300)}`);
		});
		await loaded;
	}

	private waitForLoad(
		guest: WebContents,
		timeoutMs = this.loadTimeoutMs,
	): Promise<void> {
		if (!guest.isLoading()) return Promise.resolve();
		return new Promise((resolveLoad) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				guest.removeListener("did-stop-loading", onStop);
				clearTimeout(timer);
				void delay(SETTLE_MS).then(resolveLoad);
			};
			const onStop = () => finish();
			const timer = setTimeout(finish, timeoutMs);
			timer.unref?.();
			guest.once("did-stop-loading", onStop);
		});
	}

	private async pageInfo(guest: WebContents): Promise<PageInfo> {
		const payload = await this.runPageScript(
			guest,
			pageInfoScript(),
			"page info",
		);
		return {
			url: typeof payload.url === "string" ? payload.url : guest.getURL(),
			title: typeof payload.title === "string" ? payload.title : "",
			innerWidth: Number.isSafeInteger(payload.innerWidth)
				? (payload.innerWidth as number)
				: 0,
			innerHeight: Number.isSafeInteger(payload.innerHeight)
				? (payload.innerHeight as number)
				: 0,
			scrollY: Number.isSafeInteger(payload.scrollY)
				? (payload.scrollY as number)
				: 0,
			scrollHeight: Number.isSafeInteger(payload.scrollHeight)
				? (payload.scrollHeight as number)
				: 0,
			readyState:
				typeof payload.readyState === "string" ? payload.readyState : "unknown",
		};
	}

	private async describe(
		tab: TabState,
		guest: WebContents,
	): Promise<Record<string, unknown>> {
		const info = guest.isDestroyed()
			? null
			: await this.pageInfo(guest).catch(() => null);
		tab.url = info?.url ?? tab.url;
		tab.title = info?.title ?? tab.title;
		this.push();
		return {
			url: tab.url,
			title: tab.title,
			viewport: info
				? { width: info.innerWidth, height: info.innerHeight }
				: undefined,
			pointer: tab.pointer ? { ...tab.pointer } : undefined,
		};
	}

	private async elementAt(
		guest: WebContents,
		point: { x: number; y: number },
	): Promise<Record<string, unknown> | null> {
		try {
			const payload = await this.runPageScript(
				guest,
				elementAtPointScript(point.x, point.y),
				"element at point",
			);
			return typeof payload.tag === "string"
				? {
						tag: payload.tag,
						name: typeof payload.name === "string" ? payload.name : "",
					}
				: null;
		} catch {
			return null;
		}
	}

	private async resolvePoint(
		guest: WebContents,
		params: Record<string, unknown>,
		focus: boolean,
		scroll = true,
	): Promise<{ x: number; y: number }> {
		if (params.ref !== undefined) {
			if (
				!Number.isSafeInteger(params.ref) ||
				(params.ref as number) < 0 ||
				(params.ref as number) > 999
			)
				throw new TypeError(
					"ref must be an element number from browser_read_page",
				);
			const payload = await this.runPageScript(
				guest,
				refPointScript(params.ref as number, focus, scroll),
				"element ref",
			);
			if (typeof payload.error === "string")
				throw new Error(payload.error.slice(0, 300));
			if (!Number.isSafeInteger(payload.x) || !Number.isSafeInteger(payload.y))
				throw new Error("The element position could not be determined");
			return { x: payload.x as number, y: payload.y as number };
		}
		if (typeof params.x !== "number" || !Number.isFinite(params.x) || typeof params.y !== "number" || !Number.isFinite(params.y))
			throw new TypeError(
				"Provide either ref (from browser_read_page) or x and y coordinates",
			);
		const x = params.x as number;
		const y = params.y as number;
		if (x < 0 || y < 0 || x > 20_000 || y > 20_000)
			throw new TypeError("x and y must be within the page viewport");
		return { x: Math.round(x), y: Math.round(y) };
	}

	/**
	 * Moves the pointer from its last position to the target as a smooth eased
	 * glide of real mouseMove events (so pages get genuine hover states), and
	 * emits a pointer event on the same clock so the renderer's synthetic
	 * cursor can animate the identical path.
	 */
	private async glidePointer(
		tab: TabState,
		guest: WebContents,
		to: { x: number; y: number },
		action: AgentBrowserPointerEvent["action"],
		instant = false,
	): Promise<void> {
		const from = tab.pointer;
		const distance = from ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
		const durationMs =
			!instant && from && distance > 2
				? Math.min(
						GLIDE_MAX_MS,
						Math.max(GLIDE_MIN_MS, Math.round(distance * 0.9)),
					)
				: 0;
		const event: AgentBrowserPointerEvent = {
			tabId: tab.tabId,
			sessionFile: tab.sessionKey,
			from,
			to: { ...to },
			action,
			durationMs,
		};
		for (const listener of this.pointerListeners) {
			try {
				listener(event);
			} catch {
				/* one bad listener must not break the rest */
			}
		}
		if (from && durationMs > 0) {
			const steps = Math.min(
				18,
				Math.max(5, Math.round(durationMs / GLIDE_STEP_MS)),
			);
			for (let step = 1; step <= steps; step += 1) {
				const progress = step / steps;
				const eased = progress * progress * (3 - 2 * progress);
				await this.dispatchInput(guest, "Input.dispatchMouseEvent", {
					type: "mouseMoved",
					x: Math.round(from.x + (to.x - from.x) * eased),
					y: Math.round(from.y + (to.y - from.y) * eased),
				});
				await delay(durationMs / steps);
			}
		} else {
			await this.dispatchInput(guest, "Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: to.x,
				y: to.y,
			});
		}
		tab.pointer = { x: to.x, y: to.y };
	}

	/**
	 * webContents.sendInputEvent does not reach OOPIF-based webview guests
	 * (input routing happens in the embedder); the DevTools protocol Input
	 * domain dispatches with real hit-testing, so all synthetic input goes
	 * through the debugger instead.
	 */
	private async dispatchInput(
		guest: WebContents,
		method: string,
		params: Record<string, unknown>,
	): Promise<void> {
		if (!guest.debugger.isAttached()) guest.debugger.attach("1.3");
		await guest.debugger.sendCommand(method, params);
	}

	private async sendKey(
		guest: WebContents,
		key: CdpKey,
		modifiers: string[],
	): Promise<void> {
		const bits = modifiers.reduce(
			(mask, name) => mask | (PRESS_MODIFIER_BITS[name] ?? 0),
			0,
		);
		const base = {
			modifiers: bits,
			key: key.key,
			code: key.code,
			windowsVirtualKeyCode: key.keyCode,
			nativeVirtualKeyCode: key.keyCode,
		};
		// A key with text uses keyDown so the page also receives the character;
		// keys without text (arrows, tab) and chorded shortcuts (ctrl/alt/meta
		// held) use rawKeyDown.
		const chorded =
			(bits &
				(PRESS_MODIFIER_BITS.alt |
					PRESS_MODIFIER_BITS.control |
					PRESS_MODIFIER_BITS.meta)) !==
			0;
		if (key.text && !chorded)
			await this.dispatchInput(guest, "Input.dispatchKeyEvent", {
				...base,
				type: "keyDown",
				text: key.text,
			});
		else
			await this.dispatchInput(guest, "Input.dispatchKeyEvent", {
				...base,
				type: "rawKeyDown",
			});
		await this.dispatchInput(guest, "Input.dispatchKeyEvent", {
			...base,
			type: "keyUp",
		});
	}

	private push(): void {
		if (this.closed) return;
		const snapshot = this.state();
		for (const listener of this.changeListeners) {
			try {
				listener(snapshot);
			} catch {
				/* one bad listener must not break the rest */
			}
		}
	}
}
