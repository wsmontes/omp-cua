/**
 * MCP frontend over the computer-use core.
 *
 * One adapter, no duplicated logic: the tool surface comes from
 * `src/tools.ts`, and every call dispatches into the same executors the omp
 * extension uses. Arguments are validated against the tools' own JSON Schema
 * before dispatch, because MCP input is wire input.
 */
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import Ajv, { type ValidateFunction } from "ajv";
import type { AgentToolResult } from "../../../src/host.ts";
import {
	buildToolDefinitions,
	type ApprovalTier,
	type ComputerUseTool,
} from "../../../src/tools.ts";
import { isRecord } from "./guards.ts";
import { createHostContext } from "./host.ts";
import { jsonSchemaType } from "./json-schema-type.ts";
import { parseRunCodeParams, runCodeTool } from "./run-code.ts";

export interface CuaServerOptions {
	cwd?: string;
	onNotify?: (message: string, level?: "info" | "warning" | "error") => void;
}

export interface CuaServer {
	server: Server;
	/** Executes one tool call through the same path the MCP transport uses. */
	dispatch(
		name: string,
		params: unknown,
		signal?: AbortSignal,
	): Promise<AgentToolResult<unknown>>;
	tools: ComputerUseTool[];
}

/** One tool plus its compiled argument validator. */
interface ToolEntry {
	tool: ComputerUseTool;
	validate?: ValidateFunction;
}

const RUN_CODE_DESCRIPTION = [
	"Run JavaScript inside the computer-use server to script the other tools.",
	"The code is the body of an async function receiving `{ cua, args, log }`.",
	"`cua.call(toolName, params)` resolves to that tool's structured details (the same payload MCP returns as structuredContent); `log(...)` captures output.",
	"Use it for loops, polling, multi-step waits, and assertions that a flat tool list cannot express.",
	"Runs with full process privileges: it is NOT sandboxed.",
].join(" ");

function annotationsFor(approval: ApprovalTier): Tool["annotations"] {
	if (approval === "read") return { readOnlyHint: true };
	if (approval === "write") return { readOnlyHint: false, destructiveHint: true };
	return { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
}

function createRunCodeEntry(
	dispatch: (name: string, params: unknown, signal?: AbortSignal) => Promise<AgentToolResult<unknown>>,
	toolNames: readonly string[],
): ToolEntry {
	const tool: ComputerUseTool = {
		name: "run_code",
		label: "Run Code",
		description: RUN_CODE_DESCRIPTION,
		approval: "exec",
		parameters: jsonSchemaType.Object({
			code: jsonSchemaType.String({
				description: "Async function body. Return a JSON value.",
			}),
			args: jsonSchemaType.Optional({
				description: "Value passed to the script as `args`.",
			}),
			timeoutMs: jsonSchemaType.Optional(
				jsonSchemaType.Number({ description: "Default 30000." }),
			),
		}),
		execute: async (_toolCallId, params, signal) => {
			const parsed = parseRunCodeParams(params);
			const result = await runCodeTool(parsed, {
				call: async (tool, callParams, callSignal) => {
					const outcome = await dispatch(tool, callParams, callSignal ?? signal);
					// Scripts want the structured payload, not the transport envelope.
					if (isRecord(outcome.details)) return outcome.details;
					return {
						text: outcome.content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("\n"),
					};
				},
				tools: toolNames,
				signal,
			});
			const header = result.logs.length > 0 ? `log:\n${result.logs.join("\n")}\n\n` : "";
			return {
				content: [
					{
						type: "text",
						text: `${header}result:\n${JSON.stringify(result.value, null, 2)}`,
					},
				],
				details: { value: result.value, logs: result.logs },
			};
		},
	};
	return { tool };
}

export function createCuaServer(options: CuaServerOptions = {}): CuaServer {
	const host = createHostContext({ cwd: options.cwd, notify: options.onNotify });
	const coreTools = buildToolDefinitions(jsonSchemaType);

	const ajv = new Ajv({ strict: false, allErrors: true });
	const entries: ToolEntry[] = coreTools.map((tool) => ({
		tool,
		// Unchecked cast: our builder emits plain JSON Schema, while ajv's Schema
		// type is a closed recursive interface that an index-signature object
		// cannot structurally satisfy.
		validate: ajv.compile(tool.parameters as unknown as object),
	}));

	const dispatch = async (
		name: string,
		params: unknown,
		signal?: AbortSignal,
	): Promise<AgentToolResult<unknown>> => {
		const entry = entries.find((candidate) => candidate.tool.name === name);
		if (!entry) {
			throw new Error(
				`Unknown tool '${name}'. Available: ${entries.map(({ tool }) => tool.name).join(", ")}`,
			);
		}
		if (entry.validate && !entry.validate(params)) {
			throw new Error(
				`Invalid params for '${name}': ${ajv.errorsText(entry.validate.errors)}`,
			);
		}
		return await entry.tool.execute(randomUUID(), params, signal, undefined, host);
	};

	entries.push(
		createRunCodeEntry(dispatch, [
			...entries.map(({ tool }) => tool.name),
			"run_code",
		]),
	);

	const server = new Server(
		{ name: "cua", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: entries.map(
			({ tool }): Tool => ({
				name: tool.name,
				title: tool.label,
				description: tool.description,
				// Unchecked cast: same reason as the ajv boundary above.
				inputSchema: tool.parameters as unknown as Tool["inputSchema"],
				annotations: annotationsFor(tool.approval),
			}),
		),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		try {
			const result = await dispatch(
				request.params.name,
				request.params.arguments ?? {},
				extra.signal,
			);
			const response: CallToolResult = {
				content: result.content.map((block) =>
					block.type === "image"
						? { type: "image", data: block.data, mimeType: block.mimeType }
						: { type: "text", text: block.text },
				),
			};
			if (isRecord(result.details)) response.structuredContent = result.details;
			if (result.isError) response.isError = true;
			return response;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: message }],
				isError: true,
			};
		}
	});

	return { server, dispatch, tools: entries.map(({ tool }) => tool) };
}

/** Wires the server to stdio. Returns when the transport closes. */
export async function startCuaServer(options: CuaServerOptions = {}): Promise<void> {
	const { server } = createCuaServer(options);
	await server.connect(new StdioServerTransport());
}
