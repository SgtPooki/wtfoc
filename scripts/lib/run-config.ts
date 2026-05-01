/**
 * Maintainer-only autoresearch / dogfood instrumentation.
 *
 * NOT shipped to consumers. Lives under `scripts/` so the published
 * runtime packages (`@wtfoc/common`, `@wtfoc/search`, etc.) carry no
 * autoresearch surface area. The dogfood entrypoint (`scripts/dogfood.ts`)
 * is the only intended consumer.
 */

import { createHash } from "node:crypto";
import { safeExecFileSync as execFileSync } from "./safe-exec.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DogfoodReport } from "@wtfoc/common";

export const FINGERPRINT_VERSION = 1;
export const CACHE_NAMESPACE_SCHEME_VERSION = 1;

export interface RetrievalConfig {
	topK: number;
	traceMaxPerSource: number;
	traceMaxTotal: number;
	traceMaxHops: number;
	traceMinScore: number;
	traceMode: string;
	autoRoute: boolean;
	diversityEnforce: boolean;
}

export interface ModelConfig {
	url: string;
	model: string;
}

/**
 * Evaluation-mode toggles. These flip what the dogfood pipeline
 * actually does (paraphrase scoring, claim grounding) and therefore
 * MUST participate in the runConfig fingerprint — otherwise two runs
 * that produce different reports could share a fingerprint and stomp
 * each other's cache namespace / hide as duplicate rows in analysis.
 */
export interface EvaluationConfig {
	checkParaphrases: boolean;
	groundCheck: boolean;
}

export interface RunConfig {
	collectionId: string;
	corpusDigest: string;
	goldFixtureVersion: string;
	goldFixtureHash: string;
	embedder: ModelConfig;
	extractor: ModelConfig | null;
	reranker: { type: string; url: string; model?: string } | null;
	grader: ModelConfig | null;
	retrieval: RetrievalConfig;
	evaluation: EvaluationConfig;
	promptHashes: Record<string, string>;
	seed: number;
	gitSha: string | null;
	packageVersions: Record<string, string>;
	nodeVersion: string;
	cacheNamespaceSchemeVersion: number;
}

/**
 * Maintainer-only extended report shape. Augments the published
 * `DogfoodReport` with autoresearch-only fields. Never round-tripped
 * through the published type.
 */
export interface ExtendedDogfoodReport extends DogfoodReport {
	runConfig: RunConfig;
	runConfigFingerprint: string;
	fingerprintVersion: number;
	/**
	 * Whether costs in this report are comparable enough to be ranked.
	 * False when any LLM call had unknown pricing or missing token counts.
	 * Downstream consumers (threshold check + sweep harness) MUST refuse
	 * to rank by cost when `value === false`.
	 */
	costComparable?: { value: boolean; reasons: string[] };
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function canonicalize(value: unknown): JsonValue {
	if (value === null) return null;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (typeof value === "undefined") return null;
	if (Array.isArray(value)) return value.map((v) => canonicalize(v));
	if (typeof value === "object") {
		const out: { [k: string]: JsonValue } = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			out[key] = canonicalize((value as Record<string, unknown>)[key]);
		}
		return out;
	}
	return String(value);
}

export function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

export function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

export function computeRunConfigFingerprint(config: RunConfig): string {
	const payload = canonicalJson({ v: FINGERPRINT_VERSION, config });
	return sha256Hex(payload);
}

/** Best-effort git HEAD lookup; null when not in a repo or git unavailable. */
export function readGitSha(): string | null {
	if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return null;
	}
}

/** Read versions for a list of @wtfoc/* package names from their package.json. */
export function readPackageVersions(packageNames: string[]): Record<string, string> {
	const here = dirname(fileURLToPath(import.meta.url));
	const repoRoot = join(here, "..", "..");
	const out: Record<string, string> = {};
	for (const name of packageNames) {
		const short = name.replace(/^@wtfoc\//, "");
		try {
			const pkgPath = join(repoRoot, "packages", short, "package.json");
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
			if (pkg.version) out[name] = pkg.version;
		} catch {
			// Skip packages we can't read; missing version will be visible in fingerprint.
		}
	}
	return out;
}

/** Node major.minor — patch is rarely behavior-affecting. */
export function readNodeMajorMinor(): string {
	const [major, minor] = process.versions.node.split(".");
	return `${major}.${minor}`;
}
