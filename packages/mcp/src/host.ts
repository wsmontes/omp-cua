/**
 * Host context for a process with no interactive UI (an MCP server, a CLI).
 *
 * `hasUI: false` makes the core's permission flow fail with instructions
 * instead of prompting — the client is expected to surface those instructions
 * to the user. `select` therefore never returns.
 */
import type { HostContext } from "../../../src/host.ts";

export interface HostContextOptions {
	cwd?: string;
	/** Sink for host notices. Defaults to stderr, which is safe on stdio transport. */
	notify?: (message: string, level?: "info" | "warning" | "error") => void;
}

export function createHostContext(options: HostContextOptions = {}): HostContext {
	const notify =
		options.notify ??
		((message: string) => {
			process.stderr.write(`[cua] ${message}\n`);
		});

	return {
		cwd: options.cwd ?? process.cwd(),
		hasUI: false,
		ui: {
			notify,
			select: async (): Promise<string | undefined> => {
				throw new Error(
					"This host has no interactive UI. Grant the missing macOS permissions to pi-computer-use.app in System Settings → Privacy & Security, then retry.",
				);
			},
		},
		sessionManager: {
			// No session history: state restoration is a no-op for this host.
			getBranch: () => [],
		},
	};
}
