#!/usr/bin/env tsx
/**
 * CLI wrapper around `ensureMode` for shell callers (run-nightly.sh).
 *
 * Usage:
 *   tsx scripts/lib/mode-switch-cli.ts <chat|rerank-gpu|embed-gpu>
 *   tsx scripts/lib/mode-switch-cli.ts --from-matrix <matrix-name>
 *
 * `--from-matrix` resolves the GPU phase via `resolveModeFromMatrix`
 * and exits 0 with no-op when the matrix is cloud-only / always-on.
 *
 * Exit codes:
 *   0 — switch completed (or no-op when gated/unset/cloud-only)
 *   1 — switch failed (shell wrapper logs and continues per its own
 *       error policy; autoresearch wrapper treats as DEGRADED)
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureMode, type GpuMode, resolveModeFromMatrix } from "./mode-switch.js";

const VALID: ReadonlySet<GpuMode> = new Set(["chat", "rerank-gpu", "embed-gpu"]);

function isMode(s: string): s is GpuMode {
	return (VALID as ReadonlySet<string>).has(s);
}

async function main(): Promise<number> {
	const args = process.argv.slice(2);
	if (args.length === 0) {
		console.error("usage: mode-switch-cli <mode> | --from-matrix <name>");
		return 2;
	}
	let target: GpuMode | null = null;
	if (args[0] === "--from-matrix") {
		const matrixName = args[1];
		if (!matrixName) {
			console.error("--from-matrix requires a matrix name");
			return 2;
		}
		const here = dirname(fileURLToPath(import.meta.url));
		const matrixPath = join(here, "..", "autoresearch", "matrices", `${matrixName}.ts`);
		const mod = (await import(matrixPath)) as {
			default: Parameters<typeof resolveModeFromMatrix>[0];
		};
		target = resolveModeFromMatrix(mod.default);
		if (target === null) {
			console.error(`[mode-switch] matrix=${matrixName} needs no GPU swap`);
			return 0;
		}
	} else {
		const a = args[0] ?? "";
		if (!isMode(a)) {
			console.error(`invalid mode: ${a}`);
			return 2;
		}
		target = a;
	}
	const reason = process.env.WTFOC_MODE_SWITCH_REASON ?? "wtfoc-cron";
	const r = await ensureMode(target, { reason });
	if (r.skipped) {
		console.error(`[mode-switch] skipped: ${r.skippedReason}`);
		return 0;
	}
	console.error(`[mode-switch] ok: ${r.from ?? "?"}→${r.to ?? target} phase=${r.finalPhase}`);
	return 0;
}

main()
	.then((code) => process.exit(code))
	.catch((err) => {
		console.error(`[mode-switch] FAILED: ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	});
