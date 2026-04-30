import { describe, expect, it } from "vitest";
import {
	getKnob,
	KNOBS,
	knobsToPromptLines,
	materializableKnobs,
	validateProposal,
} from "./knobs.js";

describe("knobs inventory", () => {
	it("every knob has a unique name", () => {
		const names = KNOBS.map((k) => k.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it("getKnob returns the entry by name", () => {
		expect(getKnob("autoRoute")?.type).toBe("boolean");
		expect(getKnob("topK")?.type).toBe("int");
		expect(getKnob("reranker")?.type).toBe("enum");
		expect(getKnob("nonexistent")).toBeUndefined();
	});

	it("coupledWith only references existing knob names", () => {
		const names = new Set(KNOBS.map((k) => k.name));
		for (const k of KNOBS) {
			for (const c of k.coupledWith) {
				expect(names.has(c)).toBe(true);
			}
		}
	});
});

describe("validateProposal", () => {
	it("accepts valid boolean on materialized knob", () => {
		expect(validateProposal("autoRoute", true)).toBeNull();
		expect(validateProposal("autoRoute", false)).toBeNull();
	});

	it("rejects non-boolean for boolean knob", () => {
		expect(validateProposal("autoRoute", 1)).toMatch(/expected boolean/);
	});

	it("accepts integer in range on materialized int knob", () => {
		expect(validateProposal("topK", 10)).toBeNull();
		expect(validateProposal("topK", 5)).toBeNull();
		expect(validateProposal("topK", 25)).toBeNull();
	});

	it("rejects integer outside range", () => {
		expect(validateProposal("topK", 4)).toMatch(/outside/);
		expect(validateProposal("topK", 26)).toMatch(/outside/);
	});

	it("rejects non-integer for int knob", () => {
		expect(validateProposal("topK", 10.5)).toMatch(/expected integer/);
	});

	it("accepts float in range on materialized float knob", () => {
		expect(validateProposal("traceMinScore", 0.4)).toBeNull();
	});

	it("rejects float outside range", () => {
		expect(validateProposal("traceMinScore", 0.05)).toMatch(/outside/);
	});

	it("accepts enum value in set on materialized knob", () => {
		expect(validateProposal("reranker", "off")).toBeNull();
		expect(validateProposal("reranker", "llm:haiku")).toBeNull();
	});

	it("rejects enum value outside set", () => {
		expect(validateProposal("reranker", "cohere")).toMatch(/not in enum/);
	});

	it("rejects unknown knob", () => {
		expect(validateProposal("nonexistent", 0)).toMatch(/unknown knob/);
	});
});

describe("materializableKnobs", () => {
	it("returns only knobs flagged materialized=true", () => {
		const subset = materializableKnobs();
		expect(subset.length).toBeGreaterThan(0);
		expect(subset.every((k) => k.materialized)).toBe(true);
	});

	it("includes the seven Phase 4.5+334 axes", () => {
		const names = materializableKnobs().map((k) => k.name);
		for (const required of [
			"autoRoute",
			"diversityEnforce",
			"reranker",
			"topK",
			"traceMaxPerSource",
			"traceMaxTotal",
			"traceMinScore",
		]) {
			expect(names).toContain(required);
		}
	});
});

describe("knobsToPromptLines", () => {
	it("emits one line per materialized knob by default (LLM-visible subset)", () => {
		const lines = knobsToPromptLines();
		expect(lines.length).toBe(materializableKnobs().length);
	});

	it("includeUnmaterialized: true returns the full inventory", () => {
		const lines = knobsToPromptLines({ includeUnmaterialized: true });
		expect(lines.length).toBe(KNOBS.length);
	});

	it("encodes ranges + defaults legibly", () => {
		const lines = knobsToPromptLines();
		const topK = lines.find((l) => l.startsWith("- topK"));
		expect(topK).toContain("[5, 25]");
		expect(topK).toContain("default=10");
	});

	it("flags coupling", () => {
		const lines = knobsToPromptLines();
		const div = lines.find((l) => l.startsWith("- diversityEnforce"));
		expect(div).toContain("coupled-with: reranker");
	});
});
