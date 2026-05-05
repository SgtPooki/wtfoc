import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CACHE_SCHEMA_VERSION,
	CacheFingerprintMismatchError,
	CacheSchemaMismatchError,
	type EmbedPhaseCacheV1,
	type SearchPhaseCacheV1,
	phaseCachePath,
	readPhaseCache,
	writePhaseCache,
} from "./dogfood-cache.js";

describe("phaseCachePath", () => {
	it("composes <base>/<sweep>/<variant>/<corpus>/<fingerprint>/<phase>.json", () => {
		const p = phaseCachePath({
			base: "/tmp/cache",
			sweepId: "sw_1",
			variantId: "v_a",
			corpus: "demo",
			runConfigFingerprint: "abc123",
			phase: "search",
		});
		expect(p).toBe("/tmp/cache/sw_1/v_a/demo/abc123/search.json");
	});

	it("keeps phases isolated per variant", () => {
		const a = phaseCachePath({
			base: "/c",
			sweepId: "s",
			variantId: "v_a",
			corpus: "demo",
			runConfigFingerprint: "fp",
			phase: "search",
		});
		const b = phaseCachePath({
			base: "/c",
			sweepId: "s",
			variantId: "v_b",
			corpus: "demo",
			runConfigFingerprint: "fp",
			phase: "search",
		});
		expect(a).not.toBe(b);
	});
});

describe("write/read phase cache", () => {
	let base: string;
	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), "wtfoc-cache-test-"));
	});
	afterEach(() => {
		rmSync(base, { recursive: true, force: true });
	});

	const baseInput = {
		sweepId: "sw_1",
		variantId: "v_a",
		corpus: "demo",
		runConfigFingerprint: "fp_abc",
	};

	it("round-trips a SearchPhaseCacheV1 payload", () => {
		const payload: SearchPhaseCacheV1 = {
			schemaVersion: CACHE_SCHEMA_VERSION,
			phase: "search",
			capturedAt: "2026-05-05T00:00:00Z",
			runConfigFingerprint: baseInput.runConfigFingerprint,
			collectionId: "demo",
			manifestId: "m1",
			segmentIds: ["s1", "s2"],
			activeQueryIds: ["q1"],
			preflight: { q1: "applicable" as never },
			corpusSourceTypes: ["github"],
			documentCatalogId: "cat1",
			retrievalOverrides: { topK: 12 },
			reranker: { type: "bge", url: "http://reranker-gpu.x" },
			diversityEnforce: false,
			autoRoute: false,
			queries: [
				{
					id: "q1",
					queryText: "hello",
					queryResults: [
						{
							chunkId: "c1",
							score: 0.9,
							retrievalScore: 0.7,
							documentId: "d1",
							source: "src1",
							sourceType: "github",
							sourceUrl: "",
							content: "snippet",
						},
					],
					timingMs: 42,
				},
			],
			stageResult: {
				stage: "quality-queries",
				startedAt: "2026-05-05T00:00:00Z",
				durationMs: 1234,
				verdict: "pass",
				summary: "stub",
				metrics: { passRate: 1.0 },
				checks: [],
			},
			searchTiming: {},
			searchCost: {},
		};
		const path = writePhaseCache(
			{ base, ...baseInput, phase: "search" },
			payload,
		);
		expect(path).toContain("/sw_1/v_a/demo/fp_abc/search.json");
		const back = readPhaseCache({ base, ...baseInput, phase: "search" });
		expect(back).toEqual(payload);
	});

	it("returns null when file is missing", () => {
		expect(
			readPhaseCache({ base, ...baseInput, phase: "search" }),
		).toBeNull();
	});

	it("throws CacheSchemaMismatchError on schemaVersion drift", () => {
		const path = writePhaseCache(
			{ base, ...baseInput, phase: "embed" },
			{
				schemaVersion: CACHE_SCHEMA_VERSION,
				phase: "embed",
				capturedAt: "2026-05-05T00:00:00Z",
				runConfigFingerprint: baseInput.runConfigFingerprint,
				collectionId: "demo",
				embedderModel: "m",
				embedderUrl: "u",
				embedderCacheDir: null,
				warmedQueryIds: ["q1"],
			} satisfies EmbedPhaseCacheV1,
		);
		// Mutate stored version to simulate an older build's payload.
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		raw.schemaVersion = 0;
		writeFileSync(path, JSON.stringify(raw));
		expect(() =>
			readPhaseCache({ base, ...baseInput, phase: "embed" }),
		).toThrow(CacheSchemaMismatchError);
	});

	it("throws CacheFingerprintMismatchError when stored fingerprint drifts from path", () => {
		const path = writePhaseCache(
			{ base, ...baseInput, phase: "embed" },
			{
				schemaVersion: CACHE_SCHEMA_VERSION,
				phase: "embed",
				capturedAt: "2026-05-05T00:00:00Z",
				runConfigFingerprint: baseInput.runConfigFingerprint,
				collectionId: "demo",
				embedderModel: "m",
				embedderUrl: "u",
				embedderCacheDir: null,
				warmedQueryIds: ["q1"],
			} satisfies EmbedPhaseCacheV1,
		);
		// Tamper with stored fingerprint to simulate a corrupt or relocated
		// cache file; reader must reject rather than serve stale state.
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		raw.runConfigFingerprint = "tampered";
		writeFileSync(path, JSON.stringify(raw));
		expect(() =>
			readPhaseCache({ base, ...baseInput, phase: "embed" }),
		).toThrow(CacheFingerprintMismatchError);
	});

	it("refuses to write when payload.phase mismatches path phase", () => {
		expect(() =>
			writePhaseCache(
				{ base, ...baseInput, phase: "search" },
				{
					schemaVersion: CACHE_SCHEMA_VERSION,
					phase: "embed",
					capturedAt: "2026-05-05T00:00:00Z",
					runConfigFingerprint: baseInput.runConfigFingerprint,
					collectionId: "demo",
					embedderModel: "m",
					embedderUrl: "u",
					embedderCacheDir: null,
					warmedQueryIds: [],
				} satisfies EmbedPhaseCacheV1,
			),
		).toThrow(/phase mismatch/);
	});
});
