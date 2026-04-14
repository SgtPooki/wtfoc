import { describe, expect, it } from "vitest";
import { classifyQueryPersona } from "./classify-query.js";

/**
 * Rule-based query → persona classification (#259).
 *
 * Codex review recommended starting rule-based (not LLM) and keeping the
 * persona taxonomy small. Each persona maps to an include/exclude set of
 * source types for filtered retrieval. When a query's intent is ambiguous
 * or doesn't match any rule, we return "open-ended" — the unfiltered lane
 * that ensures every query gets a fair baseline.
 */
describe("classifyQueryPersona (#259)", () => {
	it("classifies 'how does X work' as technical (code-leaning)", () => {
		expect(classifyQueryPersona("How does the ingest pipeline work?").persona).toBe("technical");
		expect(classifyQueryPersona("how does edge extraction work").persona).toBe("technical");
	});

	it("classifies 'what was discussed / debated / argued' as discussion", () => {
		expect(classifyQueryPersona("What was discussed in the PR?").persona).toBe("discussion");
		expect(classifyQueryPersona("What are people saying about this feature?").persona).toBe(
			"discussion",
		);
		expect(classifyQueryPersona("which issues debate the architecture").persona).toBe("discussion");
	});

	it("classifies 'what changed / what did they change / what fixed' as changes", () => {
		expect(classifyQueryPersona("What changed recently?").persona).toBe("changes");
		expect(classifyQueryPersona("What PRs fixed the chunker?").persona).toBe("changes");
		expect(classifyQueryPersona("what was changed in the last release").persona).toBe("changes");
	});

	it("classifies 'what do the docs say / documentation for' as docs", () => {
		expect(classifyQueryPersona("What do the docs say about CIDs?").persona).toBe("docs");
		expect(classifyQueryPersona("documentation for the storage API").persona).toBe("docs");
	});

	it("falls back to 'open-ended' for queries that don't match any rule", () => {
		expect(classifyQueryPersona("Filecoin").persona).toBe("open-ended");
		expect(classifyQueryPersona("some random thing").persona).toBe("open-ended");
	});

	it("technical persona includeSourceTypes leans code/markdown", () => {
		const result = classifyQueryPersona("How does trace work?");
		expect(result.includeSourceTypes).toContain("code");
		expect(result.includeSourceTypes).toContain("markdown");
	});

	it("discussion persona includeSourceTypes includes all discussion types", () => {
		const result = classifyQueryPersona("What was discussed?");
		expect(result.includeSourceTypes).toContain("github-issue");
		expect(result.includeSourceTypes).toContain("github-pr-comment");
		expect(result.includeSourceTypes).toContain("github-discussion");
	});

	it("open-ended persona has no filters", () => {
		const result = classifyQueryPersona("nothing in particular");
		expect(result.includeSourceTypes).toBeUndefined();
		expect(result.excludeSourceTypes).toBeUndefined();
	});

	it("returns a stable persona name and filter set (deterministic)", () => {
		const q = "how does the pipeline work";
		const a = classifyQueryPersona(q);
		const b = classifyQueryPersona(q);
		expect(a.persona).toBe(b.persona);
		expect(a.includeSourceTypes).toEqual(b.includeSourceTypes);
	});
});
