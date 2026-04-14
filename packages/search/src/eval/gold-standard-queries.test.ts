import { describe, expect, it } from "vitest";
import { GOLD_STANDARD_QUERIES } from "./gold-standard-queries.js";

/**
 * Fixture-integrity tests for the gold-standard queries (#261).
 *
 * The 10-query set was flaky: a single query flipping flipped the verdict.
 * Expanding to ~20+ queries with balanced categories gives a more reliable
 * signal and makes autonomous validation trustworthy.
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
		const cats: Array<"direct-lookup" | "cross-source" | "coverage" | "synthesis"> = [
			"direct-lookup",
			"cross-source",
			"coverage",
			"synthesis",
		];
		for (const cat of cats) {
			const n = GOLD_STANDARD_QUERIES.filter((q) => q.category === cat).length;
			expect(n, `category ${cat} underrepresented`).toBeGreaterThanOrEqual(3);
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
