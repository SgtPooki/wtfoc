import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Embedder, ResolvedExtractorConfig } from "@wtfoc/common";
import type { createStore } from "@wtfoc/store";
import { z } from "zod";
import type { CollectionLoader } from "./helpers.js";
import { handleQuery } from "./tools/query.js";
import { handleStatus } from "./tools/status.js";
import { handleTrace } from "./tools/trace.js";

export type { CollectionLoader } from "./helpers.js";

export interface CreateMcpServerOptions {
	/** If true, omit write tools like ingest. Defaults to false. */
	readOnly?: boolean;
	/**
	 * Optional collection loader that MCP tools call instead of loading from
	 * disk. When the web server passes its cached `getCollection()` here, MCP
	 * queries reuse the warm cache and freshness-checking logic.
	 */
	collectionLoader?: CollectionLoader;
	/**
	 * Resolved LLM extractor config from .wtfoc.json / env vars.
	 * When enabled and present with a valid URL + model, the ingest tool registers
	 * an LlmEdgeExtractor in the CompositeEdgeExtractor pipeline.
	 */
	extractorConfig?: ResolvedExtractorConfig;
}

/** Strip filesystem paths from error messages to avoid leaking server internals. */
function sanitizeError(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	// WtfocError with stable codes — safe to pass through
	if ("code" in err && typeof (err as { code: unknown }).code === "string") {
		return err.message;
	}
	// If it looks like an fs error (ENOENT, EACCES, etc.), genericize it
	if (/^(ENOENT|EACCES|EPERM|EISDIR|ENOTDIR)/.test(err.message)) {
		return "Resource not found";
	}
	// Strip POSIX and Windows absolute paths from error messages
	const cleaned = err.message.replace(/\s*'\/[^']*'/g, "").replace(/\s*'[A-Za-z]:\\[^']*'/g, "");
	return cleaned;
}

/**
 * Create a configured McpServer with all wtfoc tools registered.
 *
 * Accepts externally-created store/embedder so callers (stdio entry point,
 * HTTP endpoint, tests) can share infrastructure without duplication.
 */
export function createMcpServer(
	store: ReturnType<typeof createStore>,
	embedder: Embedder,
	modelName: string,
	options?: CreateMcpServerOptions,
): McpServer {
	const collectionLoader = options?.collectionLoader;
	const extractorConfig = options?.extractorConfig;

	const server = new McpServer({
		name: "wtfoc",
		version: "0.0.3",
	});

	// ─── wtfoc_trace ──────────────────────────────────────────────────────
	server.tool(
		"wtfoc_trace",
		"Trace evidence-backed connections across sources in a wtfoc collection. " +
			"Returns grouped results with semantic and edge-based hops.",
		{
			query: z.string().describe("The natural-language query to trace"),
			collection: z.string().describe("Name of the wtfoc collection to search"),
			mode: z
				.enum(["discovery", "analytical"])
				.optional()
				.describe(
					'Trace mode: "discovery" (default) finds connected results, "analytical" adds cross-source insights (convergence, evidence chains, temporal clusters)',
				),
			maxTotal: z.number().int().min(1).max(200).optional().describe("Max total results (default: 15)"),
			maxPerSource: z.number().int().min(1).max(50).optional().describe("Max results per source type (default: 3)"),
			maxHops: z.number().int().min(1).max(10).optional().describe("Max edge hops to follow (default: 3)"),
		},
		async ({ query, collection, mode, maxTotal, maxPerSource, maxHops }) => {
			try {
				const text = await handleTrace(
					store,
					embedder,
					{ query, collection, mode, maxTotal, maxPerSource, maxHops },
					collectionLoader,
				);
				return { content: [{ type: "text" as const, text }] };
			} catch (err) {
				const msg = sanitizeError(err);
				return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
			}
		},
	);

	// ─── wtfoc_query ──────────────────────────────────────────────────────
	server.tool(
		"wtfoc_query",
		"Semantic search across a wtfoc collection. Returns ranked chunks by similarity.",
		{
			queryText: z.string().describe("The search query text"),
			collection: z.string().describe("Name of the wtfoc collection to search"),
			topK: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe("Number of results to return (default: 10, max: 100)"),
		},
		async ({ queryText, collection, topK }) => {
			try {
				const text = await handleQuery(
					store,
					embedder,
					{ queryText, collection, topK },
					collectionLoader,
				);
				return { content: [{ type: "text" as const, text }] };
			} catch (err) {
				const msg = sanitizeError(err);
				return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
			}
		},
	);

	// ─── wtfoc_status ─────────────────────────────────────────────────────
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
				const msg = sanitizeError(err);
				return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
			}
		},
	);

	// ─── wtfoc_list_collections ───────────────────────────────────────────
	server.tool(
		"wtfoc_list_collections",
		"List all wtfoc collections with chunk count, segment count, embedding model, and last updated.",
		async () => {
			try {
				const { handleListSources } = await import("./tools/list-sources.js");
				const text = await handleListSources(store);
				return { content: [{ type: "text" as const, text }] };
			} catch (err) {
				const msg = sanitizeError(err);
				return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
			}
		},
	);

	// ─── Write tools (omitted in readOnly mode) ───────────────────────────
	if (!options?.readOnly) {
		// ─── wtfoc_ingest ─────────────────────────────────────────────────
		server.tool(
			"wtfoc_ingest",
			"Ingest content from a source (repo, github, website, discord) into a wtfoc collection.",
			{
				sourceType: z
					.string()
					.describe("Source adapter type (e.g. repo, github, website, discord)"),
				source: z.string().describe("Source identifier (e.g. path, URL, or owner/repo)"),
				collection: z.string().describe("Name of the wtfoc collection to ingest into"),
				since: z
					.string()
					.optional()
					.describe("Only fetch items newer than duration (e.g. 90d, 24h)"),
			},
			async ({ sourceType, source, collection, since }) => {
				try {
					const { handleIngest } = await import("./tools/ingest.js");
					const text = await handleIngest(store, embedder, modelName, {
						sourceType,
						source,
						collection,
						since,
						extractorConfig,
					});
					return { content: [{ type: "text" as const, text }] };
				} catch (err) {
					const msg = sanitizeError(err);
					return {
						content: [{ type: "text" as const, text: `Error: ${msg}` }],
						isError: true,
					};
				}
			},
		);

		// ─── wtfoc_list_sources ───────────────────────────────────────────
		server.tool(
			"wtfoc_list_sources",
			"List available source adapter types for ingestion.",
			async () => {
				const { getAvailableSourceTypes } = await import("@wtfoc/ingest");
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
	}

	return server;
}
