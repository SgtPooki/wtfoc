import { describe, expect, it } from "vitest";
import { asTriedRow, PHASE_3_SEEDS } from "./seed-tried-log.js";

describe("PHASE_3_SEEDS", () => {
	it("includes the three losing axes from the Phase 3 sweep", () => {
		const tuples = PHASE_3_SEEDS.map((s) => `${s.axis}|${JSON.stringify(s.value)}`);
		expect(tuples).toContain("autoRoute|true");
		expect(tuples).toContain("diversityEnforce|false");
		expect(tuples).toContain('reranker|"llm:haiku"');
	});

	it("each seed has verdict and rationale", () => {
		for (const s of PHASE_3_SEEDS) {
			expect(s.verdict).toMatch(/^(accepted|rejected)$/);
			expect(s.rationale.length).toBeGreaterThan(0);
		}
	});
});

describe("asTriedRow", () => {
	it("produces a valid TriedLogRow with seed tag in rationale", () => {
		const row = asTriedRow(PHASE_3_SEEDS[0]!);
		expect(row.schemaVersion).toBe(1);
		expect(row.matrixName).toBe("retrieval-baseline");
		expect(row.proposal.rationale).toContain("seed:");
	});
});
