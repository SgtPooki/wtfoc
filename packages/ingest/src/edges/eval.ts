/**
 * Edge-quality evaluation harness.
 *
 * Runs the LLM extraction pipeline against frozen fixture chunks,
 * compares results to a gold set, and reports precision/recall/F1
 * at three stages: raw LLM output, post-normalization, post-gate.
 *
 * Designed for real LLM calls — no mocking.
 */

import type { Chunk, Edge, StructuredEvidence } from "@wtfoc/common";
import { FIXTURE_CHUNKS } from "./__fixtures__/chunks.js";
import {
	type ForbiddenEdge,
	GOLD_SET,
	GOLD_SET_VERSION,
	type GoldEdge,
	type GoldEntry,
	type MatchMode,
} from "./__fixtures__/gold-set.js";
import { type ValidationResult, validateEdges } from "./edge-validator.js";
import { normalizeEdgeType } from "./llm.js";
import { chatCompletion, type LlmClientOptions, parseJsonResponse } from "./llm-client.js";
import { buildExtractionMessages, estimatePromptOverhead, estimateTokens } from "./llm-prompt.js";
import { Semaphore } from "./semaphore.js";

// ── Types ───────────────────────────────────────────────────────────

interface RawLlmEdge {
	type?: string;
	sourceId?: string;
	targetType?: string;
	targetId?: string;
	evidence?: string;
	confidence?: number;
}

export interface EdgeTypeMetrics {
	type: string;
	truePositives: number;
	falsePositives: number;
	falseNegatives: number;
	precision: number;
	recall: number;
	f1: number;
}

export interface StageMetrics {
	/** Stage name: "raw", "normalized", or "gated" */
	stage: string;
	/** Total edges produced at this stage */
	edgeCount: number;
	/** Per-canonical-type metrics */
	perType: EdgeTypeMetrics[];
	/** Micro-averaged precision across all types */
	microPrecision: number;
	/** Micro-averaged recall across all types */
	microRecall: number;
	/** Micro-averaged F1 across all types */
	microF1: number;
	/** Macro-averaged F1 (average of per-type F1s, excluding types with no gold edges) */
	macroF1: number;
}

export interface GateMetrics {
	/** Number of edges accepted by gates */
	accepted: number;
	/** Number of edges rejected by gates */
	rejected: number;
	/** Number of edges downgraded (type changed by gates) */
	downgraded: number;
	/** Acceptance rate */
	acceptanceRate: number;
	/** Downgrade rate (out of accepted) */
	downgradeRate: number;
	/** Rejection rate */
	rejectionRate: number;
	/** Gold edges that survived gating */
	goldSurvivalRate: number;
}

export interface CoverageMetrics {
	/** Total batches attempted */
	totalBatches: number;
	/** Batches that completed successfully */
	succeededBatches: number;
	/** Batches that failed (timeout, error, etc.) */
	failedBatches: number;
	/** Total chunks in the fixture set */
	totalChunks: number;
	/** Chunks that were in successful batches (actually evaluated) */
	evaluatedChunks: number;
	/** Chunks that were in failed batches (not evaluated) */
	skippedChunks: number;
	/** IDs of chunks that were skipped */
	skippedChunkIds: string[];
}

export interface NegativeMetrics {
	/** Chunks expected to produce no edges */
	hardNegativeChunks: number;
	/** Hard negative chunks that correctly produced 0 edges */
	hardNegativeCorrect: number;
	/** Forbidden edge violations (specific edge types that appeared when they shouldn't) */
	forbiddenViolations: Array<{ chunkId: string; edge: Edge; forbidden: ForbiddenEdge }>;
}

export interface EvalReport {
	/** Timestamp of the eval run */
	timestamp: string;
	/** Gold set version */
	goldSetVersion: string;
	/** LLM model used */
	model: string;
	/** LLM endpoint base URL */
	baseUrl: string;
	/** Metrics at each pipeline stage */
	stages: StageMetrics[];
	/** Acceptance gate behavior */
	gates: GateMetrics;
	/** Coverage — how much of the fixture set was actually evaluated */
	coverage: CoverageMetrics;
	/** Negative example performance */
	negatives: NegativeMetrics;
	/** Total chunks in fixture set */
	chunkCount: number;
	/** Total wall-clock time in ms */
	durationMs: number;
	/** Token usage if reported by LLM */
	tokenUsage?: { prompt: number; completion: number; total: number };
}

// ── Matching ────────────────────────────────────────────────────────

function matchesTarget(produced: string, pattern: string, mode: MatchMode): boolean {
	switch (mode) {
		case "exact":
			return produced === pattern;
		case "substring":
			return produced.toLowerCase().includes(pattern.toLowerCase());
		case "regex":
			return new RegExp(pattern, "i").test(produced);
	}
}

function edgeMatchesGold(edge: Edge, gold: GoldEdge): boolean {
	// Primary match: exact type + targetType + targetId pattern
	if (
		edge.type === gold.type &&
		edge.targetType === gold.targetType &&
		matchesTarget(edge.targetId, gold.targetPattern, gold.match)
	) {
		return true;
	}
	// Acceptable alternatives: if the gold edge defines them, try those too
	if (gold.acceptableAlternatives) {
		for (const alt of gold.acceptableAlternatives) {
			const altType = alt.type ?? gold.type;
			const altTargetType = alt.targetType ?? gold.targetType;
			const altPattern = alt.targetPattern ?? gold.targetPattern;
			const altMatch = alt.match ?? gold.match;
			if (
				edge.type === altType &&
				edge.targetType === altTargetType &&
				matchesTarget(edge.targetId, altPattern, altMatch)
			) {
				return true;
			}
		}
	}
	return false;
}

function edgeMatchesForbidden(edge: Edge, forbidden: ForbiddenEdge): boolean {
	if (edge.type !== forbidden.type) return false;
	if (forbidden.targetType && edge.targetType !== forbidden.targetType) return false;
	return true;
}

// ── Scoring ─────────────────────────────────────────────────────────

/**
 * Score a set of produced edges against the gold set.
 * Uses one-to-one assignment: each produced edge can satisfy at most one gold edge.
 * Only scores against gold entries whose chunks were actually evaluated.
 */
function scoreEdges(
	producedEdges: Edge[],
	goldEntries: GoldEntry[],
	evaluatedChunkIds: Set<string>,
): {
	perType: Map<string, { tp: number; fp: number; fn: number }>;
	totalTp: number;
	totalFp: number;
	totalFn: number;
} {
	const perType = new Map<string, { tp: number; fp: number; fn: number }>();

	const ensureType = (type: string) => {
		if (!perType.has(type)) perType.set(type, { tp: 0, fp: 0, fn: 0 });
	};

	// Build a lookup of produced edges by chunk
	const producedByChunk = new Map<string, Edge[]>();
	for (const edge of producedEdges) {
		const list = producedByChunk.get(edge.sourceId) ?? [];
		list.push(edge);
		producedByChunk.set(edge.sourceId, list);
	}

	let totalTp = 0;
	let totalFp = 0;
	let totalFn = 0;

	for (const entry of goldEntries) {
		// Skip gold entries for chunks that were not evaluated (timed out, etc.)
		if (!evaluatedChunkIds.has(entry.chunkId)) continue;

		const chunkEdges = [...(producedByChunk.get(entry.chunkId) ?? [])];
		const matchedProduced = new Set<number>();

		// Match gold edges (one-to-one assignment)
		for (const gold of entry.expectedEdges) {
			ensureType(gold.type);
			let matched = false;
			for (let i = 0; i < chunkEdges.length; i++) {
				if (matchedProduced.has(i)) continue;
				const candidate = chunkEdges[i];
				if (candidate && edgeMatchesGold(candidate, gold)) {
					matchedProduced.add(i);
					matched = true;
					break;
				}
			}
			const metrics = perType.get(gold.type);
			if (metrics && matched) {
				metrics.tp++;
				totalTp++;
			} else if (metrics) {
				metrics.fn++;
				totalFn++;
			}
		}

		// Unmatched produced edges are false positives
		for (let i = 0; i < chunkEdges.length; i++) {
			if (!matchedProduced.has(i)) {
				const edge = chunkEdges[i];
				if (!edge) continue;
				ensureType(edge.type);
				const m = perType.get(edge.type);
				if (m) m.fp++;
				totalFp++;
			}
		}
	}

	return { perType, totalTp, totalFp, totalFn };
}

function computeStageMetrics(
	stage: string,
	producedEdges: Edge[],
	goldEntries: GoldEntry[],
	evaluatedChunkIds: Set<string>,
): StageMetrics {
	const { perType, totalTp, totalFp, totalFn } = scoreEdges(
		producedEdges,
		goldEntries,
		evaluatedChunkIds,
	);

	const perTypeMetrics: EdgeTypeMetrics[] = [];
	let f1Sum = 0;
	let f1Count = 0;

	for (const [type, counts] of perType) {
		const precision = counts.tp + counts.fp > 0 ? counts.tp / (counts.tp + counts.fp) : 0;
		const recall = counts.tp + counts.fn > 0 ? counts.tp / (counts.tp + counts.fn) : 0;
		const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

		perTypeMetrics.push({
			type,
			truePositives: counts.tp,
			falsePositives: counts.fp,
			falseNegatives: counts.fn,
			precision,
			recall,
			f1,
		});

		// Only include types that have gold edges in macro average
		if (counts.tp + counts.fn > 0) {
			f1Sum += f1;
			f1Count++;
		}
	}

	// Sort by type for consistent output
	perTypeMetrics.sort((a, b) => a.type.localeCompare(b.type));

	const microPrecision = totalTp + totalFp > 0 ? totalTp / (totalTp + totalFp) : 0;
	const microRecall = totalTp + totalFn > 0 ? totalTp / (totalTp + totalFn) : 0;
	const microF1 =
		microPrecision + microRecall > 0
			? (2 * microPrecision * microRecall) / (microPrecision + microRecall)
			: 0;
	const macroF1 = f1Count > 0 ? f1Sum / f1Count : 0;

	return {
		stage,
		edgeCount: producedEdges.length,
		perType: perTypeMetrics,
		microPrecision,
		microRecall,
		microF1,
		macroF1,
	};
}

// ── Pipeline steps (mirrors LlmEdgeExtractor but exposes intermediates) ─

function parseAndFilterRaw(rawEdges: RawLlmEdge[], validChunkIds: Set<string>): Edge[] {
	const edges: Edge[] = [];
	for (const raw of rawEdges) {
		if (!raw.type || !raw.sourceId || !raw.targetType || !raw.targetId) continue;
		if (!raw.evidence || raw.evidence.trim().length === 0) continue;
		if (!validChunkIds.has(raw.sourceId)) continue;

		const confidence = Math.min(0.8, Math.max(0.3, raw.confidence ?? 0.5));

		edges.push({
			type: raw.type,
			sourceId: raw.sourceId,
			targetType: raw.targetType,
			targetId: raw.targetId,
			evidence: raw.evidence,
			confidence,
		});
	}
	return edges;
}

function normalizeEdges(edges: Edge[], model: string): Edge[] {
	return edges.map((edge) => {
		const canonicalType = normalizeEdgeType(edge.type);
		const structuredEvidence: StructuredEvidence = {
			text: edge.evidence,
			extractor: "llm",
			model,
			observedAt: new Date().toISOString(),
			confidence: edge.confidence,
		};
		return { ...edge, type: canonicalType, structuredEvidence };
	});
}

// ── Main eval function ──────────────────────────────────────────────

export interface EvalOptions extends LlmClientOptions {
	/** Max concurrent LLM requests (default: 2 for eval) */
	maxConcurrency?: number;
	/** Max input tokens per batch (default: 4000) */
	maxInputTokens?: number;
}

export async function runEdgeEval(options: EvalOptions, signal?: AbortSignal): Promise<EvalReport> {
	signal?.throwIfAborted();

	const startTime = Date.now();
	const chunks = FIXTURE_CHUNKS;
	const validChunkIds = new Set(chunks.map((c) => c.id));

	const maxInputTokens = options.maxInputTokens ?? 4000;
	const maxConcurrency = options.maxConcurrency ?? 2;

	// Batch chunks by token budget (same logic as LlmEdgeExtractor)
	const promptOverhead = estimatePromptOverhead();
	const chunkBudget = maxInputTokens - promptOverhead;
	const batches = chunkBudget > 0 ? batchChunks(chunks, chunkBudget) : [];

	// Track which chunks were successfully evaluated
	const evaluatedChunkIds = new Set<string>();
	const skippedChunkIds: string[] = [];
	let failedBatchCount = 0;

	// Run LLM extraction on all batches
	const allRawLlmEdges: RawLlmEdge[] = [];
	let totalPromptTokens = 0;
	let totalCompletionTokens = 0;

	// Concurrency limiter (proper wait-queue, no polling)
	const semaphore = new Semaphore(maxConcurrency);

	const batchResults = await Promise.allSettled(
		batches.map(async (batch, batchIndex) => {
			signal?.throwIfAborted();
			const release = await semaphore.acquire();
			try {
				signal?.throwIfAborted();
				const messages = buildExtractionMessages(batch);
				console.log(
					`[eval] Batch ${batchIndex + 1}/${batches.length}: ${batch.length} chunks, sending to LLM...`,
				);
				const response = await chatCompletion(messages, options, signal);
				if (response.usage) {
					totalPromptTokens += response.usage.prompt_tokens;
					totalCompletionTokens += response.usage.completion_tokens;
				}
				const parsed = parseJsonResponse<RawLlmEdge[]>(response.content);
				const edges = Array.isArray(parsed) ? parsed : [];
				console.log(`[eval] Batch ${batchIndex + 1}: ${edges.length} raw edges extracted`);
				return { edges, chunkIds: batch.map((c) => c.id) };
			} finally {
				release();
			}
		}),
	);

	for (let i = 0; i < batchResults.length; i++) {
		const result = batchResults[i];
		const batch = batches[i];
		if (!result || !batch) continue;
		if (result.status === "rejected") {
			console.error(`[eval] Batch ${i + 1} failed: ${result.reason}`);
			failedBatchCount++;
			for (const chunk of batch) {
				skippedChunkIds.push(chunk.id);
			}
		} else {
			allRawLlmEdges.push(...result.value.edges);
			for (const id of result.value.chunkIds) {
				evaluatedChunkIds.add(id);
			}
		}
	}

	console.log(
		`[eval] Coverage: ${evaluatedChunkIds.size}/${chunks.length} chunks evaluated, ${failedBatchCount}/${batches.length} batches failed`,
	);

	// Stage 1: Raw LLM output (parsed, filtered for required fields, but not normalized)
	const rawEdges = parseAndFilterRaw(allRawLlmEdges, validChunkIds);

	// Stage 2: Normalized (canonical types applied)
	const normalizedEdges = normalizeEdges(rawEdges, options.model);

	// Stage 3: Post-gate (acceptance gates applied)
	const validation = validateEdges(normalizedEdges);
	const gatedEdges = validation.accepted;

	// Count downgrades: edges whose type changed between normalized and gated
	const preGateValidation = validateEdgesWithDowngradeTracking(normalizedEdges);

	// ── Compute metrics (only against evaluated chunks) ─────────────

	const rawStage = computeStageMetrics("raw", rawEdges, GOLD_SET, evaluatedChunkIds);
	const normalizedStage = computeStageMetrics(
		"normalized",
		normalizedEdges,
		GOLD_SET,
		evaluatedChunkIds,
	);
	const gatedStage = computeStageMetrics("gated", gatedEdges, GOLD_SET, evaluatedChunkIds);

	// ── Gate metrics ──────────────────────────────────────────────────

	const evaluatedGoldEntries = GOLD_SET.filter((e) => evaluatedChunkIds.has(e.chunkId));
	const goldEdgeCount = evaluatedGoldEntries.reduce(
		(sum, entry) => sum + entry.expectedEdges.length,
		0,
	);

	const gates: GateMetrics = {
		accepted: preGateValidation.accepted.length,
		rejected: preGateValidation.rejected.length,
		downgraded: preGateValidation.downgraded,
		acceptanceRate:
			normalizedEdges.length > 0 ? preGateValidation.accepted.length / normalizedEdges.length : 1,
		downgradeRate:
			preGateValidation.accepted.length > 0
				? preGateValidation.downgraded / preGateValidation.accepted.length
				: 0,
		rejectionRate:
			normalizedEdges.length > 0 ? preGateValidation.rejected.length / normalizedEdges.length : 0,
		goldSurvivalRate:
			goldEdgeCount > 0
				? gatedStage.perType.reduce((s, t) => s + t.truePositives, 0) / goldEdgeCount
				: 1,
	};

	// ── Coverage metrics ─────────────────────────────────────────────

	const coverage: CoverageMetrics = {
		totalBatches: batches.length,
		succeededBatches: batches.length - failedBatchCount,
		failedBatches: failedBatchCount,
		totalChunks: chunks.length,
		evaluatedChunks: evaluatedChunkIds.size,
		skippedChunks: skippedChunkIds.length,
		skippedChunkIds,
	};

	// ── Negative example metrics ──────────────────────────────────────

	const hardNegativeEntries = GOLD_SET.filter(
		(e) => e.expectNoEdges && evaluatedChunkIds.has(e.chunkId),
	);
	const hardNegativeCorrect = hardNegativeEntries.filter(
		(entry) => !gatedEdges.some((e) => e.sourceId === entry.chunkId),
	).length;

	const forbiddenViolations: NegativeMetrics["forbiddenViolations"] = [];
	for (const entry of GOLD_SET) {
		if (!entry.forbiddenEdges || !evaluatedChunkIds.has(entry.chunkId)) continue;
		for (const forbidden of entry.forbiddenEdges) {
			for (const edge of gatedEdges) {
				if (edge.sourceId === entry.chunkId && edgeMatchesForbidden(edge, forbidden)) {
					forbiddenViolations.push({ chunkId: entry.chunkId, edge, forbidden });
				}
			}
		}
	}

	const negatives: NegativeMetrics = {
		hardNegativeChunks: hardNegativeEntries.length,
		hardNegativeCorrect,
		forbiddenViolations,
	};

	// ── Build report ──────────────────────────────────────────────────

	const report: EvalReport = {
		timestamp: new Date().toISOString(),
		goldSetVersion: GOLD_SET_VERSION,
		model: options.model,
		baseUrl: options.baseUrl,
		stages: [rawStage, normalizedStage, gatedStage],
		gates,
		coverage,
		negatives,
		chunkCount: chunks.length,
		durationMs: Date.now() - startTime,
		tokenUsage:
			totalPromptTokens > 0
				? {
						prompt: totalPromptTokens,
						completion: totalCompletionTokens,
						total: totalPromptTokens + totalCompletionTokens,
					}
				: undefined,
	};

	return report;
}

// ── Helpers ─────────────────────────────────────────────────────────

function batchChunks(chunks: Chunk[], maxTokens: number): Chunk[][] {
	const batches: Chunk[][] = [];
	let currentBatch: Chunk[] = [];
	let currentTokens = 0;
	const perChunkOverhead = 15;

	for (const chunk of chunks) {
		const tokens = estimateTokens(chunk.content) + perChunkOverhead;
		if (currentBatch.length > 0 && currentTokens + tokens > maxTokens) {
			batches.push(currentBatch);
			currentBatch = [];
			currentTokens = 0;
		}
		currentBatch.push(chunk);
		currentTokens += tokens;
	}
	if (currentBatch.length > 0) batches.push(currentBatch);
	return batches;
}

/**
 * Run validateEdges but also track how many edges were downgraded
 * (type changed during validation but still accepted).
 */
function validateEdgesWithDowngradeTracking(
	edges: Edge[],
): ValidationResult & { downgraded: number } {
	// Count types before validation
	const preTypeCounts = new Map<string, number>();
	for (const e of edges) {
		preTypeCounts.set(e.type, (preTypeCounts.get(e.type) ?? 0) + 1);
	}

	const result = validateEdges(edges);

	// Count types after validation (accepted edges only)
	const postTypeCounts = new Map<string, number>();
	for (const e of result.accepted) {
		postTypeCounts.set(e.type, (postTypeCounts.get(e.type) ?? 0) + 1);
	}

	// Downgrades show up as strong types losing count and "references" gaining count.
	// Since validateEdges only downgrades TO "references", we can detect this reliably:
	// downgraded = accepted edges whose type is "references" beyond what was originally "references",
	// capped by how many non-references were lost (to avoid counting rejections as downgrades).
	const preReferences = preTypeCounts.get("references") ?? 0;
	const postReferences = postTypeCounts.get("references") ?? 0;
	const referencesGained = Math.max(0, postReferences - preReferences);

	// Also count how many strong-type edges disappeared from accepted (not rejected, downgraded)
	let strongTypesLost = 0;
	for (const [type, preCount] of preTypeCounts) {
		if (type === "references") continue;
		const postCount = postTypeCounts.get(type) ?? 0;
		const rejectedOfType = result.rejected.filter((r) => r.edge.type === type).length;
		const downgradedsOfType = Math.max(0, preCount - postCount - rejectedOfType);
		strongTypesLost += downgradedsOfType;
	}

	const downgraded = Math.min(referencesGained, strongTypesLost);

	return { ...result, downgraded };
}

// ── Formatting ──────────────────────────────────────────────────────

export function formatEvalReport(report: EvalReport): string {
	const lines: string[] = [];

	lines.push("╔══════════════════════════════════════════════════════════════╗");
	lines.push("║              Edge Quality Evaluation Report                 ║");
	lines.push("╚══════════════════════════════════════════════════════════════╝");
	lines.push("");
	lines.push(`  Model:         ${report.model}`);
	lines.push(`  Endpoint:      ${report.baseUrl}`);
	lines.push(`  Gold set:      ${report.goldSetVersion}`);
	lines.push(`  Chunks:        ${report.chunkCount}`);
	lines.push(`  Duration:      ${(report.durationMs / 1000).toFixed(1)}s`);
	if (report.tokenUsage) {
		lines.push(
			`  Tokens:        ${report.tokenUsage.total} (${report.tokenUsage.prompt}p + ${report.tokenUsage.completion}c)`,
		);
	}
	lines.push("");

	// Coverage section
	lines.push("── COVERAGE ──");
	lines.push("");
	lines.push(
		`  Batches:         ${report.coverage.succeededBatches}/${report.coverage.totalBatches} succeeded`,
	);
	lines.push(
		`  Chunks:          ${report.coverage.evaluatedChunks}/${report.coverage.totalChunks} evaluated`,
	);
	if (report.coverage.skippedChunkIds.length > 0) {
		lines.push(`  Skipped:         ${report.coverage.skippedChunkIds.join(", ")}`);
	}
	lines.push("");

	for (const stage of report.stages) {
		lines.push(`── ${stage.stage.toUpperCase()} (${stage.edgeCount} edges) ──`);
		lines.push("");
		lines.push("  Type             TP   FP   FN   Prec   Rec    F1");
		lines.push("  ───────────────  ───  ───  ───  ─────  ─────  ─────");
		for (const t of stage.perType) {
			lines.push(
				`  ${t.type.padEnd(17)} ${String(t.truePositives).padStart(3)}  ${String(t.falsePositives).padStart(3)}  ${String(t.falseNegatives).padStart(3)}  ${t.precision.toFixed(2).padStart(5)}  ${t.recall.toFixed(2).padStart(5)}  ${t.f1.toFixed(2).padStart(5)}`,
			);
		}
		lines.push("");
		lines.push(
			`  Micro:  P=${stage.microPrecision.toFixed(2)}  R=${stage.microRecall.toFixed(2)}  F1=${stage.microF1.toFixed(2)}`,
		);
		lines.push(`  Macro F1: ${stage.macroF1.toFixed(2)}`);
		lines.push("");
	}

	lines.push("── ACCEPTANCE GATES ──");
	lines.push("");
	lines.push(
		`  Accepted:        ${report.gates.accepted} (${(report.gates.acceptanceRate * 100).toFixed(0)}%)`,
	);
	lines.push(
		`  Rejected:        ${report.gates.rejected} (${(report.gates.rejectionRate * 100).toFixed(0)}%)`,
	);
	lines.push(
		`  Downgraded:      ${report.gates.downgraded} (${(report.gates.downgradeRate * 100).toFixed(0)}% of accepted)`,
	);
	lines.push(`  Gold survival:   ${(report.gates.goldSurvivalRate * 100).toFixed(0)}%`);
	lines.push("");

	lines.push("── NEGATIVE EXAMPLES ──");
	lines.push("");
	lines.push(
		`  Hard negatives:  ${report.negatives.hardNegativeCorrect}/${report.negatives.hardNegativeChunks} correct`,
	);
	lines.push(`  Forbidden violations: ${report.negatives.forbiddenViolations.length}`);
	if (report.negatives.forbiddenViolations.length > 0) {
		for (const v of report.negatives.forbiddenViolations) {
			lines.push(
				`    - ${v.chunkId}: got ${v.edge.type}\u2192${v.edge.targetType}:${v.edge.targetId} (forbidden: ${v.forbidden.type})`,
			);
		}
	}
	lines.push("");

	return lines.join("\n");
}
