import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Matrix } from "./matrix.js";
import { materializePatchProposal } from "./materialize-patch.js";
import type { PatchProposal } from "./patch-proposal.js";

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
			autoRoute: [false],
			diversityEnforce: [true],
			reranker: ["off"],
		},
	};
}

function setupTestEnv() {
	const stateDir = mkdtempSync(join(tmpdir(), "wtfoc-mp-"));
	// proposalDir is computed inside the function as
	// stateDir/proposals/<proposalId>/worktree. The proposalId includes
	// Date.now() so we can't predict it; create the proposals root and
	// let spawnFn-mock create the worktree subtree once it fires.
	const proposalsRoot = join(stateDir, "proposals");
	mkdirSync(proposalsRoot, { recursive: true });
	return { stateDir, proposalsRoot };
}

function buildSpawnFn(
	calls: Array<{ cmd: string; args: string[] }>,
	worktreeFileSetup: (worktreePath: string) => void,
) {
	return (cmd: string, args: string[], opts?: { cwd?: string }) => {
		calls.push({ cmd, args });
		// Simulate `git worktree add --detach <worktreePath> <baseSha>` by
		// creating the worktree dir + target file the test expects.
		if (cmd === "git" && args[0] === "worktree" && args[1] === "add") {
			const detachIdx = args.indexOf("--detach");
			const worktreePath = args[detachIdx + 1] ?? "";
			if (worktreePath) {
				mkdirSync(worktreePath, { recursive: true });
				worktreeFileSetup(worktreePath);
			}
		}
		return Buffer.from("");
	};
}

describe("materializePatchProposal — #403 target-variant sweep", () => {
	const before = "function applySeedDiversity(seeds) {\n  return seeds;\n}\n";
	const after = "function applySeedDiversity(seeds) {\n  return seeds.filter((s) => s);\n}\n";
	const proposal: PatchProposal = {
		kind: "patch",
		baseSha: "eca38385766c7184ee95da4c13b29f0a6ea2e2db",
		edits: [
			{
				file: "packages/search/src/trace/trace.ts",
				old: before,
				new: after,
			},
		],
		rationale: "fix applySeedDiversity",
	};

	const tempDirs: string[] = [];
	afterEach(() => {
		for (const d of tempDirs) {
			try {
				rmSync(d, { recursive: true, force: true });
			} catch {
				// best-effort cleanup
			}
		}
		tempDirs.length = 0;
	});

	it("invokes sweep with --variant-filter <targetVariantId> when target differs from production", async () => {
		const calls: Array<{ cmd: string; args: string[] }> = [];
		const { stateDir } = setupTestEnv();
		tempDirs.push(stateDir);
		const spawnFn = buildSpawnFn(calls, (worktreePath) => {
			const target = join(worktreePath, "packages/search/src/trace/trace.ts");
			mkdirSync(join(worktreePath, "packages/search/src/trace"), { recursive: true });
			writeFileSync(target, before);
		});

		const result = await materializePatchProposal({
			productionMatrix: baseMatrix(),
			productionMatrixName: "retrieval-baseline",
			proposal,
			targetVariantId: "noar_div_rrBge",
			spawnFn,
			stateDir,
		});

		const sweepCall = calls.find(
			(c) => c.cmd === "pnpm" && c.args.includes("autoresearch:sweep"),
		);
		expect(sweepCall).toBeDefined();
		const filterIdx = sweepCall!.args.indexOf("--variant-filter");
		expect(filterIdx).toBeGreaterThanOrEqual(0);
		expect(sweepCall!.args[filterIdx + 1]).toBe("noar_div_rrBge");
		expect(
			result.notes.some(
				(n) =>
					n.includes("noar_div_rrBge") &&
					n.includes("#403") &&
					n.includes("differs from productionVariantId"),
			),
		).toBe(true);
	});

	it("bails with skippedReason when both productionVariantId and targetVariantId are unset", async () => {
		const calls: Array<{ cmd: string; args: string[] }> = [];
		const { stateDir } = setupTestEnv();
		tempDirs.push(stateDir);
		const spawnFn = buildSpawnFn(calls, () => {});
		const m = baseMatrix();
		const noProdMatrix = { ...m, productionVariantId: undefined as unknown as string };
		const result = await materializePatchProposal({
			productionMatrix: noProdMatrix,
			productionMatrixName: "retrieval-baseline",
			proposal,
			spawnFn,
			stateDir,
		});
		expect(result.skippedReason).toMatch(/no variant id resolvable/);
		expect(result.aggregateAccept).toBe(false);
		// Sweep must NOT have fired with empty filter (which would run all
		// variants and obscure evidence).
		const sweepCall = calls.find(
			(c) => c.cmd === "pnpm" && c.args.includes("autoresearch:sweep"),
		);
		expect(sweepCall).toBeUndefined();
	});

	it("falls back to productionVariantId when targetVariantId omitted (legacy)", async () => {
		const calls: Array<{ cmd: string; args: string[] }> = [];
		const { stateDir } = setupTestEnv();
		tempDirs.push(stateDir);
		const spawnFn = buildSpawnFn(calls, (worktreePath) => {
			const target = join(worktreePath, "packages/search/src/trace/trace.ts");
			mkdirSync(join(worktreePath, "packages/search/src/trace"), { recursive: true });
			writeFileSync(target, before);
		});

		const result = await materializePatchProposal({
			productionMatrix: baseMatrix(),
			productionMatrixName: "retrieval-baseline",
			proposal,
			spawnFn,
			stateDir,
		});

		const sweepCall = calls.find(
			(c) => c.cmd === "pnpm" && c.args.includes("autoresearch:sweep"),
		);
		expect(sweepCall).toBeDefined();
		const filterIdx = sweepCall!.args.indexOf("--variant-filter");
		expect(sweepCall!.args[filterIdx + 1]).toBe("noar_div_rrOff");
		expect(result.notes.some((n) => n.includes("#403"))).toBe(false);
	});
});
