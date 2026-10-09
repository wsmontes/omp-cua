/**
 * CDP over a multiplexing relay endpoint.
 *
 * A relay — such as the one that drives the user's own Chrome through a
 * `chrome.debugger` extension — exposes `/json/version` and `/json/list` plus a
 * single browser-level WebSocket. Page commands are routed by attaching to a
 * target and tagging every message with the returned session id.
 *
 * This module presents that as one `CdpChannel` per page, so a tab connected
 * through a relay is indistinguishable from a directly connected one.
 */

/** The wire a CDP tab speaks over. A direct WebSocket is one implementation. */
export interface CdpChannel {
	readonly readyState: number;
	send(data: string): void;
	close(): void;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: (() => void) | null;
	onerror: (() => void) | null;
}

export interface CdpRelayTarget {
	id: string;
	title: string;
	url: string;
}

const HTTP_TIMEOUT_MS = 2_000;
const SOCKET_OPEN_TIMEOUT_MS = 5_000;

interface PendingCommand {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

/** Canonical record guard: every relay payload is unvalidated wire data. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalizes a relay URL so the HTTP surface can be fetched from it. */
function httpBase(url: string): string {
	return url.replace(/\/+$/, "");
}

export class CdpRelayEndpoint {
	private nextId = 1;
	private readonly pending = new Map<number, PendingCommand>();
	private readonly sessions = new Map<string, (message: unknown) => void>();
	private readonly sessionChannels = new Set<RelaySessionChannel>();
	private socketClosedError: Error | undefined;

	private constructor(
		private readonly ws: WebSocket,
		readonly url: string,
		readonly browser: string,
	) {
		ws.onmessage = (event) => this.dispatch(event.data);
		ws.onclose = () => this.failAll(new Error("Relay connection closed."));
		ws.onerror = () => this.failAll(new Error("Relay connection error."));
	}

	static async connect(url: string): Promise<CdpRelayEndpoint> {
		const base = httpBase(url);
		const response = await fetch(`${base}/json/version`, {
			signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
		});
		if (!response.ok) {
			throw new Error(`Relay at ${base} answered ${response.status}.`);
		}
		const version: unknown = await response.json();
		if (!isRecord(version) || typeof version.webSocketDebuggerUrl !== "string") {
			throw new Error(`Relay at ${base} did not report a webSocketDebuggerUrl.`);
		}

		const socketUrl = version.webSocketDebuggerUrl;
		const ws = new WebSocket(socketUrl);
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`Timed out connecting to relay socket ${socketUrl}`)),
				SOCKET_OPEN_TIMEOUT_MS,
			);
			ws.onopen = () => {
				clearTimeout(timer);
				resolve();
			};
			ws.onerror = () => {
				clearTimeout(timer);
				reject(new Error(`Failed to connect to relay socket ${socketUrl}`));
			};
		});
		const browser = typeof version.Browser === "string" ? version.Browser : "unknown";
		return new CdpRelayEndpoint(ws, base, browser);
	}

	get isOpen(): boolean {
		return this.socketClosedError === undefined && this.ws.readyState === WebSocket.OPEN;
	}

	async listTargets(): Promise<CdpRelayTarget[]> {
		const response = await fetch(`${this.url}/json/list`, {
			signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
		});
		if (!response.ok) throw new Error(`Relay at ${this.url} answered ${response.status} for /json/list.`);
		const payload: unknown = await response.json();
		if (!Array.isArray(payload)) return [];
		const targets: CdpRelayTarget[] = [];
		for (const entry of payload) {
			if (!isRecord(entry)) continue;
			if (entry.type !== "page" || typeof entry.id !== "string") continue;
			targets.push({
				id: entry.id,
				title: typeof entry.title === "string" ? entry.title : "",
				url: typeof entry.url === "string" ? entry.url : "",
			});
		}
		return targets;
	}

	/** Attaches to one target and returns the channel its commands travel on. */
	async openChannel(targetId: string): Promise<CdpChannel> {
		const attached = await this.send("Target.attachToTarget", { targetId, flatten: true });
		if (!isRecord(attached) || typeof attached.sessionId !== "string") {
			throw new Error(`Relay did not return a session id for target ${targetId}.`);
		}
		const sessionId = attached.sessionId;
		const channel = new RelaySessionChannel(this, sessionId);
		this.sessions.set(sessionId, (message) => channel.deliver(message));
		this.sessionChannels.add(channel);
		return channel;
	}

	close(): void {
		for (const channel of [...this.sessionChannels]) channel.close();
		this.sessionChannels.clear();
		this.sessions.clear();
		this.failAll(new Error("Relay connection closed."));
		try {
			this.ws.close();
		} catch {
			// already closed
		}
	}

	/** Sends a browser-level command and resolves with its result. */
	send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
		if (this.socketClosedError) return Promise.reject(this.socketClosedError);
		const id = this.nextId++;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		this.pending.set(id, { resolve, reject });
		try {
			this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
		} catch (error) {
			this.pending.delete(id);
			reject(error instanceof Error ? error : new Error(String(error)));
		}
		return promise;
	}

	detach(sessionId: string): void {
		this.sessions.delete(sessionId);
		if (!this.socketClosedError && this.ws.readyState === WebSocket.OPEN) {
			void this.send("Target.detachFromTarget", { sessionId }).catch(() => undefined);
		}
	}

	/** Routes one socket frame to the command table or to a session channel. */
	private dispatch(raw: unknown): void {
		if (typeof raw !== "string") return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return;
		}
		if (!isRecord(parsed)) return;

		if (typeof parsed.id === "number") {
			const pending = this.pending.get(parsed.id);
			if (!pending) return;
			this.pending.delete(parsed.id);
			const failure = isRecord(parsed.error) && typeof parsed.error.message === "string"
				? parsed.error.message
				: undefined;
			if (failure !== undefined) pending.reject(new Error(`CDP error: ${failure}`));
			else pending.resolve(parsed.result);
			return;
		}

		if (typeof parsed.sessionId === "string") {
			this.sessions.get(parsed.sessionId)?.(parsed);
		}
	}

	private failAll(error: Error): void {
		this.socketClosedError ??= error;
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
		for (const channel of this.sessionChannels) channel.notifyClosed();
	}
}

/** One tab's view of the shared relay socket. */
class RelaySessionChannel implements CdpChannel {
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	private closed = false;

	constructor(
		private readonly endpoint: CdpRelayEndpoint,
		private readonly sessionId: string,
	) {}

	get readyState(): number {
		return !this.closed && this.endpoint.isOpen ? WebSocket.OPEN : WebSocket.CLOSED;
	}

	/** Rewrites one tab command into a session-tagged relay command. */
	send(data: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch {
			return;
		}
		if (!isRecord(parsed) || typeof parsed.method !== "string") return;
		const params = isRecord(parsed.params) ? parsed.params : {};
		void this.endpoint.send(parsed.method, params, this.sessionId).then(
			(result) => this.deliver({ id: parsed.id, result }),
			(error: Error) => this.deliver({ id: parsed.id, error: { message: error.message } }),
		);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.endpoint.detach(this.sessionId);
		this.onclose?.();
	}

	deliver(message: unknown): void {
		if (this.closed) return;
		this.onmessage?.({ data: JSON.stringify(message) });
	}

	/** The shared socket died: report it as this channel's own close. */
	notifyClosed(): void {
		if (this.closed) return;
		this.closed = true;
		this.onerror?.();
		this.onclose?.();
	}
}
