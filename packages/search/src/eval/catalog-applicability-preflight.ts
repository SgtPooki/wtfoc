import type { DocumentCatalog } from "@wtfoc/common";
import type { GoldQuery } from "./gold-standard-queries.js";

/**
 * Catalog-applicability preflight (#344 step 1).
 *
 * For each (query, corpus) pair in the matrix, classify the query as
 * `applicable | skipped | invalid`:
 *
 * - **`applicable`** — corpus is in `applicableCorpora` AND every
 *   `expectedEvidence` row with `required: true` resolves to an active
 *   document in the corpus catalog.
 * - **`skipped`** — corpus is NOT in `applicableCorpora`. Excluded from
 *   aggregate scoring; not a failure.
 * - **`invalid`** — corpus IS in `applicableCorpora` but ≥1 required
 *   `artifactId` is absent from the catalog. Surfaced as a warning during the
 *   migration window; will hard-fail in a follow-up.
 *
 * Hard-failure conditions (always nonzero exit regardless of warn-only):
 * - Duplicate query IDs in the fixture.
 * - Query references a corpus not present in the matrix's catalog map.
 * - Query has zero `applicableCorpora` (schema violation).
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */

export type PreflightStatus = "applicable" | "skipped" | "invalid";

export interface PreflightCatalogEntry {
	corpusId: string;
	catalog: DocumentCatalog;
}

export interface PreflightQueryResult {
	queryId: string;
	corpusId: string;
	status: PreflightStatus;
	missingRequiredArtifacts: string[];
}

export interface PreflightCorpusStats {
	corpusId: string;
	total: number;
	applicable: number;
	skipped: number;
	invalid: number;
	invalidQueries: Array<{ queryId: string; missing: string[] }>;
	invalidPercent: number;
}

export interface PreflightSummary {
	results: PreflightQueryResult[];
	perCorpus: PreflightCorpusStats[];
	hardErrors: string[];
	invalidThresholdPercent: number;
	exceededInvalidThreshold: string[];
}

export interface RunPreflightOptions {
	queries: ReadonlyArray<GoldQuery>;
	catalogs: ReadonlyArray<PreflightCatalogEntry>;
	/** Above this %, a corpus emits a warn-now / hard-fail-later signal. */
	invalidThresholdPercent?: number;
}

/**
 * Walk every (query, corpus) pair and classify status.
 *
 * Schema violations (duplicates, empty applicableCorpora, unknown corpora)
 * are accumulated in `hardErrors` and should drive a nonzero exit.
 */
export function runPreflight(opts: RunPreflightOptions): PreflightSummary {
	const { queries, catalogs } = opts;
	const invalidThresholdPercent = opts.invalidThresholdPercent ?? 20;
	const hardErrors: string[] = [];

	const seenIds = new Set<string>();
	for (const q of queries) {
		if (seenIds.has(q.id)) hardErrors.push(`duplicate query id: ${q.id}`);
		seenIds.add(q.id);
		if (q.applicableCorpora.length === 0) {
			hardErrors.push(`query ${q.id}: empty applicableCorpora (schema violation)`);
		}
	}

	const catalogById = new Map<string, DocumentCatalog>();
	for (const c of catalogs) catalogById.set(c.corpusId, c.catalog);

	const matrixCorpora = catalogs.map((c) => c.corpusId);
	for (const q of queries) {
		for (const target of q.applicableCorpora) {
			if (!catalogById.has(target)) {
				hardErrors.push(
					`query ${q.id}: applicableCorpora references "${target}" but no catalog provided in matrix (catalogs in matrix: ${matrixCorpora.join(", ")})`,
				);
			}
		}
	}

	const results: PreflightQueryResult[] = [];
	for (const q of queries) {
		const required = q.expectedEvidence.filter((e) => e.required).map((e) => e.artifactId);
		for (const corpusId of matrixCorpora) {
			const inApplicable = q.applicableCorpora.includes(corpusId);
			if (!inApplicable) {
				results.push({
					queryId: q.id,
					corpusId,
					status: "skipped",
					missingRequiredArtifacts: [],
				});
				continue;
			}
			const catalog = catalogById.get(corpusId);
			if (!catalog) {
				// Captured already in hardErrors; emit a placeholder result.
				results.push({
					queryId: q.id,
					corpusId,
					status: "invalid",
					missingRequiredArtifacts: required,
				});
				continue;
			}
			const present = catalog.documents;
			const missing: string[] = [];
			for (const artifactId of required) {
				const entry = present[artifactId];
				if (!entry || entry.state !== "active") {
					missing.push(artifactId);
				}
			}
			results.push({
				queryId: q.id,
				corpusId,
				status: missing.length === 0 ? "applicable" : "invalid",
				missingRequiredArtifacts: missing,
			});
		}
	}

	const perCorpus: PreflightCorpusStats[] = [];
	const exceededInvalidThreshold: string[] = [];
	for (const corpusId of matrixCorpora) {
		const slice = results.filter((r) => r.corpusId === corpusId);
		const applicable = slice.filter((r) => r.status === "applicable").length;
		const skipped = slice.filter((r) => r.status === "skipped").length;
		const invalid = slice.filter((r) => r.status === "invalid").length;
		const total = slice.length;
		const invalidQueries = slice
			.filter((r) => r.status === "invalid")
			.map((r) => ({ queryId: r.queryId, missing: r.missingRequiredArtifacts }));
		const denom = applicable + invalid;
		const invalidPercent = denom === 0 ? 0 : Math.round((invalid / denom) * 100);
		if (invalidPercent > invalidThresholdPercent) {
			exceededInvalidThreshold.push(corpusId);
		}
		perCorpus.push({
			corpusId,
			total,
			applicable,
			skipped,
			invalid,
			invalidQueries,
			invalidPercent,
		});
	}

	return {
		results,
		perCorpus,
		hardErrors,
		invalidThresholdPercent,
		exceededInvalidThreshold,
	};
}

/** Render the preflight summary as a markdown report (for #343 / PR comments). */
export function renderPreflightMarkdown(summary: PreflightSummary): string {
	const lines: string[] = [];
	lines.push("# Catalog-Applicability Preflight");
	lines.push("");
	if (summary.hardErrors.length > 0) {
		lines.push("## Hard errors");
		lines.push("");
		for (const e of summary.hardErrors) lines.push(`- ❌ ${e}`);
		lines.push("");
	}
	lines.push("## Per-corpus stats");
	lines.push("");
	lines.push(
		`Threshold: invalid > **${summary.invalidThresholdPercent}%** of applicable triggers warning (warn-only this PR).`,
	);
	lines.push("");
	lines.push("| Corpus | Total | Applicable | Skipped | Invalid | Invalid% |");
	lines.push("|---|---|---|---|---|---|");
	for (const c of summary.perCorpus) {
		const flag = summary.exceededInvalidThreshold.includes(c.corpusId) ? " ⚠️" : "";
		lines.push(
			`| \`${c.corpusId}\` | ${c.total} | ${c.applicable} | ${c.skipped} | ${c.invalid} | ${c.invalidPercent}%${flag} |`,
		);
	}
	lines.push("");
	for (const c of summary.perCorpus) {
		if (c.invalidQueries.length === 0) continue;
		lines.push(`## \`${c.corpusId}\` — invalid queries (${c.invalidQueries.length})`);
		lines.push("");
		for (const inv of c.invalidQueries) {
			lines.push(`- \`${inv.queryId}\` — missing required:`);
			for (const m of inv.missing.slice(0, 5)) {
				lines.push(`  - \`${m}\``);
			}
			if (inv.missing.length > 5) {
				lines.push(`  - ... ${inv.missing.length - 5} more`);
			}
		}
		lines.push("");
	}
	return lines.join("\n");
}
