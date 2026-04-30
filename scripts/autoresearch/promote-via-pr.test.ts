import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyProposalToMatrixSource, promoteViaPr } from "./promote-via-pr.js";

const SAMPLE_MATRIX_SRC = `import type { Matrix } from "../matrix.js";

const matrix: Matrix = {
	name: "retrieval-baseline",
	description: "Cross-corpus retrieval-knob sweep on v12 + v3.",
	productionVariantId: "noar_div_rrOff",
	baseConfig: {
		collections: {
			primary: "filoz",
			secondary: "wtfoc-v3",
		},
		embedderUrl: "https://x/v1",
		embedderModel: "test",
	},
	axes: {
		autoRoute: [false, true],
		diversityEnforce: [false, true],
		reranker: [
			"off",
			{ type: "llm", url: "http://127.0.0.1:4523/v1", model: "haiku" },
		],
	},
};

export default matrix;
`;

describe("applyProposalToMatrixSource", () => {
	it("replaces autoRoute axis array with the proposed single value", () => {
		const { newSource, replaced } = applyProposalToMatrixSource(
			SAMPLE_MATRIX_SRC,
			"autoRoute",
			true,
		);
		expect(replaced).toBe(true);
		expect(newSource).toContain("autoRoute: [true]");
		expect(newSource).not.toContain("autoRoute: [false, true]");
	});

	it("replaces diversityEnforce axis", () => {
		const { newSource, replaced } = applyProposalToMatrixSource(
			SAMPLE_MATRIX_SRC,
			"diversityEnforce",
			false,
		);
		expect(replaced).toBe(true);
		expect(newSource).toContain("diversityEnforce: [false]");
	});

	it("replaces reranker enum to off", () => {
		const { newSource, replaced } = applyProposalToMatrixSource(
			SAMPLE_MATRIX_SRC,
			"reranker",
			"off",
		);
		expect(replaced).toBe(true);
		expect(newSource).toContain('reranker: ["off"]');
	});

	it("replaces reranker enum to bge", () => {
		const { newSource, replaced } = applyProposalToMatrixSource(
			SAMPLE_MATRIX_SRC,
			"reranker",
			"bge",
		);
		expect(replaced).toBe(true);
		expect(newSource).toContain('{ type: "bge", url: "http://127.0.0.1:8386" }');
	});

	it("returns replaced=false for axes not present as literals", () => {
		const { replaced } = applyProposalToMatrixSource(SAMPLE_MATRIX_SRC, "topK", 15);
		expect(replaced).toBe(false);
	});

	it("returns replaced=false for invalid reranker enum value", () => {
		const { replaced } = applyProposalToMatrixSource(
			SAMPLE_MATRIX_SRC,
			"reranker",
			"cohere",
		);
		expect(replaced).toBe(false);
	});
});

describe("promoteViaPr — dry-run", () => {
	function setupRepo(): string {
		const repo = mkdtempSync(join(tmpdir(), "wtfoc-promote-"));
		mkdirSync(join(repo, "scripts", "autoresearch", "matrices"), { recursive: true });
		writeFileSync(
			join(repo, "scripts", "autoresearch", "matrices", "retrieval-baseline.ts"),
			SAMPLE_MATRIX_SRC,
		);
		return repo;
	}

	it("computes diff without touching git in dry-run", async () => {
		const repo = setupRepo();
		const result = await promoteViaPr({
			proposalId: "p1",
			matrixName: "retrieval-baseline",
			proposal: { axis: "autoRoute", value: true, rationale: "test" },
			candidateVariantId: "candidate",
			rationale: "test rationale",
			verdictSummary: "accepted",
			dryRun: true,
			repoRoot: repo,
		});
		expect(result.dryRun).toBe(true);
		expect(result.prUrl).toBeNull();
		expect(result.branch).toBe("autoresearch/p1");
		expect(result.diff).toContain("-");
		expect(result.diff).toContain("+");
		// Source file untouched in dry-run.
		const after = readFileSync(
			join(repo, "scripts", "autoresearch", "matrices", "retrieval-baseline.ts"),
			"utf-8",
		);
		expect(after).toBe(SAMPLE_MATRIX_SRC);
	});

	it("skips with reason when matrix file missing", async () => {
		const repo = mkdtempSync(join(tmpdir(), "wtfoc-promote-"));
		const result = await promoteViaPr({
			proposalId: "p2",
			matrixName: "missing-matrix",
			proposal: { axis: "autoRoute", value: true, rationale: "x" },
			candidateVariantId: "c",
			rationale: "r",
			verdictSummary: "v",
			repoRoot: repo,
		});
		expect(result.skippedReason).toMatch(/not found/);
		expect(result.prUrl).toBeNull();
	});

	it("skips with reason when axis not promotable via regex", async () => {
		const repo = setupRepo();
		const result = await promoteViaPr({
			proposalId: "p3",
			matrixName: "retrieval-baseline",
			proposal: { axis: "topK", value: 15, rationale: "x" },
			candidateVariantId: "c",
			rationale: "r",
			verdictSummary: "v",
			dryRun: true,
			repoRoot: repo,
		});
		expect(result.skippedReason).toMatch(/not promotable/);
	});
});
