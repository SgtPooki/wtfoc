import { describe, expect, it } from "vitest";
import {
	CACHE_NAMESPACE_SCHEME_VERSION,
	FINGERPRINT_VERSION,
	canonicalJson,
	computeRunConfigFingerprint,
	type RunConfig,
	sha256Hex,
} from "./run-config.js";

function baseConfig(): RunConfig {
	return {
		collectionId: "filoz-ecosystem-2026-04-v12",
		corpusDigest: "deadbeef",
		goldFixtureVersion: "1.6.0",
		goldFixtureHash: "f1xt",
		embedder: { url: "https://openrouter.ai/api/v1", model: "baai/bge-base-en-v1.5" },
		extractor: { url: "http://127.0.0.1:4523/v1", model: "haiku" },
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
			diversityEnforce: true,
		},
		evaluation: {
			checkParaphrases: false,
			groundCheck: false,
		},
		promptHashes: {},
		seed: 0,
		gitSha: "abc1234",
		packageVersions: { "@wtfoc/common": "0.0.3", "@wtfoc/search": "0.0.1" },
		nodeVersion: "24.11",
		cacheNamespaceSchemeVersion: CACHE_NAMESPACE_SCHEME_VERSION,
	};
}

describe("canonicalJson", () => {
	it("orders keys deterministically across nested objects", () => {
		const a = canonicalJson({ b: 1, a: { y: 2, x: 1 } });
		const b = canonicalJson({ a: { x: 1, y: 2 }, b: 1 });
		expect(a).toBe(b);
	});

	it("preserves array order", () => {
		expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
	});

	it("normalizes undefined to null", () => {
		expect(canonicalJson({ a: undefined })).toBe('{"a":null}');
	});
});

describe("computeRunConfigFingerprint", () => {
	it("is deterministic for the same config", () => {
		const c = baseConfig();
		expect(computeRunConfigFingerprint(c)).toBe(computeRunConfigFingerprint(c));
	});

	it("changes when any input changes", () => {
		const base = computeRunConfigFingerprint(baseConfig());
		const cases: Array<(c: RunConfig) => void> = [
			(c) => {
				c.embedder.model = "different";
			},
			(c) => {
				c.retrieval.topK = 20;
			},
			(c) => {
				c.retrieval.diversityEnforce = false;
			},
			(c) => {
				c.goldFixtureVersion = "1.7.0";
			},
			(c) => {
				c.corpusDigest = "fffffff";
			},
			(c) => {
				c.gitSha = "0000000";
			},
			(c) => {
				c.packageVersions["@wtfoc/search"] = "9.9.9";
			},
			(c) => {
				c.promptHashes.synthesis = "x";
			},
			(c) => {
				c.cacheNamespaceSchemeVersion = 2;
			},
			(c) => {
				c.evaluation.checkParaphrases = true;
			},
			(c) => {
				c.evaluation.groundCheck = true;
			},
		];
		for (const mutate of cases) {
			const c = baseConfig();
			mutate(c);
			expect(computeRunConfigFingerprint(c)).not.toBe(base);
		}
	});

	it("does not change when key insertion order differs", () => {
		const a = baseConfig();
		const b: RunConfig = {
			...a,
			retrieval: {
				diversityEnforce: a.retrieval.diversityEnforce,
				autoRoute: a.retrieval.autoRoute,
				traceMode: a.retrieval.traceMode,
				traceMinScore: a.retrieval.traceMinScore,
				traceMaxHops: a.retrieval.traceMaxHops,
				traceMaxTotal: a.retrieval.traceMaxTotal,
				traceMaxPerSource: a.retrieval.traceMaxPerSource,
				topK: a.retrieval.topK,
			},
		};
		expect(computeRunConfigFingerprint(a)).toBe(computeRunConfigFingerprint(b));
	});

	it("FINGERPRINT_VERSION starts at 1", () => {
		expect(FINGERPRINT_VERSION).toBe(1);
	});
});

describe("sha256Hex", () => {
	it("returns a 64-char lowercase hex digest", () => {
		const h = sha256Hex("hello");
		expect(h).toMatch(/^[0-9a-f]{64}$/);
	});

	it("matches a known SHA-256 vector for empty string", () => {
		expect(sha256Hex("")).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});
});
