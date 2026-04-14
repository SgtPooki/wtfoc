import { describe, expect, it } from "vitest";
import { FIXTURE_QUERIES } from "./search-eval-fixtures.js";

/**
 * Fixture validity tests (#255). Every expectedSourceTypes entry must be a
 * real source type emitted by some ingest adapter today. Stale or typo'd
 * entries (e.g. "doc" when the real type is "doc-page") produce misleading
 * MRR=0 in dogfood runs and hide chunker/retrieval improvements.
 */
const KNOWN_SOURCE_TYPES = new Set([
	// Repo / file
	"code",
	"markdown",
	"tombstone",
	// GitHub
	"github-issue",
	"github-pr",
	"github-pr-comment",
	"github-discussion",
	// Chat
	"slack-message",
	"discord-message",
	// Web
	"doc-page",
	// News / community
	"hn-story",
	"hn-comment",
]);

describe("search-eval-fixtures validity (#255)", () => {
	it("every fixture's expectedSourceTypes uses known source types", () => {
		const stale: Array<{ query: string; type: string }> = [];
		for (const fixture of FIXTURE_QUERIES) {
			for (const type of fixture.expectedSourceTypes) {
				if (!KNOWN_SOURCE_TYPES.has(type)) {
					stale.push({ query: fixture.queryText, type });
				}
			}
		}
		expect(stale).toEqual([]);
	});

	it("'discussions' query accepts github-pr-comment and github-discussion", () => {
		const discussions = FIXTURE_QUERIES.find((q) =>
			q.queryText.toLowerCase().includes("discussion"),
		);
		expect(discussions).toBeDefined();
		// Both are legitimate discussion evidence sources in this ecosystem
		expect(discussions?.expectedSourceTypes).toContain("github-pr-comment");
		expect(discussions?.expectedSourceTypes).toContain("github-discussion");
	});

	it("'code work' query accepts doc-page (not nonexistent 'doc')", () => {
		const codeWork = FIXTURE_QUERIES.find((q) => q.queryText.toLowerCase().includes("code work"));
		expect(codeWork).toBeDefined();
		expect(codeWork?.expectedSourceTypes).toContain("doc-page");
		expect(codeWork?.expectedSourceTypes).not.toContain("doc");
	});

	it("'changes' query accepts github-pr-comment alongside pr/issue/code", () => {
		const changes = FIXTURE_QUERIES.find((q) => q.queryText.toLowerCase().includes("changes"));
		expect(changes).toBeDefined();
		// PR comments explain WHY a change happened — valid evidence for "what changed"
		expect(changes?.expectedSourceTypes).toContain("github-pr-comment");
	});
});
