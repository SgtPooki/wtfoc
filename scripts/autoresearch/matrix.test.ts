import { describe, expect, it } from "vitest";
import { enumerateVariants, type Matrix } from "./matrix.js";

const baseMatrix: Matrix = {
	name: "test",
	description: "test matrix",
	baseConfig: {
		collection: "test-corpus",
		embedderUrl: "http://localhost:1/v1",
		embedderModel: "test-embedder",
	},
	axes: {
		autoRoute: [false, true],
		diversityEnforce: [false, true],
		reranker: ["off", { type: "llm", url: "http://localhost:2/v1", model: "haiku" }],
	},
};

describe("enumerateVariants", () => {
	it("produces the Cartesian product of axis values", () => {
		const variants = enumerateVariants(baseMatrix);
		expect(variants).toHaveLength(2 * 2 * 2);
	});

	it("each variant has a unique variantId", () => {
		const variants = enumerateVariants(baseMatrix);
		const ids = variants.map((v) => v.variantId);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("variantId encodes axis values legibly", () => {
		const variants = enumerateVariants(baseMatrix);
		const off = variants.find(
			(v) => !v.axes.autoRoute && !v.axes.diversityEnforce && v.axes.reranker === "off",
		);
		expect(off?.variantId).toBe("noar_nodiv_rrOff");
		const all = variants.find(
			(v) =>
				v.axes.autoRoute &&
				v.axes.diversityEnforce &&
				v.axes.reranker !== "off" &&
				v.axes.reranker.type === "llm",
		);
		expect(all?.variantId).toBe("ar_div_rrLlm-haiku");
	});

	it("enumeration order is stable across calls", () => {
		const a = enumerateVariants(baseMatrix).map((v) => v.variantId);
		const b = enumerateVariants(baseMatrix).map((v) => v.variantId);
		expect(a).toEqual(b);
	});

	it("defaults to a single variant when no axes are configured", () => {
		const m: Matrix = {
			name: "minimal",
			description: "no axes",
			baseConfig: {
				collection: "test-corpus",
				embedderUrl: "http://localhost:1/v1",
				embedderModel: "test-embedder",
			},
			axes: {},
		};
		const variants = enumerateVariants(m);
		expect(variants).toHaveLength(1);
		expect(variants[0]?.variantId).toBe("noar_nodiv_rrOff");
	});
});
