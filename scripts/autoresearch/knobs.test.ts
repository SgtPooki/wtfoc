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

	it("rejects unmaterialized int knob even when value is in range", () => {
		expect(validateProposal("topK", 10)).toMatch(/not yet materializable/);
	});

	it("rejects unmaterialized float knob", () => {
		expect(validateProposal("traceMinScore", 0.4)).toMatch(/not yet materializable/);
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
		expect(subset.length).toBeLessThan(KNOBS.length);
	});

	it("includes the three Phase 4.5 axes", () => {
		const names = materializableKnobs().map((k) => k.name);
		expect(names).toContain("autoRoute");
		expect(names).toContain("diversityEnforce");
		expect(names).toContain("reranker");
	});

	it("excludes the un-plumbed numeric/float knobs", () => {
		const names = materializableKnobs().map((k) => k.name);
		expect(names).not.toContain("topK");
		expect(names).not.toContain("traceMinScore");
	});
});

describe("knobsToPromptLines", () => {
	it("emits one line per materialized knob by default (LLM-visible subset)", () => {
		const lines = knobsToPromptLines();
		expect(lines.length).toBe(materializableKnobs().length);
		expect(lines.length).toBeLessThan(KNOBS.length);
	});

	it("includeUnmaterialized: true returns the full inventory", () => {
		const lines = knobsToPromptLines({ includeUnmaterialized: true });
		expect(lines.length).toBe(KNOBS.length);
		expect(lines.some((l) => l.startsWith("- topK"))).toBe(true);
	});

	it("encodes ranges + defaults legibly when full inventory requested", () => {
		const lines = knobsToPromptLines({ includeUnmaterialized: true });
		const topK = lines.find((l) => l.startsWith("- topK"));
		expect(topK).toContain("[5, 25]");
		expect(topK).toContain("default=10");
	});

	it("flags coupling", () => {
		const lines = knobsToPromptLines();
		const div = lines.find((l) => l.startsWith("- diversityEnforce"));
		expect(div).toContain("coupled-with: reranker");
	});

	it("default LLM view excludes unmaterialized knobs", () => {
		const lines = knobsToPromptLines();
		expect(lines.some((l) => l.startsWith("- topK"))).toBe(false);
	});
});
