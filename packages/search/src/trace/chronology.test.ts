import { describe, expect, it } from "vitest";
import { buildChronologicalHopIndices, parseHopTimestampMs } from "./chronology.js";
import type { TraceHop } from "./trace.js";

function hop(overrides: Partial<TraceHop> & { sourceType: string }): TraceHop {
	return {
		content: "c",
		source: "s",
		storageId: "sid",
		connection: { method: "semantic", confidence: 0.5 },
		...overrides,
	};
}

describe("parseHopTimestampMs", () => {
	it("parses ISO-8601 timestamps", () => {
		expect(parseHopTimestampMs("2025-10-15T10:35:03Z")).toBe(Date.parse("2025-10-15T10:35:03Z"));
	});

	it("returns null for undefined, empty, or unparseable input", () => {
		expect(parseHopTimestampMs(undefined)).toBeNull();
		expect(parseHopTimestampMs("")).toBeNull();
		expect(parseHopTimestampMs("not-a-date")).toBeNull();
	});
});

describe("buildChronologicalHopIndices", () => {
	it("returns empty for empty input", () => {
		expect(buildChronologicalHopIndices([])).toEqual([]);
	});

	it("sorts dated hops ascending by timestamp", () => {
		const hops: TraceHop[] = [
			hop({ sourceType: "a", timestamp: "2025-10-16T00:00:00Z" }),
			hop({ sourceType: "b", timestamp: "2025-10-14T00:00:00Z" }),
			hop({ sourceType: "c", timestamp: "2025-10-15T00:00:00Z" }),
		];
		expect(buildChronologicalHopIndices(hops)).toEqual([1, 2, 0]);
	});

	it("appends undated hops at end in traversal order", () => {
		const hops: TraceHop[] = [
			hop({ sourceType: "a" }),
			hop({ sourceType: "b", timestamp: "2025-10-15T00:00:00Z" }),
			hop({ sourceType: "c" }),
			hop({ sourceType: "d", timestamp: "2025-10-14T00:00:00Z" }),
		];
		// Dated: [3 (10-14), 1 (10-15)]. Undated: [0, 2] in traversal order.
		expect(buildChronologicalHopIndices(hops)).toEqual([3, 1, 0, 2]);
	});

	it("treats unparseable timestamps as undated", () => {
		const hops: TraceHop[] = [
			hop({ sourceType: "a", timestamp: "not-a-date" }),
			hop({ sourceType: "b", timestamp: "2025-10-15T00:00:00Z" }),
		];
		expect(buildChronologicalHopIndices(hops)).toEqual([1, 0]);
	});

	it("breaks timestamp ties stably by traversal index", () => {
		const same = "2025-10-15T00:00:00Z";
		const hops: TraceHop[] = [
			hop({ sourceType: "a", timestamp: same }),
			hop({ sourceType: "b", timestamp: same }),
			hop({ sourceType: "c", timestamp: same }),
		];
		expect(buildChronologicalHopIndices(hops)).toEqual([0, 1, 2]);
	});

	it("returns a bijection with hops — every index appears exactly once", () => {
		const hops: TraceHop[] = [
			hop({ sourceType: "a", timestamp: "2025-10-16T00:00:00Z" }),
			hop({ sourceType: "b" }),
			hop({ sourceType: "c", timestamp: "2025-10-14T00:00:00Z" }),
			hop({ sourceType: "d" }),
			hop({ sourceType: "e", timestamp: "2025-10-15T00:00:00Z" }),
		];
		const indices = buildChronologicalHopIndices(hops);
		expect(indices).toHaveLength(hops.length);
		expect(new Set(indices).size).toBe(hops.length);
		for (const i of indices) {
			expect(i).toBeGreaterThanOrEqual(0);
			expect(i).toBeLessThan(hops.length);
		}
	});
});
