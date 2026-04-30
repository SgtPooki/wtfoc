#!/usr/bin/env tsx
/**
 * One-time seeder for the tried-log. Maintainer-only.
 *
 * Encodes the verdicts from the manual Phase 3 sweep
 * (docs/autoresearch/sweeps/2026-04-29-phase-3-retrieval-baseline.md)
 * so the autonomous loop's LLM proposer doesn't waste cycles
 * re-proposing knob values that were already evaluated by hand and
 * landed as production winners or known losers.
 *
 * Idempotent: each historical row carries `seedKey` in its rationale
 * so re-running the seeder won't duplicate. The `alreadyTried` lookup
 * matches on (matrixName, axis, value) — once a seed row exists, the
 * proposer is silenced for that combination within the silence window
 * regardless of seed source.
 *
 * Usage:
 *   pnpm exec tsx --tsconfig scripts/tsconfig.json \\
 *     scripts/autoresearch/seed-tried-log.ts [--dry-run]
 *
 * Output:
 *   - --dry-run: prints rows it would write
 *   - default: appends new rows, skips existing
 */

import { fileURLToPath } from "node:url";
import { appendTriedRow, readTriedLog, type TriedLogRow } from "./tried-log.js";

const SEED_TAG = "seed:phase-3-2026-04-29";

interface SeedRow {
	axis: string;
	value: boolean | number | string;
	verdict: "accepted" | "rejected";
	rationale: string;
}

/**
 * Hand-encoded from
 * docs/autoresearch/sweeps/2026-04-29-phase-3-retrieval-baseline.md.
 *
 * The Phase 3 sweep evaluated autoRoute × diversityEnforce × reranker
 * over both corpora. Production winner: noar_div_rrOff.
 */
const PHASE_3_SEEDS: SeedRow[] = [
	{
		axis: "autoRoute",
		value: true,
		verdict: "rejected",
		rationale: `${SEED_TAG}: ar_nodiv_rrOff broke demo-critical (80%); harmful on every measured config (#314).`,
	},
	{
		axis: "diversityEnforce",
		value: false,
		verdict: "rejected",
		rationale: `${SEED_TAG}: without diversityEnforce every variant fails the overall gate; +11pp portable lift when on (#161).`,
	},
	{
		axis: "reranker",
		value: "llm:haiku",
		verdict: "rejected",
		rationale: `${SEED_TAG}: zero lift on noar_nodiv baseline; regresses on diversityEnforce (#313). LLM rerankers explicitly deprioritized until prompt template changes.`,
	},
];

interface CliArgs {
	dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const args = argv.slice(2);
	let dryRun = false;
	for (const a of args) {
		if (a === "--dry-run") dryRun = true;
		else throw new Error(`unknown flag: ${a}`);
	}
	return { dryRun };
}

function asTriedRow(seed: SeedRow): TriedLogRow {
	return {
		schemaVersion: 1,
		loggedAt: "2026-04-29T00:00:00Z",
		matrixName: "retrieval-baseline",
		variantId: `seed_${seed.axis}_${JSON.stringify(seed.value).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
		proposal: { axis: seed.axis, value: seed.value, rationale: seed.rationale },
		verdict: seed.verdict,
		reasons: [seed.rationale],
	};
}

function main(): void {
	const cli = parseArgs(process.argv);
	const existing = readTriedLog();
	const existingTags = new Set(
		existing
			.filter((r) => r.proposal.rationale.includes(SEED_TAG))
			.map((r) => `${r.proposal.axis}|${JSON.stringify(r.proposal.value)}`),
	);

	let added = 0;
	let skipped = 0;
	for (const seed of PHASE_3_SEEDS) {
		const key = `${seed.axis}|${JSON.stringify(seed.value)}`;
		if (existingTags.has(key)) {
			skipped++;
			console.error(`[seed] SKIP ${key} (already seeded)`);
			continue;
		}
		const row = asTriedRow(seed);
		if (cli.dryRun) {
			console.log(JSON.stringify(row, null, 2));
		} else {
			appendTriedRow(row);
			console.error(`[seed] ADD  ${key} (verdict=${seed.verdict})`);
		}
		added++;
	}
	console.error(`[seed] ${added} added, ${skipped} skipped`);
}

const isMain = (() => {
	try {
		const here = fileURLToPath(import.meta.url);
		return process.argv[1] === here;
	} catch {
		return false;
	}
})();

if (isMain) {
	try {
		main();
	} catch (err) {
		console.error("[seed] fatal:", err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}

export { PHASE_3_SEEDS, asTriedRow };
