/**
 * Recipe-apply CLI for #344 step-2 review tooling.
 *
 * Reads an enriched candidates JSON produced by `recipe-validate`, selects
 * the entries the human approved, validates them structurally, and codegens
 * the new gold queries between the BEGIN/END markers in
 * `packages/search/src/eval/gold-authored-queries.ts`.
 *
 * Three peer-review constraints land here:
 *
 *   1. **Hard gate is structural ONLY.** `keeper-candidate` lands by
 *      default. `human-review` / `needs-fix` / `trivial-suspect` /
 *      `auto-reject` require explicit opt-in flags or a per-entry
 *      `humanOverride: true` field — never silent. Probe-failure auto-
 *      rejection at the apply step would block valuable trace-stress
 *      queries (peer-review consensus from #359).
 *
 *   2. **Per-entry override beats CLI flag.** A reviewer who edits the
 *      enriched JSON to add a top-level `humanOverride: true` field on a
 *      specific record (sibling to `label` / `reasons` / `probe`) signals
 *      they have read the probe metadata and accept it. The flag-based
 *      escape hatches are coarser tools.
 *
 *   3. **Structural invariants are non-negotiable.** Duplicate ids,
 *      missing required fields, empty `applicableCorpora`, etc. — all
 *      hard-fail with a non-zero exit even when `--force` is set.
 *
 * Usage:
 *   pnpm exec tsx --tsconfig scripts/tsconfig.json \
 *     scripts/autoresearch/recipe-apply.ts \
 *     --candidates /tmp/wtfoc-self-candidates.validated.json
 *     [--include-human-review]
 *     [--include-needs-fix]
 *     [--force]                # also include trivial-suspect + auto-reject
 *     [--dry-run]              # validate + log; do not write
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
	type CandidateQuery,
	GOLD_STANDARD_QUERIES,
	type GoldQuery,
} from "@wtfoc/search";
import type { ValidationLabel, ValidationRecord } from "./recipe-validate.js";

const VALID_QUERY_TYPES = new Set([
	"lookup",
	"trace",
	"compare",
	"temporal",
	"causal",
	"howto",
	"entity-resolution",
]);
const VALID_DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const VALID_LAYER_HINTS = new Set([
	"chunking",
	"embedding",
	"edge-extraction",
	"ranking",
	"trace",
]);

export interface ApplyEnrichedRecord extends ValidationRecord {
	/** Per-entry override added by the human during review. Bypasses label gating. */
	humanOverride?: boolean;
}

export interface EnrichedFile {
	collection: string;
	validation: {
		labelCounts: Record<ValidationLabel, number>;
		records: ApplyEnrichedRecord[];
	};
}

export interface SelectionPolicy {
	includeHumanReview: boolean;
	includeNeedsFix: boolean;
	force: boolean;
}

export interface SelectionResult {
	keep: ApplyEnrichedRecord[];
	skip: Array<{ record: ApplyEnrichedRecord; reason: string }>;
}

/**
 * Decide which records land based on label + per-entry override + CLI
 * policy. Pure: no I/O, no side effects. Tests pin the table here so a
 * future loosening of the policy is reviewable.
 */
export function selectKeepers(
	records: ReadonlyArray<ApplyEnrichedRecord>,
	policy: SelectionPolicy,
): SelectionResult {
	const keep: ApplyEnrichedRecord[] = [];
	const skip: Array<{ record: ApplyEnrichedRecord; reason: string }> = [];
	for (const r of records) {
		if (r.humanOverride === true) {
			keep.push(r);
			continue;
		}
		switch (r.label) {
			case "keeper-candidate":
				keep.push(r);
				break;
			case "human-review":
				if (policy.includeHumanReview) keep.push(r);
				else skip.push({ record: r, reason: "label=human-review (use --include-human-review)" });
				break;
			case "needs-fix":
				if (policy.includeNeedsFix || policy.force) keep.push(r);
				else skip.push({ record: r, reason: "label=needs-fix (use --include-needs-fix)" });
				break;
			case "trivial-suspect":
				if (policy.force) keep.push(r);
				else skip.push({ record: r, reason: "label=trivial-suspect (use --force)" });
				break;
			case "auto-reject":
				if (policy.force) keep.push(r);
				else skip.push({ record: r, reason: "label=auto-reject (use --force)" });
				break;
		}
	}
	return { keep, skip };
}

export interface StructuralError {
	queryId: string;
	error: string;
}

/**
 * Validate the GoldQuery shape on each candidate's `draft`. Hard-fails
 * the apply when any error is present. Detects: missing/empty required
 * fields; invalid enum values; duplicate ids vs existing
 * `GOLD_STANDARD_QUERIES`; duplicate ids within the apply set itself;
 * empty `applicableCorpora`; empty `expectedEvidence`.
 */
export function validateStructural(
	records: ReadonlyArray<ApplyEnrichedRecord>,
	existingIds: ReadonlySet<string>,
): StructuralError[] {
	const errors: StructuralError[] = [];
	const seen = new Set<string>();
	for (const r of records) {
		const d = r.candidate.draft;
		const id = d.id ?? "";
		if (!id) errors.push({ queryId: "(no id)", error: "missing id" });
		if (id && existingIds.has(id)) {
			errors.push({ queryId: id, error: `id collides with existing GOLD_STANDARD_QUERIES entry` });
		}
		if (id && seen.has(id)) {
			errors.push({ queryId: id, error: "duplicate id within apply set" });
		}
		seen.add(id);
		if (!d.query || d.query.trim().length === 0) {
			errors.push({ queryId: id, error: "empty query" });
		}
		if (!d.applicableCorpora || d.applicableCorpora.length === 0) {
			errors.push({ queryId: id, error: "empty applicableCorpora" });
		}
		if (!VALID_QUERY_TYPES.has(d.queryType)) {
			errors.push({ queryId: id, error: `invalid queryType: ${d.queryType}` });
		}
		if (!VALID_DIFFICULTIES.has(d.difficulty)) {
			errors.push({ queryId: id, error: `invalid difficulty: ${d.difficulty}` });
		}
		for (const h of d.targetLayerHints ?? []) {
			if (!VALID_LAYER_HINTS.has(h)) {
				errors.push({ queryId: id, error: `invalid targetLayerHint: ${h}` });
			}
		}
		if (!d.expectedEvidence || d.expectedEvidence.length === 0) {
			errors.push({ queryId: id, error: "empty expectedEvidence" });
		}
		if (!d.requiredSourceTypes) {
			errors.push({ queryId: id, error: "missing requiredSourceTypes" });
		}
		if (typeof d.minResults !== "number" || d.minResults < 1) {
			errors.push({ queryId: id, error: `invalid minResults: ${d.minResults}` });
		}
		if (!d.authoredFromCollectionId || d.authoredFromCollectionId.trim().length === 0) {
			errors.push({ queryId: id, error: "missing authoredFromCollectionId" });
		}
		if (!Array.isArray(d.targetLayerHints) || d.targetLayerHints.length === 0) {
			errors.push({ queryId: id, error: "empty targetLayerHints" });
		}
	}
	return errors;
}

/**
 * Codegen a TS array literal for the kept GoldQuery drafts. Uses
 * JSON.stringify with tab indent (matches the legacy migrator's output
 * convention so diffs are visually consistent). `validateStructural`
 * has already gated id presence and shape, so the cast is safe here.
 */
export function codegenAuthoredQueries(records: ReadonlyArray<ApplyEnrichedRecord>): string {
	const drafts: GoldQuery[] = records.map((r) => r.candidate.draft as GoldQuery);
	return JSON.stringify(drafts, null, "\t");
}

const BEGIN = "// === BEGIN AUTHORED-QUERIES MANAGED ARRAY ===";
const END = "// === END AUTHORED-QUERIES MANAGED ARRAY ===";

/**
 * Splice the codegen result between the markers in
 * `packages/search/src/eval/gold-authored-queries.ts`. Throws when the
 * markers are missing — explicit failure beats silent corruption.
 */
export function spliceAuthoredQueries(currentFile: string, codegen: string): string {
	const startIdx = currentFile.indexOf(BEGIN);
	const endIdx = currentFile.indexOf(END);
	if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
		throw new Error(
			"BEGIN/END AUTHORED-QUERIES markers missing or out of order in gold-authored-queries.ts",
		);
	}
	const before = currentFile.slice(0, startIdx + BEGIN.length);
	const after = currentFile.slice(endIdx);
	const block = [
		"",
		"// This block is regenerated by `scripts/autoresearch/recipe-apply.ts`.",
		"// Do not hand-edit individual entries; rerun the apply CLI on a refreshed",
		"// candidates JSON instead.",
		`export const AUTHORED_QUERIES: GoldQuery[] = ${codegen};`,
		"",
	].join("\n");
	return `${before}\n${block}${after}`;
}

interface CliArgs {
	candidates: string;
	includeHumanReview: boolean;
	includeNeedsFix: boolean;
	force: boolean;
	dryRun: boolean;
}

function parseCliArgs(argv: ReadonlyArray<string>): CliArgs {
	const out: Partial<CliArgs> = {
		includeHumanReview: false,
		includeNeedsFix: false,
		force: false,
		dryRun: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = argv[i + 1];
		if (a === "--candidates" && next) {
			out.candidates = next;
			i++;
		} else if (a === "--include-human-review") {
			out.includeHumanReview = true;
		} else if (a === "--include-needs-fix") {
			out.includeNeedsFix = true;
		} else if (a === "--force") {
			out.force = true;
		} else if (a === "--dry-run") {
			out.dryRun = true;
		} else if (a !== undefined) {
			throw new Error(`unknown flag: "${a}"`);
		}
	}
	if (!out.candidates) throw new Error("usage: recipe-apply --candidates <path> ...");
	return out as CliArgs;
}

async function main(): Promise<void> {
	const args = parseCliArgs(process.argv.slice(2));
	const here = dirname(fileURLToPath(import.meta.url));
	const target = resolve(here, "../../packages/search/src/eval/gold-authored-queries.ts");

	const enriched = JSON.parse(await readFile(args.candidates, "utf-8")) as EnrichedFile;
	const policy: SelectionPolicy = {
		includeHumanReview: args.includeHumanReview,
		includeNeedsFix: args.includeNeedsFix,
		force: args.force,
	};
	const { keep, skip } = selectKeepers(enriched.validation.records, policy);
	console.log(
		`[recipe-apply] keep=${keep.length} skip=${skip.length} (policy: human-review=${policy.includeHumanReview} needs-fix=${policy.includeNeedsFix} force=${policy.force})`,
	);
	for (const s of skip.slice(0, 10)) {
		console.log(`  - skip ${s.record.candidate.draft.id ?? "?"}: ${s.reason}`);
	}

	const existingIds = new Set(GOLD_STANDARD_QUERIES.map((q) => q.id));
	const errors = validateStructural(keep, existingIds);
	if (errors.length > 0) {
		console.error(`[recipe-apply] ${errors.length} structural error(s) — refusing to apply:`);
		for (const e of errors.slice(0, 20)) {
			console.error(`  - ${e.queryId}: ${e.error}`);
		}
		process.exit(2);
	}

	const codegen = codegenAuthoredQueries(keep);
	const current = await readFile(target, "utf-8");
	const next = spliceAuthoredQueries(current, codegen);

	if (args.dryRun) {
		console.log(`[recipe-apply] --dry-run; would write ${keep.length} queries to ${target}`);
		return;
	}
	await writeFile(target, next, "utf-8");
	console.log(`[recipe-apply] wrote ${keep.length} queries to ${target}`);
}

const entryPath = process.argv[1] ?? "";
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
	main().catch((err) => {
		console.error("[recipe-apply] FATAL:", err);
		process.exit(1);
	});
}
