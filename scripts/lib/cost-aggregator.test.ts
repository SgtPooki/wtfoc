import { describe, expect, it } from "vitest";
import { CostAggregator } from "./cost-aggregator.js";

describe("CostAggregator", () => {
	it("sums tokens and cost across calls in a substage", () => {
		const a = new CostAggregator();
		a.record("embed-call", {
			requestModelId: "text-embedding-3-small",
			promptTokens: 500_000,
		});
		a.record("embed-call", {
			requestModelId: "text-embedding-3-small",
			promptTokens: 500_000,
		});
		const s = a.stats("embed-call");
		expect(s.callCount).toBe(2);
		expect(s.promptTokens).toBe(1_000_000);
		expect(s.cost_usd).toBeCloseTo(0.02, 6);
		expect(s.modelDriftDetected).toBe(false);
	});

	it("flags missing pricing as costComparable false", () => {
		const a = new CostAggregator();
		a.record("rerank", { requestModelId: "mystery-model", promptTokens: 100 });
		const c = a.comparability();
		expect(c.value).toBe(false);
		expect(c.reasons).toContain("unknown-price:mystery-model");
	});

	it("flags missing token counts as costComparable false", () => {
		const a = new CostAggregator();
		a.record("rerank", { requestModelId: "haiku" });
		const c = a.comparability();
		expect(c.value).toBe(false);
		expect(c.reasons).toContain("missing-tokens:haiku");
	});

	it("comparability is true when every call has known pricing + tokens", () => {
		const a = new CostAggregator();
		a.record("embed-call", { requestModelId: "haiku", promptTokens: 10, completionTokens: 5 });
		a.record("rerank", { requestModelId: "haiku", promptTokens: 20, completionTokens: 10 });
		expect(a.comparability().value).toBe(true);
	});

	it("detects request/response model drift", () => {
		const a = new CostAggregator();
		a.record("embed-call", {
			requestModelId: "haiku",
			providerResponseModelId: "claude-3-5-haiku-20241022",
			promptTokens: 1,
		});
		expect(a.stats("embed-call").modelDriftDetected).toBe(true);
	});

	it("ignores case-only differences in model id (provider re-casing)", () => {
		const a = new CostAggregator();
		a.record("embed-call", {
			requestModelId: "baai/bge-base-en-v1.5",
			providerResponseModelId: "BAAI/bge-base-en-v1.5",
			promptTokens: 1,
		});
		expect(a.stats("embed-call").modelDriftDetected).toBe(false);
	});
});
