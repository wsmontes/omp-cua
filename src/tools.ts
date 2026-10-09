/**
 * Tool definitions for the computer-use surface.
 *
 * The schemas are built from an injected `Type` builder so one definition
 * feeds every host: the omp extension (pi.typebox shim), the MCP server, and
 * the CLI. Hosts must not copy these definitions — drift between frontends is
 * the failure mode this module exists to prevent.
 *
 * `Type` is typed structurally: the omp shim returns `ArkSchema`, which has an
 * index signature and is therefore assignable to `JsonSchema`.
 */
import {
	executeAct,
	executeAppControl,
	executeBrowserAttach,
	executeEvaluateBrowser,
	executeExpandUi,
	executeFind,
	executeInspectUi,
	executeLaunchBrowser,
	executeNavigateBrowser,
	executeObserve,
	executeReadText,
	executeRunScript,
	executeRunShortcut,
	executeSearchUi,
	executeWaitFor,
} from "./bridge.ts";
import type { AgentToolResult, AgentToolUpdateCallback, HostContext } from "./host.ts";

export type ApprovalTier = "read" | "write" | "exec";

/** JSON-Schema-shaped object as produced by any supported `Type` builder. */
export type JsonSchema = Record<string, unknown>;

/** Options bag shared by the builders used below. */
export interface SchemaOptions {
	description?: string;
	minItems?: number;
	maxItems?: number;
}

/** Subset of the TypeBox-style `Type` API used by the schemas below. */
export interface SchemaBuilder<S extends JsonSchema = JsonSchema> {
	String(options?: SchemaOptions): S;
	Number(options?: SchemaOptions): S;
	Boolean(options?: SchemaOptions): S;
	Literal(value: string): S;
	Union(schemas: readonly S[], options?: SchemaOptions): S;
	Array(schema: S, options?: SchemaOptions): S;
	Object(properties: Record<string, S>, options?: SchemaOptions): S;
	Optional(schema: S): S;
}

export interface ComputerUseTool<S extends JsonSchema = JsonSchema> {
	name: string;
	label: string;
	description: string;
	approval: ApprovalTier;
	/** JSON Schema for the tool parameters. */
	parameters: S;
	/**
	 * Params arrive as unvalidated wire input. Hosts are responsible for
	 * checking them against `parameters` before dispatch.
	 */
	execute(
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<unknown> | undefined,
		ctx: HostContext,
	): Promise<AgentToolResult<unknown>>;
}

export function buildToolDefinitions<S extends JsonSchema = JsonSchema>(
	Type: SchemaBuilder<S>,
): ComputerUseTool<S>[] {
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

	return [
		{
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
		},
		{
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
		},
		{
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
		},
		{
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
		},
		{
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
		},
		{
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
		},
		{
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
		},
		{
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
		},
		{
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
		},
		{
			name: "browser_attach",
			label: "Attach Real Browser",
			description:
				"Attach to a running browser through a multiplexing CDP relay and expose its pages as browser_page roots, which observe_ui, act_ui, navigate_browser, and evaluate_browser then drive. This is how the user's own signed-in browser becomes controllable: the relay runs an extension inside it rather than launching a separate, empty profile. The endpoint is verified before success is reported, and find_roots lists the attached pages.",
			approval: "write",
			parameters: Type.Object({
				url: Type.Optional(
					Type.String({
						description:
							"Relay HTTP endpoint, e.g. http://127.0.0.1:9224 (the default)",
					}),
				),
			}),
			execute: executeBrowserAttach,
		},
		{
			name: "navigate_browser",
			label: "Navigate Browser",
			description:
				"Navigate a managed browser state directly to a URL or search string instead of typing through the address bar.",
			approval: "write",
			parameters: Type.Object({ url: Type.String(), stateId, image }),
			execute: executeNavigateBrowser,
		},
		{
			name: "evaluate_browser",
			label: "Evaluate Browser",
			description:
				"Evaluate JavaScript in a managed CDP browser state for targeted inspection when semantic observation is insufficient.",
			approval: "exec",
			parameters: Type.Object({ stateId, expression: Type.String() }),
			execute: executeEvaluateBrowser,
		},
		{
			name: "app_control",
			label: "App Control",
			description:
				"Launch, activate, or quit an application by name, bundle id, or path. Prefer this over driving the UI to start a program. launch opens the app without stealing focus; activate brings it forward; quit asks the app to close through AppleScript so it can run its own save flow, while force terminates the process and can lose unsaved work. macOS only.",
			approval: "write",
			parameters: Type.Object({
				action: Type.Union([
					Type.Literal("launch"),
					Type.Literal("activate"),
					Type.Literal("quit"),
				]),
				app: Type.Optional(
					Type.String({ description: "Application name, e.g. TextEdit" }),
				),
				bundleId: Type.Optional(
					Type.String({ description: "Bundle id, e.g. com.apple.TextEdit" }),
				),
				path: Type.Optional(
					Type.String({ description: "Path to a bundle or executable" }),
				),
				args: Type.Optional(
					Type.Array(Type.String(), {
						description: "Arguments passed to the launched application",
					}),
				),
				newInstance: Type.Optional(
					Type.Boolean({ description: "Start a second instance instead of reusing one" }),
				),
				force: Type.Optional(
					Type.Boolean({
						description: "quit only: send SIGTERM instead of asking the app to quit",
					}),
				),
			}),
			execute: executeAppControl,
		},
		{
			name: "run_script",
			label: "Run Script",
			description:
				"Run AppleScript or JavaScript for Automation with osascript and return stdout, stderr, and exit code. This is the highest-leverage route for scriptable macOS applications (Finder, Mail, Music, Terminal, System Events) and for what the accessibility route cannot express; prefer it over pixel automation whenever a scripting dictionary exists. Automation access is granted per target application. macOS only.",
			approval: "exec",
			parameters: Type.Object({
				source: Type.String({ description: "Script source, passed to osascript -e" }),
				language: Type.Optional(
					Type.Union(
						[Type.Literal("applescript"), Type.Literal("javascript")],
						{ description: "Default applescript; javascript selects JXA" },
					),
				),
				timeoutMs: Type.Optional(
					Type.Number({ description: "Default 30000" }),
				),
			}),
			execute: executeRunScript,
		},
		{
			name: "run_shortcut",
			label: "Run Shortcut",
			description:
				"Run a shortcut from the user's Shortcuts library, optionally feeding input on stdin, or list the available shortcut names with action list. Shortcuts can perform arbitrary actions including shell scripts, so treat the result as code execution. macOS only.",
			approval: "exec",
			parameters: Type.Object({
				action: Type.Optional(
					Type.Union([Type.Literal("run"), Type.Literal("list")], {
						description: "Default run",
					}),
				),
				name: Type.Optional(
					Type.String({ description: "Shortcut name; required unless action is list" }),
				),
				input: Type.Optional(
					Type.String({ description: "Text passed to the shortcut on stdin" }),
				),
				timeoutMs: Type.Optional(
					Type.Number({ description: "Default 60000" }),
				),
			}),
			execute: executeRunShortcut,
		},
	];
}
