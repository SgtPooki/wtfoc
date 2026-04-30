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

	it("rejects unsupported axis (knob exists in inventory but not in materializer yet)", async () => {
		const stateDir = mkdtempSync(join(tmpdir(), "wtfoc-materialize-"));
		await expect(
			materializeVariant({
				productionMatrix: baseMatrix(),
				productionMatrixName: "retrieval-baseline",
				proposal: { axis: "topK", value: 15, rationale: "wider K" },
				spawnFn: () => Buffer.from(""),
				stateDir,
			}),
		).rejects.toThrow(/not yet supported by the materializer/);
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
