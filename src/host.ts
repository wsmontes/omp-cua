/**
 * Host seam for the computer-use core.
 *
 * The core (bridge, actions, state, view, outline, platform) runs inside more
 * than one host: the omp extension, the MCP server, and the CLI. Everything a
 * host must supply lives here, so no core module imports the omp package.
 *
 * A host without an interactive UI sets `hasUI: false`; permission flows then
 * throw with instructions instead of prompting.
 */
import os from "node:os";
import path from "node:path";

/** Text or image content block, shape-compatible with the omp tool result contract. */
export interface TextContent {
	type: "text";
	text: string;
	textSignature?: string;
}

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
	detail?: "auto" | "low" | "high" | "original";
}

export interface AgentToolResult<T = any, _TInput = unknown> {
	content: (TextContent | ImageContent)[];
	details?: T;
	/** Marks a non-throwing failure. */
	isError?: boolean;
	/** Marks the result as contextually useless (safe for compaction to elide). */
	useless?: boolean;
}

export type AgentToolUpdateCallback<T = any, TInput = unknown> = (partialResult: AgentToolResult<T, TInput>) => void;

export interface HostSelectOptions {
	signal?: AbortSignal;
}

export interface HostContext {
	/** Working directory used to resolve project-scoped configuration. */
	cwd: string;
	/** False in headless hosts: permission prompts fail with instructions. */
	hasUI: boolean;
	ui: {
		notify(message: string, level?: "info" | "warning" | "error"): void;
		select(prompt: string, options: string[], selectOptions?: HostSelectOptions): Promise<string | undefined>;
	};
	sessionManager: {
		/** Historical tool results used to restore state after a reload; may be empty. */
		getBranch(): Iterable<unknown>;
	};
}

/**
 * Agent-state directory. Defaults to the omp layout so an existing
 * `~/.omp/agent/extensions/omp-computer-use.json` keeps being honoured.
 */
export function getAgentDir(): string {
	const override = (process.env.CUA_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR ?? "").trim();
	return override || path.join(os.homedir(), ".omp", "agent");
}
