#!/usr/bin/env bun

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent";
import { setupRuntimeExecutable } from "../src/platform/setup-runtime.ts";

const root = path.resolve(import.meta.dir, "..");
const manifest = await Bun.file(path.join(root, "package.json")).json();
assert.deepEqual(manifest.omp?.extensions, ["./extensions"]);
assert.deepEqual(manifest.omp?.skills, ["./skills"]);
assert.equal(await Bun.file(path.join(root, "skills", "omp-computer-use", "SKILL.md")).exists(), true, "declared OMP skill is missing");
const extensionPath = path.join(root, "extensions", "computer-use.ts");
const loaded = await loadExtensions([extensionPath], root);
assert.deepEqual(loaded.errors, [], "OMP failed to load the extension");
assert.equal(loaded.extensions.length, 1, "OMP did not load exactly one extension");

const extension = loaded.extensions[0];
assert.equal(extension.label, "OMP Computer Use");
assert.deepEqual([...extension.tools.keys()], [
	"find_roots",
	"observe_ui",
	"search_ui",
	"expand_ui",
	"inspect_ui",
	"act_ui",
	"read_text",
	"wait_for",
	"launch_browser",
	"navigate_browser",
	"evaluate_browser",
	"app_control",
	"run_script",
	"run_shortcut",
]);

const approvals = Object.fromEntries([...extension.tools].map(([name, registration]) => [name, registration.definition.approval]));
assert.deepEqual(approvals, {
	find_roots: "read",
	observe_ui: "read",
	search_ui: "read",
	expand_ui: "read",
	inspect_ui: "read",
	act_ui: "write",
	read_text: "read",
	wait_for: "read",
	launch_browser: "write",
	navigate_browser: "write",
	evaluate_browser: "exec",
	app_control: "write",
	run_script: "exec",
	run_shortcut: "exec",
});

const actSchema = extension.tools.get("act_ui").definition.parameters;
assert.equal(actSchema.safeParse({ stateId: "state-1", actions: [{ action: "wait", ms: 1 }] }).success, true);
assert.equal(actSchema.safeParse({ stateId: "state-1", actions: [] }).success, false);

const command = extension.commands.get("computer-use");
assert(command, "computer-use command was not registered");
let notification = "";
await command.handler("", {
	cwd: root,
	ui: { notify(message) { notification = message; } },
});
assert.match(notification, /OMP computer use configuration/);
assert.match(notification, new RegExp(`${os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.omp/agent/extensions/omp-computer-use\\.json`));
assert.match(notification, /\.omp\/computer-use\.json/);

const lifecycleContext = {
	cwd: root,
	hasUI: false,
	sessionManager: { getBranch: () => [] },
};
const sessionStart = extension.handlers.get("session_start")?.[0];
assert(sessionStart, "session_start handler was not registered");
assert.equal(sessionStart({ type: "session_start" }, lifecycleContext), undefined, "session_start must not block on interactive setup");
assert.equal(sessionStart({ type: "session_start" }, lifecycleContext), undefined, "repeated session_start must remain synchronous");
const sessionShutdown = extension.handlers.get("session_shutdown")?.[0];
assert(sessionShutdown, "session_shutdown handler was not registered");
await sessionShutdown({ type: "session_shutdown" }, lifecycleContext);

const bunName = process.platform === "win32" ? "bun.exe" : "bun";
assert.equal(setupRuntimeExecutable({ BUN_INSTALL: "/runtime/bun" }), path.join("/runtime/bun", "bin", bunName));
assert.equal(setupRuntimeExecutable({ OMP_COMPUTER_USE_BUN_PATH: "/custom/bun", BUN_INSTALL: "/ignored" }), "/custom/bun");

console.log("OMP extension integration checks passed.");
