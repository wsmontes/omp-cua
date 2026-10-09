#!/usr/bin/env bun
/**
 * Entry point for the computer-use MCP server.
 *
 * Default: stdio transport (what MCP clients spawn).
 * `--list`: print the tool surface and its JSON Schema, then exit. Used by the
 * smoke tests and by `cua doctor` to compare frontends without a client.
 */
import { createCuaServer, startCuaServer } from "./server.ts";

if (process.argv.slice(2).includes("--list")) {
	const { tools } = createCuaServer();
	for (const tool of tools) {
		process.stdout.write(`${tool.name}\t[${tool.approval}]\n`);
		process.stdout.write(`${JSON.stringify(tool.parameters)}\n`);
	}
	process.exit(0);
}

await startCuaServer();
