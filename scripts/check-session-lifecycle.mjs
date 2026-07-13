import assert from "node:assert/strict";
import { cdpTabForWindow } from "../src/cdp.ts";
import { shutdownComputerUseSession } from "../src/bridge.ts";

let upgradedSocket;
let resolveSocketClosed;
const socketClosed = new Promise((resolve) => {
	resolveSocketClosed = resolve;
});

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request, bunServer) {
		const url = new URL(request.url);
		if (url.pathname === "/json/list") {
			return Response.json([{
				id: "test-tab",
				type: "page",
				title: "Test Tab",
				url: "about:blank",
				webSocketDebuggerUrl: `ws://127.0.0.1:${bunServer.port}/devtools/page/test-tab`,
			}]);
		}
		if (url.pathname === "/devtools/page/test-tab" && bunServer.upgrade(request)) return;
		return new Response("Not found", { status: 404 });
	},
	websocket: {
		open(socket) {
			upgradedSocket = socket;
		},
		message(socket, message) {
			const request = JSON.parse(String(message));
			socket.send(JSON.stringify({ id: request.id, result: {} }));
		},
		close() {
			resolveSocketClosed();
		},
	},
});

try {
	process.env.PI_COMPUTER_USE_CDP_PORT = String(server.port);

	const tab = await cdpTabForWindow("Test Tab");
	assert(tab?.isOpen, "test CDP tab did not connect");
	assert(upgradedSocket, "test server did not retain the CDP socket");

	await shutdownComputerUseSession();
	await Promise.race([
		socketClosed,
		Bun.sleep(1_500).then(() => {
			throw new Error("CDP socket remained open after session shutdown");
		}),
	]);

	const response = await fetch(`http://127.0.0.1:${server.port}/json/list`);
	assert.equal(response.status, 200, "session shutdown stopped the external browser endpoint");
	assert.equal(process.env.PI_COMPUTER_USE_CDP_PORT, String(server.port), "session shutdown changed the external CDP configuration");
	console.log("PASS session shutdown closes CDP while leaving an external browser running");
} finally {
	delete process.env.PI_COMPUTER_USE_CDP_PORT;
	server.stop(true);
}
