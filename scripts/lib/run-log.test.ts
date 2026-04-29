import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	appendRunLogRow,
	buildRunLogRow,
	readRunLog,
	RUN_LOG_SCHEMA_VERSION,
	type RunLogRow,
} from "./run-log.js";
import type { ExtendedDogfoodReport, RunConfig } from "./run-config.js";

function makeReport(overrides: Partial<RunConfig> = {}): ExtendedDogfoodReport {
	const runConfig: RunConfig = {
		collectionId: "test",
		corpusDigest: "abc",
		goldFixtureVersion: "1.9.0",
		goldFixtureHash: "hash",
		embedder: { url: "http://localhost:1/v1", model: "test" },
		extractor: null,
		reranker: null,
		grader: null,
		retrieval: {
			topK: 10,
			traceMaxPerSource: 3,
			traceMaxTotal: 15,
			traceMaxHops: 3,
			traceMinScore: 0.3,
			traceMode: "analytical",
			autoRoute: false,
			diversityEnforce: false,
		},
		promptHashes: {},
		seed: 0,
		gitSha: null,
		packageVersions: {},
		nodeVersion: "24.11",
		cacheNamespaceSchemeVersion: 1,
		...overrides,
	};
	return {
		reportSchemaVersion: "1.0.0",
		timestamp: new Date().toISOString(),
		collectionId: "test",
		collectionName: "test",
		stages: [
			{
				stage: "quality-queries",
				startedAt: new Date().toISOString(),
				durationMs: 0,
				verdict: "pass",
				summary: "synthetic",
				metrics: {
					passRate: 0.65,
					passCount: 100,
					applicableTotal: 153,
					portabilityBreakdown: { portable: { passRate: 0.46 } },
					tierBreakdown: { "demo-critical": { passRate: 1 } },
					categoryBreakdown: { "hard-negative": { passRate: 0 } },
					paraphraseInvariance: {
						checked: true,
						invariantFraction: 0.81,
						withParaphrases: 41,
						allInvariant: 33,
						brittle: 8,
					},
					recallAtK: {
						avgRecallAtK: 0.7,
						graded: 24,
						k: 10,
						demoCriticalAvgRecallAtK: 0.5,
						demoCriticalGraded: 5,
					},
					timing: {
						"embed-call": { p95Ms: 1100 },
						"vector-retrieve": { p95Ms: 40 },
					},
					cost: {
						"embed-call": { cost_usd: 0 },
					},
				},
				checks: [],
			},
		],
		verdict: "pass",
		durationMs: 0,
		runConfig,
		runConfigFingerprint: "fp123",
		fingerprintVersion: 1,
		costComparable: { value: true, reasons: [] },
	};
}

describe("buildRunLogRow", () => {
	it("lifts summary metrics from the report", () => {
		const row = buildRunLogRow({
			sweepId: "sweep-1",
			matrixName: "m",
			variantId: "v",
			report: makeReport(),
			durationMs: 1234,
		});
		expect(row.schemaVersion).toBe(RUN_LOG_SCHEMA_VERSION);
		expect(row.summary.passRate).toBe(0.65);
		expect(row.summary.portablePassRate).toBe(0.46);
		expect(row.summary.demoCriticalPassRate).toBe(1);
		expect(row.summary.hardNegativePassRate).toBe(0);
		expect(row.summary.paraphraseInvariantFraction).toBe(0.81);
		expect(row.summary.recallAtKMean).toBe(0.7);
		expect(row.summary.costComparable).toBe(true);
		expect(row.summary.costUsdTotal).toBe(0);
		expect(row.summary.latencyP95Ms).toBe(1100);
		expect(row.durationMs).toBe(1234);
	});

	it("returns null cost when any substage cost is null", () => {
		const r = makeReport();
		const qq = r.stages.find((s) => s.stage === "quality-queries");
		(qq!.metrics as { cost: Record<string, { cost_usd: number | null }> }).cost = {
			"embed-call": { cost_usd: 0 },
			rerank: { cost_usd: null },
		};
		const row = buildRunLogRow({
			sweepId: "sweep-1",
			matrixName: "m",
			variantId: "v",
			report: r,
			durationMs: 1,
		});
		expect(row.summary.costUsdTotal).toBeNull();
	});

	it("returns null paraphraseInvariantFraction when checks not run", () => {
		const r = makeReport();
		const qq = r.stages.find((s) => s.stage === "quality-queries");
		(
			qq!.metrics as { paraphraseInvariance: { checked: boolean; invariantFraction: number } }
		).paraphraseInvariance = { checked: false, invariantFraction: 0 } as never;
		const row = buildRunLogRow({
			sweepId: "sweep-1",
			matrixName: "m",
			variantId: "v",
			report: r,
			durationMs: 1,
		});
		expect(row.summary.paraphraseInvariantFraction).toBeNull();
	});

	it("includes replicateIdx when set", () => {
		const row = buildRunLogRow({
			sweepId: "sweep-1",
			matrixName: "m",
			variantId: "v",
			report: makeReport(),
			durationMs: 1,
			replicateIdx: 2,
		});
		expect(row.replicateIdx).toBe(2);
	});
});

describe("appendRunLogRow + readRunLog", () => {
	it("round-trips multiple rows", () => {
		const dir = mkdtempSync(join(tmpdir(), "wtfoc-run-log-"));
		const paths = { dir, jsonlPath: join(dir, "runs.jsonl") };
		const row1 = buildRunLogRow({
			sweepId: "s1",
			matrixName: "m",
			variantId: "v1",
			report: makeReport(),
			durationMs: 1,
		});
		const row2 = buildRunLogRow({
			sweepId: "s1",
			matrixName: "m",
			variantId: "v2",
			report: makeReport({ corpusDigest: "diff" }),
			durationMs: 2,
		});
		appendRunLogRow(row1, paths);
		appendRunLogRow(row2, paths);
		const read = readRunLog(paths);
		expect(read).toHaveLength(2);
		expect(read[0]?.variantId).toBe("v1");
		expect(read[1]?.variantId).toBe("v2");
	});

	it("returns [] when file missing", () => {
		const dir = mkdtempSync(join(tmpdir(), "wtfoc-run-log-empty-"));
		const paths = { dir, jsonlPath: join(dir, "nope.jsonl") };
		expect(readRunLog(paths)).toEqual([]);
	});

	it("skips unparseable lines without crashing", () => {
		const dir = mkdtempSync(join(tmpdir(), "wtfoc-run-log-bad-"));
		const paths = { dir, jsonlPath: join(dir, "runs.jsonl") };
		const good = buildRunLogRow({
			sweepId: "s1",
			matrixName: "m",
			variantId: "v",
			report: makeReport(),
			durationMs: 1,
		});
		appendRunLogRow(good, paths);
		// Append a malformed line.
		require("node:fs").appendFileSync(paths.jsonlPath, "not json at all\n");
		const goodAgain: RunLogRow = { ...good, variantId: "v2" };
		appendRunLogRow(goodAgain, paths);
		const read = readRunLog(paths);
		expect(read).toHaveLength(2);
		const variants = read.map((r) => r.variantId).sort();
		expect(variants).toEqual(["v", "v2"]);
	});
});
