import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRepository } from "./db/index.js";
import { createHonoApp } from "./hono-app.js";
import { registerCidPullHandler } from "./collections/cid-pull-worker.js";
import { registerIngestHandler } from "./collections/ingest-worker.js";
import { registerMaterializeHandler } from "./collections/materialize-worker.js";
import { createJobQueue } from "./jobs/bootstrap.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type {
	CollectionHead,
	Embedder,
	EmbedderProfile,
	ResolvedEmbedderConfig,
	Segment,
	StorageBackend,
	VectorIndex,
} from "@wtfoc/common";
import { StorageNotFoundError } from "@wtfoc/common";
import { loadProjectConfig, resolveConfig } from "@wtfoc/config";
import { createMcpServer } from "@wtfoc/mcp-server/server";
import {
	analyzeEdgeResolution,
	buildSourceIndex,
	createVectorIndex,
	mountCollection,
	QdrantCollectionGc,
	query,
	trace,
} from "@wtfoc/search";
import type { VectorBackend } from "@wtfoc/search";
import { CidReadableStorage, createStore } from "@wtfoc/store";

// ─── Configuration ──────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env["WTFOC_PORT"] ?? "3577");
const WEB_DIR = process.env["WTFOC_WEB_DIR"] ?? join(__dirname, "..", "dist");
const DATA_DIR = process.env["WTFOC_DATA_DIR"];
const MANIFEST_DIR = process.env["WTFOC_MANIFEST_DIR"];
const VECTOR_BACKEND = parseVectorBackend(process.env["WTFOC_VECTOR_BACKEND"]);
const QDRANT_URL = process.env["WTFOC_QDRANT_URL"] ?? "http://localhost:6333";
const QDRANT_API_KEY = process.env["WTFOC_QDRANT_API_KEY"];
const COLLECTION_TTL_MS = parseTtl(process.env["WTFOC_COLLECTION_TTL"]);
const CID_GC_MAX_IDLE_MS = parseTtlWithDefault(process.env["WTFOC_CID_GC_MAX_IDLE"], 7 * 86_400_000);
const CID_GC_MAX_COLLECTIONS = parsePositiveInt(process.env["WTFOC_CID_GC_MAX_COLLECTIONS"], 50);
const CID_GC_SWEEP_INTERVAL_MS = parseTtlWithDefault(process.env["WTFOC_CID_GC_INTERVAL"], 3_600_000);

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseVectorBackend(value: string | undefined): VectorBackend {
	if (!value || value === "inmemory") return "inmemory";
	if (value === "qdrant") return "qdrant";
	console.error(
		`[wtfoc] Unknown WTFOC_VECTOR_BACKEND "${value}", falling back to "inmemory".`,
	);
	return "inmemory";
}

function parseTtl(value: string | undefined): number {
	if (!value) return 0; // 0 = disabled
	const match = value.match(/^(\d+)(ms|s|m|h|d)$/);
	if (!match) {
		console.error(
			`[wtfoc] Invalid TTL "${value}" — expected format: <number><unit> (ms|s|m|h|d). Disabled.`,
		);
		return 0;
	}
	const [, num, unit] = match;
	if (unit !== "ms" && unit !== "s" && unit !== "m" && unit !== "h" && unit !== "d") return 0;
	const n = Number(num);
	const multipliers: Record<"ms" | "s" | "m" | "h" | "d", number> = {
		ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000,
	};
	return n * multipliers[unit];
}

/** Parse a TTL env var with a fallback default. Returns 0 only if explicitly set to "0" or "0ms". */
function parseTtlWithDefault(value: string | undefined, defaultMs: number): number {
	if (!value) return defaultMs;
	if (value === "0" || value === "0ms") return 0; // explicit disable
	const parsed = parseTtl(value);
	if (parsed === 0) {
		console.error(`[wtfoc] Invalid GC TTL "${value}", using default ${defaultMs}ms`);
		return defaultMs;
	}
	return parsed;
}

function parsePositiveInt(value: string | undefined, defaultVal: number): number {
	if (!value) return defaultVal;
	const n = Number(value);
	if (!Number.isFinite(n) || n < 1) {
		console.error(`[wtfoc] Invalid positive integer "${value}", using default ${defaultVal}`);
		return defaultVal;
	}
	return Math.floor(n);
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface LoadedCollection {
	manifest: CollectionHead;
	segments: Segment[];
	vectorIndex: VectorIndex;
	headId: string;
	loadedAt: number;
	lastAccessedAt: number;
	/** When we last checked the manifest headId for freshness. */
	lastValidatedAt: number;
	/** When we last wrote the GC sentinel to Qdrant. */
	lastSentinelTouchedAt: number;
}

interface CachedFile {
	content: Buffer;
	contentType: string;
}

// ─── Embedder ───────────────────────────────────────────────────────────────

// Load .wtfoc.json + env vars for embedder config (profiles, prefix, etc.)
let resolvedEmbedderConfig: ResolvedEmbedderConfig | undefined;
try {
	const fileConfig = loadProjectConfig();
	const resolved = resolveConfig({ file: fileConfig });
	resolvedEmbedderConfig = resolved.embedder;
} catch (err) {
	console.error(
		`Warning: failed to load .wtfoc.json: ${err instanceof Error ? err.message : err}`,
	);
}

// Cache embedders by model name so we don't recreate per-request
const embedderCache = new Map<string, { embedder: Embedder; modelName: string }>();

function findProfileForModel(modelName: string): EmbedderProfile | undefined {
	const profiles = resolvedEmbedderConfig?.profiles ?? {};
	for (const p of Object.values(profiles)) {
		if (p.model === modelName) return p;
	}
	return undefined;
}

/**
 * Get or create an embedder for a specific model.
 * Looks up the model in .wtfoc.json profiles for prefix/pooling config,
 * then creates an appropriately configured embedder.
 */
async function getEmbedderForModel(modelName: string): Promise<{ embedder: Embedder; modelName: string }> {
	const cached = embedderCache.get(modelName);
	if (cached) return cached;

	const url = resolvedEmbedderConfig?.url ?? process.env["WTFOC_EMBEDDER_URL"];
	const apiKey =
		resolvedEmbedderConfig?.key ??
		process.env["WTFOC_EMBEDDER_KEY"] ??
		process.env["WTFOC_OPENAI_API_KEY"] ??
		"no-key";

	const profile = findProfileForModel(modelName);

	let result: { embedder: Embedder; modelName: string };

	// Pass explicit dimensions as requestDimensions for MRL/Matryoshka models,
	// matching the CLI/MCP behavior (only when profile specifies dimensions)
	const explicitDimensions = resolvedEmbedderConfig?.dimensions ?? profile?.dimensions;

	if (url) {
		const { OpenAIEmbedder } = await import("@wtfoc/search");
		result = {
			embedder: new OpenAIEmbedder({
				apiKey,
				baseUrl: url,
				model: modelName,
				dimensions: explicitDimensions,
				requestDimensions: resolvedEmbedderConfig?.dimensions,
				prefix: profile?.prefix,
			}),
			modelName,
		};
	} else {
		// Local transformers.js fallback
		try {
			const { TransformersEmbedder } = await import("@wtfoc/search");
			result = {
				embedder: new TransformersEmbedder(modelName, {
					dimensions: profile?.dimensions,
					pooling: profile?.pooling,
					prefix: profile?.prefix,
				}),
				modelName,
			};
		} catch {
			throw new Error(`No embedder available for model "${modelName}"`);
		}
	}

	embedderCache.set(modelName, result);
	console.error(
		`🔧 Created embedder for "${modelName}" (${profile ? "profile matched" : "no profile"}, prefix=${profile?.prefix ? "yes" : "no"})`,
	);
	return result;
}

/** Get the default embedder (from env/config, used for MCP and when collection model is unknown). */
async function getDefaultEmbedder(): Promise<{ embedder: Embedder; modelName: string }> {
	// Resolve profile → model (same as CLI/MCP helpers)
	const profileName = resolvedEmbedderConfig?.profile ?? process.env["WTFOC_EMBEDDER_PROFILE"];
	const profiles = resolvedEmbedderConfig?.profiles ?? {};
	const profileModel = profileName ? profiles[profileName]?.model : undefined;

	const model =
		resolvedEmbedderConfig?.model ??
		process.env["WTFOC_EMBEDDER_MODEL"] ??
		profileModel;

	if (model) return getEmbedderForModel(model);

	// Try local MiniLM fallback
	try {
		return await getEmbedderForModel("Xenova/all-MiniLM-L6-v2");
	} catch {
		// fall through
	}

	console.error("Error: No embedder configured.");
	console.error("  Set WTFOC_EMBEDDER_URL and WTFOC_EMBEDDER_MODEL environment variables.");
	console.error("  Example: WTFOC_EMBEDDER_URL=http://ollama:11434/v1 WTFOC_EMBEDDER_MODEL=nomic-embed-text");
	process.exit(1);
}

/**
 * Get the right embedder for a collection based on its embeddingModel metadata.
 * Falls back to the default embedder if the collection model is unknown.
 */
async function getEmbedderForCollection(manifest: CollectionHead): Promise<{ embedder: Embedder; modelName: string }> {
	const collectionModel = manifest.embeddingModel;
	if (collectionModel && collectionModel !== "pending") {
		return getEmbedderForModel(collectionModel);
	}
	return getDefaultEmbedder();
}

// ─── Store ──────────────────────────────────────────────────────────────────

function getStore() {
	return createStore({
		storage: "local",
		...(DATA_DIR ? { dataDir: DATA_DIR } : {}),
		...(MANIFEST_DIR ? { manifestDir: MANIFEST_DIR } : {}),
	});
}

// ─── Hydrating Storage ──────────────────────────────────────────────────────
// Wraps LocalStorageBackend with IPFS fallback for segments that have CIDs.
// On cache miss: fetches from IPFS → persists locally → returns data.

function createHydratingStorage(
	local: StorageBackend,
	manifest: CollectionHead,
): StorageBackend {
	// Build segment ID → IPFS CID lookup from the manifest
	const cidBySegmentId = new Map<string, string>();
	for (const seg of manifest.segments) {
		if (seg.ipfsCid) {
			cidBySegmentId.set(seg.id, seg.ipfsCid);
		}
	}

	// No IPFS CIDs in manifest — just use local storage as-is
	if (cidBySegmentId.size === 0) return local;

	let ipfsReader: CidReadableStorage | null = null;

	return {
		async download(id: string, signal?: AbortSignal): Promise<Uint8Array> {
			// Try local first
			try {
				return await local.download(id, signal);
			} catch (err) {
				// Only fall back to IPFS for missing segments, not IO/permission errors
				if (!(err instanceof StorageNotFoundError)) throw err;

				const ipfsCid = cidBySegmentId.get(id);
				if (!ipfsCid) throw err; // no CID fallback available — rethrow

				// Fetch from IPFS
				console.error(`📥 Hydrating segment ${id.slice(0, 12)}… from IPFS (${ipfsCid.slice(0, 16)}…)`);
				if (!ipfsReader) ipfsReader = new CidReadableStorage();
				const data = await ipfsReader.download(ipfsCid, signal);

				// Persist locally so future loads don't need IPFS.
				// LocalStorageBackend uses content SHA-256 as the ID, which must
				// match the segment ID in the manifest (both are SHA-256 of the blob).
				try {
					const result = await local.upload(data, undefined, signal);
					if (result.id !== id) {
						console.error(
							`⚠️  Hydrated segment hash mismatch: expected ${id.slice(0, 12)}…, got ${result.id.slice(0, 12)}… — content may have changed on IPFS`,
						);
					}
				} catch (persistErr) {
					console.error(`⚠️  Failed to persist segment locally: ${persistErr instanceof Error ? persistErr.message : persistErr}`);
				}

				return data;
			}
		},
		upload: local.upload.bind(local),
		verify: local.verify?.bind(local),
	};
}

// ─── Collection Cache (lazy-loading) ────────────────────────────────────────

const collectionCache = new Map<string, LoadedCollection>();
const collectionInflight = new Map<string, Promise<LoadedCollection>>();
/** Skip manifest re-read if the cached entry was validated within this window. */
const FRESHNESS_TTL_MS = 5_000;
let store: ReturnType<typeof createStore>;
let embedder: Embedder;

async function getCollection(name: string): Promise<LoadedCollection | null> {
	// Fast path: skip manifest IO if the cache was recently validated
	const cached = collectionCache.get(name);
	if (cached && Date.now() - cached.lastValidatedAt < FRESHNESS_TTL_MS) {
		cached.lastAccessedAt = Date.now();
		return cached;
	}

	const head = await store.manifests.getHead(name);
	if (!head) return null;

	// Return cached collection if the manifest hasn't changed
	if (cached && cached.headId === head.headId) {
		cached.lastValidatedAt = Date.now();
		cached.lastAccessedAt = Date.now();
		return cached;
	}

	// Deduplicate in-flight loads for the same collection + headId
	const inflightKey = `${name}:${head.headId}`;
	const existing = collectionInflight.get(inflightKey);
	if (existing) return existing;

	const promise = (async () => {
		if (cached) {
			console.error(`♻️  Collection "${name}" changed (headId ${head.headId.slice(0, 8)}…), reloading…`);
		} else {
			console.error(`⏳ Loading collection "${name}" (${VECTOR_BACKEND} backend)...`);
		}

		const dimensions = head.manifest.embeddingDimensions ?? 384;
		const vectorIndex = await createVectorIndex({
			backend: VECTOR_BACKEND,
			collectionName: head.manifest.collectionId,
			dimensions,
			qdrantUrl: QDRANT_URL,
			qdrantApiKey: QDRANT_API_KEY,
		});
		const storage = createHydratingStorage(store.storage, head.manifest);
		const mounted = await mountCollection(head.manifest, storage, vectorIndex);

		const now = Date.now();
		const loaded: LoadedCollection = {
			manifest: head.manifest,
			segments: mounted.segments,
			vectorIndex: mounted.vectorIndex,
			headId: head.headId,
			loadedAt: now,
			lastAccessedAt: now,
			lastValidatedAt: now,
			lastSentinelTouchedAt: 0,
		};

		// Only write cache if no newer head was loaded while we were working
		const current = collectionCache.get(name);
		if (!current || current.loadedAt <= loaded.loadedAt) {
			collectionCache.set(name, loaded);
		}
		console.error(
			`✅ Loaded "${name}": ${head.manifest.totalChunks} chunks, ${head.manifest.segments.length} segments (${VECTOR_BACKEND})`,
		);
		return loaded;
	})();

	collectionInflight.set(inflightKey, promise);
	try {
		return await promise;
	} finally {
		collectionInflight.delete(inflightKey);
	}
}

// ─── CID Collection Loading ─────────────────────────────────────────────────
//
// CID import is now a job (#288 Phase 2). The synchronous mount path that
// used to live here has been removed: clients POST /api/wallet-collections/cid,
// which enqueues a `cid-pull` job that persists the manifest head under a
// wallet-scoped collection name. Queries then flow through the normal
// `/api/collections/:name/*` path against the persisted head.

const qdrantGc =
	VECTOR_BACKEND === "qdrant" ? new QdrantCollectionGc(QDRANT_URL, QDRANT_API_KEY) : null;

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
	const defaultEmbedder = await getDefaultEmbedder();
	embedder = defaultEmbedder.embedder;

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
	const MCP_MAX_BODY = 1 * 1024 * 1024; // 1 MB
	const MCP_MAX_CONCURRENT = 20;
	let mcpInflight = 0;

	async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
		// CORS headers for MCP
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

		if (req.method === "GET") {
			res.writeHead(405, { "Content-Type": "text/plain" });
			res.end("SSE not supported in stateless mode. Use POST to send MCP requests.");
			return;
		}

		if (req.method === "DELETE") {
			res.writeHead(200);
			res.end();
			return;
		}

		if (req.method !== "POST") {
			res.writeHead(405, { "Content-Type": "text/plain" });
			res.end("Method not allowed");
			return;
		}

		// Concurrency guard
		if (mcpInflight >= MCP_MAX_CONCURRENT) {
			res.writeHead(503, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Too many concurrent MCP requests" }));
			return;
		}

		mcpInflight++;
		try {
			// Parse JSON body with size limit and abort handling
			const body = await new Promise<string>((resolve, reject) => {
				const chunks: Buffer[] = [];
				let total = 0;
				let settled = false;

				const onData = (chunk: Buffer): void => {
					total += chunk.byteLength;
					if (total > MCP_MAX_BODY) {
						req.destroy();
						cleanup();
						settled = true;
						reject(new Error("body too large"));
						return;
					}
					chunks.push(chunk);
				};
				const onEnd = (): void => {
					cleanup();
					settled = true;
					resolve(Buffer.concat(chunks).toString("utf-8"));
				};
				const onError = (err: Error): void => {
					if (settled) return;
					cleanup();
					settled = true;
					reject(err);
				};
				const onAbort = (): void => {
					if (settled) return;
					cleanup();
					settled = true;
					reject(new Error("request aborted"));
				};

				function cleanup(): void {
					req.removeListener("data", onData);
					req.removeListener("end", onEnd);
					req.removeListener("error", onError);
					req.removeListener("aborted", onAbort);
					req.removeListener("close", onAbort);
				}

				req.on("data", onData);
				req.on("end", onEnd);
				req.on("error", onError);
				req.on("aborted", onAbort);
				req.on("close", onAbort);
			});

			let parsedBody: unknown;
			try {
				parsedBody = JSON.parse(body);
			} catch {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Invalid JSON" }));
				return;
			}

			// Create a fresh server + transport per request (stateless),
			// but share the collection cache so MCP queries don't re-read from disk.
			const mcpServer = createMcpServer(store, embedder, embedderModel, {
				readOnly: true,
				collectionLoader: getCollection,
			});
			const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

			const cleanup = () => {
				transport.close().catch(() => {});
				mcpServer.close().catch(() => {});
			};
			res.once("finish", cleanup);
			res.once("close", cleanup);

			await mcpServer.connect(transport);
			await transport.handleRequest(req, res, parsedBody);
		} catch (err) {
			if (!res.headersSent) {
				const msg = err instanceof Error && err.message === "body too large"
					? "Request body too large"
					: "Internal error";
				res.writeHead(msg === "Request body too large" ? 413 : 500, {
					"Content-Type": "application/json",
				});
				res.end(JSON.stringify({ error: msg }));
			}
		} finally {
			mcpInflight--;
		}
	}

	// ─── Initialize wallet collection flow ──────────────────────────────
	const repo = await createRepository();

	// Job orchestration (#168). pg-boss when DATABASE_URL is set, otherwise
	// in-memory. Handlers register before start() so the worker picks them
	// up immediately.
	const { queue, dispose: disposeJobs } = await createJobQueue();
	registerIngestHandler(queue, repo);
	registerCidPullHandler(queue, repo);
	registerMaterializeHandler(queue, repo);
	await queue.start();
	console.error("[jobs] queue started");

	const honoApp = createHonoApp(repo, () => queue);

	// Graceful shutdown — drain in-flight handlers before the process exits.
	const onShutdown = async (signal: string) => {
		console.error(`[wtfoc] ${signal} — draining job queue`);
		try {
			await disposeJobs();
		} catch (err) {
			console.error("[jobs] shutdown error", err);
		}
		process.exit(0);
	};
	process.on("SIGINT", () => onShutdown("SIGINT"));
	process.on("SIGTERM", () => onShutdown("SIGTERM"));

	const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		const url = req.url ?? "/";
		const params = parseQuery(url);
		const path = url.split("?")[0] ?? "/";

		// ─── Route /api/auth/*, /api/wallet-collections/*, /api/jobs/* through Hono ───
		if (
			path.startsWith("/api/auth") ||
			path.startsWith("/api/wallet-collections") ||
			path.startsWith("/api/jobs")
		) {
			const honoReq = new Request(
				new URL(url, `http://${req.headers.host ?? "localhost"}`),
				{
					method: req.method,
					headers: Object.entries(req.headers).reduce(
						(h, [k, v]) => {
							if (v) h[k] = Array.isArray(v) ? v.join(", ") : v;
							return h;
						},
						{} as Record<string, string>,
					),
					body: req.method !== "GET" && req.method !== "HEAD"
						? await new Promise<string>((resolve) => {
								let body = "";
								req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
								req.on("end", () => resolve(body));
							})
						: undefined,
				},
			);
			const honoRes = await honoApp.fetch(honoReq);
			res.writeHead(honoRes.status, Object.fromEntries(honoRes.headers.entries()));
			const body = await honoRes.arrayBuffer();
			res.end(Buffer.from(body));
			return;
		}

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
					if (q.length > 2000) return jsonResponse(res, { error: "Query too long" }, 400);
					const topK = Math.min(Math.max(1, Number(params.get("k") ?? "10") || 10), 100);
					const colEmbedder = (await getEmbedderForCollection(col.manifest)).embedder;
					const result = await query(q, colEmbedder, col.vectorIndex, { topK });
					return jsonResponse(res, result);
				}

				if (endpoint === "trace") {
					const q = params.get("q");
					if (!q) return jsonResponse(res, { error: "Missing ?q= parameter" }, 400);
					if (q.length > 2000) return jsonResponse(res, { error: "Query too long" }, 400);
					const colEmbedder = (await getEmbedderForCollection(col.manifest)).embedder;
					const result = await trace(q, colEmbedder, col.vectorIndex, col.segments);
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
						try {
							const head = await store.manifests.getHead(name);
							if (!head) return null;
							const m = head.manifest;
							return {
								name: m.name,
								description: m.description,
								chunks: m.totalChunks,
								segments: m.segments.length,
								model: m.embeddingModel,
								updated: m.updatedAt,
							};
						} catch {
							console.error(`[api] Skipping collection "${name}": invalid manifest`);
							return null;
						}
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
			jsonResponse(res, { error: "Internal error" }, 500);
		}
	});

	// ─── TTL eviction sweep ─────────────────────────────────────────────
	if (COLLECTION_TTL_MS > 0) {
		const SWEEP_INTERVAL = Math.max(60_000, COLLECTION_TTL_MS / 2);
		setInterval(() => {
			const now = Date.now();
			for (const [key, col] of collectionCache) {
				if (now - col.lastAccessedAt > COLLECTION_TTL_MS) {
					collectionCache.delete(key);
					console.error(`♻️  Evicted idle collection "${key}" (TTL ${process.env["WTFOC_COLLECTION_TTL"]})`);
				}
			}
		}, SWEEP_INTERVAL).unref();
		console.error(`   TTL: ${process.env["WTFOC_COLLECTION_TTL"]} (sweep every ${Math.round(SWEEP_INTERVAL / 1000)}s)`);
	}

	// ─── Qdrant idle collection garbage collection ─────────────────────
	// Imported-via-CID collections now live under wallet-scoped names (same
	// Qdrant key as any other collection), so we just protect whatever is
	// currently cached and let the GC reap the rest.
	if (qdrantGc) {
		const activeQdrantNames = (): Set<string> => {
			const active = new Set<string>();
			for (const [name] of collectionCache) {
				active.add(`wtfoc-${name}`);
			}
			return active;
		};

		let sweepInProgress = false;
		setInterval(async () => {
			if (sweepInProgress) return;
			sweepInProgress = true;
			try {
				const deleted = await qdrantGc.sweep({
					maxIdleMs: CID_GC_MAX_IDLE_MS,
					maxCollections: CID_GC_MAX_COLLECTIONS,
					activeCollections: activeQdrantNames(),
				});
				if (deleted.length > 0) {
					console.error(`♻️  Qdrant GC: deleted ${deleted.length} idle collection(s): ${deleted.join(", ")}`);
					for (const name of deleted) {
						collectionCache.delete(name.replace(/^wtfoc-/, ""));
					}
				}
			} catch (err) {
				console.error("⚠️  Qdrant GC sweep failed:", err);
			} finally {
				sweepInProgress = false;
			}
		}, CID_GC_SWEEP_INTERVAL_MS).unref();

		console.error(`   Qdrant GC: sweep every ${Math.round(CID_GC_SWEEP_INTERVAL_MS / 60_000)}min, max idle ${Math.round(CID_GC_MAX_IDLE_MS / 86_400_000)}d, max ${CID_GC_MAX_COLLECTIONS} collections`);
	}

	server.listen(PORT, () => {
		console.error(`\n🌐 wtfoc web running at http://localhost:${PORT}`);
		console.error(`   API: http://localhost:${PORT}/api/collections`);
		console.error(`   MCP: http://localhost:${PORT}/mcp`);
		console.error(`   UI:  http://localhost:${PORT}/`);
		if (VECTOR_BACKEND !== "inmemory") {
			console.error(`   Vector backend: ${VECTOR_BACKEND} (${QDRANT_URL})`);
		}
	});
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
