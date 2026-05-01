/**
 * CLI driver for the catalog-applicability preflight (#344 step 1).
 *
 * Loads every corpus catalog the matrix targets and runs the preflight from
 * `@wtfoc/search`. Emits a markdown report (default `/tmp/gold-preflight.md`)
 * and exits nonzero on hard schema errors. Threshold breaches are warn-only
 * during the migration PR per #344 ratification.
 *
 * Usage:
 *   pnpm exec tsx --tsconfig scripts/tsconfig.json \
 *     scripts/autoresearch/preflight-gold-queries.ts
 *
 * Flags:
 *   --output <path>       Override report output (default /tmp/gold-preflight.md).
 *   --hard-fail           Exit nonzero on threshold breaches (off by default).
 *   --json                Emit JSON summary alongside markdown (path.json).
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */

import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { catalogFilePath, readCatalog } from "@wtfoc/ingest";
import {
	GOLD_STANDARD_QUERIES,
	type PreflightCatalogEntry,
	type PreflightSummary,
	renderPreflightMarkdown,
	runPreflight,
} from "@wtfoc/search";

const MANIFEST_DIR = join(homedir(), ".wtfoc/projects");

/**
 * Corpora to preflight against. Mirrors the migrator's known set (#344 will
 * extend this as new collections are added in step 3+). Adding a corpus here
 * also requires its catalog to exist locally at the conventional path.
 */
const KNOWN_CORPORA = [
	"filoz-ecosystem-2026-04-v12",
	"wtfoc-dogfood-2026-04-v3",
] as const;

interface ParsedArgs {
	output: string;
	hardFail: boolean;
	json: boolean;
}

function parseArgs(): ParsedArgs {
	const args = process.argv.slice(2);
	let output = "/tmp/gold-preflight.md";
	let hardFail = false;
	let json = false;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--hard-fail") hardFail = true;
		else if (a === "--json") json = true;
		else if (a === "--output" && i + 1 < args.length) {
			output = args[++i];
		}
	}
	return { output, hardFail, json };
}

async function loadCatalogs(): Promise<PreflightCatalogEntry[]> {
	const out: PreflightCatalogEntry[] = [];
	for (const id of KNOWN_CORPORA) {
		const path = catalogFilePath(MANIFEST_DIR, id);
		const cat = await readCatalog(path);
		if (!cat) {
			throw new Error(
				`Catalog not found or unreadable for corpus "${id}" at ${path}.`,
			);
		}
		out.push({ corpusId: id, catalog: cat });
	}
	return out;
}

function logSummary(summary: PreflightSummary): void {
	console.log(`[preflight] ${summary.results.length} (query, corpus) pairs evaluated`);
	for (const c of summary.perCorpus) {
		console.log(
			`[preflight] ${c.corpusId}: applicable=${c.applicable} skipped=${c.skipped} invalid=${c.invalid} (${c.invalidPercent}%)`,
		);
	}
	if (summary.hardErrors.length > 0) {
		console.error(`[preflight] HARD ERRORS (${summary.hardErrors.length}):`);
		for (const e of summary.hardErrors) console.error(`  - ${e}`);
	}
	if (summary.exceededInvalidThreshold.length > 0) {
		console.warn(
			`[preflight] WARN: invalid% threshold exceeded for: ${summary.exceededInvalidThreshold.join(", ")}`,
		);
	}
}

async function main(): Promise<void> {
	const { output, hardFail, json } = parseArgs();
	const catalogs = await loadCatalogs();
	console.log(
		`[preflight] Loaded ${catalogs.length} catalogs: ${catalogs.map((c) => `${c.corpusId}(${Object.keys(c.catalog.documents).length} docs)`).join(", ")}`,
	);
	console.log(`[preflight] Evaluating ${GOLD_STANDARD_QUERIES.length} gold queries`);

	const summary = runPreflight({
		queries: GOLD_STANDARD_QUERIES,
		catalogs,
	});

	const md = renderPreflightMarkdown(summary);
	await writeFile(output, md, "utf-8");
	console.log(`[preflight] Wrote markdown report: ${output}`);

	if (json) {
		const jsonPath = output.replace(/\.md$/, ".json");
		await writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf-8");
		console.log(`[preflight] Wrote JSON summary: ${jsonPath}`);
	}

	logSummary(summary);

	if (summary.hardErrors.length > 0) {
		console.error("[preflight] FAIL: schema hard errors present");
		process.exit(2);
	}
	if (hardFail && summary.exceededInvalidThreshold.length > 0) {
		console.error("[preflight] FAIL: invalid% threshold exceeded (--hard-fail)");
		process.exit(3);
	}
	console.log("[preflight] OK (warn-only mode for threshold breaches)");
}

main().catch((err) => {
	console.error("[preflight] FATAL:", err);
	process.exit(1);
});
