/**
 * CI-only smoke: start the hosted web server in-process and verify `/mcp`
 * negotiates over Streamable HTTP and exposes the read-only toolset.
 *
 * Run with cwd `/app/apps/web` inside the production image.
 */
import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

const port = 3587;
const baseUrl = new URL(`http://127.0.0.1:${port}/mcp`);

function fail(message) {
	console.error(message);
	process.exit(1);
}

async function waitForServer() {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		try {
			const response = await fetch(baseUrl, { method: "GET" });
			if (response.status === 405) {
				return;
			}
		} catch {
			// Server still starting up.
		}

		await delay(1_000);
	}

	fail("timed out waiting for /mcp to become ready");
}

const server = spawn("node", ["server/dist/index.js"], {
	cwd: process.cwd(),
	env: {
		...process.env,
		WTFOC_PORT: String(port),
	},
	stdio: "inherit",
});

server.on("exit", (code, signal) => {
	if (signal === "SIGTERM" || signal === "SIGINT") {
		return;
	}

	fail(`web server exited before smoke test completed (code=${code ?? "null"}, signal=${signal ?? "null"})`);
});

try {
	await waitForServer();

	const client = new Client(
		{
			name: "wtfoc-smoke",
			version: "1.0.0",
		},
		{
			capabilities: {},
		},
	);
	const transport = new StreamableHTTPClientTransport(baseUrl);

	await client.connect(transport);

	const tools = await client.request(
		{
			method: "tools/list",
			params: {},
		},
		ListToolsResultSchema,
	);

	const toolNames = tools.tools.map((tool) => tool.name).sort();
	const expectedTools = [
		"wtfoc_list_collections",
		"wtfoc_query",
		"wtfoc_status",
		"wtfoc_trace",
	];

	for (const expectedTool of expectedTools) {
		if (!toolNames.includes(expectedTool)) {
			fail(`missing MCP tool ${expectedTool}; got ${toolNames.join(", ")}`);
		}
	}

	if (toolNames.includes("wtfoc_ingest") || toolNames.includes("wtfoc_list_sources")) {
		fail(`hosted /mcp exposed write tools unexpectedly: ${toolNames.join(", ")}`);
	}

	const collections = await client.request(
		{
			method: "tools/call",
			params: {
				name: "wtfoc_list_collections",
				arguments: {},
			},
		},
		CallToolResultSchema,
	);

	const textResult = collections.content.find((item) => item.type === "text");
	if (!textResult || textResult.text.trim() !== "[]") {
		fail(`unexpected wtfoc_list_collections response: ${JSON.stringify(collections)}`);
	}

	console.log(`MCP smoke test passed: ${toolNames.join(", ")}`);

	await transport.close();
} finally {
	server.kill("SIGTERM");
	await delay(500);
}
