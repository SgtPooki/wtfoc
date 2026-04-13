import type {
	CollectionHead,
	DocumentCatalog,
	Edge,
	EvalCheck,
	EvalStageResult,
	Segment,
	StorageBackend,
} from "@wtfoc/common";

export interface StorageEvalOptions {
	head: CollectionHead;
	storage: StorageBackend;
	/** Optional document catalog for AC-US6-04 orphan check */
	catalog?: DocumentCatalog | null;
	signal?: AbortSignal;
}

/**
 * Evaluate storage quality: segment download integrity, derived edge layer
 * consistency, and document catalog accuracy.
 */
export async function evaluateStorage(
	headOrOpts: CollectionHead | StorageEvalOptions,
	storage?: StorageBackend,
	signal?: AbortSignal,
): Promise<EvalStageResult> {
	// Support both old signature (head, storage, signal) and new options object
	let head: CollectionHead;
	let storageBackend: StorageBackend;
	let catalog: DocumentCatalog | null | undefined;
	let abortSignal: AbortSignal | undefined;

	if ("head" in headOrOpts && "storage" in headOrOpts) {
		head = headOrOpts.head;
		storageBackend = headOrOpts.storage;
		catalog = headOrOpts.catalog;
		abortSignal = headOrOpts.signal;
	} else {
		head = headOrOpts;
		if (!storage) {
			throw new Error("evaluateStorage requires a storage backend");
		}
		storageBackend = storage;
		abortSignal = signal;
	}
	const startedAt = new Date().toISOString();
	const t0 = performance.now();

	const checks: EvalCheck[] = [];
	let totalChunks = 0;
	let totalEdges = 0;
	let segmentFailures = 0;
	const allChunkIds = new Set<string>();

	// Segment integrity
	for (const segSummary of head.segments) {
		abortSignal?.throwIfAborted();
		try {
			const raw = await storageBackend.download(segSummary.id);
			const text = new TextDecoder().decode(raw);
			const seg = JSON.parse(text) as Segment;

			if (!Array.isArray(seg.chunks) || !Array.isArray(seg.edges)) {
				throw new Error("Missing chunks or edges array");
			}

			totalChunks += seg.chunks.length;
			totalEdges += seg.edges.length;
			for (const c of seg.chunks) allChunkIds.add(c.id);

			checks.push({
				name: `segment:${segSummary.id}`,
				passed: true,
				actual: seg.chunks.length,
				detail: `${seg.chunks.length} chunks, ${seg.edges.length} edges`,
			});
		} catch (err) {
			segmentFailures++;
			checks.push({
				name: `segment:${segSummary.id}`,
				passed: false,
				actual: "error",
				detail: err instanceof Error ? err.message : "Download/parse failed",
			});
		}
	}

	// Derived edge layer consistency
	let derivedLayerDanglingRefs = 0;
	if (head.derivedEdgeLayers && head.derivedEdgeLayers.length > 0) {
		for (const layer of head.derivedEdgeLayers) {
			abortSignal?.throwIfAborted();
			try {
				const raw = await storageBackend.download(layer.id);
				const text = new TextDecoder().decode(raw);
				const edges = JSON.parse(text) as Edge[];

				for (const edge of edges) {
					if (!allChunkIds.has(edge.sourceId)) {
						derivedLayerDanglingRefs++;
					}
				}
			} catch {
				checks.push({
					name: `derived-layer:${layer.id}`,
					passed: false,
					actual: "error",
					detail: "Failed to download/parse derived edge layer",
				});
			}
		}
	}

	if (derivedLayerDanglingRefs > 0) {
		checks.push({
			name: "derived-layer:dangling-refs",
			passed: false,
			actual: derivedLayerDanglingRefs,
			expected: 0,
			detail: `${derivedLayerDanglingRefs} edge(s) reference non-existent chunk IDs`,
		});
	}

	// Document catalog check (AC-US6-04)
	// Catalog is a sidecar file passed in via options; CollectionHead has no catalog field.
	let catalogOrphans = 0;
	if (catalog) {
		for (const [_docId, entry] of Object.entries(catalog.documents)) {
			if (entry.chunkIds) {
				for (const chunkId of entry.chunkIds) {
					if (!allChunkIds.has(chunkId)) {
						catalogOrphans++;
					}
				}
			}
		}

		if (catalogOrphans > 0) {
			checks.push({
				name: "catalog:orphan-refs",
				passed: false,
				actual: catalogOrphans,
				expected: 0,
				detail: `${catalogOrphans} catalog chunk reference(s) point to non-existent chunks`,
			});
		}
	}

	// Verdict
	let verdict: "pass" | "warn" | "fail" = "pass";
	if (segmentFailures > 0) verdict = "fail";
	else if (derivedLayerDanglingRefs > 0 || catalogOrphans > 0) verdict = "warn";

	const durationMs = Math.round(performance.now() - t0);

	return {
		stage: "storage",
		startedAt,
		durationMs,
		verdict,
		summary: `${head.segments.length} segments, ${totalChunks} chunks, ${totalEdges} edges${segmentFailures > 0 ? `, ${segmentFailures} failures` : ""}`,
		metrics: {
			segmentCount: head.segments.length,
			totalChunks,
			totalEdges,
			segmentFailures,
			derivedLayerDanglingRefs,
			catalogOrphans,
		},
		checks,
	};
}
