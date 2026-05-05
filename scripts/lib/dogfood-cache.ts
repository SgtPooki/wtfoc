/**
 * Dogfood-private phase cache. Captures the artifacts produced by one
 * sweep phase (embed, search, score) so the next phase can resume
 * without re-running anything that's already on disk.
 *
 * Step 2 of the 3-phase sweep refactor — schema + IO only. Wiring into
 * the dogfood pipeline lands when `--phase` is added.
 *
 * Path layout (per codex peer-review):
 *
 *   <base>/<sweepId>/<variantId>/<corpus>/<runConfigFingerprint>/<phase>.json
 *
 * `base` defaults to `$WTFOC_DOGFOOD_CACHE_DIR` when set, otherwise a
 * fresh temp dir under the OS tmp prefix. Caches are NOT a public
 * artifact: they are written next to the active sweep report, deleted
 * on sweep cleanup, and never bundled with the published packages.
 *
 * The schema is versioned. Bump `CACHE_SCHEMA_VERSION` whenever the
 * stored shape changes — readers MUST reject any payload whose stored
 * `schemaVersion` does not match the current build, because a stale
 * cache silently consumed across schema generations is worse than a
 * miss. The fingerprint already prevents cross-config reuse, so a
 * schema bump only ever invalidates caches written by an older build.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PreflightStatus } from "@wtfoc/search";

export const CACHE_SCHEMA_VERSION = 1;

export type CachePhase = "embed" | "search" | "score";

export interface CachePathInput {
	base: string;
	sweepId: string;
	variantId: string;
	corpus: string;
	runConfigFingerprint: string;
	phase: CachePhase;
}

/**
 * Resolve the on-disk path for a single phase cache file. Pure — does
 * not create the parent directory. Callers that intend to write should
 * either call `writePhaseCache` (which mkdirs) or `mkdirSync(dirname,
 * { recursive: true })` themselves.
 */
export function phaseCachePath(input: CachePathInput): string {
	return join(
		input.base,
		input.sweepId,
		input.variantId,
		input.corpus,
		input.runConfigFingerprint,
		`${input.phase}.json`,
	);
}

/**
 * Compact view of a retrieved chunk — just the fields the score phase
 * needs to reconstruct evidence checks without re-running the embedder
 * or vector index. Mirrors the metadata shape that `query()` /
 * `trace()` emit, but normalized so the cache stays stable across
 * minor evaluator refactors.
 */
export interface CachedQueryResult {
	chunkId: string;
	score: number;
	/**
	 * Raw embedder cosine before reranking / boosts. Stored separately
	 * so the hard-negative gate's calibrated thresholds keep working
	 * when score-phase replays a cached search produced under a
	 * different reranker.
	 */
	retrievalScore: number;
	documentId: string;
	source: string;
	sourceType: string;
	sourceUrl: string;
	content: string;
	metadata?: Record<string, string>;
	signalScores?: Record<string, number>;
}

export interface CachedTraceHop {
	chunkId: string;
	viaEdge: string | null;
	source: string;
	sourceType: string;
	score: number;
}

export interface CachedTraceStats {
	hopCount: number;
	maxHops: number;
	maxPerSource: number;
	maxTotal: number;
	minScore: number;
	terminationReason: string;
}

export interface CachedQueryEntry {
	id: string;
	queryText: string;
	/**
	 * When the evaluator skipped the query (corpus coverage gap,
	 * preflight invalidation, etc.) the cache stores only the skip
	 * reason — there are no search results to replay.
	 */
	skipped?: { reason: string };
	queryResults: CachedQueryResult[];
	trace?: {
		hops: CachedTraceHop[];
		stats: CachedTraceStats;
		/**
		 * Inputs needed by `aggregateLineageMetrics` so the score phase
		 * can re-derive lineage metrics without re-walking the graph.
		 */
		lineageInputs: Record<string, unknown>;
	};
	timingMs: number;
	goldProximity?: {
		widerK: number;
		topKCutoff: number;
		goldRank: number | null;
		goldScore: number | null;
		topKLastScore: number | null;
	} | null;
	/** Top-K retrieval recall when the fixture has goldSupportingSources. */
	recallAtK?: number | null;
	recallK?: number | null;
	/**
	 * Retrieval-side hard-negative signal. Raw embedder scores only;
	 * calibrated against the hard-negative noise floor / score ceiling
	 * by the score phase.
	 */
	hardNegatives?: Array<{
		chunkId: string;
		retrievalScore: number;
		calibratedScore: number;
	}>;
}

/**
 * Search-phase output. The score phase reads this and runs deterministic
 * evidence checks (and optional grounding) against the cached results.
 */
export interface SearchPhaseCacheV1 {
	schemaVersion: typeof CACHE_SCHEMA_VERSION;
	phase: "search";
	capturedAt: string;
	runConfigFingerprint: string;
	collectionId: string;
	manifestId: string;
	segmentIds: string[];
	activeQueryIds: string[];
	preflight: Record<string, PreflightStatus>;
	corpusSourceTypes: string[];
	documentCatalogId: string | null;
	retrievalOverrides: {
		topK?: number;
		traceMaxPerSource?: number;
		traceMaxTotal?: number;
		traceMinScore?: number;
	};
	reranker: { type: string; model?: string; url?: string } | null;
	diversityEnforce: boolean;
	autoRoute: boolean;
	queries: CachedQueryEntry[];
	searchTiming: Record<string, unknown>;
	searchCost: Record<string, unknown>;
}

/**
 * Embed-phase output. Today the on-disk caching embedder already
 * persists query embeddings under the run-config fingerprint, so the
 * embed-phase cache is a thin manifest used to assert the warm-pass
 * actually covered every active query before search starts.
 */
export interface EmbedPhaseCacheV1 {
	schemaVersion: typeof CACHE_SCHEMA_VERSION;
	phase: "embed";
	capturedAt: string;
	runConfigFingerprint: string;
	collectionId: string;
	embedderModel: string;
	embedderUrl: string;
	embedderCacheDir: string | null;
	warmedQueryIds: string[];
}

/**
 * Score-phase output. This is the EvalStageResult of the quality-queries
 * stage plus any grounding payload — the same payload that
 * `runQualityQueriesPipeline` produces today. Stored so a re-run with
 * `--phase=score` can be skipped when the fingerprint is unchanged.
 */
export interface ScorePhaseCacheV1 {
	schemaVersion: typeof CACHE_SCHEMA_VERSION;
	phase: "score";
	capturedAt: string;
	runConfigFingerprint: string;
	collectionId: string;
	stageResult: unknown;
}

export type PhaseCache =
	| EmbedPhaseCacheV1
	| SearchPhaseCacheV1
	| ScorePhaseCacheV1;

export class CacheSchemaMismatchError extends Error {
	constructor(
		public readonly path: string,
		public readonly stored: number,
		public readonly expected: number,
	) {
		super(
			`phase cache schema mismatch at ${path}: stored=${stored}, expected=${expected}`,
		);
		this.name = "CacheSchemaMismatchError";
	}
}

export class CacheFingerprintMismatchError extends Error {
	constructor(
		public readonly path: string,
		public readonly stored: string,
		public readonly expected: string,
	) {
		super(
			`phase cache fingerprint mismatch at ${path}: stored=${stored.slice(0, 12)}, expected=${expected.slice(0, 12)}`,
		);
		this.name = "CacheFingerprintMismatchError";
	}
}

/**
 * Persist a phase cache. Creates the parent directory tree as needed.
 * Writes pretty-printed JSON so a maintainer can diff successive caches
 * without re-formatting.
 */
export function writePhaseCache(
	pathInput: CachePathInput,
	payload: PhaseCache,
): string {
	if (payload.schemaVersion !== CACHE_SCHEMA_VERSION) {
		throw new Error(
			`writePhaseCache refuses to write payload with schemaVersion=${payload.schemaVersion}; expected ${CACHE_SCHEMA_VERSION}`,
		);
	}
	if (payload.phase !== pathInput.phase) {
		throw new Error(
			`writePhaseCache phase mismatch: payload.phase=${payload.phase} but pathInput.phase=${pathInput.phase}`,
		);
	}
	const path = phaseCachePath(pathInput);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(payload, null, 2));
	return path;
}

/**
 * Read a phase cache, asserting schema and fingerprint identity. Returns
 * null when the file does not exist; throws on mismatch so a stale
 * cache cannot silently feed downstream phases.
 */
export function readPhaseCache(pathInput: CachePathInput): PhaseCache | null {
	const path = phaseCachePath(pathInput);
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
	const parsed = JSON.parse(raw) as PhaseCache;
	if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) {
		throw new CacheSchemaMismatchError(
			path,
			parsed.schemaVersion as number,
			CACHE_SCHEMA_VERSION,
		);
	}
	if (parsed.phase !== pathInput.phase) {
		throw new Error(
			`phase cache phase mismatch at ${path}: stored=${parsed.phase}, expected=${pathInput.phase}`,
		);
	}
	if (parsed.runConfigFingerprint !== pathInput.runConfigFingerprint) {
		throw new CacheFingerprintMismatchError(
			path,
			parsed.runConfigFingerprint,
			pathInput.runConfigFingerprint,
		);
	}
	return parsed;
}
