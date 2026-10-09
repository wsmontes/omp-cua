#!/usr/bin/env bun
/**
 * Asserts that both frontends publish byte-identical tool schemas.
 *
 * The omp extension authors schemas with the pi.typebox shim; the MCP server
 * authors them with the local JSON Schema builder. If those drift, an agent
 * sees a different contract depending on which frontend it talks to — and a
 * model that learned the surface from one will send invalid params to the
 * other.
 */
import { Type } from "@oh-my-pi/pi-coding-agent/extensibility/typebox";
import { buildToolDefinitions } from "../../../src/tools.ts";
import { jsonSchemaType } from "../src/json-schema-type.ts";

const ompTools = buildToolDefinitions(Type);
const mcpTools = buildToolDefinitions(jsonSchemaType);
const failures = [];

if (ompTools.length !== mcpTools.length) {
	failures.push(
		`tool count differs: omp=${ompTools.length} mcp=${mcpTools.length}`,
	);
}

for (const [index, ompTool] of ompTools.entries()) {
	const mcpTool = mcpTools[index];
	if (!mcpTool) break;
	if (ompTool.name !== mcpTool.name) {
		failures.push(`tool ${index} name differs: ${ompTool.name} vs ${mcpTool.name}`);
		continue;
	}
	if (ompTool.approval !== mcpTool.approval) {
		failures.push(
			`${ompTool.name}: approval differs (${ompTool.approval} vs ${mcpTool.approval})`,
		);
	}
	if (ompTool.description !== mcpTool.description) {
		failures.push(`${ompTool.name}: description differs`);
	}
	const ompSchema = JSON.stringify(ompTool.parameters);
	const mcpSchema = JSON.stringify(mcpTool.parameters);
	if (ompSchema !== mcpSchema) {
		failures.push(
			`${ompTool.name}: schema differs\n    omp: ${ompSchema}\n    mcp: ${mcpSchema}`,
		);
	}
}
// `run_code` is added by the MCP server on top of the shared definitions, so
// the two lists are expected to be the same length here. smoke.mjs asserts the
// full 12-tool surface over the wire.
if (failures.length > 0) {
	console.error("Schema parity checks failed:\n");
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}
console.log(
	`Schema parity checks passed (${ompTools.length} shared tools, identical JSON Schema).`,
);
