/**
 * Pure helpers for the dogfood quality-queries pipeline. Extracted from
 * `scripts/dogfood.ts` so the autoresearch sweep can phase-split the
 * pipeline into embed → search → score for single-GPU mode-switch
 * deployments.
 *
 * Step 1 of the 3-phase sweep refactor — no behavior change. Today the
 * pipeline still runs as a single shot; later steps add cache-backed
 * `runSearch` / `scoreFromCachedSearch` boundaries.
 */

import {
	type DocumentCatalog,
	type Edge,
	type Embedder,
	type EvalStageResult,
	type HeadManifest,
	type Reranker,
	type Segment,
	type VectorIndex,
} from "@wtfoc/common";
import { catalogFilePath, loadAllOverlayEdges, readCatalog } from "@wtfoc/ingest";
import {
	CachingEmbedder,
	evaluateQualityQueries,
	type GoldQuery,
	GOLD_STANDARD_QUERIES,
	InMemoryVectorIndex,
	OpenAIEmbedder,
	type PreflightStatus,
	runPreflight,
} from "@wtfoc/search";
import { namespacedCacheDir } from "./cache-namespace.js";
import { CostAggregator } from "./cost-aggregator.js";
import {
	type CachePathInput,
	type EmbedPhaseCacheV1,
	type SearchPhaseCacheV1,
	CACHE_SCHEMA_VERSION,
	readPhaseCache,
	writePhaseCache,
} from "./dogfood-cache.js";
import {
	GRADER_PROMPT_VERSION,
	GRADER_SYSTEM_PROMPT,
	SYNTHESIS_PROMPT_VERSION,
	SYNTHESIS_SYSTEM_PROMPT,
} from "./grounding-prompts.js";
import { runGrounding } from "./grounding-runner.js";
import type { LlmUsage } from "./llm-usage.js";
import { sha256Hex } from "./run-config.js";
import { SubstageTimer } from "./substage-timer.js";
import { TimingVectorIndex } from "./timing-vector-index.js";

export interface BuildRetrievalContextInput {
	collectionId: string;
	manifestDir: string;
	manifest: HeadManifest;
	segments: Segment[];
	runConfigFingerprint: string;
	embedderUrl: string;
	embedderModel: string;
	embedderApiKey?: string;
	embedderCacheDir?: string;
	retrievalOverrides: {
		topK?: number;
		traceMaxPerSource?: number;
		traceMaxTotal?: number;
		traceMinScore?: number;
	};
	timer: SubstageTimer;
	embedderUsageSink: (u: LlmUsage) => void;
}

export interface RetrievalContext {
	embedder: Embedder;
	vectorIndex: VectorIndex;
	segments: Segment[];
	overlayEdges: Edge[];
	documentCatalog: DocumentCatalog | null;
	preflightStatusByQueryId: Map<string, PreflightStatus>;
	retrievalOverrides: BuildRetrievalContextInput["retrievalOverrides"];
	corpusSourceTypes: Set<string>;
	collectionId: string;
}

/**
 * Build the retrieval context the quality-queries stage needs. Pure
 * setup: constructs the embedder (caching when configured), populates
 * an in-memory vector index from segment chunks, loads overlay edges
 * and document catalog, and runs the catalog-applicability preflight
 * for the active corpus.
 */
export async function buildRetrievalContext(
	input: BuildRetrievalContextInput,
): Promise<RetrievalContext> {
	const rawEmbedder = new OpenAIEmbedder({
		apiKey: input.embedderApiKey || "no-key",
		baseUrl: input.embedderUrl,
		model: input.embedderModel,
		usageSink: input.embedderUsageSink,
	});
	const embedder = input.embedderCacheDir
		? new CachingEmbedder(rawEmbedder, {
				cacheDir: namespacedCacheDir(
					input.embedderCacheDir,
					input.runConfigFingerprint,
				),
				provider: "openai-compatible",
				modelVersion: "unknown",
			})
		: rawEmbedder;

	const baseVectorIndex = new InMemoryVectorIndex();
	for (const seg of input.segments) {
		const entries = seg.chunks
			.filter(
				(c: { embedding?: number[] }) =>
					c.embedding && c.embedding.length > 0,
			)
			.map(
				(c: {
					id: string;
					storageId: string;
					content: string;
					sourceType: string;
					source: string;
					sourceUrl?: string;
					embedding: number[];
					metadata?: Record<string, string>;
					signalScores?: Record<string, number>;
				}) => ({
					id: c.id,
					vector: new Float32Array(c.embedding),
					storageId: c.storageId || c.id,
					metadata: {
						sourceType: c.sourceType,
						source: c.source,
						sourceUrl: c.sourceUrl ?? "",
						content: c.content,
						...(c.metadata ?? {}),
						...(c.signalScores && Object.keys(c.signalScores).length > 0
							? { signalScores: JSON.stringify(c.signalScores) }
							: {}),
					},
				}),
			);
		if (entries.length > 0) {
			await baseVectorIndex.add(entries);
		}
	}
	const vectorIndex = new TimingVectorIndex(baseVectorIndex, (ms) =>
		input.timer.record("vector-retrieve", ms),
	);

	const overlayEdges = await loadAllOverlayEdges(
		input.manifestDir,
		input.collectionId,
	);

	const corpusSourceTypes = new Set<string>();
	for (const segSummary of input.manifest.segments) {
		for (const st of segSummary.sourceTypes ?? []) corpusSourceTypes.add(st);
	}

	const catPath = catalogFilePath(input.manifestDir, input.collectionId);
	const documentCatalog = await readCatalog(catPath);
	const preflightStatusByQueryId = new Map<string, PreflightStatus>();
	if (documentCatalog) {
		const localQueries = GOLD_STANDARD_QUERIES.filter((q) =>
			q.applicableCorpora.includes(input.collectionId),
		).map((q) => ({ ...q, applicableCorpora: [input.collectionId] }));
		const preflight = runPreflight({
			queries: localQueries,
			catalogs: [{ corpusId: input.collectionId, catalog: documentCatalog }],
		});
		if (preflight.hardErrors.length > 0) {
			console.warn(
				`[dogfood] preflight hard-errors (${preflight.hardErrors.length}); skipping fixture-invalid wiring`,
			);
			for (const e of preflight.hardErrors) console.warn(`  - ${e}`);
		} else {
			for (const r of preflight.results) {
				if (r.corpusId === input.collectionId) {
					preflightStatusByQueryId.set(r.queryId, r.status);
				}
			}
		}
	}

	return {
		embedder,
		vectorIndex,
		segments: input.segments,
		overlayEdges,
		documentCatalog,
		preflightStatusByQueryId,
		retrievalOverrides: input.retrievalOverrides,
		corpusSourceTypes,
		collectionId: input.collectionId,
	};
}

export interface QualityQueriesPipelineOptions {
	reranker?: Reranker;
	autoRoute: boolean;
	diversityEnforce: boolean;
	checkParaphrases: boolean;
	timer: SubstageTimer;
	costs: CostAggregator;
	groundingEnabled: boolean;
	graderConfig: { url: string; model: string; apiKey?: string } | null;
	synthesizerConfig: { url: string; model: string; apiKey?: string } | null;
}

/**
 * Run the quality-queries pipeline over a prebuilt retrieval context.
 * Today this is a thin wrapper around `evaluateQualityQueries` plus the
 * optional citation/grounding pass; later steps split this into
 * `runSearch` (embed + retrieve + rerank) and `scoreFromCachedSearch`
 * (extract + rubric scoring) so a phase planner can call them
 * separately around a `ensureMode` swap.
 */
export async function runQualityQueriesPipeline(
	ctx: RetrievalContext,
	opts: QualityQueriesPipelineOptions,
): Promise<EvalStageResult> {
	const result = await evaluateQualityQueries(
		ctx.embedder,
		ctx.vectorIndex,
		ctx.segments,
		undefined,
		ctx.overlayEdges,
		opts.reranker,
		opts.autoRoute,
		{
			collectionId: ctx.collectionId,
			corpusSourceTypes: ctx.corpusSourceTypes,
			perQueryHook: (id, ms) => opts.timer.record("per-query-total", ms),
			checkParaphrases: opts.checkParaphrases,
			...(ctx.preflightStatusByQueryId.size > 0
				? { preflightStatusByQueryId: ctx.preflightStatusByQueryId }
				: {}),
			...(Object.keys(ctx.retrievalOverrides).length > 0
				? { retrievalOverrides: ctx.retrievalOverrides }
				: {}),
			...(ctx.documentCatalog ? { documentCatalog: ctx.documentCatalog } : {}),
			...(process.env.WTFOC_RECIPE_GINI_FLOOR
				? { coverageGiniFloor: Number(process.env.WTFOC_RECIPE_GINI_FLOOR) }
				: {}),
			...(process.env.WTFOC_RECIPE_MIN_UNCOVERED_STRATA
				? {
						coverageMinUncoveredStrata: Number(
							process.env.WTFOC_RECIPE_MIN_UNCOVERED_STRATA,
						),
					}
				: {}),
		},
		opts.diversityEnforce,
	);

	let grounding: Awaited<ReturnType<typeof runGrounding>> | null = null;
	if (opts.groundingEnabled && opts.graderConfig && opts.synthesizerConfig) {
		const synthSink = (u: LlmUsage): void => {
			if (typeof u.durationMs === "number") opts.timer.record("synthesize", u.durationMs);
			opts.costs.record("synthesize", u);
		};
		const graderSink = (u: LlmUsage): void => {
			if (typeof u.durationMs === "number") opts.timer.record("grade", u.durationMs);
			opts.costs.record("grade", u);
		};
		const synthQueries = activeGoldQueries(ctx.collectionId)
			.filter((q) => q.queryType === "howto")
			.map((q) => ({ id: q.id, queryText: q.query }));
		console.error(
			`[dogfood] grounding: ${synthQueries.length} synthesis-tier queries (grader=${opts.graderConfig.model})`,
		);
		grounding = await runGrounding({
			queries: synthQueries,
			synthesizer: opts.synthesizerConfig,
			grader: opts.graderConfig,
			embedder: ctx.embedder,
			vectorIndex: ctx.vectorIndex,
			reranker: opts.reranker,
			topK: 10,
			synthesizerUsageSink: synthSink,
			graderUsageSink: graderSink,
		});
	}

	result.metrics = {
		...result.metrics,
		timing: opts.timer.allStats(),
		cost: opts.costs.allStats(),
		...(grounding ? { grounding } : {}),
	};

	return result;
}

/**
 * Compute prompt hashes used to namespace grounding caches. Returns an
 * empty record when grounding is disabled so the run-config fingerprint
 * stays stable across runs without grounding.
 */
export function groundingPromptHashes(enabled: boolean): Record<string, string> {
	if (!enabled) return {};
	return {
		synthesis: `${SYNTHESIS_PROMPT_VERSION}:${sha256Hex(SYNTHESIS_SYSTEM_PROMPT)}`,
		grader: `${GRADER_PROMPT_VERSION}:${sha256Hex(GRADER_SYSTEM_PROMPT)}`,
	};
}

/**
 * Resolve the gold-standard queries that apply to a given corpus.
 * Pure — used by every phase to enumerate the active query set.
 */
export function activeGoldQueries(collectionId: string): GoldQuery[] {
	return GOLD_STANDARD_QUERIES.filter((q) =>
		q.applicableCorpora.includes(collectionId),
	);
}

export interface PhaseCachePathBase {
	cacheBase: string;
	sweepId: string;
	variantId: string;
}

function pathFor(
	base: PhaseCachePathBase,
	ctx: { collectionId: string },
	fingerprint: string,
	phase: "embed" | "search" | "score",
): CachePathInput {
	return {
		base: base.cacheBase,
		sweepId: base.sweepId,
		variantId: base.variantId,
		corpus: ctx.collectionId,
		runConfigFingerprint: fingerprint,
		phase,
	};
}

/**
 * Embed phase: warm the embedder cache for every active query so the
 * search phase can run without an embed-mode GPU. Idempotent — calling
 * the embedder for an already-cached query is a free hash lookup. Emits
 * an `EmbedPhaseCacheV1` manifest the next phase asserts against.
 */
export async function runEmbedPhase(
	ctx: RetrievalContext,
	cachePath: PhaseCachePathBase,
	opts: { runConfigFingerprint: string; embedderUrl: string; embedderModel: string; embedderCacheDir: string | null },
): Promise<EmbedPhaseCacheV1> {
	const queries = activeGoldQueries(ctx.collectionId);
	for (const q of queries) {
		await ctx.embedder.embed(q.query);
	}
	const payload: EmbedPhaseCacheV1 = {
		schemaVersion: CACHE_SCHEMA_VERSION,
		phase: "embed",
		capturedAt: new Date().toISOString(),
		runConfigFingerprint: opts.runConfigFingerprint,
		collectionId: ctx.collectionId,
		embedderModel: opts.embedderModel,
		embedderUrl: opts.embedderUrl,
		embedderCacheDir: opts.embedderCacheDir,
		warmedQueryIds: queries.map((q) => q.id),
	};
	writePhaseCache(
		pathFor(cachePath, ctx, opts.runConfigFingerprint, "embed"),
		payload,
	);
	return payload;
}

export interface SearchPhaseOptions {
	reranker?: Reranker;
	autoRoute: boolean;
	diversityEnforce: boolean;
	checkParaphrases: boolean;
	timer: SubstageTimer;
	costs: CostAggregator;
	manifestId: string;
	segmentIds: string[];
	rerankerIdentity: { type: string; model?: string; url?: string } | null;
	documentCatalogId: string | null;
	runConfigFingerprint: string;
}

/**
 * Search phase: run the deterministic-scoring quality-queries evaluator
 * (no grounding) and persist the result so the score phase can replay
 * it under a different GPU mode.
 */
export async function runSearchPhase(
	ctx: RetrievalContext,
	cachePath: PhaseCachePathBase,
	opts: SearchPhaseOptions,
): Promise<{ stageResult: EvalStageResult; cache: SearchPhaseCacheV1 }> {
	const stageResult = await evaluateQualityQueries(
		ctx.embedder,
		ctx.vectorIndex,
		ctx.segments,
		undefined,
		ctx.overlayEdges,
		opts.reranker,
		opts.autoRoute,
		{
			collectionId: ctx.collectionId,
			corpusSourceTypes: ctx.corpusSourceTypes,
			perQueryHook: (id, ms) => opts.timer.record("per-query-total", ms),
			checkParaphrases: opts.checkParaphrases,
			...(ctx.preflightStatusByQueryId.size > 0
				? { preflightStatusByQueryId: ctx.preflightStatusByQueryId }
				: {}),
			...(Object.keys(ctx.retrievalOverrides).length > 0
				? { retrievalOverrides: ctx.retrievalOverrides }
				: {}),
			...(ctx.documentCatalog ? { documentCatalog: ctx.documentCatalog } : {}),
			...(process.env.WTFOC_RECIPE_GINI_FLOOR
				? { coverageGiniFloor: Number(process.env.WTFOC_RECIPE_GINI_FLOOR) }
				: {}),
			...(process.env.WTFOC_RECIPE_MIN_UNCOVERED_STRATA
				? {
						coverageMinUncoveredStrata: Number(
							process.env.WTFOC_RECIPE_MIN_UNCOVERED_STRATA,
						),
					}
				: {}),
		},
		opts.diversityEnforce,
	);

	const queries = activeGoldQueries(ctx.collectionId);
	const preflight: Record<string, PreflightStatus> = {};
	for (const [id, status] of ctx.preflightStatusByQueryId.entries()) {
		preflight[id] = status;
	}

	const cache: SearchPhaseCacheV1 = {
		schemaVersion: CACHE_SCHEMA_VERSION,
		phase: "search",
		capturedAt: new Date().toISOString(),
		runConfigFingerprint: opts.runConfigFingerprint,
		collectionId: ctx.collectionId,
		manifestId: opts.manifestId,
		segmentIds: opts.segmentIds,
		activeQueryIds: queries.map((q) => q.id),
		preflight,
		corpusSourceTypes: [...ctx.corpusSourceTypes],
		documentCatalogId: opts.documentCatalogId,
		retrievalOverrides: ctx.retrievalOverrides,
		reranker: opts.rerankerIdentity,
		diversityEnforce: opts.diversityEnforce,
		autoRoute: opts.autoRoute,
		stageResult,
		searchTiming: opts.timer.allStats(),
		searchCost: opts.costs.allStats(),
	};
	writePhaseCache(
		pathFor(cachePath, ctx, opts.runConfigFingerprint, "search"),
		cache,
	);
	return { stageResult, cache };
}

export interface ScorePhaseOptions {
	reranker?: Reranker;
	timer: SubstageTimer;
	costs: CostAggregator;
	groundingEnabled: boolean;
	graderConfig: { url: string; model: string; apiKey?: string } | null;
	synthesizerConfig: { url: string; model: string; apiKey?: string } | null;
}

/**
 * Score phase: replay the cached search-phase EvalStageResult and layer
 * the optional grounding pass on top. When grounding is disabled this
 * phase is a deterministic projection of the search-phase output —
 * still safe to call so the dogfood report shape stays uniform across
 * configurations.
 */
export async function runScorePhase(
	ctx: RetrievalContext,
	searchCache: SearchPhaseCacheV1,
	opts: ScorePhaseOptions,
): Promise<EvalStageResult> {
	const result = searchCache.stageResult as EvalStageResult;
	let grounding: Awaited<ReturnType<typeof runGrounding>> | null = null;
	if (opts.groundingEnabled && opts.graderConfig && opts.synthesizerConfig) {
		const synthSink = (u: LlmUsage): void => {
			if (typeof u.durationMs === "number") opts.timer.record("synthesize", u.durationMs);
			opts.costs.record("synthesize", u);
		};
		const graderSink = (u: LlmUsage): void => {
			if (typeof u.durationMs === "number") opts.timer.record("grade", u.durationMs);
			opts.costs.record("grade", u);
		};
		const synthQueries = activeGoldQueries(ctx.collectionId)
			.filter((q) => q.queryType === "howto")
			.map((q) => ({ id: q.id, queryText: q.query }));
		console.error(
			`[dogfood] grounding: ${synthQueries.length} synthesis-tier queries (grader=${opts.graderConfig.model})`,
		);
		grounding = await runGrounding({
			queries: synthQueries,
			synthesizer: opts.synthesizerConfig,
			grader: opts.graderConfig,
			embedder: ctx.embedder,
			vectorIndex: ctx.vectorIndex,
			reranker: opts.reranker,
			topK: 10,
			synthesizerUsageSink: synthSink,
			graderUsageSink: graderSink,
		});
	}
	result.metrics = {
		...result.metrics,
		timing: opts.timer.allStats(),
		cost: opts.costs.allStats(),
		...(grounding ? { grounding } : {}),
	};
	return result;
}

/**
 * Read the search-phase cache for a (sweep, variant, corpus, fingerprint)
 * tuple. Returns null when missing — callers (typically `--phase=score`
 * standalone runs) decide whether absence is fatal.
 */
export function loadSearchPhaseCache(
	cacheBase: PhaseCachePathBase,
	collectionId: string,
	runConfigFingerprint: string,
): SearchPhaseCacheV1 | null {
	const cache = readPhaseCache({
		base: cacheBase.cacheBase,
		sweepId: cacheBase.sweepId,
		variantId: cacheBase.variantId,
		corpus: collectionId,
		runConfigFingerprint,
		phase: "search",
	});
	return cache as SearchPhaseCacheV1 | null;
}
