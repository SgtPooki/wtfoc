/**
 * Parity test: a single-shot quality-queries run must produce the same
 * stageResult as a phase-split run (embed → search → score) routed
 * through the on-disk cache. This is the gate the 3-phase sweep
 * refactor needs before mode-switch sequencing — if the phase split
 * silently changes scoring, the sweep would be optimizing against a
 * different signal than the published baseline.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalStageResult, Segment } from "@wtfoc/common";

const evaluateQualityQueriesMock = vi.hoisted(() =>
	vi.fn<() => Promise<EvalStageResult>>(),
);

vi.mock("@wtfoc/search", async () => {
	const actual = await vi.importActual<typeof import("@wtfoc/search")>(
		"@wtfoc/search",
	);
	return {
		...actual,
		evaluateQualityQueries: evaluateQualityQueriesMock,
	};
});

const {
	runEmbedPhase,
	runQualityQueriesPipeline,
	runScorePhase,
	runSearchPhase,
	loadSearchPhaseCache,
} = await import("./dogfood-pipeline.js");

import { CostAggregator } from "./cost-aggregator.js";
import type { RetrievalContext } from "./dogfood-pipeline.js";
import { SubstageTimer } from "./substage-timer.js";

function buildStub(): EvalStageResult {
	return {
		stage: "quality-queries",
		startedAt: "2026-05-05T00:00:00Z",
		durationMs: 100,
		verdict: "pass",
		summary: "stub: 3/3 passed",
		metrics: { passRate: 1.0, total: 3, passed: 3 },
		checks: [],
	};
}

function fakeContext(): RetrievalContext {
	const fakeEmbed = vi
		.fn<(text: string) => Promise<{ vector: Float32Array }>>()
		.mockResolvedValue({ vector: new Float32Array([0.1, 0.2]) });
	return {
		embedder: { embed: fakeEmbed } as unknown as RetrievalContext["embedder"],
		vectorIndex: {} as RetrievalContext["vectorIndex"],
		segments: [] as Segment[],
		overlayEdges: [],
		documentCatalog: null,
		preflightStatusByQueryId: new Map(),
		retrievalOverrides: { topK: 10 },
		corpusSourceTypes: new Set(["github"]),
		collectionId: "demo",
	};
}

function stripVolatile(r: EvalStageResult): EvalStageResult {
	const { startedAt: _s, durationMs: _d, ...rest } = r;
	const m = { ...(rest.metrics as Record<string, unknown>) };
	delete m.timing;
	delete m.cost;
	return {
		...rest,
		startedAt: "FROZEN",
		durationMs: 0,
		metrics: m,
	} as EvalStageResult;
}

describe("phase-split parity", () => {
	let cacheBase: string;
	beforeEach(() => {
		cacheBase = mkdtempSync(join(tmpdir(), "wtfoc-parity-"));
		evaluateQualityQueriesMock.mockReset();
		evaluateQualityQueriesMock.mockResolvedValue(buildStub());
	});
	afterEach(() => {
		rmSync(cacheBase, { recursive: true, force: true });
	});

	it("single-shot stageResult ≡ phase-split (embed → search → score)", async () => {
		const ctx = fakeContext();
		const fingerprint = "fp_parity_1";

		const singleShot = await runQualityQueriesPipeline(ctx, {
			autoRoute: false,
			diversityEnforce: false,
			checkParaphrases: false,
			timer: new SubstageTimer(),
			costs: new CostAggregator(),
			groundingEnabled: false,
			graderConfig: null,
			synthesizerConfig: null,
			collectionId: "demo",
		});

		const cachePath = {
			cacheBase,
			sweepId: "sw_1",
			variantId: "v_a",
		};

		await runEmbedPhase(ctx, cachePath, {
			runConfigFingerprint: fingerprint,
			embedderUrl: "http://embedder",
			embedderModel: "stub",
			embedderCacheDir: null,
		});

		await runSearchPhase(ctx, cachePath, {
			autoRoute: false,
			diversityEnforce: false,
			checkParaphrases: false,
			timer: new SubstageTimer(),
			costs: new CostAggregator(),
			collectionId: "demo",
			manifestId: "m1",
			segmentIds: [],
			rerankerIdentity: null,
			documentCatalogId: null,
			runConfigFingerprint: fingerprint,
		});

		const cached = loadSearchPhaseCache(cachePath, "demo", fingerprint);
		expect(cached).not.toBeNull();
		const phaseSplit = await runScorePhase(ctx, cached!, {
			timer: new SubstageTimer(),
			costs: new CostAggregator(),
			groundingEnabled: false,
			graderConfig: null,
			synthesizerConfig: null,
			collectionId: "demo",
		});

		expect(stripVolatile(phaseSplit)).toEqual(stripVolatile(singleShot));
		// evaluateQualityQueries must have been called the same number of
		// times in both paths (once for single-shot, once for the search
		// phase) — score phase replays from cache rather than re-running.
		expect(evaluateQualityQueriesMock).toHaveBeenCalledTimes(2);
	});

	it("phase-split: score phase does NOT re-invoke evaluateQualityQueries", async () => {
		const ctx = fakeContext();
		const fingerprint = "fp_parity_2";
		const cachePath = { cacheBase, sweepId: "sw_2", variantId: "v_b" };

		await runSearchPhase(ctx, cachePath, {
			autoRoute: false,
			diversityEnforce: false,
			checkParaphrases: false,
			timer: new SubstageTimer(),
			costs: new CostAggregator(),
			collectionId: "demo",
			manifestId: "m1",
			segmentIds: [],
			rerankerIdentity: null,
			documentCatalogId: null,
			runConfigFingerprint: fingerprint,
		});
		expect(evaluateQualityQueriesMock).toHaveBeenCalledTimes(1);

		const cached = loadSearchPhaseCache(cachePath, "demo", fingerprint);
		await runScorePhase(ctx, cached!, {
			timer: new SubstageTimer(),
			costs: new CostAggregator(),
			groundingEnabled: false,
			graderConfig: null,
			synthesizerConfig: null,
			collectionId: "demo",
		});
		expect(evaluateQualityQueriesMock).toHaveBeenCalledTimes(1);
	});
});
