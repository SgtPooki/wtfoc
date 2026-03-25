import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type {
	CollectionHead,
	Embedder,
	Segment,
	VectorEntry,
	VectorIndex,
} from "@wtfoc/common";
import { createMcpServer } from "@wtfoc/mcp-server/server";
import {
	analyzeEdgeResolution,
	buildSourceIndex,
	InMemoryVectorIndex,
	query,
	trace,
} from "@wtfoc/search";
import { createStore, resolveCollectionByCid } from "@wtfoc/store";
import { mountCollection } from "@wtfoc/search";

// ─── Configuration ──────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env["WTFOC_PORT"] ?? "3577");
const WEB_DIR = process.env["WTFOC_WEB_DIR"] ?? join(__dirname, "..", "dist");
const DATA_DIR = process.env["WTFOC_DATA_DIR"];
const MANIFEST_DIR = process.env["WTFOC_MANIFEST_DIR"];

// ─── Types ──────────────────────────────────────────────────────────────────

interface LoadedCollection {
	manifest: CollectionHead;
	segments: Segment[];
	vectorIndex: VectorIndex;
	loadedAt: number;
}

interface CachedFile {
	content: Buffer;
	contentType: string;
}

// ─── Embedder ───────────────────────────────────────────────────────────────

async function createEmbedderFromEnv(): Promise<Embedder> {
	const url = process.env["WTFOC_EMBEDDER_URL"];
	const model = process.env["WTFOC_EMBEDDER_MODEL"];
	const apiKey =
		process.env["WTFOC_EMBEDDER_KEY"] ?? process.env["WTFOC_OPENAI_API_KEY"] ?? "no-key";

	if (url && model) {
		const { OpenAIEmbedder } = await import("@wtfoc/search");
		return new OpenAIEmbedder({ apiKey, baseUrl: url, model });
	}

	// Try local transformers.js embedder (optional dep, may not be installed)
	try {
		const { TransformersEmbedder } = await import("@wtfoc/search");
		if (TransformersEmbedder) {
			console.error("ℹ️  No WTFOC_EMBEDDER_URL set, using local MiniLM embedder");
			return new TransformersEmbedder();
		}
	} catch {
		// transformers.js not available
	}

	console.error("Error: No embedder configured.");
	console.error("  Set WTFOC_EMBEDDER_URL and WTFOC_EMBEDDER_MODEL environment variables.");
	console.error("  Example: WTFOC_EMBEDDER_URL=http://ollama:11434/v1 WTFOC_EMBEDDER_MODEL=nomic-embed-text");
	process.exit(1);
}

// ─── Store ──────────────────────────────────────────────────────────────────

function getStore() {
	return createStore({
		storage: "local",
		...(DATA_DIR ? { dataDir: DATA_DIR } : {}),
		...(MANIFEST_DIR ? { manifestDir: MANIFEST_DIR } : {}),
	});
}

// ─── Collection Cache (lazy-loading) ────────────────────────────────────────

const collectionCache = new Map<string, LoadedCollection>();
let store: ReturnType<typeof createStore>;
let embedder: Embedder;

async function getCollection(name: string): Promise<LoadedCollection | null> {
	const cached = collectionCache.get(name);
	if (cached) return cached;

	const head = await store.manifests.getHead(name);
	if (!head) return null;

	console.error(`⏳ Loading collection "${name}"...`);
	const vectorIndex = new InMemoryVectorIndex();
	const segments: Segment[] = [];

	for (const segSummary of head.manifest.segments) {
		const segBytes = await store.storage.download(segSummary.id);
		const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
		segments.push(segment);

		const entries: VectorEntry[] = segment.chunks.map((c) => ({
			id: c.id,
			vector: new Float32Array(c.embedding),
			storageId: c.storageId || segSummary.id,
			metadata: {
				sourceType: c.sourceType,
				source: c.source,
				sourceUrl: c.sourceUrl ?? "",
				content: c.content,
				...c.metadata,
			},
		}));
		await vectorIndex.add(entries);
	}

	const loaded: LoadedCollection = {
		manifest: head.manifest,
		segments,
		vectorIndex,
		loadedAt: Date.now(),
	};

	collectionCache.set(name, loaded);
	console.error(
		`✅ Loaded "${name}": ${head.manifest.totalChunks} chunks, ${head.manifest.segments.length} segments`,
	);
	return loaded;
}

// ─── CID Collection Loading ─────────────────────────────────────────────────

const cidInflight = new Map<string, Promise<LoadedCollection>>();

async function getCollectionByCid(cid: string): Promise<LoadedCollection> {
	const cached = collectionCache.get(`cid:${cid}`);
	if (cached) return cached;

	// Deduplicate in-flight requests for the same CID
	const existing = cidInflight.get(cid);
	if (existing) return existing;

	const promise = (async () => {
		console.error(`⏳ Fetching collection from CID ${cid.slice(0, 16)}...`);
		const { manifest, storage } = await resolveCollectionByCid(cid);

		const vectorIndex = new InMemoryVectorIndex();
		const mounted = await mountCollection(manifest, storage, vectorIndex);

		const loaded: LoadedCollection = {
			manifest,
			segments: mounted.segments,
			vectorIndex: mounted.vectorIndex,
			loadedAt: Date.now(),
		};

		collectionCache.set(`cid:${cid}`, loaded);
		console.error(
			`✅ Loaded CID ${cid.slice(0, 16)}...: ${manifest.totalChunks} chunks, ${manifest.segments.length} segments`,
		);
		return loaded;
	})();

	cidInflight.set(cid, promise);
	try {
		return await promise;
	} finally {
		cidInflight.delete(cid);
	}
}

// ─── Static File Serving ────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

function loadStaticFiles(dir: string): Map<string, CachedFile> {
	const cache = new Map<string, CachedFile>();
	if (!existsSync(dir)) return cache;

	function walk(currentDir: string) {
		for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
			const fullPath = join(currentDir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
			} else {
				const urlPath = `/${relative(dir, fullPath)}`;
				const ext = extname(entry.name);
				cache.set(urlPath, {
					content: readFileSync(fullPath),
					contentType: MIME_TYPES[ext] ?? "application/octet-stream",
				});
			}
		}
	}

	walk(dir);
	return cache;
}

// ─── HTTP Helpers ───────────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, data: unknown, status = 200) {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
	});
	res.end(JSON.stringify(data));
}

function parseQuery(url: string): URLSearchParams {
	const idx = url.indexOf("?");
	return idx === -1 ? new URLSearchParams() : new URLSearchParams(url.slice(idx + 1));
}

// ─── Server ─────────────────────────────────────────────────────────────────

async function main() {
	// Initialize store and embedder
	store = getStore();
	embedder = await createEmbedderFromEnv();

	// Cache static files at startup
	const staticFiles = loadStaticFiles(WEB_DIR);
	if (staticFiles.size > 0) {
		console.error(`📦 Web app cached: ${staticFiles.size} files from ${WEB_DIR}`);
	} else {
		console.error(`⚠️  No web app found at ${WEB_DIR} — API-only mode`);
	}

	// ─── MCP over HTTP (Streamable HTTP transport, stateless) ────────────
	// Each request gets a fresh McpServer + transport. Read-only: no ingest.
	const embedderModel = embedder.model ?? "unknown";

	async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
		// CORS headers for MCP
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

		if (req.method === "GET") {
			// SSE stream for server-initiated notifications (not used in stateless)
			res.writeHead(405, { "Content-Type": "text/plain" });
			res.end("SSE not supported in stateless mode. Use POST to send MCP requests.");
			return;
		}

		if (req.method === "DELETE") {
			// Session termination (no-op in stateless mode)
			res.writeHead(200);
			res.end();
			return;
		}

		if (req.method !== "POST") {
			res.writeHead(405, { "Content-Type": "text/plain" });
			res.end("Method not allowed");
			return;
		}

		// Parse JSON body
		const body = await new Promise<string>((resolve, reject) => {
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
			req.on("error", reject);
		});

		let parsedBody: unknown;
		try {
			parsedBody = JSON.parse(body);
		} catch {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Invalid JSON" }));
			return;
		}

		// Create a fresh server + transport per request (stateless)
		const mcpServer = createMcpServer(store, embedder, embedderModel, { readOnly: true });
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

		res.on("close", () => {
			transport.close().catch(() => {});
			mcpServer.close().catch(() => {});
		});

		await mcpServer.connect(transport);
		await transport.handleRequest(req, res, parsedBody);
	}

	const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		const url = req.url ?? "/";
		const params = parseQuery(url);
		const path = url.split("?")[0] ?? "/";

		// CORS preflight
		if (req.method === "OPTIONS") {
			res.writeHead(204, {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, mcp-session-id",
				"Access-Control-Expose-Headers": "mcp-session-id",
			});
			res.end();
			return;
		}

		try {
			// ─── MCP endpoint ───
			if (path === "/mcp") {
				return handleMcp(req, res);
			}
			// ─── Shared endpoint handler ───
			async function handleEndpoint(
				col: LoadedCollection,
				endpoint: string,
				collectionLabel: string,
			): Promise<void> {
				if (endpoint === "status") {
					const serverModel = embedder.model ?? "unknown";
					const collectionModel = col.manifest.embeddingModel;
					const modelMismatch =
						serverModel !== "unknown" &&
						collectionModel !== "pending" &&
						serverModel !== collectionModel;

					return jsonResponse(res, {
						collection: collectionLabel,
						totalChunks: col.manifest.totalChunks,
						segments: col.manifest.segments.length,
						embeddingModel: collectionModel,
						serverEmbedder: serverModel,
						...(modelMismatch
							? {
									warning: `Model mismatch: collection uses "${collectionModel}" but server has "${serverModel}". Search quality may be degraded.`,
								}
							: {}),
						updatedAt: col.manifest.updatedAt,
						sourceTypes: [
							...new Set(col.segments.flatMap((s) => s.chunks.map((c) => c.sourceType))),
						],
					});
				}

				if (endpoint === "query") {
					const q = params.get("q");
					if (!q) return jsonResponse(res, { error: "Missing ?q= parameter" }, 400);
					const topK = Number(params.get("k") ?? "10");
					const result = await query(q, embedder, col.vectorIndex, { topK });
					return jsonResponse(res, result);
				}

				if (endpoint === "trace") {
					const q = params.get("q");
					if (!q) return jsonResponse(res, { error: "Missing ?q= parameter" }, 400);
					const result = await trace(q, embedder, col.vectorIndex, col.segments);
					return jsonResponse(res, {
						query: result.query,
						stats: result.stats,
						groups: result.groups,
					});
				}

				if (endpoint === "edges") {
					const sourceIndex = buildSourceIndex(col.segments);
					const stats = analyzeEdgeResolution(col.segments, sourceIndex);
					const sorted = [...stats.unresolvedByRepo.entries()].sort((a, b) => b[1] - a[1]);
					return jsonResponse(res, {
						totalEdges: stats.totalEdges,
						resolvedEdges: stats.resolvedEdges,
						bareRefs: stats.bareRefs,
						unresolvedEdges: stats.unresolvedEdges,
						resolution:
							stats.totalEdges > 0
								? Math.round((stats.resolvedEdges / stats.totalEdges) * 100)
								: 0,
						topUnresolved: Object.fromEntries(sorted.slice(0, 20)),
					});
				}

				if (endpoint === "sources") {
					const sourceMap = new Map<string, Set<string>>();
					for (const seg of col.segments) {
						for (const c of seg.chunks) {
							let sources = sourceMap.get(c.sourceType);
							if (!sources) {
								sources = new Set<string>();
								sourceMap.set(c.sourceType, sources);
							}
							sources.add(c.source);
						}
					}

					const result: Record<string, { sources: string[]; count: number }> = {};
					for (const [sourceType, sources] of sourceMap) {
						result[sourceType] = {
							sources: [...sources].sort(),
							count: col.segments.reduce(
								(n, s) => n + s.chunks.filter((c) => c.sourceType === sourceType).length,
								0,
							),
						};
					}
					return jsonResponse(res, result);
				}

				return jsonResponse(res, { error: `Unknown endpoint: ${endpoint}` }, 404);
			}

			// ─── CID-scoped API: /api/collections/cid/:cid/... ───
			const cidMatch = path.match(/^\/api\/collections\/cid\/([^/]+)\/(.+)$/);
			if (cidMatch) {
				const [, cid, endpoint] = cidMatch;
				if (!cid || !endpoint) {
					return jsonResponse(res, { error: "Invalid CID path" }, 400);
				}

				try {
					const col = await getCollectionByCid(decodeURIComponent(cid));
					return handleEndpoint(col, endpoint, `cid:${cid}`);
				} catch (err) {
					const code = err instanceof Error && "code" in err ? (err as { code: string }).code : "";
					if (code === "CID_INVALID") return jsonResponse(res, { error: "Invalid CID format", code }, 400);
					if (code === "CID_NOT_MANIFEST") return jsonResponse(res, { error: "CID does not point to a wtfoc collection", code }, 422);
					throw err;
				}
			}

			// ─── Collection-scoped API: /api/collections/:name/... ───
			const collectionMatch = path.match(/^\/api\/collections\/([^/]+)\/(.+)$/);
			if (collectionMatch) {
				const [, collectionName, endpoint] = collectionMatch;
				if (!collectionName || !endpoint) {
					return jsonResponse(res, { error: "Invalid collection path" }, 400);
				}

				const col = await getCollection(decodeURIComponent(collectionName));
				if (!col) {
					return jsonResponse(res, { error: `Collection "${collectionName}" not found` }, 404);
				}

				return handleEndpoint(col, endpoint, col.manifest.name);
			}

			// ─── List collections: /api/collections ───
			if (path === "/api/collections") {
				const names = await store.manifests.listProjects();
				const collections = await Promise.all(
					names.map(async (name) => {
						const head = await store.manifests.getHead(name);
						if (!head) return null;
						const m = head.manifest;
						return {
							name: m.name,
							chunks: m.totalChunks,
							segments: m.segments.length,
							model: m.embeddingModel,
							updated: m.updatedAt,
						};
					}),
				);
				return jsonResponse(
					res,
					collections.filter((c): c is NonNullable<typeof c> => c !== null),
				);
			}

			// ─── Static file serving ───
			if (staticFiles.size > 0) {
				const reqPath = path === "/" ? "/index.html" : path;
				const file = staticFiles.get(reqPath);
				if (file) {
					res.writeHead(200, { "Content-Type": file.contentType });
					res.end(file.content);
					return;
				}

				// SPA fallback for extensionless paths
				if (!extname(reqPath)) {
					const indexFile = staticFiles.get("/index.html");
					if (indexFile) {
						res.writeHead(200, { "Content-Type": indexFile.contentType });
						res.end(indexFile.content);
						return;
					}
				}
			}

			// 404
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not found");
		} catch (err) {
			console.error("API error:", err);
			jsonResponse(res, { error: err instanceof Error ? err.message : "Internal error" }, 500);
		}
	});

	server.listen(PORT, () => {
		console.error(`\n🌐 wtfoc web running at http://localhost:${PORT}`);
		console.error(`   API: http://localhost:${PORT}/api/collections`);
		console.error(`   MCP: http://localhost:${PORT}/mcp`);
		console.error(`   UI:  http://localhost:${PORT}/`);
	});
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
