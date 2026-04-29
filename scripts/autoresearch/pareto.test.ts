import { describe, expect, it } from "vitest";
import { type ParetoInput, paretoLeaderboard } from "./pareto.js";

function row(opts: Partial<ParetoInput> & { id: string }): ParetoInput {
	return {
		variantId: opts.id,
		quality: opts.quality ?? 0.5,
		costUsdTotal: "costUsdTotal" in opts ? opts.costUsdTotal! : 0,
		latencyP95Ms: "latencyP95Ms" in opts ? opts.latencyP95Ms! : 1000,
		costComparable: opts.costComparable ?? true,
		allGatesPassed: opts.allGatesPassed ?? true,
	};
}

describe("paretoLeaderboard", () => {
	it("frontier holds variants no one dominates", () => {
		// A: high quality, high cost, low latency
		// B: medium quality, low cost, high latency
		// C: low quality, low cost, low latency — dominated by A on quality+latency
		const lb = paretoLeaderboard([
			row({ id: "A", quality: 0.9, costUsdTotal: 1, latencyP95Ms: 500 }),
			row({ id: "B", quality: 0.7, costUsdTotal: 0.1, latencyP95Ms: 2000 }),
			row({ id: "C", quality: 0.5, costUsdTotal: 0.05, latencyP95Ms: 800 }),
		]);
		const frontier = lb.filter((r) => r.frontier).map((r) => r.variantId).sort();
		// A: dominated by nothing. B: dominated by nothing (cheaper than both). C: dominated by A on quality+latency, but A costs more, so not dominated.
		expect(frontier).toEqual(["A", "B", "C"]);
	});

	it("strict dominance: A dominates B when all axes equal-or-better and one strict", () => {
		const lb = paretoLeaderboard([
			row({ id: "A", quality: 0.9, costUsdTotal: 0.1, latencyP95Ms: 500 }),
			row({ id: "B", quality: 0.9, costUsdTotal: 0.2, latencyP95Ms: 500 }), // same quality + lat, costlier
		]);
		const a = lb.find((r) => r.variantId === "A");
		const b = lb.find((r) => r.variantId === "B");
		expect(a?.frontier).toBe(true);
		expect(b?.frontier).toBe(false);
		expect(b?.dominatedBy).toContain("A");
	});

	it("DROPS cost axis when any variant has costComparable=false", () => {
		const lb = paretoLeaderboard([
			row({
				id: "A",
				quality: 0.9,
				costUsdTotal: 1.0,
				latencyP95Ms: 500,
				costComparable: false,
			}),
			row({
				id: "B",
				quality: 0.9,
				costUsdTotal: 0.01,
				latencyP95Ms: 500,
				costComparable: true,
			}),
		]);
		// With cost axis excluded + same quality + same latency, neither
		// strictly dominates → both on frontier.
		expect(lb.every((r) => r.frontier)).toBe(true);
		expect(lb.every((r) => r.costAxisExcluded)).toBe(true);
	});

	it("sorts frontier first, then by quality desc", () => {
		const lb = paretoLeaderboard([
			row({ id: "best", quality: 0.9 }),
			row({ id: "ok", quality: 0.7 }),
			row({ id: "bad", quality: 0.5, costUsdTotal: 5, latencyP95Ms: 5000 }),
		]);
		expect(lb[0]?.variantId).toBe("best");
		expect(lb[1]?.variantId).toBe("ok");
	});

	it("treats null cost/latency as infinity for ranking", () => {
		const lb = paretoLeaderboard([
			row({ id: "A", quality: 0.9, costUsdTotal: null, latencyP95Ms: null }),
			row({ id: "B", quality: 0.9, costUsdTotal: 0.1, latencyP95Ms: 500 }),
		]);
		// A has no measurements → B dominates A on cost + latency.
		const aRow = lb.find((r) => r.variantId === "A");
		expect(aRow?.frontier).toBe(false);
		expect(aRow?.dominatedBy).toContain("B");
	});

	it("returns empty array on empty input", () => {
		expect(paretoLeaderboard([])).toEqual([]);
	});
});
