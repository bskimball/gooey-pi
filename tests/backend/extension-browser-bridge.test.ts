import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AgentBrowserService,
	isLocalPreviewUrl,
} from "../../apps/desktop/electron/main/browser/agent-service";
import {
	ExtensionBrowserBridge,
	type ExtensionCommand,
} from "../../apps/desktop/electron/main/browser/extension-bridge";
import { readPageScript } from "../../apps/desktop/electron/main/browser/page-scripts";

const sessionA = resolve("/sessions/a.jsonl");

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
	const bridge = new ExtensionBrowserBridge({
		port: 0,
		commandTimeoutMs: 1000,
	});
	const service = new AgentBrowserService({
		getGuest: () => undefined,
		extensionBridge: bridge,
		extensionPath: "/extension",
	});
	await bridge.start();
	cleanups.push(async () => {
		service.beginShutdown();
		await bridge.stop();
	});
	const base = `http://127.0.0.1:${bridge.port}/v1/extension`;
	const origin = `chrome-extension://${"a".repeat(32)}`;
	const hello = await fetch(`${base}/hello`, { headers: { Origin: origin } });
	const { token } = (await hello.json()) as { token: string };
	const headers = {
		Authorization: `Bearer ${token}`,
		Origin: origin,
		"Content-Type": "application/json",
	};
	const post = async (endpoint: string, body: unknown) =>
		fetch(`${base}/${endpoint}`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
	const controller = new AbortController();
	const stream = await fetch(`${base}/events`, {
		headers,
		signal: controller.signal,
	});
	const reader = stream.body!.getReader();
	const commands: ExtensionCommand[] = [];
	let nextId = 10;
	let respond: (command: ExtensionCommand) => unknown = (command) => {
		if (command.method === "create_tab") return nextId++;
		if (command.method === "evaluate")
			return JSON.stringify({
				url: "https://example.com/",
				title: "Example",
				innerWidth: 640,
				innerHeight: 480,
			});
		return true;
	};
	const pump = (async () => {
		const decoder = new TextDecoder();
		let buffer = "";
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let boundary = buffer.indexOf("\n\n");
				while (boundary >= 0) {
					const block = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					boundary = buffer.indexOf("\n\n");
					if (!block.startsWith("data: ")) continue;
					const command = JSON.parse(block.slice(6)) as ExtensionCommand;
					commands.push(command);
					try {
						await post("result", {
							id: command.id,
							result: await respond(command),
						});
					} catch (error) {
						await post("result", { id: command.id, error: String(error) });
					}
				}
			}
		} catch {
			/* Aborted by fixture cleanup. */
		}
	})();
	cleanups.push(async () => {
		controller.abort();
		await pump;
	});
	return {
		bridge,
		service,
		base,
		headers,
		post,
		commands,
		hello,
		setResponder: (fn: typeof respond) => {
			respond = fn;
		},
	};
}

describe("ExtensionBrowserBridge", () => {
	it.each(["GET", "POST"])(
		"accepts the %s /connect handshake without a token",
		async (method) => {
			const { base, headers } = await fixture();
			const response = await fetch(`${base}/connect`, {
				method,
				headers: { Origin: headers.Origin },
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				token: expect.any(String),
				activeSessionKey: null,
				tabs: [],
			});
		},
	);
	it("permits extension CORS, rejects web origins and requires a connection token", async () => {
		const { base, hello, bridge } = await fixture();
		expect(hello.headers.get("access-control-allow-origin")).toBe(
			`chrome-extension://${"a".repeat(32)}`,
		);
		expect(bridge.isConnected()).toBe(true);
		expect(
			(
				await fetch(`${base}/hello`, {
					headers: { Origin: "https://evil.example" },
				})
			).status,
		).toBe(403);
		expect(
			(await fetch(`${base}/event`, { method: "POST", body: "{}" })).status,
		).toBe(401);
		const preflight = await fetch(`${base}/event`, {
			method: "OPTIONS",
			headers: { Origin: `chrome-extension://${"b".repeat(32)}` },
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get("access-control-allow-headers")).toContain(
			"Authorization",
		);
	});

	it("falls back to an ephemeral loopback port when the preferred port is occupied", async () => {
		const { bridge } = await fixture();
		const second = new ExtensionBrowserBridge({ port: bridge.port! });
		await second.start();
		cleanups.push(() => second.stop());
		expect(second.port).not.toBe(bridge.port);
	});

	it("routes external URLs, materializes lazy tabs without blank tabs and reuses user-shared tabs", async () => {
		const { service, commands, post } = await fixture();
		const pending = await service.openTab(sessionA, {});
		expect(commands).toHaveLength(0);
		expect(pending.backend).toBe("extension");
		await service.navigate(sessionA, {
			tabId: pending.tabId,
			url: "https://example.com/",
		});
		expect(
			commands
				.filter((command) => command.method === "create_tab")
				.map((command) => command.params.url),
		).toEqual(["https://example.com/"]);
		await service.setActiveSession(sessionA);
		expect(
			(
				await post("event", {
					type: "tab_paired",
					chromeTabId: 99,
					url: "https://shared.example/",
					title: "Shared",
				})
			).status,
		).toBe(200);
		const shared = await service.openTab(sessionA, {});
		expect(shared).toMatchObject({ chromeTabId: 99, pairedByUser: true });
		expect(
			commands.filter((command) => command.method === "create_tab"),
		).toHaveLength(1);
		await service.focusExtensionTab(sessionA, String(shared.tabId));
		expect(commands.at(-1)).toMatchObject({
			method: "focus_tab",
			params: { chromeTabId: 99 },
		});
	});

	it("keeps a user-paired tab in Chrome when navigating to a local preview", async () => {
		const { service, post, commands } = await fixture();
		await post("event", {
			type: "tab_paired",
			chromeTabId: 99,
			sessionKey: sessionA,
			url: "https://example.com/",
		});
		const tab = service.state().tabs[0];
		await service.navigate(sessionA, {
			tabId: tab.tabId,
			url: "http://localhost:3000/",
		});
		expect(service.state().tabs[0]).toMatchObject({
			backend: "extension",
			chromeTabId: 99,
			pairedByUser: true,
		});
		expect(commands.some((command) => command.method === "close_tab")).toBe(
			false,
		);
		expect(commands[0]).toMatchObject({
			method: "navigate",
			params: { chromeTabId: 99, url: "http://localhost:3000/" },
		});
	});

	it("revokes queued extension mutations on user pause and permits explicit resume", async () => {
		const { service, post, commands, setResponder, base, headers } = await fixture();
		const tab = await service.openTab(sessionA, {
			url: "https://example.com/",
		});
		await post("event", {
			type: "tab_pause_changed",
			chromeTabId: tab.chromeTabId,
			paused: true,
			reason: "user_input",
		});
		for (const action of [
			service.navigate,
			service.click,
			service.type,
			service.pressKey,
			service.scroll,
			service.evaluate,
		]) {
			await expect(
				action.call(service, sessionA, {
					tabId: tab.tabId,
					url: "https://example.com/",
					code: "1",
					text: "x",
					key: "a",
					direction: "down",
					x: 1,
					y: 1,
				}),
			).rejects.toThrow(
				"Tab is paused by the user. Ask the user to resume agent control or wait until they finish.",
			);
		}
		expect(commands).toHaveLength(1);
		let chromePaused = true;
		setResponder(command => {
			if (command.method === 'sync_tab_state') {
				if (typeof command.params.paused === 'boolean') chromePaused = command.params.paused;
				return true;
			}
			if (chromePaused) throw new Error('Chrome tab is paused');
			return JSON.stringify({ url: 'https://example.com/', title: 'Example' });
		});
		await service.setTabPaused(sessionA, String(tab.tabId), false);
		expect(commands.at(-1)).toMatchObject({ method: 'sync_tab_state', params: { chromeTabId: tab.chromeTabId, paused: false } });
		expect(chromePaused).toBe(false);
		const state = await fetch(`${base}/tab-state`, { headers });
		expect(await state.json()).toMatchObject({ tabs: expect.arrayContaining([expect.objectContaining({ chromeTabId: tab.chromeTabId, paused: false })]) });
		await service.evaluate(sessionA, {
			tabId: tab.tabId,
			code: "1",
		});
		expect(commands.at(-1)?.method).toBe("evaluate");
	});

	it("rejects work queued before a takeover instead of dispatching it after the current action", async () => {
		const { service, post, setResponder, commands } = await fixture();
		const tab = await service.openTab(sessionA, {
			url: "https://example.com/",
		});
		let release!: (value: string) => void;
		let started!: () => void;
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		const held = new Promise<string>((resolve) => {
			release = resolve;
		});
		setResponder(() => {
			started();
			return held;
		});
		const first = service.readPage(sessionA, { tabId: tab.tabId });
		await ready;
		const queued = service.type(sessionA, {
			tabId: tab.tabId,
			text: "must not type",
		});
		const rejected = expect(queued).rejects.toThrow(
			"Tab is paused by the user",
		);
		await post("event", {
			type: "tab_pause_changed",
			chromeTabId: tab.chromeTabId,
			paused: true,
		});
		release("{}");
		await first;
		await rejected;
		expect(commands.filter((command) => command.method === "cdp")).toHaveLength(
			0,
		);
	});

	it("sends the same read_page script as the webview backend", async () => {
		const { service, commands, setResponder } = await fixture();
		const tab = await service.openTab(sessionA, {
			url: "https://example.com/",
		});
		const payload = {
			url: "https://example.com/",
			text: "Example",
			elements: [{ ref: 1, role: "button", name: "Go" }],
		};
		setResponder(() => JSON.stringify(payload));
		expect(
			await service.readPage(sessionA, { tabId: tab.tabId }),
		).toEqual(payload);
		expect(commands.at(-1)?.params.script).toBe(
			readPageScript("interactive", 40_000, 300),
		);
	});

	it("retains a pending tab locally when its first navigation is a preview URL", async () => {
		const { service, commands } = await fixture();
		const tab = await service.openTab(sessionA, {});
		const navigation = service.navigate(sessionA, {
			tabId: tab.tabId,
			url: "http://localhost:3000/",
		});
		await Promise.resolve();
		expect(service.state().tabs[0].backend).toBe("webview");
		expect(commands).toHaveLength(0);
		service.beginShutdown();
		await expect(navigation).rejects.toThrow();
	});

	it.each([
		"http://localhost:3000",
		"http://127.0.0.1",
		"http://[::1]:1234",
		"https://app.localhost",
		"http://0.0.0.0",
	])("recognizes local preview %s", (url) => {
		expect(isLocalPreviewUrl(url)).toBe(true);
		expect(isLocalPreviewUrl("https://localhost.example.com")).toBe(false);
	});
});

type WorkerMessage = (
	message: Record<string, unknown>,
	sender: { tab: { id: number } },
	reply: (value: { result?: unknown; error?: string }) => void,
) => boolean;
function workerFixture() {
	let listener!: WorkerMessage;
	let now = 1000;
	const events: Array<Record<string, unknown>> = [];
	const eventSource = () => ({ addListener: vi.fn() });
	const sendCommand = vi
		.fn<(...args: unknown[]) => Promise<unknown>>()
		.mockResolvedValue({});
	const chrome = {
		runtime: {
			onMessage: {
				addListener: (fn: WorkerMessage) => {
					listener = fn;
				},
			},
		},
		tabs: { onUpdated: eventSource(), onRemoved: eventSource() },
		debugger: { attach: vi.fn(), sendCommand, onDetach: eventSource() },
		storage: { local: { get: () => new Promise(() => undefined) } },
		alarms: { create: vi.fn(), onAlarm: eventSource() },
	};
	const source = readFileSync(
		new URL("../../packages/browser-extension/background.js", import.meta.url),
		"utf8",
	);
	const worker = runInNewContext(`${source}\n;({ execute, tabs })`, {
		chrome,
		Date: { now: () => now },
		setTimeout: vi.fn(),
		fetch: async (_url: string, options: { body: string }) => {
			events.push(JSON.parse(options.body));
			return { ok: true, json: async () => ({}) };
		},
	}) as {
		execute(command: {
			method: string;
			params: Record<string, unknown>;
		}): Promise<unknown>;
		tabs: Map<number, { paused: boolean }>;
	};
	worker.tabs.set(42, { paused: false });
	const message = (payload: Record<string, unknown>) =>
		new Promise<{ result?: unknown; error?: string }>((resolve) => {
			listener(
				{ type: "USER_INTERACTION_DETECTED", ...payload },
				{ tab: { id: 42 } },
				resolve,
			);
		});
	return {
		...worker,
		message,
		events,
		sendCommand,
		expire: () => {
			now += 2000;
		},
	};
}

describe("extension manifest", () => {
	it("declares toolbar and store icons that exist on disk", () => {
		const extensionDir = new URL(
			"../../packages/browser-extension/",
			import.meta.url,
		);
		const manifest = JSON.parse(
			readFileSync(new URL("manifest.json", extensionDir), "utf8"),
		) as {
			icons?: Record<string, string>;
			action?: { default_icon?: Record<string, string> };
		};
		const expected = {
			16: "icons/icon-16.png",
			32: "icons/icon-32.png",
			48: "icons/icon-48.png",
			128: "icons/icon-128.png",
		};
		expect(manifest.icons).toEqual(expected);
		expect(manifest.action?.default_icon).toEqual(expected);
		for (const file of Object.values(expected))
			expect(existsSync(new URL(file, extensionDir)), file).toBe(true);
	});
});

describe("extension worker input and physical-tab queues", () => {
	it.each([
		[
			"matching pointer",
			"Input.dispatchMouseEvent",
			{ type: "mousePressed", x: 10, y: 20 },
			{ kind: "pointer", x: 12, y: 21 },
			false,
		],
		[
			"different pointer",
			"Input.dispatchMouseEvent",
			{ type: "mousePressed", x: 10, y: 20 },
			{ kind: "pointer", x: 100, y: 200 },
			true,
		],
		[
			"key during click",
			"Input.dispatchMouseEvent",
			{ type: "mousePressed", x: 10, y: 20 },
			{ kind: "key" },
			true,
		],
		[
			"click during move",
			"Input.dispatchMouseEvent",
			{ type: "mouseMoved", x: 10, y: 20 },
			{ kind: "pointer", x: 10, y: 20 },
			true,
		],
		[
			"key during move",
			"Input.dispatchMouseEvent",
			{ type: "mouseMoved", x: 10, y: 20 },
			{ kind: "key" },
			true,
		],
		[
			"matching wheel",
			"Input.dispatchMouseEvent",
			{ type: "mouseWheel", x: 10, y: 20 },
			{ kind: "wheel", x: 12, y: 21 },
			false,
		],
		[
			"mismatched wheel",
			"Input.dispatchMouseEvent",
			{ type: "mouseWheel", x: 10, y: 20 },
			{ kind: "wheel", x: 100, y: 200 },
			true,
		],
		[
			"matching key",
			"Input.dispatchKeyEvent",
			{ type: "keyDown" },
			{ kind: "key" },
			false,
		],
	])(
		"%s triggers takeover only when it does not match synthetic input",
		async (_name, method, input, interaction, paused) => {
			const worker = workerFixture();
			await worker.execute({
				method: "cdp",
				params: { chromeTabId: 42, method, params: input },
			});
			const reply = await worker.message(
				interaction as Record<string, unknown>,
			);
			expect(reply.error).toBeUndefined();
			expect(worker.tabs.get(42)?.paused).toBe(paused);
			expect(
				worker.events.some((event) => event.type === "tab_pause_changed"),
			).toBe(paused);
		},
	);

	it("consumes a matching allowance once and expires unused allowances", async () => {
		const worker = workerFixture();
		const command = {
			method: "cdp",
			params: {
				chromeTabId: 42,
				method: "Input.dispatchMouseEvent",
				params: { type: "mousePressed", x: 10, y: 20 },
			},
		};
		await worker.execute(command);
		expect(
			(await worker.message({ kind: "pointer", x: 10, y: 20 })).result,
		).toBe(false);
		expect(
			(await worker.message({ kind: "pointer", x: 10, y: 20 })).result,
		).toBe(true);
		worker.tabs.set(42, { paused: false });
		await worker.execute(command);
		worker.expire();
		expect(
			(await worker.message({ kind: "pointer", x: 10, y: 20 })).result,
		).toBe(true);
	});

	it("serializes commands for the same Chrome tab until the in-flight command settles", async () => {
		const worker = workerFixture();
		let release!: (value: unknown) => void;
		let started!: () => void;
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		worker.sendCommand.mockImplementationOnce(() => {
			started();
			return new Promise((resolve) => {
				release = resolve;
			});
		});
		const command = {
			method: "cdp",
			params: {
				chromeTabId: 42,
				method: "Input.insertText",
				params: { text: "x" },
			},
		};
		const first = worker.execute(command);
		await ready;
		const second = worker.execute(command);
		await Promise.resolve();
		expect(worker.sendCommand).toHaveBeenCalledTimes(1);
		release({});
		await Promise.all([first, second]);
		expect(worker.sendCommand).toHaveBeenCalledTimes(2);
	});

	it("reports each trusted content interaction with its kind and coordinates without throttling", () => {
		const listeners = new Map<
			string,
			(event: Record<string, unknown>) => void
		>();
		const sendMessage = vi.fn().mockResolvedValue({});
		runInNewContext(
			readFileSync(
				new URL(
					"../../packages/browser-extension/content-overlay.js",
					import.meta.url,
				),
				"utf8",
			),
			{
				window: {
					addEventListener: (
						type: string,
						listener: (event: Record<string, unknown>) => void,
					) => listeners.set(type, listener),
				},
				chrome: { runtime: { sendMessage } },
			},
		);
		for (const [type, kind] of [
			["mousedown", "pointer"],
			["keydown", "key"],
			["wheel", "wheel"],
		]) {
			listeners.get(type)!({ isTrusted: true, clientX: 12, clientY: 34 });
			expect(sendMessage).toHaveBeenLastCalledWith({
				type: "USER_INTERACTION_DETECTED",
				kind,
				x: 12,
				y: 34,
			});
		}
		listeners.get("mousedown")!({ isTrusted: false });
		expect(sendMessage).toHaveBeenCalledTimes(3);
	});
});
