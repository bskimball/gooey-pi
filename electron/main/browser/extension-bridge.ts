import { randomBytes } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";

export interface ExtensionCommand {
	id: string;
	method: string;
	params: Record<string, unknown>;
}
export interface ExtensionBridgeOptions {
	port?: number;
	commandTimeoutMs?: number;
}

/** Separate from CapabilityBridge because Chrome extensions send an Origin header. */
export class ExtensionBrowserBridge {
	private server: Server | null = null;
	private stream: ServerResponse | null = null;
	private token = "";
	private heartbeat: NodeJS.Timeout | null = null;
	private readonly pending = new Map<
		string,
		{
			resolve(value: unknown): void;
			reject(error: Error): void;
			timer: NodeJS.Timeout;
		}
	>();
	private readonly events = new Set<(event: Record<string, unknown>) => void>();
	private readonly changes = new Set<() => void>();
	private context: () => Record<string, unknown> = () => ({});
	port: number | null = null;

	constructor(private readonly options: ExtensionBridgeOptions = {}) {}

	setContext(context: () => Record<string, unknown>): void {
		this.context = context;
	}
	onEvent(listener: (event: Record<string, unknown>) => void): () => void {
		this.events.add(listener);
		return () => {
			this.events.delete(listener);
		};
	}
	onChanged(listener: () => void): () => void {
		this.changes.add(listener);
		return () => {
			this.changes.delete(listener);
		};
	}
	isConnected(): boolean {
		return this.stream !== null && !this.stream.destroyed;
	}
	private changed(): void {
		for (const listener of this.changes) listener();
	}

	async start(): Promise<void> {
		if (this.server) return;
		const listen = (port: number) =>
			new Promise<void>((resolve, reject) => {
				const server = createServer((request, response) => {
					void this.handle(request, response);
				});
				server.once("error", reject);
				server.listen(port, "127.0.0.1", () => {
					server.removeListener("error", reject);
					this.server = server;
					const address = server.address();
					this.port =
						typeof address === "object" && address ? address.port : null;
					resolve();
				});
			});
		try {
			await listen(this.options.port ?? 29301);
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!("code" in error) ||
				error.code !== "EADDRINUSE" ||
				this.options.port === 0
			)
				throw error;
			await listen(0);
		}
		this.changed();
	}

	private disconnect(): void {
		this.stream?.end();
		this.stream = null;
		if (this.heartbeat) clearInterval(this.heartbeat);
		this.heartbeat = null;
		for (const request of this.pending.values()) {
			clearTimeout(request.timer);
			request.reject(
				new Error(
					"Browser extension disconnected. Reconnect it and try again.",
				),
			);
		}
		this.pending.clear();
		this.changed();
	}

	async stop(): Promise<void> {
		this.disconnect();
		this.token = "";
		const server = this.server;
		this.server = null;
		this.port = null;
		if (server)
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			});
	}

	call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
		if (!this.isConnected())
			return Promise.reject(new Error("Browser extension is not connected"));
		const id = randomBytes(12).toString("hex");
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Browser extension command timed out: ${method}`));
			}, this.options.commandTimeoutMs ?? 20_000);
			timer.unref?.();
			this.pending.set(id, { resolve, reject, timer });
			this.stream!.write(
				`data: ${JSON.stringify({ id, method, params } satisfies ExtensionCommand)}\n\n`,
			);
		});
	}

	private async body(
		request: IncomingMessage,
	): Promise<Record<string, unknown>> {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of request) {
			size += chunk.length;
			if (size > 8 * 1024 * 1024)
				throw new Error("Extension payload is too large");
			chunks.push(chunk);
		}
		const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error("Expected an object");
		return value as Record<string, unknown>;
	}

	private async handle(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		const origin = request.headers.origin;
		if (origin && !/^chrome-extension:\/\/[a-z]{32}$/.test(origin)) {
			response.writeHead(403).end("Origin is not allowed");
			return;
		}
		if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
		response.setHeader("Vary", "Origin");
		response.setHeader(
			"Access-Control-Allow-Headers",
			"Authorization, Content-Type",
		);
		response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		response.setHeader("Cache-Control", "no-store");
		if (request.method === "OPTIONS") {
			response.writeHead(204).end();
			return;
		}
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const json = (status: number, value: unknown) => {
			response
				.writeHead(status, { "Content-Type": "application/json" })
				.end(JSON.stringify(value));
		};
		try {
			if (
				(url.pathname === "/v1/extension/hello" && request.method === "GET") ||
				(url.pathname === "/v1/extension/connect" &&
					["GET", "POST"].includes(request.method ?? ""))
			) {
				if (!this.token) this.token = randomBytes(32).toString("hex");
				json(200, { token: this.token, ...this.context() });
				return;
			}
			if (
				!this.token ||
				request.headers.authorization !== `Bearer ${this.token}`
			) {
				json(401, { error: "Invalid extension token" });
				return;
			}
			if (url.pathname === "/v1/extension/events" && request.method === "GET") {
				this.disconnect();
				this.stream = response;
				response.writeHead(200, {
					"Content-Type": "text/event-stream",
					Connection: "keep-alive",
				});
				response.write(": connected\n\n");
				this.heartbeat = setInterval(() => {
					response.write(": heartbeat\n\n");
				}, 15_000);
				this.heartbeat.unref?.();
				response.on("close", () => {
					if (this.stream === response) this.disconnect();
				});
				this.changed();
				return;
			}
			if (request.method !== "POST") {
				json(404, { error: "Unknown endpoint" });
				return;
			}
			const body = await this.body(request);
			if (url.pathname === "/v1/extension/result") {
				if (typeof body.id !== "string")
					throw new Error("Command id is required");
				const pending = this.pending.get(body.id);
				if (pending) {
					this.pending.delete(body.id);
					clearTimeout(pending.timer);
					if (typeof body.error === "string")
						pending.reject(new Error(body.error));
					else pending.resolve(body.result);
				}
			} else if (url.pathname === "/v1/extension/event") {
				for (const listener of this.events) listener(body);
			} else {
				json(404, { error: "Unknown endpoint" });
				return;
			}
			json(200, { ok: true });
		} catch (error) {
			json(400, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
