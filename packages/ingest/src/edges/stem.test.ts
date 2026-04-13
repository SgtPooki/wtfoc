import { describe, expect, it } from "vitest";
import { stripSuffix } from "./stem.js";

describe("stripSuffix", () => {
	// ── -ization / -isation ──────────────────────────────────────
	it("strips -ization", () => {
		expect(stripSuffix("initialization")).toBe("initial");
	});

	it("strips -isation", () => {
		expect(stripSuffix("normalisation")).toBe("normal");
	});

	// ── -tion / -sion ────────────────────────────────────────────
	it("strips -sion from collision", () => {
		expect(stripSuffix("collision")).toBe("colli");
	});

	it("strips -sion from regression", () => {
		expect(stripSuffix("regression")).toBe("regres");
	});

	it("strips -tion from extraction", () => {
		expect(stripSuffix("extraction")).toBe("extrac");
	});

	// ── -ment ────────────────────────────────────────────────────
	it("strips -ment", () => {
		expect(stripSuffix("deployment")).toBe("deploy");
	});

	// ── -ness ────────────────────────────────────────────────────
	it("strips -ness", () => {
		expect(stripSuffix("readiness")).toBe("readi");
	});

	// ── -ity ─────────────────────────────────────────────────────
	it("strips -ity", () => {
		expect(stripSuffix("complexity")).toBe("complex");
	});

	// ── -ance / -ence ────────────────────────────────────────────
	it("strips -ance", () => {
		expect(stripSuffix("avoidance")).toBe("avoid");
	});

	it("strips -ence", () => {
		expect(stripSuffix("reference")).toBe("refer");
	});

	// ── -ing with doubled consonant ──────────────────────────────
	it("strips -ing", () => {
		expect(stripSuffix("handling")).toBe("handl");
	});

	it("strips -ing with doubled consonant", () => {
		expect(stripSuffix("running")).toBe("run");
	});

	it("strips -ing from 'colliding' (bridging collide ↔ collision)", () => {
		expect(stripSuffix("colliding")).toBe("collid");
	});

	// ── -ed with doubled consonant ───────────────────────────────
	it("strips -ed", () => {
		expect(stripSuffix("deployed")).toBe("deploy");
	});

	it("strips -ed with doubled consonant", () => {
		expect(stripSuffix("stopped")).toBe("stop");
	});

	// ── -ize / -ise ──────────────────────────────────────────────
	it("strips -ize", () => {
		expect(stripSuffix("normalize")).toBe("normal");
	});

	it("strips -ise", () => {
		expect(stripSuffix("normalise")).toBe("normal");
	});

	// ── -able / -ible ────────────────────────────────────────────
	it("strips -able", () => {
		expect(stripSuffix("resolvable")).toBe("resolv");
	});

	it("strips -ible", () => {
		expect(stripSuffix("accessible")).toBe("access");
	});

	// ── -al / -ly / -ous ─────────────────────────────────────────
	it("strips -al", () => {
		expect(stripSuffix("functional")).toBe("function");
	});

	it("strips -ly", () => {
		expect(stripSuffix("quickly")).toBe("quick");
	});

	it("strips -ous", () => {
		expect(stripSuffix("dangerous")).toBe("danger");
	});

	// ── -er / -est ───────────────────────────────────────────────
	it("strips -er", () => {
		expect(stripSuffix("handler")).toBe("handl");
	});

	it("strips -est", () => {
		expect(stripSuffix("fastest")).toBe("fast");
	});

	// ── Min stem length (3 chars) ────────────────────────────────
	it("does not strip if result would be < 3 chars", () => {
		expect(stripSuffix("bed")).toBe("bed");
	});

	it("does not strip short words", () => {
		expect(stripSuffix("go")).toBe("go");
	});

	// ── Edge cases ───────────────────────────────────────────────
	it("returns empty string for empty input", () => {
		expect(stripSuffix("")).toBe("");
	});

	it("passes through words with no matching suffix", () => {
		expect(stripSuffix("graph")).toBe("graph");
	});

	it("is case-insensitive (lowercases)", () => {
		expect(stripSuffix("Deployment")).toBe("deploy");
	});
});
