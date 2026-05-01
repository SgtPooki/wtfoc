/**
 * Recipe-author CLI driver for #344 step 2 (gold-query regeneration).
 *
 * Pipeline:
 *
 *   load corpus catalog + segments
 *     -> derive CatalogArtifact[]
 *     -> sampleStratified (deterministic with --seed)
 *     -> for each (sample, template) pair: ask LLM to draft a CandidateQuery
 *     -> applyAdversarialFilter (discard easy queries vector search solves)
 *     -> emit JSON for human approve/edit/reject
 *
 * The actual LLM call is **stubbed** in this PR (step 2b ships the driver
 * shell). Live authoring lands in step 2c+ per-collection runs once the
 * prompt + LLM helper integration is reviewed end-to-end.
 *
 * Usage:
 *   pnpm exec tsx --tsconfig scripts/tsconfig.json \
 *     scripts/autoresearch/recipe-author.ts \
 *     --collection wtfoc-dogfood-2026-04-v3 \
 *     --output /tmp/candidates.json \
 *     [--samples-per-stratum 2] \
 *     [--seed 42] \
 *     [--max-candidates 80] \
 *     [--dry-run]
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */

import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type CandidateQuery,
	type CatalogArtifact,
	type GoldQuery,
	type QueryTemplate,
	type RecipeSample,
	type Stratum,
	sampleStratified,
} from "@wtfoc/search";
import { catalogFilePath, readCatalog } from "@wtfoc/ingest";
import { RECIPE_TEMPLATES, templatesForStratum } from "./recipe-templates.js";

interface ParsedArgs {
	collection: string;
	output: string;
	samplesPerStratum: number;
	seed: number;
	maxCandidates: number;
	dryRun: boolean;
}

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
	let collection = "";
	let output = "/tmp/recipe-candidates.json";
	let samplesPerStratum = 2;
	let seed = 42;
	let maxCandidates = 80;
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = argv[i + 1];
		if (a === "--collection" && next) {
			collection = next;
			i++;
		} else if (a === "--output" && next) {
			output = next;
			i++;
		} else if (a === "--samples-per-stratum" && next) {
			samplesPerStratum = Number.parseInt(next, 10);
			i++;
		} else if (a === "--seed" && next) {
			seed = Number.parseInt(next, 10);
			i++;
		} else if (a === "--max-candidates" && next) {
			maxCandidates = Number.parseInt(next, 10);
			i++;
		} else if (a === "--dry-run") {
			dryRun = true;
		}
	}
	if (!collection) {
		throw new Error("usage: recipe-author --collection <id> [--output <path>] ...");
	}
	return { collection, output, samplesPerStratum, seed, maxCandidates, dryRun };
}

/**
 * Seedable RNG matching the convention used elsewhere in the autoresearch
 * scripts. Same seed -> same sample selection -> reviewable diff.
 */
export function seededRng(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
}

/**
 * Convert a `DocumentCatalog` to the recipe's corpus-agnostic
 * `CatalogArtifact[]` shape. Active documents only. Edge types are
 * **not** populated by this minimal catalog reader — the `edges/`
 * overlay reader will land alongside step 2c when the LLM author needs
 * graph-shaped strata.
 */
export function catalogToArtifacts(catalog: {
	documents: Record<string, { state: string; chunkIds: string[]; sourceType?: string }>;
}): CatalogArtifact[] {
	const out: CatalogArtifact[] = [];
	for (const [artifactId, entry] of Object.entries(catalog.documents)) {
		if (entry.state !== "active") continue;
		out.push({
			artifactId,
			sourceType: entry.sourceType ?? "unknown",
			contentLength: entry.chunkIds.length * 1000,
		});
	}
	return out;
}

interface AuthorPlan {
	sample: RecipeSample;
	templates: ReadonlyArray<QueryTemplate>;
}

/**
 * Build the (sample, template) pairing plan the LLM driver will iterate.
 * Each sample is paired with every template applicable to its stratum,
 * subject to a global max-candidates cap.
 */
export function planAuthoring(
	samples: ReadonlyArray<RecipeSample>,
	maxCandidates: number,
): AuthorPlan[] {
	const out: AuthorPlan[] = [];
	let total = 0;
	for (const s of samples) {
		const templates = templatesForStratum(s.stratum);
		if (templates.length === 0) continue;
		out.push({ sample: s, templates });
		total += templates.length;
		if (total >= maxCandidates) break;
	}
	return out;
}

/**
 * Stub LLM-author for step 2b. Emits a syntactically-valid `CandidateQuery`
 * keyed by `(template.id, artifactId)` so the JSON output is reviewable
 * end-to-end. Live LLM authoring replaces this body in step 2c.
 */
export function stubAuthor(
	sample: RecipeSample,
	template: QueryTemplate,
	collection: string,
): CandidateQuery {
	const draft: Omit<GoldQuery, "id"> & { id?: string } = {
		id: `${template.id}__${sample.artifact.artifactId.slice(0, 24)}`,
		authoredFromCollectionId: collection,
		applicableCorpora: [collection],
		query: `[STUB ${template.id}] ${template.exampleSurface}`,
		queryType: template.queryType,
		difficulty: template.difficulty,
		targetLayerHints: template.targetLayerHints,
		expectedEvidence: [{ artifactId: sample.artifact.artifactId, required: true }],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [sample.artifact.sourceType],
		minResults: 1,
		migrationNotes: "stub-authored: step 2b scaffolding; replace in step 2c",
	};
	return { template, stratum: sample.stratum, draft };
}

interface CandidatesFile {
	collection: string;
	seed: number;
	totalCandidates: number;
	stratumDistribution: Array<{ stratum: Stratum; count: number }>;
	candidates: ReadonlyArray<CandidateQuery>;
}

function summarizeStrata(samples: ReadonlyArray<RecipeSample>): Array<{ stratum: Stratum; count: number }> {
	const m = new Map<string, { stratum: Stratum; count: number }>();
	for (const s of samples) {
		const key = `${s.stratum.sourceType}::${s.stratum.edgeType ?? "_"}::${s.stratum.lengthBucket}::${s.stratum.rarity}`;
		const cur = m.get(key) ?? { stratum: s.stratum, count: 0 };
		cur.count++;
		m.set(key, cur);
	}
	return Array.from(m.values());
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const manifestDir = process.env.WTFOC_MANIFEST_DIR ?? join(homedir(), ".wtfoc/projects");
	const catPath = catalogFilePath(manifestDir, args.collection);
	const catalog = await readCatalog(catPath);
	if (!catalog) {
		throw new Error(`catalog not found for collection "${args.collection}" at ${catPath}`);
	}
	const artifacts = catalogToArtifacts(catalog);
	console.log(
		`[recipe-author] collection=${args.collection} active artifacts=${artifacts.length}`,
	);

	const samples = sampleStratified(artifacts, {
		samplesPerStratum: args.samplesPerStratum,
		rng: seededRng(args.seed),
		maxTotalSamples: args.maxCandidates * 2, // allow headroom; plan caps the final
	});
	console.log(
		`[recipe-author] stratified samples=${samples.length} (samplesPerStratum=${args.samplesPerStratum})`,
	);

	const plan = planAuthoring(samples, args.maxCandidates);
	const candidates: CandidateQuery[] = [];
	for (const { sample, templates } of plan) {
		for (const t of templates) {
			candidates.push(stubAuthor(sample, t, args.collection));
			if (candidates.length >= args.maxCandidates) break;
		}
		if (candidates.length >= args.maxCandidates) break;
	}

	const out: CandidatesFile = {
		collection: args.collection,
		seed: args.seed,
		totalCandidates: candidates.length,
		stratumDistribution: summarizeStrata(samples),
		candidates,
	};

	if (args.dryRun) {
		console.log(`[recipe-author] --dry-run; would write ${candidates.length} candidates`);
		return;
	}
	await writeFile(args.output, JSON.stringify(out, null, 2), "utf-8");
	console.log(
		`[recipe-author] wrote ${candidates.length} stub candidates to ${args.output} across ${out.stratumDistribution.length} strata`,
	);
	console.log(
		`[recipe-author] templates available=${RECIPE_TEMPLATES.length}; live LLM authoring lands in step 2c`,
	);
}

// Allow this module to be imported by tests without auto-running main.
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error("[recipe-author] FATAL:", err);
		process.exit(1);
	});
}
