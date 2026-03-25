#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createStore } from "@wtfoc/store";
import { createEmbedder } from "./helpers.js";
import { createMcpServer } from "./server.js";

// Initialize shared state once — the MCP server is long-lived
const store = createStore({ storage: "local" });
const { embedder, modelName } = createEmbedder();

const server = createMcpServer(store, embedder, modelName);

// ─── Start ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	process.stderr.write("wtfoc MCP server running on stdio\n");
}

main().catch((err) => {
	process.stderr.write(`Fatal: ${err}\n`);
	process.exit(1);
});
