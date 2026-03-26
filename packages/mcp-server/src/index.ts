#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ResolvedEmbedderConfig, ResolvedExtractorConfig } from "@wtfoc/common";
import { loadProjectConfig, resolveConfig } from "@wtfoc/config";
import { createStore } from "@wtfoc/store";
import { createEmbedder } from "./helpers.js";
import { createMcpServer } from "./server.js";

// Load .wtfoc.json config (file + env vars, no CLI flags for MCP)
let resolvedEmbedder: ResolvedEmbedderConfig | undefined;
let resolvedExtractor: ResolvedExtractorConfig | undefined;
try {
	const fileConfig = loadProjectConfig();
	const resolved = resolveConfig({ file: fileConfig });
	resolvedEmbedder = resolved.embedder;
	resolvedExtractor = resolved.extractor;
} catch (err) {
	process.stderr.write(
		`Warning: failed to load .wtfoc.json: ${err instanceof Error ? err.message : err}\n`,
	);
}

// Initialize shared state once — the MCP server is long-lived
const store = createStore({ storage: "local" });
const { embedder, modelName } = createEmbedder(resolvedEmbedder);

const server = createMcpServer(store, embedder, modelName, {
	extractorConfig: resolvedExtractor,
});

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
