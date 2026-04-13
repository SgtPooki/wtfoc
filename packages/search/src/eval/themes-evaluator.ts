import type { EvalCheck, EvalStageResult, Segment, ThemeSnapshot } from "@wtfoc/common";
import { GreedyClusterer } from "../clustering/greedy-clusterer.js";

interface ManifestWithThemes {
	themes?: ThemeSnapshot;
}

/**
 * Validate that a ThemeSnapshot is well-formed.
 */
function isValidThemeSnapshot(themes: ThemeSnapshot): boolean {
	return (
		typeof themes.threshold === "number" &&
		Array.isArray(themes.clusters) &&
		themes.clusters.length > 0 &&
		typeof themes.computedAt === "string" &&
		typeof themes.totalProcessed === "number" &&
		themes.totalProcessed > 0
	);
}

/**
 * Evaluate themes/clustering quality: cluster metrics, source-type diversity.
 *
 * When a manifest with persisted themes is provided, validates those first
 * before recomputing as a diagnostic comparison.
 */
export async function evaluateThemes(
	segments: Segment[],
	_signal?: AbortSignal,
	manifest?: ManifestWithThemes,
): Promise<EvalStageResult> {
	const startedAt = new Date().toISOString();
	const t0 = performance.now();

	const checks: EvalCheck[] = [];

	// Validate persisted themes if manifest provided
	let persistedThemesValid = false;
	let persistedClusterCount: number | undefined;
	if (manifest?.themes) {
		persistedThemesValid = isValidThemeSnapshot(manifest.themes);
		persistedClusterCount = manifest.themes.clusters.length;
		if (!persistedThemesValid) {
			checks.push({
				name: "themes:persisted-invalid",
				passed: false,
				actual: JSON.stringify({
					clusters: manifest.themes.clusters.length,
					totalProcessed: manifest.themes.totalProcessed,
				}),
				detail: "Persisted themes exist but are malformed (empty clusters or missing fields)",
			});
		}
	} else if (manifest) {
		// Manifest provided but no themes field
		checks.push({
			name: "themes:no-persisted",
			passed: false,
			actual: "missing",
			detail: "manifest.themes is missing — run the themes command first",
		});
	}

	// Flatten chunks with embeddings
	const chunks = segments.flatMap((s) => s.chunks);

	if (chunks.length === 0) {
		return {
			stage: "themes",
			startedAt,
			durationMs: Math.round(performance.now() - t0),
			verdict: "pass",
			summary: "No chunks to cluster",
			metrics: { persistedThemesValid, clusterCount: 0, noiseCount: 0 },
			checks,
		};
	}

	// Build cluster request using parallel-array shape expected by ClusterRequest
	const chunksWithEmbeddings = chunks.filter((c) => c.embedding && c.embedding.length > 0);
	if (chunksWithEmbeddings.length === 0) {
		return {
			stage: "themes",
			startedAt,
			durationMs: Math.round(performance.now() - t0),
			verdict: "warn",
			summary: "No chunks with embeddings to cluster",
			metrics: { persistedThemesValid, clusterCount: 0, noiseCount: 0 },
			checks,
		};
	}
	const clusterRequest = {
		ids: chunksWithEmbeddings.map((c) => c.id),
		vectors: chunksWithEmbeddings.map((c) => new Float32Array(c.embedding)),
		contents: chunksWithEmbeddings.map((c) => c.content),
	};

	const clusterer = new GreedyClusterer();
	const result = await clusterer.cluster(clusterRequest);

	const clusterCount = result.clusters.length;
	const noiseCount = result.noise.length;

	// Cluster sizes
	const sizes = result.clusters.map((c) => c.size);
	const minSize = sizes.length > 0 ? sizes.reduce((a, b) => Math.min(a, b), sizes[0] ?? 0) : 0;
	const maxSize = sizes.length > 0 ? sizes.reduce((a, b) => Math.max(a, b), sizes[0] ?? 0) : 0;
	const meanSize = sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;

	// Source-type diversity per cluster
	const chunkSourceType = new Map<string, string>();
	for (const c of chunks) chunkSourceType.set(c.id, c.sourceType);

	const diversityScores: number[] = [];
	for (const cluster of result.clusters) {
		const sourceTypes = new Set<string>();
		for (const memberId of cluster.memberIds) {
			const st = chunkSourceType.get(memberId);
			if (st) sourceTypes.add(st);
		}
		diversityScores.push(sourceTypes.size);
	}
	const meanDiversity =
		diversityScores.length > 0
			? diversityScores.reduce((a, b) => a + b, 0) / diversityScores.length
			: 0;

	// Verdict
	let verdict: "pass" | "warn" | "fail" = "pass";
	if (clusterCount === 0) {
		verdict = "fail";
		checks.push({
			name: "clusters:none",
			passed: false,
			actual: 0,
			detail: "No clusters formed",
		});
	}

	const durationMs = Math.round(performance.now() - t0);

	return {
		stage: "themes",
		startedAt,
		durationMs,
		verdict,
		summary: `${clusterCount} clusters, ${noiseCount} noise chunks, mean diversity ${meanDiversity.toFixed(1)}`,
		metrics: {
			persistedThemesValid,
			...(persistedClusterCount !== undefined ? { persistedClusterCount } : {}),
			recomputedClusterCount: clusterCount,
			clusterCount,
			noiseCount,
			clusterSizes: { min: minSize, max: maxSize, mean: meanSize },
			meanSourceTypeDiversity: meanDiversity,
		},
		checks,
	};
}
