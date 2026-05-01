/**
 * One-shot migrator for #344 step 1: Legacy gold-standard-queries -> GoldQuery.
 *
 * Reads `gold-standard-queries.legacy.ts`, resolves each legacy substring
 * against the per-corpus document catalogs in `~/.wtfoc/projects/`, and
 * regenerates the `GOLD_STANDARD_QUERIES` array literal between the
 * migrator-managed markers in `gold-standard-queries.ts`. Emits a markdown
 * report at `/tmp/gold-migration-report.md` listing every lossy mapping,
 * unresolved substring, ambiguous catalog hit, and per-corpus skip count.
 *
 * Catalog access: uses `readCatalog()` from `@wtfoc/ingest` against the local
 * manifest dir (`~/.wtfoc/projects/`). Migrator runs on the maintainer's
 * machine — not in CI. Output (the regenerated TS file) is committed.
 *
 * Usage:
 *   pnpm exec tsx --tsconfig scripts/tsconfig.json \
 *     scripts/autoresearch/migrate-gold-queries.ts
 *
 * Flags:
 *   --dry-run         Write report only; do not modify TS file.
 *   --report-only     Same as --dry-run.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogFilePath, readCatalog } from "@wtfoc/ingest";
import {
	type Difficulty,
	type ExpectedEvidence,
	type GoldQuery,
	type LayerHint,
	LEGACY_GOLD_STANDARD_QUERIES,
	type LegacyGoldStandardQuery,
	type QueryType,
} from "@wtfoc/search";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TARGET_FILE = join(
	REPO_ROOT,
	"packages/search/src/eval/gold-standard-queries.ts",
);
const REPORT_PATH = "/tmp/gold-migration-report.md";

/** Manifest directory the wtfoc project reads catalogs from locally. */
const MANIFEST_DIR = join(homedir(), ".wtfoc/projects");

/**
 * Corpus IDs the migrator resolves substrings against. Adding a corpus here
 * extends the applicability bootstrap. Matching pattern is the legacy
 * `collectionScopePattern` regex if present; otherwise both corpora are
 * candidates and final applicability is filtered by which corpus actually
 * contains a matching catalog entry.
 */
const KNOWN_CORPORA = [
	"filoz-ecosystem-2026-04-v12",
	"wtfoc-dogfood-2026-04-v3",
] as const;

type CorpusId = (typeof KNOWN_CORPORA)[number];

/** category -> queryType. Mechanical map per #344 ratification. */
const CATEGORY_TO_QUERY_TYPE: Record<LegacyGoldStandardQuery["category"], QueryType> = {
	"direct-lookup": "lookup",
	"cross-source": "trace",
	coverage: "lookup",
	synthesis: "howto",
	"file-level": "lookup",
	"work-lineage": "trace",
	"hard-negative": "lookup",
};

/** category -> default targetLayerHints. */
const CATEGORY_TO_LAYER_HINTS: Record<LegacyGoldStandardQuery["category"], LayerHint[]> = {
	"direct-lookup": ["ranking"],
	"cross-source": ["edge-extraction", "trace"],
	coverage: ["ranking", "chunking"],
	synthesis: ["ranking"],
	"file-level": ["chunking"],
	"work-lineage": ["edge-extraction", "trace"],
	"hard-negative": ["ranking"],
};

interface CorpusCatalog {
	id: CorpusId;
	documentIds: string[];
	documentIdLower: string[];
}

/**
 * If a legacy substring matches more than this many catalog documentIds, the
 * migrator treats it as too-ambiguous to expand. The substring is kept
 * verbatim as the artifactId and flagged in migrationNotes so the preflight
 * surfaces it as missing — these queries need rewriting in step 3 anyway.
 *
 * Picked from data: substrings like "/src/" match 484 docs in filoz; substrings
 * like "ingest" match 76. Keeping per-substring evidence under ~20 keeps the
 * generated file readable and prevents one bad query from drowning the grader.
 */
const MAX_MATCHES_PER_SUBSTRING = 20;

interface SubstringResolution {
	substring: string;
	exactMatches: Array<{ corpusId: CorpusId; documentId: string }>;
	ambiguous: boolean;
	unresolved: boolean;
	tooAmbiguous: boolean;
	totalHitsBeforeCap: number;
}

interface PerQueryReport {
	id: string;
	notes: string[];
	resolutions: SubstringResolution[];
}

interface PerCorpusStats {
	id: CorpusId;
	totalQueries: number;
	resolvedSubstrings: number;
	unresolvedSubstrings: number;
	ambiguousSubstrings: number;
}

async function loadCatalogs(): Promise<CorpusCatalog[]> {
	const catalogs: CorpusCatalog[] = [];
	for (const id of KNOWN_CORPORA) {
		const path = catalogFilePath(MANIFEST_DIR, id);
		const cat = await readCatalog(path);
		if (!cat) {
			throw new Error(
				`Catalog not found or unreadable for corpus "${id}" at ${path}. ` +
					`Run wtfoc ingest for this collection before running the migrator.`,
			);
		}
		const documentIds = Object.keys(cat.documents).filter(
			(d) => cat.documents[d]?.state === "active",
		);
		const documentIdLower = documentIds.map((d) => d.toLowerCase());
		catalogs.push({ id, documentIds, documentIdLower });
	}
	return catalogs;
}

/**
 * Resolve a legacy substring against the supplied catalogs.
 *
 * Match rule: case-insensitive `documentId.includes(substring)` (mirrors the
 * legacy grader at quality-queries-evaluator.ts:691-695, which matched
 * `Chunk.source` substrings — `documentId` is the closest stable proxy).
 *
 * Returns one record per (substring, corpus, documentId) match. Ambiguity
 * (multiple matches in a single corpus) is flagged but all are emitted so the
 * grader can OR over them — same as legacy semantics.
 */
function resolveSubstring(
	substring: string,
	candidateCorpora: CorpusCatalog[],
): SubstringResolution {
	const subLower = substring.toLowerCase();
	const exactMatches: Array<{ corpusId: CorpusId; documentId: string }> = [];
	let ambiguous = false;
	let totalHitsBeforeCap = 0;
	for (const cat of candidateCorpora) {
		const hits: string[] = [];
		for (let i = 0; i < cat.documentIdLower.length; i++) {
			if (cat.documentIdLower[i].includes(subLower)) {
				hits.push(cat.documentIds[i]);
			}
		}
		totalHitsBeforeCap += hits.length;
		if (hits.length > 1) ambiguous = true;
		for (const documentId of hits) {
			exactMatches.push({ corpusId: cat.id, documentId });
		}
	}
	const tooAmbiguous = totalHitsBeforeCap > MAX_MATCHES_PER_SUBSTRING;
	return {
		substring,
		// If too ambiguous, drop expansion — keep substring verbatim downstream.
		exactMatches: tooAmbiguous ? [] : exactMatches,
		ambiguous,
		unresolved: exactMatches.length === 0,
		tooAmbiguous,
		totalHitsBeforeCap,
	};
}

function pickCandidateCorpora(
	legacy: LegacyGoldStandardQuery,
	allCatalogs: CorpusCatalog[],
): CorpusCatalog[] {
	if (!legacy.collectionScopePattern) return allCatalogs;
	let re: RegExp;
	try {
		re = new RegExp(legacy.collectionScopePattern);
	} catch {
		return allCatalogs;
	}
	const filtered = allCatalogs.filter((c) => re.test(c.id));
	return filtered.length > 0 ? filtered : allCatalogs;
}

function pickDifficulty(legacy: LegacyGoldStandardQuery): Difficulty {
	if (legacy.tier === "demo-critical") return "hard";
	if (legacy.category === "synthesis" || legacy.category === "work-lineage") return "hard";
	if (legacy.category === "cross-source") return "medium";
	return "medium";
}

function migrateOne(
	legacy: LegacyGoldStandardQuery,
	allCatalogs: CorpusCatalog[],
	stats: Map<CorpusId, PerCorpusStats>,
): { query: GoldQuery; report: PerQueryReport } {
	const notes: string[] = [];
	const candidates = pickCandidateCorpora(legacy, allCatalogs);

	const requiredSubs = legacy.expectedSourceSubstrings ?? [];
	const supportingOnlySubs = (legacy.goldSupportingSources ?? []).filter(
		(s) => !requiredSubs.includes(s),
	);

	const requiredResolutions = requiredSubs.map((s) => resolveSubstring(s, candidates));
	const supportingResolutions = supportingOnlySubs.map((s) => resolveSubstring(s, candidates));
	const allResolutions = [...requiredResolutions, ...supportingResolutions];

	// Aggregate which corpora actually have at least one resolved match.
	const corporaWithMatch = new Set<CorpusId>();
	for (const res of allResolutions) {
		for (const m of res.exactMatches) corporaWithMatch.add(m.corpusId);
	}

	let applicableCorpora: CorpusId[];
	if (corporaWithMatch.size === 0) {
		// Nothing resolved. Fall back to candidates (regex-restricted set).
		applicableCorpora = candidates.map((c) => c.id);
		notes.push(
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
		);
	} else {
		applicableCorpora = candidates
			.map((c) => c.id)
			.filter((id) => corporaWithMatch.has(id));
	}

	// portability sanity check — flag if claimed portable but only 1 corpus.
	if (legacy.portability === "portable" && applicableCorpora.length === 1) {
		notes.push(
			`portability-mismatch: portability="portable" but applicableCorpora=[${applicableCorpora.join(",")}] (single corpus)`,
		);
	}

	// Build expectedEvidence — dedupe by (artifactId).
	const evidenceMap = new Map<string, ExpectedEvidence>();
	for (const res of requiredResolutions) {
		if (res.tooAmbiguous) {
			notes.push(
				`too-ambiguous-required: "${res.substring}" -> ${res.totalHitsBeforeCap} matches (cap ${MAX_MATCHES_PER_SUBSTRING}); kept verbatim, will fail preflight`,
			);
			evidenceMap.set(res.substring, {
				artifactId: res.substring,
				required: true,
			});
			continue;
		}
		if (res.unresolved) {
			notes.push(`unresolved-required: "${res.substring}"`);
			// Preserve substring as artifactId so it shows up loud in preflight as missing.
			evidenceMap.set(res.substring, {
				artifactId: res.substring,
				required: true,
			});
			continue;
		}
		if (res.ambiguous) {
			notes.push(
				`ambiguous-required: "${res.substring}" -> ${res.exactMatches.length} matches`,
			);
		}
		for (const m of res.exactMatches) {
			const prior = evidenceMap.get(m.documentId);
			evidenceMap.set(m.documentId, {
				artifactId: m.documentId,
				required: true,
				...(prior?.locator ? { locator: prior.locator } : {}),
			});
		}
	}
	for (const res of supportingResolutions) {
		if (res.tooAmbiguous) {
			notes.push(
				`too-ambiguous-supporting: "${res.substring}" -> ${res.totalHitsBeforeCap} matches`,
			);
			if (!evidenceMap.has(res.substring)) {
				evidenceMap.set(res.substring, {
					artifactId: res.substring,
					required: false,
				});
			}
			continue;
		}
		if (res.unresolved) {
			notes.push(`unresolved-supporting: "${res.substring}"`);
			if (!evidenceMap.has(res.substring)) {
				evidenceMap.set(res.substring, {
					artifactId: res.substring,
					required: false,
				});
			}
			continue;
		}
		for (const m of res.exactMatches) {
			if (!evidenceMap.has(m.documentId)) {
				evidenceMap.set(m.documentId, {
					artifactId: m.documentId,
					required: false,
				});
			}
		}
	}

	if (legacy.collectionScopeReason) {
		notes.unshift(`scope-reason: ${legacy.collectionScopeReason}`);
	}

	for (const corpusId of applicableCorpora) {
		const s = stats.get(corpusId);
		if (!s) continue;
		s.totalQueries++;
		for (const res of allResolutions) {
			if (res.unresolved) s.unresolvedSubstrings++;
			else s.resolvedSubstrings++;
			if (res.ambiguous) s.ambiguousSubstrings++;
		}
	}

	const expectedEvidence = Array.from(evidenceMap.values()).sort((a, b) =>
		a.artifactId.localeCompare(b.artifactId),
	);

	const query: GoldQuery = {
		id: legacy.id,
		authoredFromCollectionId: applicableCorpora[0] ?? KNOWN_CORPORA[0],
		applicableCorpora: [...applicableCorpora].sort(),
		query: legacy.queryText,
		queryType: CATEGORY_TO_QUERY_TYPE[legacy.category],
		difficulty: pickDifficulty(legacy),
		targetLayerHints: CATEGORY_TO_LAYER_HINTS[legacy.category],
		expectedEvidence,
		acceptableAnswerFacts: [],
		requiredSourceTypes: [...legacy.requiredSourceTypes],
		minResults: legacy.minResults,
		...(legacy.requireEdgeHop !== undefined ? { requireEdgeHop: legacy.requireEdgeHop } : {}),
		...(legacy.requireCrossSourceHops !== undefined
			? { requireCrossSourceHops: legacy.requireCrossSourceHops }
			: {}),
		...(legacy.tier !== undefined ? { tier: legacy.tier } : {}),
		...(legacy.portability !== undefined ? { portability: legacy.portability } : {}),
		...(legacy.category === "hard-negative" ? { isHardNegative: true } : {}),
		...(legacy.paraphrases && legacy.paraphrases.length > 0
			? { paraphrases: [...legacy.paraphrases] }
			: {}),
		...(notes.length > 0 ? { migrationNotes: notes.join("; ") } : {}),
	};

	return {
		query,
		report: { id: legacy.id, notes, resolutions: allResolutions },
	};
}

/**
 * Codegen a stable, deterministic TS array-literal representation of a single
 * GoldQuery. JSON.stringify yields valid TS for our shape (no functions, no
 * undefined, no symbols), so we use it as the workhorse and indent so diffs
 * read sensibly.
 */
function codegenQueries(queries: GoldQuery[]): string {
	const json = JSON.stringify(queries, null, 2);
	// Indent each line by one tab to match TS file convention.
	return json
		.split("\n")
		.map((line) => `\t${line}`)
		.join("\n");
}

async function regenerateTargetFile(queries: GoldQuery[]): Promise<void> {
	const current = await readFile(TARGET_FILE, "utf-8");
	const startMarker = "// === BEGIN MIGRATOR-MANAGED ARRAY ===";
	const endMarker = "// === END MIGRATOR-MANAGED ARRAY ===";
	const startIdx = current.indexOf(startMarker);
	const endIdx = current.indexOf(endMarker);
	if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
		throw new Error(
			`Migrator markers missing or out of order in ${TARGET_FILE}. ` +
				`Restore the markers and rerun.`,
		);
	}
	const before = current.slice(0, startIdx + startMarker.length);
	const after = current.slice(endIdx);
	const block = [
		"",
		"// This block is regenerated by `scripts/autoresearch/migrate-gold-queries.ts`.",
		"// Do not hand-edit; rerun the migrator instead. The migrator preserves",
		"// everything outside these markers.",
		`export const GOLD_STANDARD_QUERIES: GoldQuery[] = ${codegenQueries(queries)};`,
		"",
	].join("\n");
	const next = `${before}\n${block}${after}`;
	await writeFile(TARGET_FILE, next, "utf-8");
}

function buildReport(
	perQuery: PerQueryReport[],
	stats: Map<CorpusId, PerCorpusStats>,
): string {
	const lines: string[] = [];
	lines.push("# Gold-Query Migration Report");
	lines.push("");
	lines.push(`Source: \`packages/search/src/eval/gold-standard-queries.legacy.ts\``);
	lines.push(`Target: \`packages/search/src/eval/gold-standard-queries.ts\``);
	lines.push(`Total queries: ${perQuery.length}`);
	lines.push("");
	lines.push("## Per-corpus stats");
	lines.push("");
	lines.push("| Corpus | Queries applicable | Substrings resolved | Unresolved | Ambiguous |");
	lines.push("|---|---|---|---|---|");
	for (const s of stats.values()) {
		lines.push(
			`| \`${s.id}\` | ${s.totalQueries} | ${s.resolvedSubstrings} | ${s.unresolvedSubstrings} | ${s.ambiguousSubstrings} |`,
		);
	}
	lines.push("");
	const flagged = perQuery.filter((p) => p.notes.length > 0);
	lines.push(`## Flagged queries (${flagged.length}/${perQuery.length})`);
	lines.push("");
	if (flagged.length === 0) {
		lines.push("_None — all substrings resolved cleanly._");
	} else {
		for (const p of flagged) {
			lines.push(`### \`${p.id}\``);
			for (const note of p.notes) lines.push(`- ${note}`);
			lines.push("");
		}
	}
	lines.push("## All resolutions");
	lines.push("");
	for (const p of perQuery) {
		if (p.resolutions.length === 0) continue;
		lines.push(`### \`${p.id}\``);
		for (const r of p.resolutions) {
			const status = r.unresolved
				? "❌ unresolved"
				: r.ambiguous
					? `⚠️  ambiguous (${r.exactMatches.length} matches)`
					: `✅ ${r.exactMatches.length} match(es)`;
			lines.push(`- \`${r.substring}\` → ${status}`);
			for (const m of r.exactMatches.slice(0, 5)) {
				lines.push(`  - \`${m.corpusId}\` :: \`${m.documentId}\``);
			}
			if (r.exactMatches.length > 5) {
				lines.push(`  - ... ${r.exactMatches.length - 5} more`);
			}
		}
		lines.push("");
	}
	return lines.join("\n");
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--report-only");

	const catalogs = await loadCatalogs();
	console.log(
		`[migrator] Loaded ${catalogs.length} catalogs: ${catalogs.map((c) => `${c.id}(${c.documentIds.length} docs)`).join(", ")}`,
	);

	const stats = new Map<CorpusId, PerCorpusStats>();
	for (const c of catalogs) {
		stats.set(c.id, {
			id: c.id,
			totalQueries: 0,
			resolvedSubstrings: 0,
			unresolvedSubstrings: 0,
			ambiguousSubstrings: 0,
		});
	}

	const migrated: GoldQuery[] = [];
	const reports: PerQueryReport[] = [];
	for (const legacy of LEGACY_GOLD_STANDARD_QUERIES) {
		const { query, report } = migrateOne(legacy, catalogs, stats);
		migrated.push(query);
		reports.push(report);
	}

	const reportMd = buildReport(reports, stats);
	await writeFile(REPORT_PATH, reportMd, "utf-8");
	console.log(`[migrator] Wrote report: ${REPORT_PATH} (${reports.length} queries)`);

	if (dryRun) {
		console.log("[migrator] --dry-run — TS file not modified.");
		return;
	}

	await regenerateTargetFile(migrated);
	console.log(`[migrator] Regenerated ${TARGET_FILE} (${migrated.length} queries).`);
}

main().catch((err) => {
	console.error("[migrator] FATAL:", err);
	process.exit(1);
});
