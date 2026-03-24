import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { CollectionHead, Embedder, Segment, VectorEntry, VectorIndex } from "@wtfoc/common";
import {
	analyzeEdgeResolution,
	buildSourceIndex,
	InMemoryVectorIndex,
	query,
	trace,
} from "@wtfoc/search";
import type { createStore } from "@wtfoc/store";

interface ServeOptions {
	store: ReturnType<typeof createStore>;
	collection: string;
	embedder: Embedder;
	port: number;
	html: string;
}

interface LoadedState {
	manifest: CollectionHead;
	segments: Segment[];
	vectorIndex: VectorIndex;
}

async function loadCollection(
	store: ReturnType<typeof createStore>,
	manifest: CollectionHead,
): Promise<{ segments: Segment[]; vectorIndex: VectorIndex }> {
	const vectorIndex = new InMemoryVectorIndex();
	const segments: Segment[] = [];

	for (const segSummary of manifest.segments) {
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

	return { segments, vectorIndex };
}

function json(res: ServerResponse, data: unknown, status = 200) {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
	});
	res.end(JSON.stringify(data));
}

function html(res: ServerResponse, content: string) {
	res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
	res.end(content);
}

function parseQuery(url: string): URLSearchParams {
	const idx = url.indexOf("?");
	return idx === -1 ? new URLSearchParams() : new URLSearchParams(url.slice(idx + 1));
}

export async function startServer(options: ServeOptions): Promise<void> {
	const { store, collection, embedder, port } = options;

	// Load collection once at startup
	console.error("⏳ Loading collection...");
	const head = await store.manifests.getHead(collection);
	if (!head) {
		console.error(`Error: collection "${collection}" not found`);
		process.exit(1);
	}

	const { segments, vectorIndex } = await loadCollection(store, head.manifest);
	const state: LoadedState = { manifest: head.manifest, segments, vectorIndex };
	console.error(
		`✅ Loaded "${collection}": ${head.manifest.totalChunks} chunks, ${head.manifest.segments.length} segments`,
	);

	const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		const url = req.url ?? "/";
		const params = parseQuery(url);
		const path = url.split("?")[0];

		// CORS preflight
		if (req.method === "OPTIONS") {
			res.writeHead(204, {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
			});
			res.end();
			return;
		}

		try {
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
				return json(
					res,
					collections.filter((c): c is NonNullable<typeof c> => c !== null),
				);
			}

			if (path === "/api/status") {
				return json(res, {
					collection,
					totalChunks: state.manifest.totalChunks,
					segments: state.manifest.segments.length,
					embeddingModel: state.manifest.embeddingModel,
					updatedAt: state.manifest.updatedAt,
					sourceTypes: [
						...new Set(state.segments.flatMap((s) => s.chunks.map((c) => c.sourceType))),
					],
				});
			}

			if (path === "/api/query") {
				const q = params.get("q");
				if (!q) return json(res, { error: "Missing ?q= parameter" }, 400);
				const topK = Number(params.get("k") ?? "10");
				const result = await query(q, embedder, state.vectorIndex, { topK });
				return json(res, result);
			}

			if (path === "/api/trace") {
				const q = params.get("q");
				if (!q) return json(res, { error: "Missing ?q= parameter" }, 400);
				const result = await trace(q, embedder, state.vectorIndex, state.segments);
				return json(res, {
					query: result.query,
					stats: result.stats,
					groups: result.groups,
				});
			}

			if (path === "/api/edges") {
				const sourceIndex = buildSourceIndex(state.segments);
				const stats = analyzeEdgeResolution(state.segments, sourceIndex);
				const sorted = [...stats.unresolvedByRepo.entries()].sort((a, b) => b[1] - a[1]);
				return json(res, {
					totalEdges: stats.totalEdges,
					resolvedEdges: stats.resolvedEdges,
					bareRefs: stats.bareRefs,
					unresolvedEdges: stats.unresolvedEdges,
					resolution: Math.round((stats.resolvedEdges / stats.totalEdges) * 100),
					topUnresolved: Object.fromEntries(sorted.slice(0, 20)),
				});
			}

			if (path === "/api/sources") {
				const sourceMap = new Map<string, Set<string>>();
				for (const seg of state.segments) {
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
						count: state.segments.reduce(
							(n, s) => n + s.chunks.filter((c) => c.sourceType === sourceType).length,
							0,
						),
					};
				}
				return json(res, result);
			}

			// Serve the SPA for everything else
			if (path === "/" || path === "/index.html") {
				return html(res, options.html);
			}

			// 404
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not found");
		} catch (err) {
			console.error("API error:", err);
			json(res, { error: err instanceof Error ? err.message : "Internal error" }, 500);
		}
	});

	server.listen(port, () => {
		console.error(`\n🌐 wtfoc serve running at http://localhost:${port}`);
		console.error(`   Collection: ${collection} (${state.manifest.totalChunks} chunks)`);
		console.error(`   API: http://localhost:${port}/api/status`);
		console.error(`   UI:  http://localhost:${port}/`);
	});
}
