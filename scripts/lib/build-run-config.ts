/**
 * RunConfig builder — pulls retrieval/trace defaults, gold fixture identity,
 * git/package versions, and CLI-provided model config into a stable
 * fingerprintable record. Maintainer-only.
 */

import type { HeadManifest } from "@wtfoc/common";
import {
	CACHE_NAMESPACE_SCHEME_VERSION,
	canonicalJson,
	type EvaluationConfig,
	readGitSha,
	readNodeMajorMinor,
	readPackageVersions,
	type RetrievalConfig,
	type RunConfig,
	sha256Hex,
} from "./run-config.js";

interface BuildRunConfigInput {
	collectionId: string;
	manifest: HeadManifest;
	goldFixtureVersion: string;
	goldFixture: ReadonlyArray<unknown>;
	embedder: { url: string; model: string };
	extractor: { url: string; model: string } | null;
	reranker: { type: string; url: string; model?: string } | null;
	grader: { url: string; model: string } | null;
	retrieval: RetrievalConfig;
	evaluation: EvaluationConfig;
	promptHashes?: Record<string, string>;
	seed?: number;
}

/**
 * Hash the corpus contents — segment id list (sorted) plus the manifest
 * collection id. Stable across reorderings; changes when segments are
 * added/removed or the corpus is renamed.
 */
export function computeCorpusDigest(manifest: HeadManifest): string {
	const segmentIds = [...manifest.segments.map((s) => s.id)].sort();
	return sha256Hex(canonicalJson({ collectionId: manifest.collectionId, segmentIds }));
}

/**
 * Hash the gold fixture array. Distinct from `goldFixtureVersion` because
 * a maintainer might edit a query body without bumping the version string;
 * the hash catches it.
 */
export function computeGoldFixtureHash(fixture: ReadonlyArray<unknown>): string {
	return sha256Hex(canonicalJson(fixture));
}

export function buildRunConfig(input: BuildRunConfigInput): RunConfig {
	return {
		collectionId: input.collectionId,
		corpusDigest: computeCorpusDigest(input.manifest),
		goldFixtureVersion: input.goldFixtureVersion,
		goldFixtureHash: computeGoldFixtureHash(input.goldFixture),
		embedder: input.embedder,
		extractor: input.extractor,
		reranker: input.reranker,
		grader: input.grader,
		retrieval: input.retrieval,
		evaluation: input.evaluation,
		promptHashes: input.promptHashes ?? {},
		seed: input.seed ?? 0,
		gitSha: readGitSha(),
		packageVersions: readPackageVersions([
			"@wtfoc/common",
			"@wtfoc/search",
			"@wtfoc/ingest",
			"@wtfoc/store",
		]),
		nodeVersion: readNodeMajorMinor(),
		cacheNamespaceSchemeVersion: CACHE_NAMESPACE_SCHEME_VERSION,
	};
}

/**
 * Fixed retrieval/trace defaults used by the quality-queries evaluator.
 * These are hard-coded inside the evaluator today (topK: 10, trace
 * defaults in `trace.ts`); the fingerprint records them explicitly so a
 * future change to those literals invalidates prior fingerprints.
 */
export function defaultQualityQueriesRetrieval(opts: {
	autoRoute: boolean;
	diversityEnforce: boolean;
}): RetrievalConfig {
	return {
		topK: 10,
		traceMaxPerSource: 3,
		traceMaxTotal: 15,
		traceMaxHops: 3,
		traceMinScore: 0.3,
		traceMode: "analytical",
		autoRoute: opts.autoRoute,
		diversityEnforce: opts.diversityEnforce,
	};
}
