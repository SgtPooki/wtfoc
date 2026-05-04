import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Matrix } from "./matrix.js";
import { materializeVariant } from "./materialize-variant.js";

function baseMatrix(): Matrix {
	return {
		name: "retrieval-baseline",
		description: "test",
		productionVariantId: "noar_div_rrOff",
		baseConfig: {
			collections: { primary: "filoz", secondary: "wtfoc-v3" },
			embedderUrl: "http://x/v1",
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
}

describe("materializeVariant — matrix synthesis", () => {
	it("writes a single-variant derived matrix file under the proposal dir", async () => {
		const stateDir = mkdtempSync(join(tmpdir(), "wtfoc-materialize-"));
		const calls: Array<{ cmd: string; args: string[] }> = [];
		const result = await materializeVariant({
			productionMatrix: baseMatrix(),
			productionMatrixName: "retrieval-baseline",
			proposal: { axis: "autoRoute", value: true, rationale: "force route on" },
			spawnFn: (cmd, args) => {
				calls.push({ cmd, args });
				return Buffer.from("");
			},
			stateDir,
		});
		expect(result.matrixPath.startsWith(stateDir)).toBe(true);
		expect(result.matrixPath.endsWith("/matrix.ts")).toBe(true);
		expect(existsSync(result.matrixPath)).toBe(true);
		const body = readFileSync(result.matrixPath, "utf-8");
		expect(body).toContain("AUTO-GENERATED");
		const parsed = JSON.parse(body.split("export default ")[1]?.replace(/;\s*$/, "").trim() ?? "{}");
		// Single value per axis — proposed change applied
		expect(parsed.axes.autoRoute).toEqual([true]);
		expect(parsed.axes.diversityEnforce).toEqual([true]); // production default
		expect(parsed.axes.reranker).toEqual(["off"]);
	});

	it("invokes pnpm autoresearch:sweep with the temp matrix path", async () => {
		const stateDir = mkdtempSync(join(tmpdir(), "wtfoc-materialize-"));
		const calls: Array<{ cmd: string; args: string[] }> = [];
		const result = await materializeVariant({
			productionMatrix: baseMatrix(),
			productionMatrixName: "retrieval-baseline",
			proposal: { axis: "diversityEnforce", value: false, rationale: "test off" },
			spawnFn: (cmd, args) => {
				calls.push({ cmd, args });
				return Buffer.from("");
			},
			stateDir,
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.cmd).toBe("pnpm");
		expect(calls[0]?.args).toContain("autoresearch:sweep");
		expect(calls[0]?.args).toContain(result.matrixPath);
		expect(calls[0]?.args).toContain("--stage");
		expect(calls[0]?.args).toContain("autoresearch-proposal");
	});

	it("rejects unknown axis", async () => {
		const stateDir = mkdtempSync(join(tmpdir(), "wtfoc-materialize-"));
		await expect(
			materializeVariant({
				productionMatrix: baseMatrix(),
				productionMatrixName: "retrieval-baseline",
				proposal: { axis: "nonexistent", value: 1, rationale: "x" },
				spawnFn: () => Buffer.from(""),
				stateDir,
			}),
		).rejects.toThrow(/unknown axis/);
	});

	it("encodes topK numeric override into the derived matrix", async () => {
		const stateDir = mkdtempSync(join(tmpdir(), "wtfoc-materialize-"));
		const result = await materializeVariant({
			productionMatrix: baseMatrix(),
			productionMatrixName: "retrieval-baseline",
			proposal: { axis: "topK", value: 15, rationale: "wider K" },
			spawnFn: () => Buffer.from(""),
			stateDir,
		});
		const body = readFileSync(result.matrixPath, "utf-8");
		const parsed = JSON.parse(body.split("export default ")[1]?.replace(/;\s*$/, "").trim() ?? "{}");
		expect(parsed.axes.topK).toEqual([15]);
	});

	it("encodes traceMinScore float override into the derived matrix", async () => {
		const stateDir = mkdtempSync(join(tmpdir(), "wtfoc-materialize-"));
		const result = await materializeVariant({
			productionMatrix: baseMatrix(),
			productionMatrixName: "retrieval-baseline",
			proposal: { axis: "traceMinScore", value: 0.4, rationale: "tighter floor" },
			spawnFn: () => Buffer.from(""),
			stateDir,
		});
		const body = readFileSync(result.matrixPath, "utf-8");
		const parsed = JSON.parse(body.split("export default ")[1]?.replace(/;\s*$/, "").trim() ?? "{}");
		expect(parsed.axes.traceMinScore).toEqual([0.4]);
	});

	it("derives base axes from targetVariantId when provided (#394)", async () => {
		// productionVariantId is noar_div_rrOff but the finding implicates
		// noar_div_rrBge. Materializer must derive base axes from the
		// target (BGE reranker), not from production (rerank off).
		const stateDir = mkdtempSync(join(tmpdir(), "wtfoc-materialize-"));
		const result = await materializeVariant({
			productionMatrix: baseMatrix(),
			productionMatrixName: "retrieval-baseline",
			proposal: { axis: "topK", value: 30, rationale: "wider K" },
			targetVariantId: "noar_div_rrBge",
			spawnFn: () => Buffer.from(""),
			stateDir,
		});
		const body = readFileSync(result.matrixPath, "utf-8");
		const parsed = JSON.parse(body.split("export default ")[1]?.replace(/;\s*$/, "").trim() ?? "{}");
		expect(parsed.axes.topK).toEqual([30]);
		expect(parsed.axes.reranker).toEqual([{ type: "bge", url: "http://127.0.0.1:8386" }]);
		expect(parsed.axes.diversityEnforce).toEqual([true]);
		expect(parsed.axes.autoRoute).toEqual([false]);
		// Audit note surfaced when target diverges from production.
		expect(result.notes.some((n) => n.includes("noar_div_rrBge") && n.includes("#394"))).toBe(true);
	});

	it("preserves legacy `?? true` defaults when both productionVariantId and targetVariantId are unset", async () => {
		// Exploratory matrices may have no productionVariantId. Pre-#394 the
		// internal `matrix.productionVariantId?.includes(...) ?? true` fallback
		// defaulted diversityEnforce to true. Coercing to "" would break that.
		const stateDir = mkdtempSync(join(tmpdir(), "wtfoc-materialize-"));
		const m = baseMatrix();
		const noProdMatrix = { ...m, productionVariantId: undefined as unknown as string };
		const result = await materializeVariant({
			productionMatrix: noProdMatrix,
			productionMatrixName: "retrieval-baseline",
			proposal: { axis: "topK", value: 30, rationale: "wider K" },
			spawnFn: () => Buffer.from(""),
			stateDir,
		});
		const body = readFileSync(result.matrixPath, "utf-8");
		const parsed = JSON.parse(body.split("export default ")[1]?.replace(/;\s*$/, "").trim() ?? "{}");
		expect(parsed.axes.diversityEnforce).toEqual([true]);
		expect(parsed.axes.reranker).toEqual(["off"]);
	});

	it("falls back to productionVariantId when targetVariantId omitted (legacy)", async () => {
		const stateDir = mkdtempSync(join(tmpdir(), "wtfoc-materialize-"));
		const result = await materializeVariant({
			productionMatrix: baseMatrix(),
			productionMatrixName: "retrieval-baseline",
			proposal: { axis: "topK", value: 30, rationale: "wider K" },
			spawnFn: () => Buffer.from(""),
			stateDir,
		});
		const body = readFileSync(result.matrixPath, "utf-8");
		const parsed = JSON.parse(body.split("export default ")[1]?.replace(/;\s*$/, "").trim() ?? "{}");
		expect(parsed.axes.reranker).toEqual(["off"]);
		expect(result.notes.some((n) => n.includes("#394"))).toBe(false);
	});

	it("falls back to fingerprint-loose baselines when strict matches insufficient", async () => {
		// Real-world case: candidate sweep produces a fingerprint that no
		// nightly-cron baseline shares (env/code drift). Strict match would
		// always block knob proposals. Relaxed fallback uses recent
		// nightly-cron rows for the same variant+corpus regardless of fp,
		// mirrors materialize-patch's policy.
		const stateDir = mkdtempSync(join(tmpdir(), "wtfoc-materialize-"));
		// Pre-seed runs.jsonl with 3 nightly-cron rows + a candidate row.
		// Use a temp run-log dir so we don't pollute real history.
		const runLogDir = mkdtempSync(join(tmpdir(), "wtfoc-runlog-"));
		const runsPath = join(runLogDir, "runs.jsonl");
		const reportsDir = join(runLogDir, "reports");
		mkdirSync(reportsDir, { recursive: true });
		// Helper: write a minimal report file + return its path.
		const writeReport = (variantId: string, fp: string, passRate: number) => {
			const p = join(reportsDir, `${variantId}-${fp.slice(0, 8)}-${passRate}.json`);
			const report = {
				runConfig: { collectionId: "filoz" },
				runConfigFingerprint: fp,
				summary: { passRate, demoCriticalPassRate: 1, recallAtKMean: 0.5, latencyP95Ms: 1000 },
				variantId,
			};
			writeFileSync(p, JSON.stringify(report));
			return p;
		};
		const baselineFp = "fp_baseline_old";
		const candidateFp = "fp_candidate_drift";
		const baselineRows = [0, 1, 2].map((i) => ({
			schemaVersion: 1,
			loggedAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
			matrixName: "retrieval-baseline",
			variantId: "noar_div_rrOff",
			sweepId: `nightly-${i}`,
			runConfigFingerprint: baselineFp,
			runConfig: { collectionId: "filoz" },
			stage: "nightly-cron",
			reportPath: writeReport("noar_div_rrOff", baselineFp, 0.5),
			summary: { passRate: 0.5, demoCriticalPassRate: 1, recallAtKMean: 0.5, latencyP95Ms: 1000 },
		}));
		const candidateRow = {
			schemaVersion: 1,
			loggedAt: new Date().toISOString(),
			matrixName: "retrieval-baseline",
			variantId: "noar_div_rrOff_tps5",
			sweepId: "ar-proposal-1",
			runConfigFingerprint: candidateFp,
			runConfig: { collectionId: "filoz" },
			stage: "autoresearch-proposal",
			reportPath: writeReport("noar_div_rrOff_tps5", candidateFp, 0.6),
			summary: { passRate: 0.6, demoCriticalPassRate: 1, recallAtKMean: 0.6, latencyP95Ms: 1000 },
		};
		writeFileSync(runsPath, [...baselineRows, candidateRow].map((r) => JSON.stringify(r)).join("\n") + "\n");
		// Point run-log at our temp dir.
		const prevDir = process.env.WTFOC_AUTORESEARCH_DIR;
		process.env.WTFOC_AUTORESEARCH_DIR = runLogDir;
		try {
			const result = await materializeVariant({
				productionMatrix: baseMatrix(),
				productionMatrixName: "retrieval-baseline",
				proposal: { axis: "traceMaxPerSource", value: 5, rationale: "x" },
				targetVariantId: "noar_div_rrOff",
				spawnFn: () => Buffer.from(""),
				stateDir,
				minBaseline: 3,
			});
			// Relaxed-fallback path fired (note surfaced). decide() may
			// return null if the minimal fixture reports lack scores —
			// that's an orthogonal concern; what matters here is that the
			// baseline-window construction is no longer empty.
			expect(result.notes.some((n) => n.includes("fingerprint-loose"))).toBe(true);
			expect(
				result.decisions[0]?.reason?.includes("only 0 comparable production baseline"),
			).not.toBe(true);
		} finally {
			if (prevDir === undefined) delete process.env.WTFOC_AUTORESEARCH_DIR;
			else process.env.WTFOC_AUTORESEARCH_DIR = prevDir;
		}
	});

	it("encodes reranker enum values into the derived matrix", async () => {
		const stateDir = mkdtempSync(join(tmpdir(), "wtfoc-materialize-"));
		const result = await materializeVariant({
			productionMatrix: baseMatrix(),
			productionMatrixName: "retrieval-baseline",
			proposal: { axis: "reranker", value: "bge", rationale: "try cross-encoder" },
			spawnFn: () => Buffer.from(""),
			stateDir,
		});
		const body = readFileSync(result.matrixPath, "utf-8");
		const parsed = JSON.parse(body.split("export default ")[1]?.replace(/;\s*$/, "").trim() ?? "{}");
		expect(parsed.axes.reranker).toEqual([{ type: "bge", url: "http://127.0.0.1:8386" }]);
	});
});
