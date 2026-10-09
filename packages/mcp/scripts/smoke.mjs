#!/usr/bin/env bun
/**
 * Acceptance harness for the computer-use MCP server.
 *
 * Spawns the real server over stdio and drives it as an MCP client would.
 * Default run is read-only: it never mutates the desktop.
 *
 * `CUA_SMOKE_LIVE=1` adds the write proof: it opens a scratch TextEdit
 * document, writes into it through act_ui with a semantic postcondition,
 * verifies the text landed by re-observing, then quits without saving. That is
 * the only check that changes anything on the machine.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const live = process.env.CUA_SMOKE_LIVE === "1";

const EXPECTED_TOOLS = [
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
	"run_code",
];

const failures = [];
function check(name, condition, detail) {
	if (condition) {
		console.log(`PASS ${name}`);
		return;
	}
	console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	failures.push(name);
}

async function textEditPids() {
	const { stdout } = await execFileAsync("pgrep", [
		"-f",
		"TextEdit.app/Contents/MacOS/TextEdit",
	]).catch(() => ({ stdout: "" }));
	return stdout
		.split("\n")
		.filter(Boolean)
		.map((value) => Number(value));
}

/** Resolves the pid of the instance this test started, never the user's. */
async function waitForNewPid(before, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const fresh = (await textEditPids()).find((pid) => !before.includes(pid));
		if (fresh !== undefined) return fresh;
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	return undefined;
}

const client = new Client({ name: "cua-smoke", version: "0.1.0" }, { capabilities: {} });
await client.connect(
	new StdioClientTransport({
		command: process.execPath,
		args: [path.join(root, "packages/mcp/src/main.ts")],
		cwd: root,
		// The SDK sends a filtered environment by default, which would drop
		// PI_CU_SOCKET_PATH and the computer-use config overrides.
		env: Object.fromEntries(
			Object.entries(process.env).filter((entry) => entry[1] !== undefined),
		),
	}),
);

async function call(name, args) {
	const result = await client.callTool({ name, arguments: args });
	const text = result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	return {
		isError: result.isError === true,
		text,
		image: result.content.find((block) => block.type === "image"),
		details: result.structuredContent ?? {},
	};
}

try {
	// --- surface ---------------------------------------------------------
	const { tools } = await client.listTools();
	check(
		"tool surface",
		JSON.stringify(tools.map((tool) => tool.name)) === JSON.stringify(EXPECTED_TOOLS),
		tools.map((tool) => tool.name).join(", "),
	);
	check(
		"every tool declares an object input schema",
		tools.every((tool) => tool.inputSchema?.type === "object"),
	);
	check(
		"read tools are annotated read-only",
		tools.find((tool) => tool.name === "find_roots")?.annotations?.readOnlyHint === true,
	);
	check(
		"act_ui is annotated destructive",
		tools.find((tool) => tool.name === "act_ui")?.annotations?.destructiveHint === true,
	);

	// --- argument validation --------------------------------------------
	const invalid = await call("act_ui", { actions: [{ action: "wait", ms: 10 }] });
	check(
		"missing required params are rejected before dispatch",
		invalid.isError && /Invalid params/i.test(invalid.text),
		invalid.text.slice(0, 120),
	);
	const unknown = await call("no_such_tool", {});
	check(
		"unknown tool is rejected",
		unknown.isError && /Unknown tool/i.test(unknown.text),
		unknown.text.slice(0, 120),
	);

	// --- read path -------------------------------------------------------
	const roots = await call("find_roots", {});
	const windows = roots.details.windows ?? [];
	check("find_roots returns roots", !roots.isError && windows.length > 0, `${windows.length} roots`);
	const candidateRoots = windows.filter((candidate) => candidate.windowRef).slice(0, 6);
	check("roots carry @r refs", candidateRoots.length > 0, JSON.stringify(windows[0] ?? {}).slice(0, 120));

	let observation;
	let window;
	// System surfaces (Notification Center, Dock) expose roots that refuse
	// observation, so pick the first root that actually yields a state.
	for (const candidate of candidateRoots) {
		const attempt = await call("observe_ui", {
			root: candidate.windowRef,
			image: "always",
		});
		if (typeof attempt.details.capture?.stateId === "string") {
			observation = attempt;
			window = candidate;
			break;
		}
	}
	observation ??= { isError: true, text: "no observable root", details: {}, image: undefined };
	const stateId = observation.details.capture?.stateId;
	check("observe_ui returns a stateId", typeof stateId === "string", `${window?.app ?? "?"} ${String(stateId)}`);
	check(
		"observe_ui returns an image content block",
		observation.image?.type === "image" && observation.image.data.length > 0,
		observation.image ? `${observation.image.mimeType} ${observation.image.data.length}b64` : "none",
	);
	const refMatch = /(@e\d+)\s+AX\w+/.exec(observation.details.renderedOutline ?? "");
	const firstRef = refMatch?.[1];
	check("observe_ui renders an outline with refs", Boolean(firstRef), firstRef ?? "no ref");

	// --- cached queries --------------------------------------------------
	const search = await call("search_ui", { stateId, limit: 5 });
	check("search_ui answers from the cached state", !search.isError && Array.isArray(search.details.matches));

	const inspected = await call("inspect_ui", { stateId, ref: firstRef });
	check("inspect_ui resolves a live ref", !inspected.isError, inspected.text.slice(0, 120));

	const noRef = await call("read_text", { stateId, limit: 200 });
	check("read_text refuses to guess without a ref", noRef.isError, noRef.text.slice(0, 120));

	const textish = await call("search_ui", { stateId, role: "AXStaticText", limit: 3 });
	const textRef = (textish.details.matches ?? []).find((match) => match.ref)?.ref;
	if (textRef) {
		const readText = await call("read_text", { stateId, ref: textRef, limit: 200 });
		check(
			"read_text returns text for a text-bearing ref",
			!readText.isError && readText.text.length > 0,
			readText.text.slice(0, 80),
		);
	} else {
		console.log("SKIP read_text positive path (no static text ref in the observed window)");
	}

	// --- scripting -------------------------------------------------------
	const scripted = await call("run_code", {
		code: `
			const roots = await cua.call("find_roots", {});
			const appNames = [...new Set(roots.windows.map((w) => w.app))];
			log("apps:", appNames.length);
			return { rootCount: roots.windows.length, appCount: appNames.length, tools: cua.tools().length };
		`,
	});
	const scriptedValue = scripted.details.value;
	check(
		"run_code dispatches back into the tool surface",
		!scripted.isError && scriptedValue?.rootCount > 0 && scriptedValue?.tools === 12,
		JSON.stringify(scriptedValue ?? scripted.text).slice(0, 160),
	);
	check(
		"run_code captures log output",
		Array.isArray(scripted.details.logs) && scripted.details.logs.length === 1,
		JSON.stringify(scripted.details.logs ?? []),
	);
	const scriptError = await call("run_code", { code: `throw new Error("boom");` });
	check(
		"run_code surfaces script failures",
		scriptError.isError && /boom/.test(scriptError.text),
		scriptError.text.slice(0, 120),
	);

	// --- live write path -------------------------------------------------
	if (live) {
		const marker = `cua-smoke-${Date.now()}`;
		const existing = await textEditPids();
		if (existing.length > 0) {
			// Never write into, or quit, a TextEdit the user is using.
			console.log(
				`SKIP live write path (TextEdit already running: pid ${existing.join(", ")})`,
			);
		} else {
			await execFileAsync("open", ["-n", "-a", "TextEdit"]);
			const ownPid = await waitForNewPid(existing, 15000);
			try {
				if (!ownPid) throw new Error("scratch TextEdit instance did not start");
				// Only this instance exists, so creating a document cannot touch
				// the user's work.
				await execFileAsync("osascript", [
					"-e",
					'tell application "TextEdit" to make new document',
				]);

				let target;
				for (let attempt = 0; attempt < 20 && !target; attempt += 1) {
					const liveRoots = await call("find_roots", { pid: ownPid });
					target = (liveRoots.details.windows ?? []).find(
						(candidate) => candidate.pid === ownPid,
					);
					if (!target) await new Promise((resolve) => setTimeout(resolve, 500));
				}
				if (!target) throw new Error(`no root for scratch pid ${ownPid}`);

				const scratch = await call("observe_ui", { root: target.windowRef, image: "never" });
				const scratchState = scratch.details.capture?.stateId;
				const areaRef = /(@e\d+)\s+AX(TextArea|TextView)/.exec(
					scratch.details.renderedOutline ?? "",
				)?.[1];
				if (!areaRef) throw new Error("no AXTextArea in the scratch document");

				const write = await call("act_ui", {
					stateId: scratchState,
					actions: [{ action: "setText", ref: areaRef, text: marker }],
					expect: { text: marker, timeoutMs: 5000 },
				});
				check(
					"act_ui setText reports worked",
					write.details.execution?.outcome === "worked",
					write.text.slice(0, 160),
				);

				const after = await call("observe_ui", { root: target.windowRef, image: "never" });
				check(
					"written text is present in the live application",
					(after.details.renderedOutline ?? "").includes(marker),
					marker,
				);
			} catch (error) {
				check("live write path", false, error instanceof Error ? error.message : String(error));
			} finally {
				// Only the instance this test started.
				if (ownPid) process.kill(ownPid, "SIGTERM");
			}
		}
	} else {
		console.log("SKIP live write path (set CUA_SMOKE_LIVE=1 to run it)");
	}
} finally {
	await client.close();
}

console.log(
	failures.length === 0
		? `\nSmoke suite passed${live ? " (including live write path)" : " (read-only)"}.`
		: `\nSmoke suite failed: ${failures.join(", ")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
