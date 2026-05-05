import { describe, expect, it } from "vitest";
import type { Variant } from "./matrix.js";
import {
	PhaseCompositionError,
	planSweepPhases,
	resolveRequiredMode,
} from "./sweep-phase-planner.js";

function variant(
	id: string,
	reranker: Variant["axes"]["reranker"],
): Variant {
	return {
		variantId: id,
		axes: { autoRoute: false, diversityEnforce: false, reranker },
	};
}

const ADMIN = "vllm-admin.example";

describe("resolveRequiredMode", () => {
	it("returns null for missing url", () => {
		expect(resolveRequiredMode(undefined, ADMIN)).toBe(null);
	});

	it("returns 'cloud' when host is not on admin", () => {
		expect(
			resolveRequiredMode("https://openrouter.ai/api/v1", ADMIN),
		).toBe("cloud");
	});

	it("returns 'embed-gpu' for embedder-gpu host on admin", () => {
		expect(
			resolveRequiredMode(`https://embedder-gpu.${ADMIN}/v1`, ADMIN),
		).toBe("embed-gpu");
	});

	it("returns 'rerank-gpu' for reranker-gpu host on admin", () => {
		expect(
			resolveRequiredMode(`https://reranker-gpu.${ADMIN}/v1`, ADMIN),
		).toBe("rerank-gpu");
	});

	it("returns 'chat' for chat host on admin", () => {
		expect(
			resolveRequiredMode(`https://chat.${ADMIN}/v1`, ADMIN),
		).toBe("chat");
	});

	it("treats every URL as cloud when adminHost is null", () => {
		expect(
			resolveRequiredMode(`https://embedder-gpu.${ADMIN}/v1`, null),
		).toBe("cloud");
	});
});

describe("planSweepPhases", () => {
	it("full-cloud matrix: 0 swaps, no skip on search", () => {
		const plan = planSweepPhases({
			embedderUrl: "https://openrouter.ai/api/v1",
			extractorUrl: "https://nim.example.com/v1",
			variants: [
				variant("v1", { type: "bge", url: "https://reranker.cloud.example/v1" }),
			],
			adminHost: ADMIN,
			groundingEnabled: false,
		});
		expect(plan.map((p) => p.mode)).toEqual([null, null, null]);
	});

	it("full-local 3-mode matrix: embed-gpu / rerank-gpu / null (no grounding)", () => {
		const plan = planSweepPhases({
			embedderUrl: `https://embedder-gpu.${ADMIN}/v1`,
			extractorUrl: `https://chat.${ADMIN}/v1`,
			variants: [
				variant("v1", { type: "bge", url: `https://reranker-gpu.${ADMIN}/v1` }),
			],
			adminHost: ADMIN,
			groundingEnabled: false,
		});
		expect(plan.find((p) => p.phase === "embed")?.mode).toBe("embed-gpu");
		expect(plan.find((p) => p.phase === "search")?.mode).toBe("rerank-gpu");
		expect(plan.find((p) => p.phase === "score")?.mode).toBe(null);
		expect(plan.find((p) => p.phase === "score")?.skip).toBe(true);
	});

	it("full-local + grounding: 3 GPU modes total (embed-gpu / rerank-gpu / chat)", () => {
		const plan = planSweepPhases({
			embedderUrl: `https://embedder-gpu.${ADMIN}/v1`,
			extractorUrl: `https://chat.${ADMIN}/v1`,
			variants: [
				variant("v1", { type: "bge", url: `https://reranker-gpu.${ADMIN}/v1` }),
			],
			adminHost: ADMIN,
			groundingEnabled: true,
		});
		expect(plan.find((p) => p.phase === "embed")?.mode).toBe("embed-gpu");
		expect(plan.find((p) => p.phase === "search")?.mode).toBe("rerank-gpu");
		expect(plan.find((p) => p.phase === "score")?.mode).toBe("chat");
	});

	it("mixed: cloud embedder + cloud extractor + local BGE → 1 swap on search", () => {
		const plan = planSweepPhases({
			embedderUrl: "https://openrouter.ai/api/v1",
			extractorUrl: "https://nim.example.com/v1",
			variants: [
				variant("v1", { type: "bge", url: `https://reranker-gpu.${ADMIN}/v1` }),
			],
			adminHost: ADMIN,
			groundingEnabled: false,
		});
		expect(plan.find((p) => p.phase === "embed")?.mode).toBe(null);
		expect(plan.find((p) => p.phase === "search")?.mode).toBe("rerank-gpu");
		expect(plan.find((p) => p.phase === "score")?.mode).toBe(null);
	});

	it("reranker=off across every variant: search phase needs no mode swap", () => {
		const plan = planSweepPhases({
			embedderUrl: `https://embedder-gpu.${ADMIN}/v1`,
			extractorUrl: undefined,
			variants: [variant("v1", "off"), variant("v2", "off")],
			adminHost: ADMIN,
			groundingEnabled: false,
		});
		expect(plan.find((p) => p.phase === "search")?.mode).toBe(null);
	});

	it("refuses when two variants disagree on reranker GPU mode in the same phase", () => {
		expect(() =>
			planSweepPhases({
				embedderUrl: "https://openrouter.ai/api/v1",
				variants: [
					variant("v1", { type: "bge", url: `https://reranker-gpu.${ADMIN}/v1` }),
					// Pretend a second BGE is mounted under a hypothetical
					// embedder-gpu host — both are local but on different
					// modes; the planner must refuse rather than try to
					// pre-stage one mode.
					variant("v2", {
						type: "bge",
						url: `https://embedder-gpu.${ADMIN}/v1`,
					}),
				],
				adminHost: ADMIN,
				groundingEnabled: false,
			}),
		).toThrow(PhaseCompositionError);
	});
});
