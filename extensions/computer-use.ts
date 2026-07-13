import type { ExtensionAPI, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import {
	executeAct,
	executeEvaluateBrowser,
	executeExpandUi,
	executeInspectUi,
	executeLaunchBrowser,
	executeFind,
	executeNavigateBrowser,
	executeObserve,
	executeReadText,
	executeSearchUi,
	executeWaitFor,
	reconstructStateFromBranch,
	shutdownComputerUseSession,
} from "../src/bridge.ts";
import {
	getLoadedComputerUseConfig,
	loadComputerUseConfig,
} from "../src/config.ts";

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
	const { Type } = pi.typebox;
	const registerTool = (tool: ToolDefinition): void => pi.registerTool(tool);
	const stateId = Type.String({
		description: "Required state id owning every @e ref used by this operation",
	});
	const root = Type.Optional(
		Type.String({ description: "Root ref from find_roots, e.g. @r1" }),
	);
	const image = Type.Optional(
		Type.Union(
			[Type.Literal("auto"), Type.Literal("always"), Type.Literal("never")],
			{ description: "Image attachment mode, default auto" },
		),
	);
	const refTarget = {
		ref: Type.Optional(Type.String({ description: "Outline ref, e.g. @e12" })),
		x: Type.Optional(Type.Number()),
		y: Type.Optional(Type.Number()),
	};
	const mouseButton = Type.Optional(
		Type.Union([
			Type.Literal("left"),
			Type.Literal("right"),
			Type.Literal("middle"),
		]),
	);
	const uiAction = Type.Union([
		Type.Object({ action: Type.Literal("press"), ...refTarget }),
		Type.Object({
			action: Type.Literal("click"),
			...refTarget,
			button: mouseButton,
			clickCount: Type.Optional(Type.Number()),
		}),
		Type.Object({
			action: Type.Literal("doubleClick"),
			...refTarget,
			button: mouseButton,
		}),
		Type.Object({
			action: Type.Literal("setText"),
			ref: Type.String({ description: "Editable outline ref" }),
			text: Type.String(),
		}),
		Type.Object({
			action: Type.Literal("typeText"),
			ref: Type.Optional(
				Type.String({
					description:
						"Omit after a click to type into the focus established by that click",
				}),
			),
			text: Type.String(),
		}),
		Type.Object({
			action: Type.Literal("keypress"),
			ref: Type.Optional(
				Type.String({
					description: "Omit to send keys to the focused control",
				}),
			),
			keys: Type.Array(Type.String(), { minItems: 1 }),
		}),
		Type.Object({
			action: Type.Literal("scroll"),
			...refTarget,
			scrollX: Type.Optional(Type.Number()),
			scrollY: Type.Optional(Type.Number()),
		}),
		Type.Object({
			action: Type.Literal("drag"),
			path: Type.Array(Type.Object({ x: Type.Number(), y: Type.Number() }), {
				minItems: 2,
			}),
		}),
		Type.Object({ action: Type.Literal("moveMouse"), ...refTarget }),
		Type.Object({ action: Type.Literal("wait"), ms: Type.Number() }),
	]);

	pi.setLabel("OMP Computer Use");

	registerTool({
		name: "find_roots",
		label: "Find Roots",
		description:
			"Find controllable desktop windows, transient surfaces, and managed browser pages. Use this before observe_ui when you do not already have a root ref.",
		approval: "read",
		parameters: Type.Object({
			query: Type.Optional(
				Type.String({
					description:
						"Optional app/title/menu label query; absent or unmatched returns all roots",
				}),
			),
			app: Type.Optional(
				Type.String({ description: "Optional app-name narrowing filter" }),
			),
			bundleId: Type.Optional(
				Type.String({ description: "Optional bundle-id narrowing filter" }),
			),
			pid: Type.Optional(
				Type.Number({ description: "Optional process-id narrowing filter" }),
			),
			kind: Type.Optional(
				Type.Union(
					[
						Type.Literal("window"),
						Type.Literal("menu"),
						Type.Literal("sheet"),
						Type.Literal("popover"),
						Type.Literal("dialog"),
						Type.Literal("browser_page"),
					],
					{ description: "Optional root kind narrowing filter" },
				),
			),
		}),
		execute: executeFind,
	});

	registerTool({
		name: "observe_ui",
		label: "Observe UI",
		description:
			"Capture one immutable UI state and return its stateId, running note, folded outline, and optional image. Follow with search_ui, expand_ui, inspect_ui, or act_ui. Use semantic mode to skip OCR, visual to force OCR, and fused for automatic OCR.",
		approval: "read",
		parameters: Type.Object({
			app: Type.Optional(Type.String({ description: "Optional app name" })),
			windowTitle: Type.Optional(
				Type.String({ description: "Optional exact window title" }),
			),
			root,
			mode: Type.Optional(
				Type.Union(
					[
						Type.Literal("semantic"),
						Type.Literal("visual"),
						Type.Literal("fused"),
					],
					{ description: "Observation mode, default fused" },
				),
			),
			image,
		}),
		execute: executeObserve,
	});

	registerTool({
		name: "search_ui",
		label: "Search UI",
		description:
			"Search the full cached outline by text, role, or action. Use this to find targets omitted from observe_ui's compact view; all returned @e refs belong to the supplied stateId.",
		approval: "read",
		parameters: Type.Object({
			text: Type.Optional(Type.String({ description: "Text/label query" })),
			role: Type.Optional(
				Type.String({ description: "Accessibility role, e.g. button" }),
			),
			action: Type.Optional(
				Type.String({ description: "Action/capability, e.g. press" }),
			),
			limit: Type.Optional(
				Type.Number({ description: "Maximum results, default 12" }),
			),
			stateId,
		}),
		execute: executeSearchUi,
	});

	registerTool({
		name: "expand_ui",
		label: "Expand UI",
		description:
			"Unfold local cached outline context for one @e ref instead of dumping unrelated UI. Truncated or changed regions trigger a scoped live look.",
		approval: "read",
		parameters: Type.Object({
			ref: Type.String({
				description: "Outline ref from observe_ui/search_ui, e.g. @e12",
			}),
			depth: Type.Optional(
				Type.Number({ description: "Outline subtree depth, default 3" }),
			),
			stateId,
		}),
		execute: executeExpandUi,
	});

	registerTool({
		name: "inspect_ui",
		label: "Inspect UI",
		description:
			"Inspect one @e ref with fields, pixel rect, actions, annotations, text boxes, and pictureOnly/truncated state. Use this when target evidence or provenance matters.",
		approval: "read",
		parameters: Type.Object({
			ref: Type.String({
				description: "Outline ref from observe_ui/search_ui, e.g. @e12",
			}),
			includeRaw: Type.Optional(
				Type.Boolean({
					description: "Include the serialized outline node in details",
				}),
			),
			stateId,
		}),
		execute: executeInspectUi,
	});

	registerTool({
		name: "act_ui",
		label: "Act",
		description:
			"Perform one or more checked UI actions from an immutable stateId and return a saved successor state plus a compact trustworthy diff. Batch dependent click/type steps, omit ref from typeText after a click that establishes focus, and prefer expect over a separate polling observation.",
		approval: "write",
		parameters: Type.Object({
			stateId,
			headless: Type.Optional(
				Type.Boolean({
					description:
						"When true, prohibit foreground fallback. When false or omitted, OMP attempts background delivery first and uses foreground only after a side-effect-free foreground_required result.",
				}),
			),
			expect: Type.Optional(
				Type.Object({
					text: Type.Optional(
						Type.String({
							description: "Text that must appear after the transaction",
						}),
					),
					role: Type.Optional(
						Type.String({
							description: "Role that must appear after the transaction",
						}),
					),
					value: Type.Optional(
						Type.String({
							description:
								"Exact normalized value required on the matching element",
						}),
					),
					gone: Type.Optional(
						Type.Boolean({
							description: "When true, the matching text/role must disappear",
						}),
					),
					timeoutMs: Type.Optional(
						Type.Number({
							description: "Maximum postcondition wait, default 10000ms",
						}),
					),
				}),
			),
			actions: Type.Array(uiAction, { minItems: 1, maxItems: 20 }),
			image,
		}),
		execute: executeAct,
	});

	registerTool({
		name: "read_text",
		label: "Read Text",
		description:
			"Read paginated full text from a text-bearing desktop ref or managed browser state when observe_ui or inspect_ui reports truncated text.",
		approval: "read",
		parameters: Type.Object({
			ref: Type.Optional(Type.String()),
			offset: Type.Optional(Type.Number()),
			limit: Type.Optional(Type.Number()),
			stateId,
		}),
		execute: executeReadText,
	});

	registerTool({
		name: "wait_for",
		label: "Wait For",
		description:
			"Wait until desktop UI or managed-browser text or role appears or disappears. Use this for asynchronous changes instead of polling observe_ui.",
		approval: "read",
		parameters: Type.Object({
			text: Type.Optional(Type.String()),
			role: Type.Optional(Type.String()),
			gone: Type.Optional(Type.Boolean()),
			timeoutMs: Type.Optional(Type.Number()),
			stateId,
		}),
		execute: executeWaitFor,
	});

	registerTool({
		name: "launch_browser",
		label: "Launch Browser Context",
		description:
			"Launch an OMP-managed browser and return controllable browser-page roots for the unified UI state model.",
		approval: "write",
		parameters: Type.Object({
			browser: Type.Optional(
				Type.Union([Type.Literal("helium"), Type.Literal("chrome")]),
			),
			url: Type.Optional(Type.String()),
			port: Type.Optional(Type.Number()),
		}),
		execute: executeLaunchBrowser,
	});

	registerTool({
		name: "navigate_browser",
		label: "Navigate Browser",
		description:
			"Navigate a managed browser state directly to a URL or search string instead of typing through the address bar.",
		approval: "write",
		parameters: Type.Object({ url: Type.String(), stateId, image }),
		execute: executeNavigateBrowser,
	});

	registerTool({
		name: "evaluate_browser",
		label: "Evaluate Browser",
		description:
			"Evaluate JavaScript in a managed CDP browser state for targeted inspection when semantic observation is insufficient.",
		approval: "exec",
		parameters: Type.Object({ stateId, expression: Type.String() }),
		execute: executeEvaluateBrowser,
	});

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
