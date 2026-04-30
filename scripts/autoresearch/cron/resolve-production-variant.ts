#!/usr/bin/env tsx
/**
 * Print the productionVariantId for a given matrix to stdout.
 * Maintainer-only. Used by run-nightly.sh to constrain the sweep
 * to a single variant.
 *
 * Exit codes:
 *   0 — printed productionVariantId
 *   2 — matrix exists but has no productionVariantId set
 *   1 — matrix not found / load error
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Matrix } from "../matrix.js";

async function main(): Promise<void> {
	const matrixName = process.argv[2];
	if (!matrixName) {
		console.error("usage: resolve-production-variant <matrix-name>");
		process.exit(1);
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const matrixPath = join(here, "..", "matrices", `${matrixName}.ts`);
	const mod = (await import(matrixPath)) as { default: Matrix };
	if (!mod.default) {
		console.error(`matrix ${matrixName} has no default export`);
		process.exit(1);
	}
	const v = mod.default.productionVariantId;
	if (!v) {
		console.error(`matrix ${matrixName} has no productionVariantId`);
		process.exit(2);
	}
	process.stdout.write(v);
	process.stdout.write("\n");
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
