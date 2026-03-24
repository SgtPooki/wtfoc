#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getAvailableSourceTypes } from "@wtfoc/ingest";
import { createStore } from "@wtfoc/store";
import { z } from "zod";
import { createEmbedder } from "./helpers.js";
import { handleIngest } from "./tools/ingest.js";
import { handleQuery } from "./tools/query.js";
import { handleStatus } from "./tools/status.js";
import { handleTrace } from "./tools/trace.js";

// Initialize shared state once — the MCP server is long-lived
const store = createStore({ storage: "local" });
const { embedder, modelName } = createEmbedder();

const server = new McpServer({
	name: "wtfoc",
	version: "0.0.2",
});

// ─── wtfoc_trace ─────────────────────────────────────────────────────────────
server.tool(
	"wtfoc_trace",
	"Trace evidence-backed connections across sources in a wtfoc collection. " +
		"Returns grouped results with semantic and edge-based hops.",
	{
		query: z.string().describe("The natural-language query to trace"),
		collection: z.string().describe("Name of the wtfoc collection to search"),
	},
	async ({ query, collection }) => {
		try {
			const text = await handleTrace(store, embedder, { query, collection });
			return { content: [{ type: "text" as const, text }] };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
		}
	},
);

// ─── wtfoc_query ─────────────────────────────────────────────────────────────
server.tool(
	"wtfoc_query",
	"Semantic search across a wtfoc collection. Returns ranked chunks by similarity.",
	{
		queryText: z.string().describe("The search query text"),
		collection: z.string().describe("Name of the wtfoc collection to search"),
		topK: z.number().optional().describe("Number of results to return (default: 10)"),
	},
	async ({ queryText, collection, topK }) => {
		try {
			const text = await handleQuery(store, embedder, { queryText, collection, topK });
			return { content: [{ type: "text" as const, text }] };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
		}
	},
);

// ─── wtfoc_status ────────────────────────────────────────────────────────────
server.tool(
	"wtfoc_status",
	"Show collection stats: chunk count, segments, embedding model, timestamps.",
	{
		collection: z.string().describe("Name of the wtfoc collection"),
	},
	async ({ collection }) => {
		try {
			const text = await handleStatus(store, { collection });
			return { content: [{ type: "text" as const, text }] };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
		}
	},
);

// ─── wtfoc_ingest ────────────────────────────────────────────────────────────
server.tool(
	"wtfoc_ingest",
	"Ingest content from a source (repo, github, website, discord) into a wtfoc collection.",
	{
		sourceType: z.string().describe("Source adapter type (e.g. repo, github, website, discord)"),
		source: z.string().describe("Source identifier (e.g. path, URL, or owner/repo)"),
		collection: z.string().describe("Name of the wtfoc collection to ingest into"),
		since: z
			.string()
			.optional()
			.describe("Only fetch items newer than duration (e.g. 90d, 24h)"),
	},
	async ({ sourceType, source, collection, since }) => {
		try {
			const text = await handleIngest(store, embedder, modelName, {
				sourceType,
				source,
				collection,
				since,
			});
			return { content: [{ type: "text" as const, text }] };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
		}
	},
);

// ─── wtfoc_list_sources ──────────────────────────────────────────────────────
server.tool(
	"wtfoc_list_sources",
	"List available source adapter types for ingestion.",
	async () => {
		const sources = getAvailableSourceTypes();
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ availableSourceTypes: sources }, null, 2),
				},
			],
		};
	},
);

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
