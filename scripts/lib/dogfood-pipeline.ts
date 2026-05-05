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
	GOLD_STANDARD_QUERIES,
	InMemoryVectorIndex,
	OpenAIEmbedder,
	type PreflightStatus,
	runPreflight,
} from "@wtfoc/search";
import { namespacedCacheDir } from "./cache-namespace.js";
import { CostAggregator } from "./cost-aggregator.js";
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
	collectionId: string;
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
		const synthQueries = GOLD_STANDARD_QUERIES.filter(
			(q) =>
				q.queryType === "howto" &&
				q.applicableCorpora.includes(opts.collectionId),
		).map((q) => ({ id: q.id, queryText: q.query }));
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
