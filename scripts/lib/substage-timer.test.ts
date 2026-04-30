import { describe, expect, it } from "vitest";
import { SubstageTimer } from "./substage-timer.js";

describe("SubstageTimer", () => {
	it("returns zeros for unknown substages", () => {
		const t = new SubstageTimer();
		expect(t.stats("nope")).toEqual({ callCount: 0, totalMs: 0, p50Ms: 0, p95Ms: 0 });
	});

	it("computes count + total + percentiles", () => {
		const t = new SubstageTimer();
		for (const v of [10, 20, 30, 40, 50]) t.record("retrieve", v);
		const s = t.stats("retrieve");
		expect(s.callCount).toBe(5);
		expect(s.totalMs).toBe(150);
		expect(s.p50Ms).toBe(30);
		expect(s.p95Ms).toBe(48); // 0.95 * (5-1) = 3.8 → between 40 and 50
	});

	it("handles single-call substages", () => {
		const t = new SubstageTimer();
		t.record("only", 7);
		const s = t.stats("only");
		expect(s.callCount).toBe(1);
		expect(s.totalMs).toBe(7);
		expect(s.p50Ms).toBe(7);
		expect(s.p95Ms).toBe(7);
	});

	it("isolates substages from each other", () => {
		const t = new SubstageTimer();
		t.record("a", 5);
		t.record("b", 100);
		expect(t.stats("a").callCount).toBe(1);
		expect(t.stats("b").callCount).toBe(1);
		expect(t.substages()).toEqual(["a", "b"]);
	});
});
