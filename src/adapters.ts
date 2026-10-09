/**
 * System adapters: the routes that beat pixels.
 *
 * The router's preference order is API > URL scheme/CLI > AppleScript/JXA >
 * accessibility > pixels+OCR. These adapters cover the middle tiers on macOS:
 * LaunchServices for app lifecycle, osascript for scriptable applications, and
 * the Shortcuts CLI for the user's library.
 *
 * They are plain process invocations, so they need no native helper change and
 * no cross-platform parity work. Windows equivalents belong behind the same
 * shape when they are implemented.
 */
import { spawn } from "node:child_process";

/** Cap on captured output so a chatty script cannot flood the agent's context. */
const MAX_OUTPUT_CHARS = 200_000;

export interface ProcessResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
}

export interface RunOptions {
	timeoutMs?: number;
	/** Written to the child's stdin, then closed. */
	input?: string;
}

function truncate(value: string): string {
	if (value.length <= MAX_OUTPUT_CHARS) return value;
	return `${value.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated ${value.length - MAX_OUTPUT_CHARS} chars]`;
}

function assertMacos(): void {
	if (process.platform !== "darwin") {
		throw new Error(`System adapters are implemented for macOS only; this host is ${process.platform}.`);
	}
}

/**
 * Runs a process and always resolves with its exit status.
 *
 * Deliberately not `runProcess` from the helper transport: that one rejects on
 * a non-zero exit, while an adapter must report the failure to the agent as
 * data.
 */
function run(command: string, args: string[], options: RunOptions = {}): Promise<ProcessResult> {
	const timeoutMs = options.timeoutMs ?? 30_000;
	const { promise, resolve, reject } = Promise.withResolvers<ProcessResult>();
	const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGKILL");
	}, timeoutMs);

	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString("utf8");
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString("utf8");
	});
	child.on("error", (error) => {
		clearTimeout(timer);
		reject(error);
	});
	child.on("close", (code) => {
		clearTimeout(timer);
		resolve({
			stdout: truncate(stdout),
			stderr: truncate(stderr),
			exitCode: code ?? -1,
			timedOut,
		});
	});

	if (options.input !== undefined) child.stdin.end(options.input);
	else child.stdin.end();
	return promise;
}

export interface AppControlRequest {
	action: "launch" | "activate" | "quit";
	/** Application name, as LaunchServices resolves it (e.g. "TextEdit"). */
	app?: string;
	/** Bundle identifier, the most precise selector (e.g. "com.apple.TextEdit"). */
	bundleId?: string;
	/** Path to a bundle or executable, when the app is not installed normally. */
	path?: string;
	/** Arguments passed to the launched application. */
	args?: string[];
	/** Launch a second instance instead of reusing a running one. */
	newInstance?: boolean;
}

export interface AppControlResponse {
	action: AppControlRequest["action"];
	target: string;
	stdout: string;
	stderr: string;
	exitCode: number;
}

function selectorArgs(request: AppControlRequest): string[] {
	if (request.path) return [request.path];
	if (request.bundleId) return ["-b", request.bundleId];
	if (request.app) return ["-a", request.app];
	throw new Error("app_control requires one of app, bundleId, or path.");
}

function describeTarget(request: AppControlRequest): string {
	return request.path ?? request.bundleId ?? request.app ?? "(unresolved)";
}

export async function appControl(
	request: AppControlRequest,
	options: RunOptions = {},
): Promise<AppControlResponse> {
	assertMacos();
	const args: string[] = [];
	if (request.action === "quit") {
		const target = describeTarget(request);
		// AppleScript quit lets the application run its own save/confirm flow;
		// a signal-based force quit is handled by the caller, which can resolve
		// the pid through the platform backend.
		const result = await run(
			"osascript",
			["-e", `tell application ${JSON.stringify(target)} to quit`],
			{ timeoutMs: options.timeoutMs ?? 15_000 },
		);
		return { action: "quit", target, ...result };
	}

	if (request.newInstance) args.push("-n");
	// `-g` keeps a launch from stealing focus; activation is exactly the case
	// where the user does want it brought forward.
	if (request.action === "launch") args.push("-g");
	args.push(...selectorArgs(request));
	if (request.action === "launch" && request.args && request.args.length > 0) {
		args.push("--args", ...request.args);
	}

	const result = await run("open", args, { timeoutMs: options.timeoutMs ?? 15_000 });
	return { action: request.action, target: describeTarget(request), ...result };
}

export interface ScriptRequest {
	/** AppleScript by default; "javascript" is JXA. */
	language?: "applescript" | "javascript";
	source: string;
	timeoutMs?: number;
}

export interface ScriptResponse {
	language: "applescript" | "javascript";
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
}

export async function runScript(request: ScriptRequest): Promise<ScriptResponse> {
	assertMacos();
	const language = request.language ?? "applescript";
	const result = await run(
		"osascript",
		["-l", language === "javascript" ? "JavaScript" : "AppleScript", "-e", request.source],
		{ timeoutMs: request.timeoutMs ?? 30_000 },
	);
	return { language, ...result };
}

export interface ShortcutRequest {
	action?: "run" | "list";
	name?: string;
	/** Passed to the shortcut on stdin, which is how `shortcuts run` reads input. */
	input?: string;
	timeoutMs?: number;
}

export interface ShortcutResponse {
	action: "run" | "list";
	name?: string;
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
}

export async function runShortcut(request: ShortcutRequest): Promise<ShortcutResponse> {
	assertMacos();
	const action = request.action ?? "run";
	if (action === "list") {
		const result = await run("shortcuts", ["list"], { timeoutMs: request.timeoutMs ?? 15_000 });
		return { action, ...result };
	}
	if (!request.name?.trim()) {
		throw new Error("run_shortcut requires a shortcut name, or action \"list\".");
	}
	const args = ["run", request.name.trim()];
	const options: RunOptions = { timeoutMs: request.timeoutMs ?? 60_000 };
	if (request.input !== undefined) {
		args.push("--input-path", "-");
		options.input = request.input;
	}
	const result = await run("shortcuts", args, options);
	return { action, name: request.name.trim(), ...result };
}
