import { describe, expect, it } from "vitest";
import { makeEdge } from "./__test-helpers.js";
import { validateEdges } from "./edge-validator.js";

/** Helper: validate a single edge and return the first rejection reason (or null). */
function rejectReason(overrides: Parameters<typeof makeEdge>[0]): string | null {
	const { rejected } = validateEdges([makeEdge(overrides)]);
	return rejected.length > 0 ? (rejected[0]?.reason ?? null) : null;
}

/** Helper: validate a single edge and return whether it was accepted. */
function accepted(overrides: Parameters<typeof makeEdge>[0]): boolean {
	return validateEdges([makeEdge(overrides)]).accepted.length === 1;
}

describe("edge-validator", () => {
	// ── Gate 1: Placeholder targets ────────────────────────────────
	describe("Gate 1 — placeholder targets", () => {
		it("rejects LINK_TO_ prefix", () => {
			expect(rejectReason({ targetId: "LINK_TO_something" })).toMatch(/placeholder/);
		});

		it("rejects TODO prefix", () => {
			expect(rejectReason({ targetId: "TODO: fix later" })).toMatch(/placeholder/);
		});

		it("rejects TBD", () => {
			expect(rejectReason({ targetId: "TBD" })).toMatch(/placeholder/);
		});

		it("rejects bracketed placeholders", () => {
			expect(rejectReason({ targetId: "[some placeholder]" })).toMatch(/placeholder/);
		});

		it("rejects owner/repo placeholder", () => {
			const reason = rejectReason({
				targetId: "owner/repo",
				evidence: "This references the owner/repo placeholder in the example docs",
			});
			expect(reason).not.toBeNull();
			expect(reason).toMatch(/placeholder/);
		});

		it("rejects owner/repo with path suffix", () => {
			const reason = rejectReason({
				targetId: "owner/repo/some/path",
				evidence: "This references the owner/repo/some/path file in the repository",
			});
			expect(reason).not.toBeNull();
			expect(reason).toMatch(/placeholder/);
		});
	});

	// ── Gate 2: Proposal language in factual types ─────────────────
	describe("Gate 2 — proposal language", () => {
		it("rejects 'should' in implements edge", () => {
			expect(
				rejectReason({
					type: "implements",
					evidence: "We should implement caching here to improve performance",
				}),
			).toMatch(/proposal/);
		});

		it("allows 'should' in discusses edge (non-factual)", () => {
			expect(
				accepted({
					type: "discusses",
					targetType: "concept",
					targetId: "caching-improvement",
					evidence: "We should implement caching to improve overall performance significantly",
					confidence: 0.7,
				}),
			).toBe(true);
		});
	});

	// ── Gate 3: Target ID too short ───────────────────────────────
	describe("Gate 3 — target ID length", () => {
		it("rejects 2-char target ID", () => {
			expect(rejectReason({ targetId: "ab" })).toMatch(/too short/);
		});

		it("accepts 3-char target ID", () => {
			expect(
				accepted({
					targetType: "concept",
					targetId: "abc",
					evidence: "This references abc in the repository context clearly",
				}),
			).toBe(true);
		});
	});

	// ── Gate 4: Non-resolvable targets for resolvable types ───────
	describe("Gate 4 — resolvable target types", () => {
		it("rejects file target without path separator or extension", () => {
			expect(rejectReason({ targetType: "file", targetId: "somemodule" })).toMatch(
				/non-resolvable/,
			);
		});

		it("accepts file target with path separator", () => {
			expect(
				accepted({
					targetType: "file",
					targetId: "src/index.ts",
					evidence: "The implementation is in src/index.ts which handles the routing",
				}),
			).toBe(true);
		});

		it("rejects relative path file targets starting with ./", () => {
			expect(
				rejectReason({
					targetType: "file",
					targetId: "./llm-client.js",
					evidence: 'imports { chatCompletion } from "./llm-client.js" in the edge extractor',
				}),
			).toMatch(/relative.*path|cannot.*resolv/i);
		});

		it("rejects relative path file targets starting with ../", () => {
			expect(
				rejectReason({
					targetType: "file",
					targetId: "../utils/helpers.ts",
					evidence: 'imported helper functions from "../utils/helpers.ts" for the pipeline',
				}),
			).toMatch(/relative.*path|cannot.*resolv/i);
		});

		it("accepts repo-qualified file path (resolved from relative import)", () => {
			expect(
				accepted({
					targetType: "file",
					targetId: "sgtpooki/wtfoc/packages/ingest/src/edges/llm-client.ts",
					evidence: "imports { chatCompletion } from llm-client.ts in the same directory",
				}),
			).toBe(true);
		});

		it("accepts issue target with number", () => {
			expect(
				accepted({
					targetType: "issue",
					targetId: "#142",
					evidence: "This references issue #142 in the repository",
				}),
			).toBe(true);
		});
	});

	// ── Gate 5: Evidence too short ────────────────────────────────
	describe("Gate 5 — evidence length", () => {
		it("rejects evidence shorter than 10 chars", () => {
			expect(rejectReason({ evidence: "short" })).toMatch(/evidence too short/);
		});

		it("rejects empty evidence", () => {
			expect(rejectReason({ evidence: "" })).toMatch(/evidence too short/);
		});
	});

	// ── Gate 6: Low-confidence discusses ──────────────────────────
	describe("Gate 6 — low-confidence discusses", () => {
		it("rejects discusses edge with confidence < 0.6", () => {
			expect(
				rejectReason({
					type: "discusses",
					targetType: "concept",
					targetId: "some-concept-here",
					confidence: 0.5,
					evidence: "This discusses the concept in some detail here",
				}),
			).toMatch(/low-confidence/);
		});

		it("accepts discusses edge with confidence >= 0.6", () => {
			expect(
				accepted({
					type: "discusses",
					targetType: "concept",
					targetId: "some-concept-here",
					confidence: 0.6,
					evidence: "This discusses the concept in some detail here",
				}),
			).toBe(true);
		});
	});

	// ── Gate 7: Concept grounding ─────────────────────────────────
	describe("Gate 7 — concept grounding", () => {
		it("accepts concept where all words appear literally in evidence", () => {
			expect(
				accepted({
					targetType: "concept",
					targetId: "performance-regression",
					evidence: "addresses the performance regression discussed in the backend channel",
				}),
			).toBe(true);
		});

		it("accepts concept with morphological variants (deployment/deployed)", () => {
			expect(
				accepted({
					targetType: "concept",
					targetId: "session-store-deployment",
					evidence: "The session store needs to be deployed before the auth rewrite can proceed",
				}),
			).toBe(true);
		});

		it("accepts concept with morphological variants (collision/collide)", () => {
			expect(
				accepted({
					targetType: "concept",
					targetId: "cross-adapter-flag-collision",
					evidence:
						"Flags from different adapters could collide when cross-referencing adapter configs",
				}),
			).toBe(true);
		});

		it("accepts concept with morphological variants (initialization/init)", () => {
			expect(
				accepted({
					targetType: "concept",
					targetId: "abort-signal-handling-during-init",
					evidence:
						"The abort signal must be handled properly during initialization of the service",
				}),
			).toBe(true);
		});

		it("rejects concept where <2/3 stemmed words match", () => {
			expect(
				rejectReason({
					targetType: "concept",
					targetId: "quantum-blockchain-synergy",
					evidence: "The system uses a simple caching layer for improved response times",
				}),
			).toMatch(/synthesized concept not grounded/);
		});

		it("uses 2/3 threshold (not 1/2)", () => {
			// 3 significant words, only 1 matches = 1/3 < 2/3 → reject
			expect(
				rejectReason({
					targetType: "concept",
					targetId: "caching-layer-optimization",
					evidence: "We added optimization steps to the pipeline for faster processing",
				}),
			).toMatch(/synthesized concept not grounded/);
		});

		it("ignores short words (<=2 chars) in concept slug", () => {
			// "of" is <=2 chars and should be ignored
			expect(
				accepted({
					targetType: "concept",
					targetId: "lack-of-testing",
					evidence: "There is a serious lack of testing in this module which impacts reliability",
				}),
			).toBe(true);
		});
	});

	// ── Gate 8: Uncertainty in factual types ──────────────────────
	describe("Gate 8 — uncertainty markers", () => {
		it("rejects 'maybe' in implements edge", () => {
			expect(
				rejectReason({
					type: "implements",
					evidence: "This maybe implements the caching layer described in the RFC document",
				}),
			).toMatch(/uncertainty/);
		});

		it("allows 'maybe' in references edge (non-strong)", () => {
			expect(
				accepted({
					type: "references",
					evidence: "This maybe references the caching layer described in the RFC document",
				}),
			).toBe(true);
		});
	});

	// ── maybeDowngrade ────────────────────────────────────────────
	describe("maybeDowngrade", () => {
		it("downgrades strong type with context-only evidence to references", () => {
			const { accepted: acc } = validateEdges([
				makeEdge({
					type: "implements",
					evidence: "Context: this relates to the caching implementation described elsewhere",
				}),
			]);
			expect(acc[0]?.type).toBe("references");
		});

		it("downgrades incompatible target type to references", () => {
			const { accepted: acc } = validateEdges([
				makeEdge({
					type: "closes",
					targetType: "concept",
					targetId: "architecture-pattern",
					evidence: "This closes the discussion about the architecture pattern redesign",
				}),
			]);
			expect(acc[0]?.type).toBe("references");
		});

		it("downgrades strong type without relation-specific cues to references", () => {
			const { accepted: acc } = validateEdges([
				makeEdge({
					type: "implements",
					evidence: "The architecture RFC discusses this pattern in the context of scalability",
				}),
			]);
			expect(acc[0]?.type).toBe("references");
		});

		it("downgrades discusses with temporal language to references", () => {
			const { accepted: acc } = validateEdges([
				makeEdge({
					type: "discusses",
					targetType: "concept",
					targetId: "auth-migration-plan",
					evidence: "The auth migration plan has been merged and landed in production last week",
					confidence: 0.7,
				}),
			]);
			expect(acc[0]?.type).toBe("references");
		});
	});

	// ── Full pipeline ─────────────────────────────────────────────
	describe("validateEdges pipeline", () => {
		it("returns accepted and rejected arrays", () => {
			const result = validateEdges([
				makeEdge({ evidence: "This references issue #42 in the repository context" }),
				makeEdge({ targetId: "ab" }), // too short → rejected
			]);
			expect(result.accepted).toHaveLength(1);
			expect(result.rejected).toHaveLength(1);
		});
	});
});
