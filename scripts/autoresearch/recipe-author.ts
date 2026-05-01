/**
 * Recipe-author CLI driver for #344 step 2 (gold-query regeneration).
 *
 * Pipeline (status as of step 2d):
 *
 *   load corpus catalog            [WIRED — step 2b]
 *     -> derive CatalogArtifact[]  [WIRED — step 2b]
 *     -> sampleStratified          [WIRED — step 2b, deterministic with --seed]
 *     -> load segment excerpts     [WIRED — step 2d, --live only]
 *     -> author (sample, template) [WIRED — step 2c live LLM under --live]
 *     -> applyAdversarialFilter    [DEFERRED — step 2e wires live retriever]
 *     -> emit JSON for human review[WIRED — step 2b]
 *
 * Step 2e replaces the deferred adversarial filter with a live `query()`
 * retriever (mounts the corpus's vector index in-memory) and runs the
 * first authoring rounds per collection (wtfoc-self, filoz, GitHub PR
 * threads, podcast transcripts).
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

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Segment } from "@wtfoc/common";
import { catalogFilePath, readCatalog } from "@wtfoc/ingest";
import {
	applyAdversarialFilter,
	type AdversarialFilterResult,
	type CandidateQuery,
	type CatalogArtifact,
	type GoldQuery,
	InMemoryVectorIndex,
	mountCollection,
	OpenAIEmbedder,
	type QueryTemplate,
	type RecipeSample,
	type Stratum,
	sampleStratified,
} from "@wtfoc/search";
import { createStore } from "@wtfoc/store";
import { buildLiveRetriever } from "./recipe-adversarial-retriever.js";
import { authorCandidate } from "./recipe-llm-author.js";
import { buildExcerptMap } from "./recipe-segment-loader.js";
import { RECIPE_TEMPLATES, templatesForStratum } from "./recipe-templates.js";

interface ParsedArgs {
	collection: string;
	output: string;
	samplesPerStratum: number;
	seed: number;
	maxCandidates: number;
	dryRun: boolean;
	live: boolean;
	adversarialFilter: boolean;
	embedderUrl?: string;
	embedderModel?: string;
}

function parsePositiveInt(name: string, raw: string | undefined): number {
	if (!raw) throw new Error(`${name} requires a value`);
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 1) {
		throw new Error(`${name} must be a positive integer (got "${raw}")`);
	}
	return n;
}

function parseInteger(name: string, raw: string | undefined): number {
	if (!raw) throw new Error(`${name} requires a value`);
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n)) {
		throw new Error(`${name} must be an integer (got "${raw}")`);
	}
	return n;
}

export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
	let collection = "";
	let output = "/tmp/recipe-candidates.json";
	let samplesPerStratum = 2;
	let seed = 42;
	let maxCandidates = 80;
	let dryRun = false;
	let live = false;
	let adversarialFilter = false;
	let embedderUrl: string | undefined;
	let embedderModel: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = argv[i + 1];
		if (a === "--collection" && next) {
			collection = next;
			i++;
		} else if (a === "--output" && next) {
			output = next;
			i++;
		} else if (a === "--samples-per-stratum") {
			samplesPerStratum = parsePositiveInt(a, next);
			i++;
		} else if (a === "--seed") {
			seed = parseInteger(a, next);
			i++;
		} else if (a === "--max-candidates") {
			maxCandidates = parsePositiveInt(a, next);
			i++;
		} else if (a === "--dry-run") {
			dryRun = true;
		} else if (a === "--live") {
			live = true;
		} else if (a === "--adversarial-filter") {
			adversarialFilter = true;
		} else if (a === "--embedder-url" && next) {
			embedderUrl = next;
			i++;
		} else if (a === "--embedder-model" && next) {
			embedderModel = next;
			i++;
		} else if (a !== undefined) {
			throw new Error(`unknown flag: "${a}"`);
		}
	}
	if (!collection) {
		throw new Error("usage: recipe-author --collection <id> [--output <path>] ...");
	}
	if (adversarialFilter && (!embedderUrl || !embedderModel)) {
		throw new Error(
			"--adversarial-filter requires --embedder-url and --embedder-model",
		);
	}
	return {
		collection,
		output,
		samplesPerStratum,
		seed,
		maxCandidates,
		dryRun,
		live,
		adversarialFilter,
		...(embedderUrl ? { embedderUrl } : {}),
		...(embedderModel ? { embedderModel } : {}),
	};
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
/**
 * Build a stable id keyed by the full `(template.id, artifactId)` pair.
 * Hashing keeps the id filesystem/JSON safe even when artifactIds carry
 * slashes or unusual characters; the full artifactId is preserved in
 * `expectedEvidence[0].artifactId` for human review.
 */
function makeCandidateId(templateId: string, artifactId: string): string {
	const fp = createHash("sha1").update(`${templateId}::${artifactId}`).digest("hex").slice(0, 12);
	return `${templateId}__${fp}`;
}

export function stubAuthor(
	sample: RecipeSample,
	template: QueryTemplate,
	collection: string,
): CandidateQuery {
	const draft: Omit<GoldQuery, "id"> & { id?: string } = {
		id: makeCandidateId(template.id, sample.artifact.artifactId),
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
	/**
	 * Adversarial-filter audit. Populated only when --adversarial-filter is
	 * passed. `discarded[]` carries the offending candidate plus the reason
	 * the filter rejected it (typically: "vector top-3 already returns the
	 * required artifact" — query is too easy).
	 */
	adversarial?: {
		topK: number;
		kept: number;
		discarded: AdversarialFilterResult["discarded"];
	};
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

async function loadSegments(collectionId: string): Promise<Segment[]> {
	const store = createStore({ storage: "local" });
	const head = await store.manifests.getHead(collectionId);
	if (!head) {
		throw new Error(`collection "${collectionId}" not found`);
	}
	const segments: Segment[] = [];
	for (const segSummary of head.manifest.segments) {
		const raw = await store.storage.download(segSummary.id);
		const text = new TextDecoder().decode(raw);
		segments.push(JSON.parse(text) as Segment);
	}
	return segments;
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

	// Load segment content only when we'll actually use it. Stub authoring
	// has no use for excerpts and segment download is several seconds on a
	// large corpus.
	let excerpts: ReadonlyMap<string, string> = new Map();
	if (args.live) {
		const segments = await loadSegments(args.collection);
		excerpts = buildExcerptMap(segments);
		console.log(
			`[recipe-author] loaded segments: ${segments.length}; excerpts indexed for ${excerpts.size} artifactIds`,
		);
	}

	const samples = sampleStratified(artifacts, {
		samplesPerStratum: args.samplesPerStratum,
		rng: seededRng(args.seed),
		maxTotalSamples: args.maxCandidates * 2, // allow headroom; plan caps the final
	});
	console.log(
		`[recipe-author] stratified samples=${samples.length} (samplesPerStratum=${args.samplesPerStratum})`,
	);

	// In --live mode authorCandidate can fail per-pair; plan with 2x
	// headroom so a typical failure rate doesn't cause us to fall short of
	// --max-candidates. Stub mode never fails so the cap is exact.
	const planCap = args.live ? args.maxCandidates * 2 : args.maxCandidates;
	const plan = planAuthoring(samples, planCap);
	const candidates: CandidateQuery[] = [];
	const authorErrors: Array<{ template: string; artifactId: string; error: string }> = [];
	for (const { sample, templates } of plan) {
		for (const t of templates) {
			if (args.live) {
				const excerpt = excerpts.get(sample.artifact.artifactId);
				const r = await authorCandidate(sample, t, {
					collectionId: args.collection,
					...(excerpt ? { excerpt } : {}),
				});
				if (r.ok && r.candidate) {
					candidates.push(r.candidate);
				} else {
					authorErrors.push({
						template: t.id,
						artifactId: sample.artifact.artifactId,
						error: r.error ?? "unknown",
					});
				}
			} else {
				candidates.push(stubAuthor(sample, t, args.collection));
			}
			if (candidates.length >= args.maxCandidates) break;
		}
		if (candidates.length >= args.maxCandidates) break;
	}
	if (authorErrors.length > 0) {
		console.warn(`[recipe-author] ${authorErrors.length} author error(s):`);
		for (const e of authorErrors.slice(0, 10)) {
			console.warn(`  - ${e.template} on ${e.artifactId}: ${e.error}`);
		}
	}

	// Adversarial filter — discard candidates whose required gold is in
	// vector-search top-3 (too easy; doesn't exercise the trace engine).
	// Requires a mounted corpus + embedder.
	let adversarial: CandidatesFile["adversarial"];
	let kept: CandidateQuery[] = candidates;
	if (args.adversarialFilter && args.embedderUrl && args.embedderModel) {
		const segments = await loadSegments(args.collection);
		const store = createStore({ storage: "local" });
		const head = await store.manifests.getHead(args.collection);
		if (!head) throw new Error(`collection "${args.collection}" not found`);
		const vectorIndex = new InMemoryVectorIndex();
		await mountCollection(head.manifest, store.storage, vectorIndex);
		const embedder = new OpenAIEmbedder({
			apiKey: process.env.WTFOC_EMBEDDER_KEY ?? "",
			model: args.embedderModel,
			baseUrl: args.embedderUrl,
		});
		const retrieve = buildLiveRetriever({ embedder, vectorIndex, segments });
		const result = await applyAdversarialFilter(candidates, retrieve, { topK: 3 });
		kept = result.kept;
		adversarial = { topK: 3, kept: kept.length, discarded: result.discarded };
		console.log(
			`[recipe-author] adversarial filter: kept=${kept.length} discarded=${result.discarded.length}`,
		);
	}

	const out: CandidatesFile = {
		collection: args.collection,
		seed: args.seed,
		totalCandidates: kept.length,
		stratumDistribution: summarizeStrata(samples),
		candidates: kept,
		...(adversarial ? { adversarial } : {}),
	};

	if (args.dryRun) {
		console.log(`[recipe-author] --dry-run; would write ${kept.length} candidates`);
		return;
	}
	await writeFile(args.output, JSON.stringify(out, null, 2), "utf-8");
	console.log(
		`[recipe-author] wrote ${kept.length} ${args.live ? "live-authored" : "stub"} candidates to ${args.output} across ${out.stratumDistribution.length} strata`,
	);
	if (!args.live) {
		console.log(
			`[recipe-author] templates available=${RECIPE_TEMPLATES.length}; pass --live to call the LLM`,
		);
	}
}

// Allow this module to be imported by tests without auto-running main.
// Use `fileURLToPath` instead of string-comparing `file://` prefixes so
// path encoding / Windows paths / symlinks all resolve consistently.
const entryPath = process.argv[1] ?? "";
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
	main().catch((err) => {
		console.error("[recipe-author] FATAL:", err);
		process.exit(1);
	});
}
