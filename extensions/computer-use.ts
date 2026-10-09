import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { reconstructStateFromBranch, shutdownComputerUseSession } from "../src/bridge.ts";
import {
	getLoadedComputerUseConfig,
	loadComputerUseConfig,
} from "../src/config.ts";
import { buildToolDefinitions } from "../src/tools.ts";

function formatConfigStatus(): string {
	const loaded = getLoadedComputerUseConfig();
	return [
		"OMP computer use configuration",
		`browser_use: ${loaded.config.browser_use ? "enabled" : "disabled"}`,
		`headless: ${loaded.config.headless ? "enabled" : "disabled"}`,
		`cursor_overlay: ${loaded.config.cursor_overlay ? "enabled" : "disabled"}`,
		"",
		"Sources:",
		...loaded.sources.map(
			(source) =>
				`- ${source.path}: ${source.error ? `error: ${source.error}` : source.exists ? "loaded" : "not found"}`,
		),
		`- env overrides: ${Object.keys(loaded.env).join(", ") || "none"}`,
	].join("\n");
}

export default function computerUseExtension(pi: ExtensionAPI): void {
	pi.setLabel("OMP Computer Use");

	// Definitions live in src/tools.ts so the MCP frontend registers the exact
	// same surface. This file is glue only.
	for (const tool of buildToolDefinitions(pi.typebox.Type)) {
		pi.registerTool(tool);
	}

	pi.registerCommand("computer-use", {
		description: "Show OMP computer-use configuration",
		handler: async (_args, ctx) => {
			loadComputerUseConfig(ctx.cwd);
			ctx.ui.notify(formatConfigStatus(), "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		loadComputerUseConfig(ctx.cwd);
		reconstructStateFromBranch(ctx);
	});

	pi.on("session_shutdown", async () => {
		await shutdownComputerUseSession();
	});
}
