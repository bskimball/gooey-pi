import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import {
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
	win32 as win32Path,
} from "node:path";
import { pathToFileURL } from "node:url";
import type {
	BrowserWindowConstructorOptions,
	Input,
	WebContents,
} from "electron";
import {
	app,
	BrowserWindow,
	dialog,
	Menu,
	nativeImage,
	nativeTheme,
	protocol,
	safeStorage,
	session,
	webContents,
} from "electron";
import { assertNoMcpAuthenticationCommand } from "../../src/lib/mcp-policy";
import {
	type ApplicationMenuName,
	type AppMeta,
	type AppUpdateState,
	BROWSER_PARTITION,
	type HarnessId,
	type PrimeEventEnvelope,
	type RuntimeInfo,
	type ThemeMode,
} from "../../src/types/api";
import { AgentRpcManager, PI_RPC_ADAPTER } from "./agent-rpc";
import { installApplicationMenu } from "./application-menu";
import { MacBackgroundController, shouldStartInBackground } from "./background";
import { AgentBrowserBridge } from "./browser/agent-bridge";
import { AgentBrowserService } from "./browser/agent-service";
import { ExtensionBrowserBridge } from "./browser/extension-bridge";
import { BrowserDownloadGuard } from "./browser-downloads";
import { CheckoutService } from "./checkouts";
import { AgentCollaborationBridge } from "./collaboration/agent-bridge";
import {
	configureGooeyPiAgentMessageSigning,
	loadOrCreateGooeyPiAgentMessageKey,
} from "./collaboration/message-envelope";
import { installCrashGuards } from "./crash-guard";
import { CuaDriverService } from "./cua-driver";
import {
	type ExtensionCapability,
	extensionInjection,
	resolveDesktopAppRoot,
	resolveExtensionPath,
} from "./extension-manifest";
import { GitService } from "./git";
import {
	HarnessDiscoveryService,
	reconcileActiveHarness,
} from "./harness-discovery";
import { type IpcRegistration, isTrustedRendererUrl, registerIpc } from "./ipc";
import {
	PACKAGED_RENDERER_URL,
	PACKAGED_SMOKE_READY_EVENT,
	packagedSmokeMarker,
	packagedSmokeMarkerPath,
	serializePackagedSmokeMarker,
} from "./packaged-smoke";
import { PetService } from "./pets";
import { beginPluginDiscoveryShutdown, PluginService } from "./plugins";
import {
	beginProcessShutdown,
	runProcess,
	stopChildProcesses,
} from "./process-utils";
import { ProjectService } from "./projects";
import { PiModelCatalogService } from "./providers-pi";
import { RepositoryUseGate } from "./repository-use-gate";
import { AgentScheduleBridge } from "./schedules/agent-bridge";
import { ScheduledRunExecutor } from "./schedules/executor";
import { AutomationService } from "./schedules/service";
import { SessionService } from "./sessions";
import { piSessionServiceOptions } from "./sessions/pi";
import { SettingsService } from "./settings-schedules";
import {
	type JsonStateStore,
	openDesktopStateStore,
	StateCompatibilityError,
	StateMigrationError,
} from "./store";
import { TerminalService } from "./terminal";
import {
	createManualUpdateCheck,
	getAutoUpdater,
	UpdateService,
} from "./updates";
import { VoiceService, voiceSecretStorageStatus } from "./voice";
import { isAllowedRendererAudioPermission } from "./voice-permissions";

protocol.registerSchemesAsPrivileged([
	{
		scheme: "prime-work",
		privileges: { standard: true, secure: true, supportFetchAPI: true },
	},
]);

let mainWindow: BrowserWindow | null = null;
let ipc: IpcRegistration | null = null;
let piAgents: AgentRpcManager | null = null;
let terminals: TerminalService | null = null;
let downloads: BrowserDownloadGuard | null = null;
let updateService: UpdateService | null = null;
let store: JsonStateStore | null = null;
let automation: AutomationService | null = null;
let agentScheduleBridges: AgentScheduleBridge[] = [];
let extensionBrowserBridge: ExtensionBrowserBridge | null = null;
let agentBrowser: AgentBrowserService | null = null;
let agentBrowserBridge: AgentBrowserBridge | null = null;
let agentCollaborationBridge: AgentCollaborationBridge | null = null;
let backgroundMode: MacBackgroundController | null = null;
let shutdownStarted = false;
let shutdownApproved = false;
let confirmingShutdown = false;
let trustedRendererUrl = "";
let packagedSmokeMarkerFile: string | null = null;
let windowCreation: Promise<BrowserWindow | null> | null = null;
let startInBackground = false;
const keepTestWindowsHidden = process.env.PRIME_WORK_E2E_HIDE_WINDOWS === "1";

installCrashGuards({
	logPath: () => {
		try {
			return join(app.getPath("userData"), "crash.log");
		} catch {
			return null;
		}
	},
	cleanup: async () => {
		piAgents?.beginShutdown();
		beginProcessShutdown();
		await Promise.allSettled([
			piAgents?.stopAll() ?? Promise.resolve(),
			stopChildProcesses(),
		]);
	},
});

function appIconPath(): string {
	return app.isPackaged
		? join(process.resourcesPath, "icon.png")
		: join(resolveDesktopAppRoot(app.getAppPath()), "assets", "icon.png");
}

// One policy for every surface that serves renderer content: the app protocol
// response headers and the packaged browser-session header rewrite.
const RENDERER_CONTENT_SECURITY_POLICY =
	"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

const rendererContentTypes: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".map": "application/json; charset=utf-8",
};

function registerRendererProtocol(): void {
	if (!app.isPackaged) return;
	const rendererRoot = resolve(__dirname, "../renderer");
	protocol.handle("prime-work", async (request) => {
		try {
			const url = new URL(request.url);
			if (
				url.hostname !== "app" ||
				url.username ||
				url.password ||
				url.search ||
				url.hash
			)
				return new Response("Not found", { status: 404 });
			const decoded = decodeURIComponent(url.pathname);
			const candidate = resolveRendererAssetPath(rendererRoot, decoded);
			if (!candidate) return new Response("Not found", { status: 404 });
			const body = await readFile(candidate);
			return new Response(body, {
				headers: {
					"Content-Type":
						rendererContentTypes[extname(candidate).toLowerCase()] ??
						"application/octet-stream",
					"Content-Security-Policy": RENDERER_CONTENT_SECURITY_POLICY,
					"X-Content-Type-Options": "nosniff",
				},
			});
		} catch {
			return new Response("Not found", { status: 404 });
		}
	});
}

/** Resolves a renderer URL path without relying on a platform-specific separator. */
export function resolveRendererAssetPath(
	rendererRoot: string,
	decodedPath: string,
): string | null {
	if (
		!decodedPath.startsWith("/") ||
		decodedPath.includes("\0") ||
		decodedPath.includes("\\")
	)
		return null;
	const pathApi = /^[A-Za-z]:[\\/]/.test(rendererRoot)
		? win32Path
		: { resolve, relative, isAbsolute };
	const candidate = pathApi.resolve(
		rendererRoot,
		`.${decodedPath === "/" ? "/index.html" : decodedPath}`,
	);
	const relativePath = pathApi.relative(rendererRoot, candidate);
	if (
		!relativePath ||
		relativePath.startsWith("..") ||
		pathApi.isAbsolute(relativePath)
	)
		return null;
	return candidate;
}

function resolveRendererUrl(): string {
	const developmentUrl = !app.isPackaged
		? process.env.ELECTRON_RENDERER_URL
		: undefined;
	if (!developmentUrl)
		return app.isPackaged
			? PACKAGED_RENDERER_URL
			: pathToFileURL(join(__dirname, "../renderer/index.html")).href;
	const parsed = new URL(developmentUrl);
	if (
		!["http:", "https:"].includes(parsed.protocol) ||
		parsed.username ||
		parsed.password ||
		!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
	) {
		throw new Error(
			"ELECTRON_RENDERER_URL must use an uncredentialed loopback HTTP(S) origin",
		);
	}
	return parsed.href;
}

function isAllowedBrowserUrl(raw: string): boolean {
	if (raw === "about:blank") return true;
	try {
		const url = new URL(raw);
		return (
			["http:", "https:"].includes(url.protocol) &&
			!url.username &&
			!url.password
		);
	} catch {
		return false;
	}
}

export function hardenRenderer(
	window: BrowserWindow,
	trustedUrl: () => string = () => trustedRendererUrl,
): void {
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("context-menu", (_event, params) => {
		if (params.mediaType !== "image" || !params.hasImageContents) return;
		const contents = window.webContents;
		Menu.buildFromTemplate([
			{
				label: "Copy Image",
				click: () => {
					if (!window.isDestroyed() && !contents.isDestroyed())
						contents.copyImageAt(params.x, params.y);
				},
			},
		]).popup({ window });
	});
	window.webContents.on("will-attach-webview", (event, preferences, params) => {
		delete preferences.preload;
		preferences.nodeIntegration = false;
		preferences.nodeIntegrationInSubFrames = false;
		preferences.contextIsolation = true;
		preferences.sandbox = true;
		preferences.webSecurity = true;
		preferences.allowRunningInsecureContent = false;
		// A guest page must never be able to attach a nested guest of its own.
		preferences.webviewTag = false;
		const partition =
			typeof params.partition === "string" ? params.partition : "";
		if (partition !== BROWSER_PARTITION || !isAllowedBrowserUrl(params.src))
			event.preventDefault();
	});
	window.webContents.on("did-attach-webview", (_event, contents) => {
		contents.setWindowOpenHandler(() => ({ action: "deny" }));
		contents.on("will-navigate", (event, target) => {
			if (!isAllowedBrowserUrl(target)) event.preventDefault();
		});
		contents.on("will-redirect", (event) => {
			if (!isAllowedBrowserUrl(event.url)) event.preventDefault();
		});
		contents.on("will-frame-navigate", (event) => {
			if (!isAllowedBrowserUrl(event.url)) event.preventDefault();
		});
		contents.once("destroyed", () => downloads?.cancelOwner(contents.id));
		// Guests reaching this point passed the will-attach-webview partition and
		// URL gates above, which makes them eligible for agent control.
		agentBrowser?.approveGuest(contents);
	});
	window.webContents.on("will-navigate", (event, target) => {
		const current = window.webContents.getURL();
		if (target !== current) event.preventDefault();
	});
	// Server redirects and sub-frame navigations bypass will-navigate; hold them
	// to the same trusted-renderer predicate the IPC gate uses.
	window.webContents.on("will-redirect", (event) => {
		if (!isTrustedRendererUrl(event.url, trustedUrl())) event.preventDefault();
	});
	window.webContents.on("will-frame-navigate", (event) => {
		if (!isTrustedRendererUrl(event.url, trustedUrl())) event.preventDefault();
	});
}

interface InitialRendererWindow {
	loadURL(url: string): Promise<unknown>;
	isDestroyed(): boolean;
	destroy(): void;
}

export async function loadInitialRenderer(
	window: InitialRendererWindow,
	rendererUrl: string,
): Promise<void> {
	try {
		await window.loadURL(rendererUrl);
	} catch (error) {
		if (!window.isDestroyed()) window.destroy();
		throw error;
	}
}

/** Work that would be lost by quitting: in-flight agent turns and armed schedules. */
export interface ActiveShutdownWork {
	runningAgents: number;
	activeSchedules: boolean;
}

export interface ShutdownPrompt {
	message: string;
	detail: string;
}

export function activeShutdownWork(
	runtimes: readonly RuntimeInfo[],
	hasActiveSchedules: boolean,
): ActiveShutdownWork {
	const running = runtimes.filter(
		(runtime) =>
			runtime.isStreaming ||
			runtime.isCompacting === true ||
			runtime.sessionActions?.active !== undefined ||
			(runtime.sessionActions?.queuedCount ?? 0) > 0,
	);
	return { runningAgents: running.length, activeSchedules: hasActiveSchedules };
}

/** Null when nothing is active, which is the signal to close without a prompt. */
export function shutdownPrompt(
	work: ActiveShutdownWork,
): ShutdownPrompt | null {
	const details: string[] = [];
	if (work.runningAgents > 0) {
		details.push(
			work.runningAgents === 1
				? "An agent run is still in progress and will be stopped."
				: `${work.runningAgents} agent runs are still in progress and will be stopped.`,
		);
	}
	if (work.activeSchedules)
		details.push("Scheduled automations will not run while Apex is closed.");
	if (details.length === 0) return null;
	return {
		message:
			work.runningAgents > 0
				? "Close Apex while an agent is running?"
				: "Close Apex?",
		detail: details.join(" "),
	};
}

export async function confirmAppClose(
	window: BrowserWindow | null,
	prompt: ShutdownPrompt,
): Promise<boolean> {
	const options = {
		type: "warning" as const,
		buttons: ["Cancel", "Close Apex"],
		defaultId: 0,
		cancelId: 0,
		noLink: true,
		title: "Apex",
		...prompt,
	};
	const { response } =
		window && !window.isDestroyed()
			? await dialog.showMessageBox(window, options)
			: await dialog.showMessageBox(options);
	return response === 1;
}

function pendingShutdownPrompt(): ShutdownPrompt | null {
	const runtimes = [
		...(piAgents?.list() ?? []),
	];
	return shutdownPrompt(
		activeShutdownWork(runtimes, automation?.hasActiveSchedules() ?? false),
	);
}

/**
 * The one confirmation path for both ✕ and Quit: the dialog is async so agent
 * RPC, IPC, and schedule ticks keep running while it is open, and the approved
 * flag lets the programmatic quit through without re-asking.
 */
function requestShutdown(
	window: BrowserWindow | null,
	prompt: ShutdownPrompt,
): void {
	confirmingShutdown = true;
	void confirmAppClose(window, prompt)
		.then((approved) => {
			if (!approved) return;
			shutdownApproved = true;
			app.quit();
		})
		.catch((error: unknown) => {
			console.error(
				`Apex close confirmation failed: ${boundedErrorMessage(error)}`,
			);
		})
		.finally(() => {
			confirmingShutdown = false;
		});
}

export function interfaceZoomFactor(): number {
	return (store?.getSettings().interfaceFontScale ?? 110) / 100;
}

/**
 * App windows only: embedded browser guests and their views keep their own
 * zoom, so the app scale is applied through the window list rather than to
 * every webContents in the process.
 */
function applyInterfaceZoom(scale: number): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (window.isDestroyed()) continue;
		const contents = window.webContents;
		if (!contents.isDestroyed()) contents.setZoomFactor(scale / 100);
	}
}

type ResolvedTheme = Exclude<ThemeMode, "system">;

function windowsTitleBarOverlay(theme: ResolvedTheme): {
	color: string;
	symbolColor: string;
	height: number;
} {
	return theme === "dark"
		? { color: "#171716", symbolColor: "#f1f1ee", height: 32 }
		: { color: "#ffffff", symbolColor: "#20201e", height: 32 };
}

function resolvedWindowTheme(theme: ThemeMode | undefined): ResolvedTheme {
	if (theme === "dark") return "dark";
	if (theme === "system" && nativeTheme.shouldUseDarkColors) return "dark";
	return "light";
}

export function mainWindowChromeOptions(
	platform: NodeJS.Platform = process.platform,
	theme: ResolvedTheme = "light",
): BrowserWindowConstructorOptions {
	if (platform === "darwin")
		return {
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 18, y: 18 },
			vibrancy: "sidebar",
			visualEffectState: "active",
		};
	if (platform === "win32")
		return {
			// The native caption controls share a dedicated menu row. Apex's own
			// 52px toolbar remains a separate application surface below it.
			titleBarStyle: "hidden",
			titleBarOverlay: windowsTitleBarOverlay(theme),
			autoHideMenuBar: true,
		};
	if (platform === "linux")
		return {
			titleBarStyle: "hidden",
			titleBarOverlay: { height: 52 },
			autoHideMenuBar: true,
		};
	return { titleBarStyle: "default" };
}

export function isMacWindowCloseShortcut(
	input: Pick<Input, "type" | "key" | "shift" | "control" | "alt" | "meta">,
	platform: NodeJS.Platform = process.platform,
): boolean {
	return (
		platform === "darwin" &&
		input.type === "keyDown" &&
		input.key.toLowerCase() === "q" &&
		input.meta &&
		!input.shift &&
		!input.control &&
		!input.alt
	);
}

export function popupApplicationMenu(
	sender: WebContents,
	menuName: ApplicationMenuName,
	x: number,
	y: number,
): boolean {
	const window = BrowserWindow.fromWebContents(sender);
	const applicationMenu = Menu.getApplicationMenu();
	const menuItem = applicationMenu?.items.find(
		(item) => item.label.replaceAll("&", "").toLowerCase() === menuName,
	);
	if (!window || window.isDestroyed() || !menuItem?.submenu) return false;
	const zoom = sender.getZoomFactor();
	menuItem.submenu.popup({
		window,
		x: Math.round(x * zoom),
		y: Math.round(y * zoom),
	});
	return true;
}

export function setTitleBarTheme(
	sender: WebContents,
	theme: ResolvedTheme,
): boolean {
	const window = BrowserWindow.fromWebContents(sender);
	if (process.platform !== "win32" || !window || window.isDestroyed())
		return false;
	window.setTitleBarOverlay(windowsTitleBarOverlay(theme));
	return true;
}

async function createWindow(): Promise<BrowserWindow | null> {
	if (shutdownStarted) return null;
	const window = new BrowserWindow({
		width: 1440,
		height: 920,
		minWidth: 420,
		minHeight: 480,
		show: false,
		backgroundColor: "#f5f5f4",
		icon: appIconPath(),
		...mainWindowChromeOptions(
			process.platform,
			resolvedWindowTheme(store?.getSettings().theme),
		),
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			zoomFactor: interfaceZoomFactor(),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webviewTag: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			spellcheck: true,
		},
	});
	mainWindow = window;
	const renderer = window.webContents;
	const rendererId = renderer.id;
	hardenRenderer(window);
	renderer.on("before-input-event", (event, input) => {
		if (!isMacWindowCloseShortcut(input)) return;
		event.preventDefault();
		if (!window.isDestroyed()) window.close();
	});
	renderer.on("did-finish-load", () => {
		if (renderer.isDestroyed()) return;
		// A reload resets the zoom factor, so the persisted scale is re-applied
		// on every load rather than only at window creation.
		renderer.setZoomFactor(interfaceZoomFactor());
		if (isTrustedRendererUrl(renderer.getURL(), trustedRendererUrl))
			ipc?.authorize(renderer);
	});
	renderer.on(
		"did-start-navigation",
		(_event, url, _isInPlace, isMainFrame) => {
			if (isMainFrame && !isTrustedRendererUrl(url, trustedRendererUrl))
				ipc?.revoke(rendererId);
		},
	);
	renderer.on("render-process-gone", () => ipc?.revoke(rendererId));
	let rendererLoaded = false;
	let readyToShow = false;
	window.once("ready-to-show", () => {
		readyToShow = true;
		if (
			!keepTestWindowsHidden &&
			!backgroundMode?.isBackgrounded() &&
			rendererLoaded &&
			!shutdownStarted &&
			!window.isDestroyed() &&
			mainWindow === window
		)
			window.show();
	});
	window.on("close", (event) => {
		if (shutdownStarted || shutdownApproved) return;
		if (backgroundMode?.handleWindowClose(window)) {
			event.preventDefault();
			return;
		}
		const prompt = pendingShutdownPrompt();
		if (!prompt) return;
		event.preventDefault();
		if (!confirmingShutdown) requestShutdown(window, prompt);
	});
	window.on("closed", () => {
		ipc?.revoke(rendererId);
		if (mainWindow === window) mainWindow = null;
	});
	try {
		await loadInitialRenderer(window, trustedRendererUrl);
	} catch (error) {
		ipc?.revoke(rendererId);
		if (mainWindow === window) mainWindow = null;
		throw error;
	}
	if (shutdownStarted || window.isDestroyed() || mainWindow !== window) {
		ipc?.revoke(rendererId);
		if (!window.isDestroyed()) window.destroy();
		if (mainWindow === window) mainWindow = null;
		return null;
	}
	rendererLoaded = true;
	if (
		!keepTestWindowsHidden &&
		!backgroundMode?.isBackgrounded() &&
		readyToShow
	)
		window.show();
	return window;
}

function ensureWindow(): Promise<BrowserWindow | null> {
	if (shutdownStarted) return Promise.resolve(null);
	if (mainWindow && !mainWindow.isDestroyed())
		return windowCreation ?? Promise.resolve(mainWindow);
	if (windowCreation) return windowCreation;
	const creation = createWindow();
	windowCreation = creation;
	const clearCreation = () => {
		if (windowCreation === creation) windowCreation = null;
	};
	void creation.then(clearCreation, clearCreation);
	return creation;
}

function boundedErrorMessage(error: unknown, maxLength = 512): string {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.replace(/[\r\n\t]+/g, " ").slice(0, maxLength) || "Unknown error"
	);
}

export interface StartupFailureDialog {
	title: string;
	detail: string;
}

export function startupFailureDialog(
	error: unknown,
): StartupFailureDialog | null {
	if (error instanceof StateMigrationError) {
		return {
			title: "Apex state migration failed",
			detail: boundedErrorMessage(error, 2_048),
		};
	}
	if (error instanceof StateCompatibilityError) {
		return {
			title: "Apex update required",
			detail: boundedErrorMessage(error, 2_048),
		};
	}
	return null;
}

/** Filesystem locations of shared capability extensions and their external runtimes. */
export interface CapabilityExtensionPaths {
	schedule: string;
	browser: string;
	browserAgent?: { extension: string; runtime: string; stateDir: string };
	askUser: string;
}

/**
 * Pi runtime capabilities use scoped broker variables and explicit extensions.
 * Skill-path variables are stripped because the bundled extensions carry their
 * own usage guidance.
 */
export function extensionRuntimeEnvironment(
	scheduleBridgeEnvironment: NodeJS.ProcessEnv,
	browserBridgeEnvironment: () => NodeJS.ProcessEnv,
	extensionPaths: CapabilityExtensionPaths,
	askUserEnabled = true,
	browserEnabled = true,
): NodeJS.ProcessEnv {
	const {
		PRIME_WORK_SCHEDULE_SKILL_PATH: _scheduleSkill,
		...scheduleEnvironment
	} = scheduleBridgeEnvironment;
	const browserEnvironment = browserEnabled ? browserBridgeEnvironment() : {};
	const {
		PRIME_WORK_BROWSER_SKILL_PATH: _browserSkill,
		...runtimeBrowserEnvironment
	} = browserEnvironment;
	return {
		...scheduleEnvironment,
		...runtimeBrowserEnvironment,
		PRIME_WORK_SCHEDULE_EXTENSION_PATH: extensionPaths.schedule,
		PRIME_WORK_BROWSER_EXTENSION_PATH: browserEnabled
			? extensionPaths.browser
			: undefined,
		APEX_BROWSER_AGENT_EXTENSION_PATH: browserEnabled ? extensionPaths.browserAgent?.extension : undefined,
		APEX_BROWSER_AGENT_RUNTIME_PATH: browserEnabled ? extensionPaths.browserAgent?.runtime : undefined,
		APEX_BROWSER_AGENT_STATE_DIR: browserEnabled ? extensionPaths.browserAgent?.stateDir : undefined,
		PRIME_WORK_ASK_USER_EXTENSION_PATH: askUserEnabled
			? extensionPaths.askUser
			: undefined,
		GOOEYPI_MANAGES_ASK_USER: "1",
	};
}

export async function settleShutdown(
	steps: ReadonlyArray<PromiseLike<unknown>>,
	options: { watchdogMs?: number; log?: (message: string) => void } = {},
): Promise<void> {
	const log = options.log ?? ((message: string) => console.error(message));
	const watchdogMs = options.watchdogMs ?? 10_000;
	const settled = Promise.allSettled(steps).then((results) => {
		for (const result of results) {
			if (result.status === "rejected")
				log(
					`Apex shutdown step failed: ${boundedErrorMessage(result.reason)}`,
				);
		}
	});
	let timer: NodeJS.Timeout | undefined;
	const watchdog = new Promise<void>((resolve) => {
		timer = setTimeout(() => {
			log(
				`Apex shutdown did not finish within ${watchdogMs} ms; quitting anyway`,
			);
			resolve();
		}, watchdogMs);
		timer.unref?.();
	});
	try {
		await Promise.race([settled, watchdog]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function requestWindow(
	reason: "activation" | "second instance" | "menu bar" | "settings",
	afterOpen?: (window: BrowserWindow) => void,
): void {
	void ensureWindow()
		.then((window) => {
			if (!window || shutdownStarted || window.isDestroyed()) return;
			if (!keepTestWindowsHidden) {
				if (window.isMinimized()) window.restore();
				window.show();
				window.focus();
			}
			afterOpen?.(window);
		})
		.catch((error: unknown) => {
			if (!shutdownStarted)
				console.error(
					`Apex failed to open a window after ${reason}: ${boundedErrorMessage(error)}`,
				);
		});
}

function revealApplication(reason: "activation" | "second instance"): void {
	if (backgroundMode) backgroundMode.open();
	else requestWindow(reason);
}

export function routeAllWindowsClosed(
	shutdownInProgress: boolean,
	background: Pick<MacBackgroundController, "handleAllWindowsClosed"> | null,
	quit: () => void,
): void {
	if (shutdownInProgress) return;
	if (!background?.handleAllWindowsClosed()) quit();
}

async function bootstrap(): Promise<void> {
	const userDataPath = app.getPath("userData");
	configureGooeyPiAgentMessageSigning(
		loadOrCreateGooeyPiAgentMessageKey(
			join(userDataPath, "agent-message-signing.key"),
		),
	);
	const stateStore = await openDesktopStateStore(userDataPath);
	store = stateStore;
	backgroundMode = new MacBackgroundController({
		iconPath: appIconPath(),
		getSettings: () => stateStore.getSettings(),
		onOpen: () => requestWindow("menu bar"),
		onSettings: () =>
			requestWindow("settings", (window) => {
				if (!window.webContents.isDestroyed())
					window.webContents.send("app:open-settings");
			}),
		onQuit: () => app.quit(),
		startInBackground,
	});
	const discovery = new HarnessDiscoveryService(
		() => stateStore.getSettings().runtimePaths,
	);
	const initialHarnesses = await discovery.refresh();
	await reconcileActiveHarness(stateStore, initialHarnesses);
	if (shutdownStarted) return;
	const piExecutable = () => discovery.executable("pi");
	// Pi likewise has no live-CLI overlay; its catalog is JSONL-only.
	const piSessions = new SessionService(
		stateStore,
		null,
		undefined,
		{ ...piSessionServiceOptions(), metadataCachePath: join(app.getPath("userData"), "pi-session-metadata-cache.json") },
	);
	const piProjects = new ProjectService(stateStore, () => mainWindow, "pi");
	const repositoryUseGate = new RepositoryUseGate();
	const checkouts = {
		pi: new CheckoutService(
			() => stateStore.getSettings().checkoutStrategy,
			piProjects,
			repositoryUseGate,
		),
	};
	const authorizeCwd = (cwd: string) => piProjects.authorizeCwd(cwd);
	const git = new GitService(authorizeCwd, (cwd) => piProjects.authorizeReadOnlyCwd(cwd));
	const piDisabledProviders = () =>
		new Set(stateStore.getSettings().piDisabledProviders);
	const piDisabledModels = () =>
		new Set(stateStore.getSettings().piDisabledModels);
	const piCatalog = new PiModelCatalogService(piExecutable);
	const piManager = new AgentRpcManager(
		piExecutable,
		(cwd) => piProjects.authorizeCwd(cwd),
		(path) => piSessions.requireSessionPath(path),
		piCatalog,
		piDisabledProviders,
		PI_RPC_ADAPTER,
	);
	piManager.setDisabledModelsProvider(piDisabledModels);
	piManager.setWorkspaceUseProvider((cwd, owner, retireIfIdle) =>
		repositoryUseGate.beginWorkspaceUse(cwd, owner, retireIfIdle),
	);
	piAgents = piManager;
	piSessions.bindRuntimeHooks({
		get: (path) => piAgents?.getForSession(path),
		all: () => piAgents?.list() ?? [],
		stop: async (path) => {
			await piAgents?.stopForSession(path);
		},
		rename: async (path, title) =>
			piAgents?.renameForSession(path, title) ?? false,
	});
	terminals = new TerminalService(
		authorizeCwd,
		() => stateStore.getSettings().terminalShell,
		(path) => piSessions.requireSessionPath(path),
		(cwd, owner) => repositoryUseGate.beginWorkspaceUse(cwd, owner),
	);
	piProjects.bindProviders({
		sessions: () => piSessions.list(undefined, true),
		branch: (cwd) => git.branch(cwd),
		stopProjectProcesses: async (roots) => {
			piPlugins.evictProjects(roots);
			await Promise.all([
				piManager.stopForProjectRoots(roots),
				terminals!.killForProjectRoots(roots),
			]);
		},
	});
	downloads = new BrowserDownloadGuard(
		isAllowedBrowserUrl,
		app.getPath("downloads"),
	);
	const settings = new SettingsService(
		stateStore,
		(shell) => terminals!.validateShell(shell),
		() => downloads?.cancelAll(true),
		(previous, next) => backgroundMode?.applySettings(previous, next),
	);
	const cuaDriver = new CuaDriverService();
	// The disabled-by-default integration probes PATH and may spawn a version
	// command. Defer that work until it is enabled or its settings UI is opened.
	if (stateStore.getSettings().computerUseEnabled) await cuaDriver.status();
	const voice = new VoiceService({
		secretPath: join(app.getPath("userData"), "voice-secrets.json"),
		secretCodec: {
			status: () =>
				voiceSecretStorageStatus(
					process.platform,
					safeStorage.isEncryptionAvailable(),
					process.platform === "linux"
						? safeStorage.getSelectedStorageBackend()
						: undefined,
				),
			encrypt: (value) => safeStorage.encryptString(value),
			decrypt: (value) => safeStorage.decryptString(value),
		},
		settings: () => stateStore.getSettings(),
		projects: { pi: piProjects },
		agents: { pi: piManager },
		catalogs: { pi: piCatalog },
		runProcess,
	});
	const pets = new PetService({
		builtInRoot: app.isPackaged
			? join(process.resourcesPath, "pets")
			: join(resolveDesktopAppRoot(app.getAppPath()), "assets", "pets"),
		codexRoot: join(homedir(), ".codex", "pets"),
	});
	const browserProfile = session.fromPartition(BROWSER_PARTITION);
	browserProfile.on("will-download", (event, item, owner) =>
		downloads?.handle(
			event,
			item,
			owner,
			settings.get().browserAskForDownloads,
		),
	);
	const scheduleSkillPath = app.isPackaged
		? join(process.resourcesPath, "skills", "prime-work-schedules")
		: join(resolveDesktopAppRoot(app.getAppPath()), "assets", "skills", "prime-work-schedules");
	const browserSkillPath = app.isPackaged
		? join(process.resourcesPath, "skills", "prime-work-browser")
		: join(resolveDesktopAppRoot(app.getAppPath()), "assets", "skills", "prime-work-browser");
	const computerUseSkillPath = app.isPackaged
		? join(process.resourcesPath, "skills", "gooeypi-computer-use", "SKILL.md")
		: join(
				resolveDesktopAppRoot(app.getAppPath()),
				"assets",
				"skills",
				"gooeypi-computer-use",
				"SKILL.md",
			);
	const extensionPathContext = {
		isPackaged: app.isPackaged,
		appPath: app.getAppPath(),
		resourcesPath: process.resourcesPath,
	};
	const extensionPathFor = (
		harness: HarnessId,
		capability: ExtensionCapability,
	): string =>
		resolveExtensionPath(
			extensionInjection(harness, capability).filename,
			extensionPathContext,
		);
	const piBrowserExtensionPath = extensionPathFor("pi", "browser");
	const browserAgentExtensionPath = extensionPathFor("pi", "browserAgent");
	const ompBrowserExtensionPath = extensionPathFor("pi", "browser");
	const ompScheduleExtensionPath = extensionPathFor("pi", "schedule");
	const ompAskUserExtensionPath = extensionPathFor("pi", "askUser");
	const collaborationExtensionPath = extensionPathFor("pi", "collaboration");
	const piFastModeExtensionPath = extensionPathFor("pi", "piFastMode");
	const computerUseSkill = async () => {
		const status = await cuaDriver.status();
		return {
			id: "gooeypi-computer-use",
			name: "Computer Use | TryCUA",
			description:
				"Drive native apps through a separately installed TryCUA driver. Install the driver before enabling.",
			kind: "extension" as const,
			location: "system" as const,
			path: computerUseSkillPath,
			enabled: stateStore.getSettings().computerUseEnabled,
			availability: {
				available: status.available,
				detail: status.detail,
				actionUrl: status.available ? undefined : status.installUrl,
			},
		};
	};
	// Pi's extension API is the ancestor of OMP's, so pi runtimes inject the
	// same omp-work-* extension files (accepted naming drift; never forked).
	const piPlugins = new PluginService(
		piExecutable,
		(path) => piProjects.authorizeProjectRoot(path),
		{
			harness: "pi",
			builtInSkills: async () => [
				{
					id: "omp-work-schedules",
					name: "Scheduled tasks",
					description:
						"Pi extension for durable project and thread schedules managed by Apex.",
					kind: "extension",
					location: "system",
					path: ompScheduleExtensionPath,
					enabled: true,
				},
				{
					id: "omp-work-browser",
					name: "Browser",
					description: "Pi extension for driving this thread's in-app browser.",
					kind: "extension",
					location: "system",
					path: ompBrowserExtensionPath,
					enabled: stateStore.getSettings().browserEnabled,
				},
				{
					id: "apex-browser-agent",
					name: "Browser agent",
					description: "Run ordered browser steps with expectations and page diffs.",
					kind: "extension",
					location: "system",
					path: browserAgentExtensionPath,
					enabled: stateStore.getSettings().browserEnabled,
				},
				{
					id: "gooeypi-ask-user",
					name: "Ask user",
					description:
						"Pi extension for asking focused multiple-choice questions in the Apex app.",
					kind: "extension",
					location: "system",
					path: ompAskUserExtensionPath,
					enabled: stateStore.getSettings().askUserEnabled,
				},
				await computerUseSkill(),
			],
		},
	);
	const piScheduledRuns = new ScheduledRunExecutor(
		piProjects,
		piSessions,
		piManager,
		piCatalog,
		() => new Set(stateStore.getSettings().piDisabledProviders),
		() => new Set(stateStore.getSettings().piDisabledModels),
	);
	const scheduledRunsFor = (harness: HarnessId): ScheduledRunExecutor => {
		if (harness !== "pi") throw new Error("Invalid harness");
		return piScheduledRuns;
	};
	const schedules = new AutomationService(stateStore, {
		validateTarget: (target, harness) =>
			scheduledRunsFor(harness).validateTarget(target),
		validateExecution: (execution, harness) =>
			scheduledRunsFor(harness).validateExecution(execution),
		validatePrompt: (prompt, harness) => {
			if (harness !== "pi") throw new TypeError("This schedule belongs to a removed runtime");
			assertNoMcpAuthenticationCommand(prompt, harness);
		},
		run: (task) => scheduledRunsFor(task.harness).run(task),
	});
	automation = schedules;
	await schedules.start();
	const piScheduleBridge = new AgentScheduleBridge({
		service: schedules,
		harness: "pi",
		skillPath: scheduleSkillPath,
		resolveScope: async ({ cwd, sessionPath }) => {
			const catalog = await piProjects.list();
			const canonicalCwd = resolve(cwd);
			const project = catalog.find(
				(candidate) =>
					!candidate.inferred &&
					candidate.folders.some((folder) => {
						const root = resolve(folder);
						return (
							canonicalCwd === root ||
							canonicalCwd.startsWith(
								`${root}${process.platform === "win32" ? "\\" : "/"}`,
							)
						);
					}),
			);
			if (!project)
				throw new Error(
					"The agent is not running in an explicitly granted Pi Work project",
				);
			if (!sessionPath) return { projectId: project.id };
			const scheduledSession = (await piSessions.list(undefined, true)).find(
				(candidate) => resolve(candidate.filePath) === resolve(sessionPath),
			);
			return { projectId: project.id, sessionId: scheduledSession?.id };
		},
	});
	const extensionBridge = new ExtensionBrowserBridge();
	await extensionBridge.startOrConnect('vscode');
	extensionBrowserBridge = extensionBridge;
	const browserService = new AgentBrowserService({
		extensionBridge,
		extensionPath: app.isPackaged
			? join(process.resourcesPath, "browser-extension")
			: join(app.getAppPath(), "packages", "browser-extension", "extension"),
		imageFromDataURL: (url) => nativeImage.createFromDataURL(url),
		getGuest: (webContentsId) => {
			const contents = webContents.fromId(webContentsId);
			return contents && !contents.isDestroyed() ? contents : undefined;
		},
	});
	agentBrowser = browserService;
	const browserBridge = new AgentBrowserBridge({
		service: browserService,
		terminals,
		extensionPath: piBrowserExtensionPath,
		skillPath: browserSkillPath,
	});
	const collaborationBridge = new AgentCollaborationBridge({
		extensionPath: collaborationExtensionPath,
		sessions: { pi: piSessions },
		agents: { pi: piManager },
		catalogs: { pi: piCatalog },
		disabledProviders: { pi: piDisabledProviders },
		disabledModels: { pi: piDisabledModels },
	});
	await Promise.all([
		piScheduleBridge.start(),
		browserBridge.start(),
		collaborationBridge.start(),
	]);
	agentScheduleBridges = [piScheduleBridge];
	agentBrowserBridge = browserBridge;
	agentCollaborationBridge = collaborationBridge;
	const revokeRuntimeCapabilities = (
		environment: NodeJS.ProcessEnv,
		runtimeScheduleBridge: AgentScheduleBridge,
	): void => {
		const claims: Array<
			[
				string,
				{ revoke(token: string | undefined): boolean },
				string | undefined,
			]
		> = [
			[
				"schedule",
				runtimeScheduleBridge,
				environment.PRIME_WORK_SCHEDULE_TOKEN,
			],
			["browser", browserBridge, environment.PRIME_WORK_BROWSER_TOKEN],
			[
				"collaboration",
				collaborationBridge,
				environment.GOOEYPI_COLLABORATION_TOKEN,
			],
		];
		for (const [name, bridge, token] of claims) {
			try {
				bridge.revoke(token);
			} catch (error) {
				console.error(
					`Apex failed to revoke ${name} runtime capability: ${boundedErrorMessage(error)}`,
				);
			}
		}
	};
	const capabilityExtensionPaths: CapabilityExtensionPaths = {
		schedule: ompScheduleExtensionPath,
		browser: ompBrowserExtensionPath,
		browserAgent: {
			extension: browserAgentExtensionPath,
			runtime: app.isPackaged
				? join(process.resourcesPath, "browser-agent", "runtime.mjs")
				: join(app.getAppPath(), "out", "browser-agent", "runtime.mjs"),
			stateDir: join(app.getPath("userData"), "browser-agent"),
		},
		askUser: ompAskUserExtensionPath,
	};
	// Pi runtimes receive the identical capability surface: pi's extension API
	// is the ancestor of OMP's, so the omp-work-* files are shared by design.
	piManager.setRuntimeEnvironmentProvider((scope) => ({
		...extensionRuntimeEnvironment(
			piScheduleBridge.environmentFor(scope),
			() => browserBridge.environmentFor(scope),
			capabilityExtensionPaths,
			stateStore.getSettings().askUserEnabled && scope.interactive,
			stateStore.getSettings().browserEnabled,
		),
		...collaborationBridge.environmentFor({ ...scope, harness: "pi" }),
		GOOEYPI_PI_FAST_MODE_EXTENSION_PATH: piFastModeExtensionPath,
		GOOEYPI_CUA_DRIVER_PATH: stateStore.getSettings().computerUseEnabled
			? (cuaDriver.executable() ?? undefined)
			: undefined,
		GOOEYPI_COMPUTER_USE_SKILL_PATH:
			stateStore.getSettings().computerUseEnabled && cuaDriver.executable()
				? computerUseSkillPath
				: undefined,
	}));
	piManager.setRuntimeStartListener((environment, info) => {
		browserBridge.bindSession(
			environment.PRIME_WORK_BROWSER_TOKEN,
			info.sessionFile,
		);
		collaborationBridge.bindSession(
			environment.GOOEYPI_COLLABORATION_TOKEN,
			info.sessionFile,
			info.runtimeId,
		);
	});
	piManager.setRuntimeEndListener((environment) =>
		revokeRuntimeCapabilities(environment, piScheduleBridge),
	);
	if (shutdownStarted) return;
	const meta: AppMeta = {
		version: app.getVersion(),
		platform: process.platform,
		homeDir: homedir(),
		harnesses: initialHarnesses,
	};
	const updates = new UpdateService(getAutoUpdater(), {
		enabled: app.isPackaged,
	});
	updateService = updates;
	const refreshHarnesses = async () => {
		const harnesses = await discovery.refresh();
		const currentSettings = await reconcileActiveHarness(stateStore, harnesses);
		meta.harnesses = harnesses;
		return { meta: structuredClone(meta), settings: currentSettings };
	};
	trustedRendererUrl = resolveRendererUrl();
	ipc = registerIpc(
		{
			meta,
			refreshHarnesses,
			projects: piProjects,
			checkouts,
			sessions: piSessions,
			agents: piManager,
			terminals,
			git,
			plugins: piPlugins,
			catalog: piCatalog,
			settings,
			updates,
			cuaDriver,
			schedules,
			browser: browserService,
			voice,
			pets,
			popupApplicationMenu,
			setTitleBarTheme,
			applyInterfaceZoom,
		},
		trustedRendererUrl,
	);
	// Runtime events share one trusted renderer forwarding path.
	const forwardAgentEvent = (envelope: PrimeEventEnvelope): void => {
		const renderer = mainWindow?.webContents;
		if (
			!shutdownStarted &&
			renderer &&
			!renderer.isDestroyed() &&
			isTrustedRendererUrl(renderer.getURL(), trustedRendererUrl) &&
			isTrustedRendererUrl(renderer.mainFrame.url, trustedRendererUrl)
		) {
			renderer.send("agent:event", envelope);
		}
	};
	piManager.setEventSink(forwardAgentEvent);
	updates.setEventSink((state: AppUpdateState) => {
		const renderer = mainWindow?.webContents;
		if (
			!shutdownStarted &&
			renderer &&
			!renderer.isDestroyed() &&
			isTrustedRendererUrl(renderer.getURL(), trustedRendererUrl) &&
			isTrustedRendererUrl(renderer.mainFrame.url, trustedRendererUrl)
		) {
			renderer.send("updates:changed", state);
		}
	});
	installApplicationMenu({
		appName: "Apex",
		updatesEnabled: updates.isEnabled(),
		closeWindow: () => {
			const window = mainWindow;
			if (!window || window.isDestroyed()) app.quit();
			else window.close();
		},
		checkForUpdates: createManualUpdateCheck(
			() => updates.check(),
			async (notification) => {
				await dialog.showMessageBox({
					type: notification.type,
					title: "Apex",
					message: notification.message,
					detail: notification.detail,
				});
			},
		),
	});
	backgroundMode.start();
	const window = await ensureWindow();
	if (packagedSmokeMarkerFile) {
		await runPackagedSmoke(window, packagedSmokeMarkerFile);
		return;
	}
	updates.start();
}

/**
 * Reports packaged readiness once the trusted renderer has completed an
 * authorized IPC round trip, then quits. The launcher owns the deadline, so
 * nothing here polls or waits on a timer.
 */
async function runPackagedSmoke(
	window: BrowserWindow | null,
	markerPath: string,
): Promise<void> {
	if (!window || window.isDestroyed())
		throw new Error("Packaged smoke mode could not open the renderer window");
	if (!ipc)
		throw new Error(
			"Packaged smoke mode has no registered IPC surface to observe",
		);
	await ipc.whenRendererReady;
	const marker = serializePackagedSmokeMarker(
		packagedSmokeMarker(trustedRendererUrl, app.getVersion()),
	);
	await writeFile(markerPath, marker, {
		encoding: "utf8",
		flag: "wx",
		mode: 0o600,
	});
	console.log(`${PACKAGED_SMOKE_READY_EVENT} ${trustedRendererUrl}`);
	shutdownApproved = true;
	app.quit();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else
	void app
		.whenReady()
		.then(async () => {
			// Parsed from the first instance's own argv only: a second-instance command
			// line must never be able to make a running application write a marker and quit.
			const requestedSmokeMarker = packagedSmokeMarkerPath(process.argv);
			if (requestedSmokeMarker) {
				if (!app.isPackaged)
					throw new Error(
						"Packaged smoke mode is only available in packaged builds",
					);
				packagedSmokeMarkerFile = requestedSmokeMarker;
			}
			registerRendererProtocol();
			let wasOpenedAtLogin = false;
			if (process.platform === "darwin" && app.isPackaged) {
				try {
					wasOpenedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
				} catch {
					/* The explicit flag remains available if the OS lookup fails. */
				}
			}
			startInBackground = shouldStartInBackground(
				process.argv,
				wasOpenedAtLogin,
			);
			if (process.platform === "darwin") {
				app.setActivationPolicy(startInBackground ? "accessory" : "regular");
				if (!startInBackground) app.dock?.setIcon(appIconPath());
			}
			const browserSession = session.defaultSession;
			browserSession.setPermissionRequestHandler(
				(contents, permission, callback, details) => {
					const mediaTypes =
						permission === "media" && "mediaTypes" in details
							? details.mediaTypes
							: undefined;
					callback(
						permission === "media" &&
							isAllowedRendererAudioPermission(
								contents.getURL(),
								contents.mainFrame.url,
								trustedRendererUrl,
								mediaTypes,
							),
					);
				},
			);
			browserSession.setPermissionCheckHandler(
				(contents, permission, _origin, details) =>
					Boolean(
						contents &&
							permission === "media" &&
							details.isMainFrame &&
							isAllowedRendererAudioPermission(
								contents.getURL(),
								contents.mainFrame.url,
								trustedRendererUrl,
								details.mediaType ? [details.mediaType] : undefined,
							),
					),
			);
			const browserProfile = session.fromPartition(BROWSER_PARTITION);
			browserProfile.setPermissionRequestHandler(
				(_webContents, _permission, callback) => callback(false),
			);
			browserProfile.setPermissionCheckHandler(() => false);
			if (app.isPackaged) {
				browserSession.webRequest.onHeadersReceived((details, callback) => {
					callback({
						responseHeaders: {
							...details.responseHeaders,
							"Content-Security-Policy": [RENDERER_CONTENT_SECURITY_POLICY],
						},
					});
				});
			}
			await bootstrap();
			app.on("second-instance", () => {
				if (!shutdownStarted) revealApplication("second instance");
			});
			app.on("activate", () => {
				if (
					!shutdownStarted &&
					(!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible())
				)
					revealApplication("activation");
			});
		})
		.catch((error: unknown) => {
			const failureDialog = startupFailureDialog(error);
			if (failureDialog)
				dialog.showErrorBox(failureDialog.title, failureDialog.detail);
			if (!shutdownStarted)
				console.error(`Apex failed to start: ${boundedErrorMessage(error)}`);
			app.quit();
		});

app.on("window-all-closed", () => {
	routeAllWindowsClosed(shutdownStarted, backgroundMode, () => app.quit());
});

app.on("before-quit", (event) => {
	if (shutdownStarted) return;
	if (!shutdownApproved) {
		const prompt = pendingShutdownPrompt();
		if (prompt) {
			event.preventDefault();
			if (!confirmingShutdown)
				requestShutdown(
					mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
						? mainWindow
						: null,
					prompt,
				);
			return;
		}
	}
	event.preventDefault();
	shutdownStarted = true;

	const registration = ipc;
	ipc = null;
	registration?.dispose();
	backgroundMode?.dispose();
	updateService?.dispose();
	piAgents?.beginShutdown();
	beginProcessShutdown();
	beginPluginDiscoveryShutdown();
	downloads?.cancelAll();
	agentBrowser?.beginShutdown();
	void settleShutdown([
		...agentScheduleBridges.map((bridge) => bridge.stop()),
		agentBrowserBridge?.stop() ?? Promise.resolve(),
		extensionBrowserBridge?.stop() ?? Promise.resolve(),
		agentCollaborationBridge?.stop() ?? Promise.resolve(),
		automation?.stop() ?? Promise.resolve(),
		terminals?.killAll() ?? Promise.resolve(),
		piAgents?.stopAll() ?? Promise.resolve(),
		stopChildProcesses(),
	])
		.then(async () => {
			// Await the drain so the final persist lands before the process exits.
			try {
				await store?.beginShutdown();
			} catch (error) {
				console.error(
					`Apex store shutdown failed: ${boundedErrorMessage(error)}`,
				);
			}
		})
		.finally(() => app.quit());
});
