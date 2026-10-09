/**
 * `run_code`: the ergonomics keeper of the MCP surface.
 *
 * A flat tool list cannot express loops, polling, multi-step waits, or
 * assertions over live state handles. Without this tool the omp prelude stays
 * strictly better than the MCP frontend, and the MCP becomes decoration.
 *
 * The submitted code is the body of an async function receiving
 * `{ cua, args, log }`, where `cua.call(toolName, params)` dispatches back
 * through the same validated tool path. It runs with full process privileges:
 * it is NOT sandboxed, and hosts must treat the approval tier as `exec`.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getAgentDir } from "../../../src/host.ts";

export type ToolDispatcher = (
	tool: string,
	params: unknown,
	signal?: AbortSignal,
) => Promise<unknown>;

export interface RunCodeDependencies {
	/** Dispatches a validated call back into the tool surface. */
	call: ToolDispatcher;
	/** Tool names exposed to the script, so it can discover the surface. */
	tools: readonly string[];
	signal?: AbortSignal;
}

export interface RunCodeResult {
	value: unknown;
	logs: string[];
}

export interface RunCodeParams {
	code: string;
	args?: unknown;
	timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Parses wire input into a named contract instead of scattering `typeof` checks. */
export function parseRunCodeParams(value: unknown): RunCodeParams {
	if (typeof value !== "object" || value === null) {
		throw new Error("run_code requires an object with a `code` string");
	}
	if (!("code" in value) || typeof value.code !== "string") {
		throw new Error("run_code requires a `code` string");
	}
	const timeoutMs =
		"timeoutMs" in value &&
		typeof value.timeoutMs === "number" &&
		value.timeoutMs > 0
			? value.timeoutMs
			: DEFAULT_TIMEOUT_MS;
	const args = "args" in value ? value.args : undefined;
	return { code: value.code, args, timeoutMs };
}

interface RunModule {
	run(input: {
		cua: unknown;
		args: unknown;
		log: (...values: unknown[]) => void;
	}): Promise<unknown>;
}

const RUN_DIR = path.join(getAgentDir(), "cua", "run");

/** Type guard: the loaded module is authored by a client, not by us. */
function isRunModule(value: unknown): value is RunModule {
	return (
		typeof value === "object" &&
		value !== null &&
		"run" in value &&
		typeof value.run === "function"
	);
}

function describeValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "bigint") return `${value.toString()}n`;
	if (value instanceof Error) return value.stack ?? value.message;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

export async function runCodeTool(
	request: RunCodeParams,
	dependencies: RunCodeDependencies,
): Promise<RunCodeResult> {
	const logs: string[] = [];
	const log = (...values: unknown[]): void => {
		logs.push(values.map(describeValue).join(" "));
	};

	// Aborting this controller aborts both the awaited script and any tool call
	// the script has in flight.
	const controller = new AbortController();
	const abortSignals = [controller.signal, dependencies.signal].filter(
		(signal): signal is AbortSignal => signal !== undefined,
	);
	const dispatchSignal = AbortSignal.any(abortSignals);

	const cua = {
		tools: (): string[] => [...dependencies.tools],
		call: async (tool: unknown, params?: unknown): Promise<unknown> => {
			if (typeof tool !== "string") {
				throw new Error("cua.call expects a tool name string");
			}
			return await dependencies.call(tool, params ?? {}, dispatchSignal);
		},
	};

	await mkdir(RUN_DIR, { recursive: true });
	const modulePath = path.join(RUN_DIR, `${randomUUID()}.mjs`);
	await writeFile(
		modulePath,
		`export async function run({ cua, args, log }) {\n${request.code}\n}\n`,
		"utf8",
	);

	const timer = setTimeout(
		() => controller.abort(),
		request.timeoutMs,
	);

	try {
		// Static import is impossible: the module is authored per call and its
		// path does not exist until the line above.
		const loaded: unknown = await import(
			`${pathToFileURL(modulePath).href}?t=${Date.now()}`
		);
		if (!isRunModule(loaded)) {
			throw new Error("run_code module did not export a run() function");
		}

		const timedOut = new Promise<never>((_resolve, reject) => {
			controller.signal.addEventListener(
				"abort",
				() => reject(new Error(`run_code stopped after ${request.timeoutMs}ms`)),
				{ once: true },
			);
		});

		const value = await Promise.race([
			loaded.run({ cua, args: request.args ?? null, log }),
			timedOut,
		]);

		let serializable: unknown = value ?? null;
		try {
			serializable = JSON.parse(JSON.stringify(serializable)) as unknown;
		} catch {
			serializable = describeValue(value);
		}
		return { value: serializable, logs };
	} finally {
		clearTimeout(timer);
		await rm(modulePath, { force: true }).catch(() => undefined);
	}
}
