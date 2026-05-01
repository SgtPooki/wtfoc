import { describe, expect, it } from "vitest";
import { LEGACY_GOLD_STANDARD_QUERIES as GOLD_STANDARD_QUERIES } from "./gold-standard-queries.legacy.js";

/**
 * Legacy fixture-integrity tests preserved during the #344 step-1 schema
 * overhaul. These run against `gold-standard-queries.legacy.ts` to keep the
 * legacy data validated until the migrator is finalized and the legacy file
 * is deleted in a follow-up PR.
 *
 * Original context (#261): the 10-query set was flaky; expanding to ~20+
 * queries with balanced categories gives a more reliable signal.
 */
describe("GOLD_STANDARD_QUERIES fixture integrity", () => {
	it("has at least 20 queries (expanded per #261 guidance)", () => {
		expect(GOLD_STANDARD_QUERIES.length).toBeGreaterThanOrEqual(20);
	});

	it("IDs are unique", () => {
		const ids = GOLD_STANDARD_QUERIES.map((q) => q.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("category distribution is balanced (no single category exceeds 50%)", () => {
		const counts: Record<string, number> = {};
		for (const q of GOLD_STANDARD_QUERIES) counts[q.category] = (counts[q.category] ?? 0) + 1;
		for (const [cat, n] of Object.entries(counts)) {
			expect(n / GOLD_STANDARD_QUERIES.length, `category ${cat} dominates`).toBeLessThan(0.5);
		}
	});

	it("every category has at least 3 queries", () => {
		const cats: Array<
			"direct-lookup" | "cross-source" | "coverage" | "synthesis" | "file-level" | "work-lineage"
		> = ["direct-lookup", "cross-source", "coverage", "synthesis", "file-level", "work-lineage"];
		for (const cat of cats) {
			const n = GOLD_STANDARD_QUERIES.filter((q) => q.category === cat).length;
			expect(n, `category ${cat} underrepresented`).toBeGreaterThanOrEqual(3);
		}
	});

	it("work-lineage demo-critical queries require code + edge + cross-source (v1.2.0)", () => {
		const demoCritical = GOLD_STANDARD_QUERIES.filter(
			(q) => q.category === "work-lineage" && q.tier === "demo-critical",
		);
		expect(demoCritical.length, "need ≥ 5 demo-critical flagship queries").toBeGreaterThanOrEqual(
			5,
		);
		for (const q of demoCritical) {
			expect(q.requiredSourceTypes, `${q.id} must require code`).toContain("code");
			expect(q.requireEdgeHop, `${q.id} must requireEdgeHop`).toBe(true);
		}
	});

	it("at least 5 queries require trace (requireEdgeHop or requireCrossSourceHops)", () => {
		// Codex review: must have enough trace-requiring queries to measure
		// whether trace quality is actually helping (not just rescuing everything).
		const traceRequired = GOLD_STANDARD_QUERIES.filter(
			(q) => q.requireEdgeHop || q.requireCrossSourceHops,
		);
		expect(traceRequired.length).toBeGreaterThanOrEqual(5);
	});

	it("fixture has at least 8 portable queries (v1.6.0 overfit-guard)", () => {
		const portable = GOLD_STANDARD_QUERIES.filter((q) => q.portability === "portable");
		expect(
			portable.length,
			"fewer than 8 portable queries — fixture is too corpus-specific to measure generic retrieval",
		).toBeGreaterThanOrEqual(8);
	});

	it("portable queries do not reference specific corpora in text (v1.6.0)", () => {
		const CORPUS_NAMES = [
			"filoz",
			"synapse-sdk",
			"synapse-core",
			"filecoin-services",
			"filecoin-pin",
			"FilOzone",
			"piece.ts",
			"DataSetStatus",
			"PieceCID",
			"CommP",
			"Curio",
			"PDP",
		];
		for (const q of GOLD_STANDARD_QUERIES) {
			if (q.portability !== "portable") continue;
			for (const name of CORPUS_NAMES) {
				expect(
					q.queryText.toLowerCase().includes(name.toLowerCase()),
					`portable query ${q.id} references "${name}" — move to corpus-specific`,
				).toBe(false);
			}
		}
	});

	it("queries with collectionScopePattern must carry a reason and a valid regex (v1.4.0)", () => {
		for (const q of GOLD_STANDARD_QUERIES) {
			if (!q.collectionScopePattern) continue;
			expect(
				q.collectionScopeReason,
				`${q.id} has collectionScopePattern but no collectionScopeReason`,
			).toBeTruthy();
			expect(() => new RegExp(q.collectionScopePattern ?? "")).not.toThrow();
		}
	});

	it("requiredSourceTypes values are all real source types", () => {
		const KNOWN = new Set([
			"code",
			"markdown",
			"github-issue",
			"github-pr",
			"github-pr-comment",
			"github-discussion",
			"slack-message",
			"discord-message",
			"doc-page",
			"hn-story",
			"hn-comment",
		]);
		for (const q of GOLD_STANDARD_QUERIES) {
			for (const t of q.requiredSourceTypes) {
				expect(KNOWN.has(t), `query ${q.id} uses unknown sourceType "${t}"`).toBe(true);
			}
		}
	});
});
