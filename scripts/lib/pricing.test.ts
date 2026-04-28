import { describe, expect, it } from "vitest";
import { computeCost, lookupPrice } from "./pricing.js";

describe("lookupPrice", () => {
	it("returns price for known models", () => {
		expect(lookupPrice("text-embedding-3-small")?.promptPerMillion).toBe(0.02);
		expect(lookupPrice("baai/bge-base-en-v1.5")?.promptPerMillion).toBe(0);
	});

	it("returns null for unknown models", () => {
		expect(lookupPrice("not-a-real-model")).toBeNull();
	});
});

describe("computeCost", () => {
	it("reports cost for known model with token counts", () => {
		const r = computeCost({ modelId: "text-embedding-3-small", promptTokens: 1_000_000 });
		expect(r.cost_usd).toBeCloseTo(0.02, 6);
		expect(r.missing).toBeNull();
	});

	it("treats local zero-priced models as zero cost, not unknown", () => {
		const r = computeCost({ modelId: "haiku", promptTokens: 100, completionTokens: 50 });
		expect(r.cost_usd).toBe(0);
		expect(r.missing).toBeNull();
	});

	it("returns null cost with reason 'price' when model is unknown", () => {
		const r = computeCost({ modelId: "mystery-model", promptTokens: 100 });
		expect(r.cost_usd).toBeNull();
		expect(r.missing).toBe("price");
	});

	it("returns null cost with reason 'tokens' when prompt tokens missing", () => {
		const r = computeCost({ modelId: "text-embedding-3-small" });
		expect(r.cost_usd).toBeNull();
		expect(r.missing).toBe("tokens");
	});

	it("includes completion cost when completion rate set", () => {
		const r = computeCost({
			modelId: "haiku",
			promptTokens: 1_000_000,
			completionTokens: 1_000_000,
		});
		expect(r.cost_usd).toBe(0);
	});
});
