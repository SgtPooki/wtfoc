import { describe, expect, it } from "vitest";
import { planNextCandidate, reconcileWithPlanner } from "./planner.js";
import type { TriedLogRow } from "./tried-log.js";

function row(axis: string, value: boolean | number | string, daysAgo = 0): TriedLogRow {
	const loggedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
	return {
		schemaVersion: 1,
		loggedAt,
		matrixName: "retrieval-baseline",
		variantId: `r_${axis}_${JSON.stringify(value)}`,
		proposal: { axis, value, rationale: "test" },
		verdict: "rejected",
		reasons: [],
	};
}

describe("planNextCandidate", () => {
	it("returns a candidate when nothing tried", () => {
		const next = planNextCandidate({ matrixName: "retrieval-baseline", triedRows: [] });
		expect(next).not.toBeNull();
	});

	it("prioritises cheap-uncoupled phase before cheap-coupled", () => {
		// First candidate should be from a knob with no couplings.
		const next = planNextCandidate({ matrixName: "retrieval-baseline", triedRows: [] });
		expect(next?.phase).toBe("cheap-uncoupled");
	});

	it("skips already-tried tuples within the silence window", () => {
		// Mark the ENTIRE cheap-uncoupled phase as tried, planner should
		// fall through to cheap-coupled.
		// autoRoute is uncoupled.
		const tried: TriedLogRow[] = [
			row("autoRoute", true),
			row("autoRoute", false),
			row("traceMinScore", 0.1),
			row("traceMinScore", 0.35),
			row("traceMinScore", 0.6),
		];
		const next = planNextCandidate({
			matrixName: "retrieval-baseline",
			triedRows: tried,
		});
		expect(next?.phase).not.toBe("cheap-uncoupled");
	});

	it("returns null when every materializable tuple is in the silence window", () => {
		// Build a row for every (knob, value) the planner would generate.
		const tried: TriedLogRow[] = [
			row("autoRoute", true),
			row("autoRoute", false),
			row("traceMinScore", 0.1),
			row("traceMinScore", 0.35),
			row("traceMinScore", 0.6),
			row("diversityEnforce", true),
			row("diversityEnforce", false),
			row("reranker", "off"),
			row("reranker", "llm:haiku"),
			row("reranker", "bge"),
			row("topK", 5),
			row("topK", 15),
			row("topK", 25),
			row("traceMaxPerSource", 1),
			row("traceMaxPerSource", 5),
			row("traceMaxPerSource", 6),
			row("traceMaxPerSource", 10),
			row("traceMaxTotal", 5),
			row("traceMaxTotal", 27),
			row("traceMaxTotal", 28),
			row("traceMaxTotal", 50),
		];
		const next = planNextCandidate({
			matrixName: "retrieval-baseline",
			triedRows: tried,
		});
		expect(next).toBeNull();
	});

	it("re-explores past the silence window", () => {
		const tried: TriedLogRow[] = [row("autoRoute", true, 60)];
		const next = planNextCandidate({
			matrixName: "retrieval-baseline",
			triedRows: tried,
			silenceDays: 30,
		});
		// `autoRoute=true` should be back on the table.
		expect(next).not.toBeNull();
	});
});

describe("reconcileWithPlanner", () => {
	it("returns null when the LLM proposal is acceptable", () => {
		const r = reconcileWithPlanner(
			{ matrixName: "retrieval-baseline", triedRows: [] },
			{ axis: "autoRoute", value: true },
		);
		expect(r).toBeNull();
	});

	it("nudges to planner candidate when LLM proposes already-tried tuple", () => {
		const r = reconcileWithPlanner(
			{
				matrixName: "retrieval-baseline",
				triedRows: [row("autoRoute", true)],
			},
			{ axis: "autoRoute", value: true },
		);
		expect(r).not.toBeNull();
		// Planner must propose a (axis, value) pair OTHER than the one
		// the LLM tried. Same axis with a different value is fine.
		expect(`${r?.axis}|${JSON.stringify(r?.value)}`).not.toBe("autoRoute|true");
	});

	it("nudges to planner candidate when LLM proposes unknown axis", () => {
		const r = reconcileWithPlanner(
			{ matrixName: "retrieval-baseline", triedRows: [] },
			{ axis: "fakeKnob", value: 42 },
		);
		expect(r).not.toBeNull();
	});
});
