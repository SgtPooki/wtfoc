import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	promoteFixtureViaPr,
	renderRetrievalHealthSection,
} from "./promote-fixture-via-pr.js";

const FIXTURE_BASELINE = `// gold-authored-queries.ts (test fixture)
import type { GoldQuery } from "./gold-standard-queries.js";

// === BEGIN AUTHORED-QUERIES MANAGED ARRAY ===
export const AUTHORED_QUERIES: GoldQuery[] = [];
// === END AUTHORED-QUERIES MANAGED ARRAY ===
`;

const CODEGEN_SAMPLE = `[
\t{
\t\t"id": "test-q1",
\t\t"query": "x"
\t}
]`;

function setupRepo(fixture: string = FIXTURE_BASELINE): string {
	const repo = mkdtempSync(join(tmpdir(), "wtfoc-promote-fixture-"));
	const dir = join(repo, "packages", "search", "src", "eval");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "gold-authored-queries.ts"), fixture);
	return repo;
}

describe("promoteFixtureViaPr — dry-run", () => {
	it("returns dry-run result without touching disk", async () => {
		const repo = setupRepo();
		const result = await promoteFixtureViaPr({
			proposalId: "p1",
			collectionId: "alpha",
			codegen: CODEGEN_SAMPLE,
			keptCount: 1,
			targetedStrata: [
				{ sourceType: "code", queryType: "lookup", artifactsInCorpus: 10 },
			],
			dryRun: true,
			repoRoot: repo,
		});
		expect(result.dryRun).toBe(true);
		expect(result.prUrl).toBeNull();
		expect(result.branch).toBe("autoresearch/fixture-p1");
		// Source file untouched in dry-run.
		const after = readFileSync(
			join(repo, "packages", "search", "src", "eval", "gold-authored-queries.ts"),
			"utf-8",
		);
		expect(after).toBe(FIXTURE_BASELINE);
	});

	it("skips with reason when fixture file missing", async () => {
		const repo = mkdtempSync(join(tmpdir(), "wtfoc-promote-fixture-"));
		const result = await promoteFixtureViaPr({
			proposalId: "p2",
			collectionId: "alpha",
			codegen: CODEGEN_SAMPLE,
			keptCount: 1,
			targetedStrata: [],
			repoRoot: repo,
		});
		expect(result.skippedReason).toMatch(/not found/);
		expect(result.prUrl).toBeNull();
	});

	it("skips with reason when markers missing in fixture file", async () => {
		const repo = setupRepo("// empty file, no markers\n");
		const result = await promoteFixtureViaPr({
			proposalId: "p3",
			collectionId: "alpha",
			codegen: CODEGEN_SAMPLE,
			keptCount: 1,
			targetedStrata: [],
			dryRun: true,
			repoRoot: repo,
		});
		expect(result.skippedReason).toMatch(/splice failed/i);
	});

	it("returns dry-run with non-null branch when splice produces a diff", async () => {
		const repo = setupRepo();
		const result = await promoteFixtureViaPr({
			proposalId: "p4",
			collectionId: "alpha",
			codegen: CODEGEN_SAMPLE,
			keptCount: 2,
			targetedStrata: [
				{ sourceType: "code", queryType: "lookup", artifactsInCorpus: 5 },
				{ sourceType: "github-issue", queryType: "trace", artifactsInCorpus: 3 },
			],
			dryRun: true,
			repoRoot: repo,
		});
		expect(result.skippedReason).toBeUndefined();
		expect(result.branch).toBe("autoresearch/fixture-p4");
	});
});

describe("renderRetrievalHealthSection (#360 fixture-drift mitigation)", () => {
	it("returns null when no health data supplied", () => {
		expect(renderRetrievalHealthSection(undefined)).toBeNull();
	});

	it("formats latest + baseline + delta when both rates present", () => {
		const out = renderRetrievalHealthSection({
			latestPassRate: 0.72,
			baselinePassRate: 0.7,
		});
		expect(out).toContain("Latest pass rate: 72.0%");
		expect(out).toContain("Baseline pass rate: 70.0%");
		expect(out).toContain("+2.0 pp");
	});

	it("flags retrieval regression when delta is below -1pp", () => {
		const out = renderRetrievalHealthSection({
			latestPassRate: 0.65,
			baselinePassRate: 0.72,
		});
		expect(out).toContain(":warning:");
		expect(out).toContain("regressed");
	});

	it("does NOT flag for tiny noise within -1pp", () => {
		const out = renderRetrievalHealthSection({
			latestPassRate: 0.715,
			baselinePassRate: 0.72,
		});
		expect(out).not.toContain(":warning:");
	});

	it("renders n/a when one side is missing", () => {
		const out = renderRetrievalHealthSection({
			latestPassRate: 0.72,
			baselinePassRate: null,
		});
		expect(out).toContain("Baseline pass rate: n/a");
		expect(out).not.toContain("Δ pass rate");
	});
});
