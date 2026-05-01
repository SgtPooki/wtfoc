/**
 * Recipe-validate CLI for #344 step-2 review tooling.
 *
 * Reads a candidates JSON produced by `recipe-author --live`, probes each
 * surviving candidate against the live mounted-corpus retriever + trace,
 * classifies the result into a categorical label, and emits both an
 * enriched JSON (validation metadata per candidate) and a markdown
 * triage report for the human reviewer.
 *
 * Three-way peer-review consensus shaped this design:
 *
 *   1. Deterministic probe (Option A) is the primary filter. LLM-grader
 *      (Option B) defers to a follow-up — single-model circularity is a
 *      real risk and the marginal signal does not justify it yet.
 *   2. Categorical labels, NOT pass/fail. The reviewer's burden drops when
 *      probe disagreements (e.g. "adversarial said hard, but vector top-3
 *      hits gold") are surfaced loudly.
 *   3. The probe is enrichment, NOT a hard gate. The apply CLI (separate
 *      PR) gates structurally-invalid candidates only; probe failures
 *      land in the JSON for human override.
 *   4. Specifically NOT-safe auto-rejects: `goldRank > 50`, `wouldPass:
 *      false`, low score alone. These can reflect retrieval weakness on
 *      genuinely valuable trace-stress queries.
 *
 * Usage:
 *   pnpm exec tsx --tsconfig scripts/tsconfig.json \
 *     scripts/autoresearch/recipe-validate.ts \
 *     --candidates /tmp/wtfoc-self-candidates.json \
 *     --output /tmp/wtfoc-self-candidates.validated.json \
 *     --report /tmp/wtfoc-self-review.md \
 *     --collection wtfoc-dogfood-2026-04-v3 \
 *     --embedder-url https://openrouter.ai/api/v1 \
 *     --embedder-model baai/bge-base-en-v1.5
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Embedder, Segment, VectorIndex } from "@wtfoc/common";
import {
	type CandidateQuery,
	InMemoryVectorIndex,
	mountCollection,
	OpenAIEmbedder,
	query,
	trace,
} from "@wtfoc/search";
import { createStore } from "@wtfoc/store";
import { buildStorageToDocMap } from "./recipe-adversarial-retriever.js";

export type ValidationLabel =
	| "keeper-candidate"
	| "trivial-suspect"
	| "needs-fix"
	| "human-review"
	| "auto-reject";

/**
 * Failure-mode taxonomy for the validation pipeline. Each `RejectReason`
 * maps to a real corrective action so the loop has something to optimize
 * against — single-bit kept/rejected loses too much signal.
 *
 * Distinguishes (per #360 ChatGPT review):
 *
 *   - **`unsupported-data`** — corpus lacks the facts the question needs.
 *     Fix: ingest more sources. Recipe shouldn't have authored this.
 *   - **`unsupported-schema`** — graph/edge inventory has no path the
 *     question can traverse. Fix: extend extractor / edge-type registry.
 *   - **`ambiguous-target`** — multiple plausible answers; under-specified.
 *     Fix: human edits the question. Detection requires LLM-grader (B) or
 *     a top-K-score-spread heuristic; not detected by the deterministic
 *     probe alone in this PR.
 *   - **`duplicate-or-near-duplicate`** — semantically equivalent to an
 *     existing query. Fix: drop. Requires Option D (dedup pass against
 *     existing fixture). Not detected by this PR.
 *   - **`retrieval-failure`** — answer exists in corpus AND graph supports
 *     it, but retrieval misses (rank too low / required types absent).
 *     This is the "valuable stress test" lane the loop's RANKING tier
 *     should target. Do NOT auto-reject (peer-review consensus).
 *   - **`trivial-low-signal`** — vector top-K already returns gold; query
 *     doesn't exercise the trace engine. Fix: drop or rephrase.
 *   - **`hallucinated-premise`** — question references a concept not in
 *     the artifact (LLM-author fabricated). Fix: drop. Detected via
 *     preflight `fixture-invalid` (artifactId absent from catalog) OR
 *     LLM-grader closed-book check; the latter not in this PR.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/360
 */
export type RejectReason =
	| "unsupported-data"
	| "unsupported-schema"
	| "ambiguous-target"
	| "duplicate-or-near-duplicate"
	| "retrieval-failure"
	| "trivial-low-signal"
	| "hallucinated-premise";

/** Reason metadata for reviewer triage display + downstream optimization. */
export interface ReasonRecord {
	code: RejectReason;
	/** Free-form per-instance detail for the human reviewer. */
	detail: string;
}

export interface ProbeMetadata {
	/** 1-indexed rank of the required artifact in the wider top-K. null = not in widerK. */
	goldRank: number | null;
	/** Top-K depth used for the probe (default 100). */
	widerK: number;
	/** True if any required source type appeared in retrieved chunks. */
	requiredTypeCoverage: boolean;
	/** Number of edge hops the trace pass walked. */
	traceHopCount: number;
	/** Whether the gold artifact appeared in the trace's reached source set. */
	goldReachedByTrace: boolean;
	/** Top result source labels, for triage display. */
	topResults: Array<{ rank: number; artifactId: string; sourceType: string; score: number }>;
}

export interface ValidationRecord {
	candidate: CandidateQuery;
	label: ValidationLabel;
	/** Structured reason codes from the `RejectReason` taxonomy. */
	reasons: ReasonRecord[];
	probe: ProbeMetadata;
}

export interface CandidatesFile {
	collection: string;
	seed: number;
	totalCandidates: number;
	candidates: CandidateQuery[];
	adversarial?: unknown;
}

export interface EnrichedCandidatesFile extends CandidatesFile {
	validation: {
		labelCounts: Record<ValidationLabel, number>;
		records: ValidationRecord[];
	};
}

/**
 * Classify a single probe result into a categorical label + structured
 * reason list. Pure: deterministic given the probe metadata, no I/O.
 *
 * Reason emissions are scoped to what the deterministic probe can
 * actually signal. `ambiguous-target`, `duplicate-or-near-duplicate`, and
 * `hallucinated-premise` (from #360 taxonomy) require optional LLM-grader
 * (Option B) and dedup (Option D) layers — not in this PR.
 *
 * Decision table (label-driving):
 *   - gold absent from top-K AND not reached by trace      -> auto-reject
 *   - hard-negative violated (gold reached when shouldn't) -> ranking pass
 *   - vector top-3 already returns gold                    -> trivial-suspect
 *   - trace rescued gold not in top-K                      -> human-review
 *   - trace template + 0 hops, OR required types missing   -> needs-fix
 *   - gold mid-rank (4..widerK)                            -> human-review
 */
export function classifyValidation(
	candidate: CandidateQuery,
	probe: ProbeMetadata,
): { label: ValidationLabel; reasons: ReasonRecord[] } {
	const reasons: ReasonRecord[] = [];
	const queryType = candidate.draft.queryType;
	const traceTemplate = queryType === "trace" || queryType === "causal" || queryType === "compare";

	// 1. AUTO-REJECT: gold not findable at all. Without preflight context
	//    here we can't distinguish data-vs-schema cleanly; default to
	//    `unsupported-data` and let the optional preflight wiring later
	//    upgrade this to `unsupported-schema` for fixture-invalid cases.
	if (probe.goldRank === null && !probe.goldReachedByTrace) {
		reasons.push({
			code: "unsupported-data",
			detail: `gold absent from top-${probe.widerK} and trace; corpus likely lacks the artifact`,
		});
		return { label: "auto-reject", reasons };
	}

	// 2. NEEDS-FIX: trace template but trace returned zero hops. The graph
	//    cannot express the question — schema-side gap.
	if (traceTemplate && probe.traceHopCount === 0) {
		reasons.push({
			code: "unsupported-schema",
			detail: `${queryType} template but trace returned 0 edge hops; graph schema may lack a path`,
		});
	}

	// 3. NEEDS-FIX: required source types never surfaced. Retrieval missed,
	//    but the data may exist (corpus could still have those types in
	//    other chunks the embedding doesn't cluster near the query).
	if (!probe.requiredTypeCoverage) {
		reasons.push({
			code: "retrieval-failure",
			detail: `required source types absent from top-${probe.widerK} retrieved chunks`,
		});
	}

	// 4. TRIVIAL-SUSPECT: vector top-3 already returns gold. Adversarial
	//    filter should have caught this; flag the disagreement loudly.
	if (probe.goldRank !== null && probe.goldRank <= 3) {
		reasons.push({
			code: "trivial-low-signal",
			detail: `gold ranked ${probe.goldRank} in vector top-3; query doesn't exercise trace`,
		});
		return { label: "trivial-suspect", reasons };
	}

	// 5. HUMAN-REVIEW: trace rescued a gold not in vector top-K. Valuable
	//    stress test if the question is well-formed; vague otherwise.
	if (probe.goldRank === null && probe.goldReachedByTrace) {
		reasons.push({
			code: "retrieval-failure",
			detail: `gold absent from vector top-${probe.widerK} but reached via trace edge hops; deep-recall stress`,
		});
		return { label: "human-review", reasons };
	}

	// 6. NEEDS-FIX accumulator: any schema/retrieval reason flagged → fix.
	if (reasons.length > 0) {
		return { label: "needs-fix", reasons };
	}

	// 7. HUMAN-REVIEW: gold mid-rank (4..widerK) — borderline. Could be
	//    valuable trace stress; could be a weak query. Surface to human.
	if (probe.goldRank !== null && probe.goldRank > 3) {
		reasons.push({
			code: "retrieval-failure",
			detail: `gold mid-rank ${probe.goldRank} of ${probe.widerK}; assistance from trace unclear`,
		});
		return { label: "human-review", reasons };
	}

	// 8. KEEPER: every signal positive. Empty reasons by convention —
	//    keepers don't carry RejectReason codes.
	return { label: "keeper-candidate", reasons: [] };
}

/**
 * Run the deterministic probe against a single candidate. Pulls top-`widerK`
 * via `query()` and runs `trace()` to gather hop count + reached sources.
 * The `storageToDoc` map converts retrieval `storageId`s back to the
 * artifactId namespace the gold queries use.
 */
export async function probeCandidate(
	candidate: CandidateQuery,
	ctx: {
		embedder: Embedder;
		vectorIndex: VectorIndex;
		segments: ReadonlyArray<Segment>;
		storageToDoc: ReadonlyMap<string, string>;
		widerK?: number;
	},
): Promise<ProbeMetadata> {
	const widerK = ctx.widerK ?? 100;
	const requiredArtifactIds = candidate.draft.expectedEvidence
		.filter((e) => e.required)
		.map((e) => e.artifactId);
	const requiredSourceTypes = new Set(candidate.draft.requiredSourceTypes);

	const qResult = await query(candidate.draft.query, ctx.embedder, ctx.vectorIndex, {
		topK: widerK,
	});

	let goldRank: number | null = null;
	const requiredTypesSeen = new Set<string>();
	const topResults: ProbeMetadata["topResults"] = [];
	for (let i = 0; i < qResult.results.length; i++) {
		const r = qResult.results[i];
		if (!r) continue;
		requiredTypesSeen.add(r.sourceType);
		const docId = ctx.storageToDoc.get(r.storageId);
		if (i < 5) {
			topResults.push({
				rank: i + 1,
				artifactId: docId ?? r.source,
				sourceType: r.sourceType,
				score: r.score,
			});
		}
		if (goldRank === null && docId && requiredArtifactIds.includes(docId)) {
			goldRank = i + 1;
		}
	}

	const tResult = await trace(candidate.draft.query, ctx.embedder, ctx.vectorIndex, [
		...ctx.segments,
	], { mode: "analytical" });
	const traceHopCount = tResult.stats.edgeHops;
	const traceSources = new Set<string>();
	for (const hop of tResult.hops) traceSources.add(hop.source);
	const goldReachedByTrace = requiredArtifactIds.some((id) => traceSources.has(id));

	const requiredTypeCoverage =
		requiredSourceTypes.size === 0 ||
		[...requiredSourceTypes].every((t) => requiredTypesSeen.has(t));

	return {
		goldRank,
		widerK,
		requiredTypeCoverage,
		traceHopCount,
		goldReachedByTrace,
		topResults,
	};
}

const ALL_LABELS: ValidationLabel[] = [
	"keeper-candidate",
	"trivial-suspect",
	"needs-fix",
	"human-review",
	"auto-reject",
];

export function summarizeLabels(records: ReadonlyArray<ValidationRecord>): Record<ValidationLabel, number> {
	const out = Object.fromEntries(ALL_LABELS.map((l) => [l, 0])) as Record<ValidationLabel, number>;
	for (const r of records) out[r.label]++;
	return out;
}

/**
 * Render the per-candidate triage packet markdown report. The reviewer
 * sees one section per candidate, sortable by label, with all evidence
 * needed for a y/n/edit decision visible on screen.
 */
export function renderTriageReport(
	collection: string,
	records: ReadonlyArray<ValidationRecord>,
): string {
	const counts = summarizeLabels(records);
	const lines: string[] = [];
	lines.push(`# Recipe-validate triage report — \`${collection}\``);
	lines.push("");
	lines.push("## Label distribution");
	lines.push("");
	for (const l of ALL_LABELS) {
		lines.push(`- **${l}**: ${counts[l]}`);
	}
	lines.push("");
	for (const label of ALL_LABELS) {
		const subset = records.filter((r) => r.label === label);
		if (subset.length === 0) continue;
		lines.push(`## ${label} (${subset.length})`);
		lines.push("");
		for (const r of subset) {
			const id = r.candidate.draft.id ?? "(no-id)";
			lines.push(`### \`${id}\` — ${r.candidate.draft.queryType} / ${r.candidate.draft.difficulty}`);
			lines.push("");
			lines.push(`**Query**: ${r.candidate.draft.query}`);
			lines.push("");
			lines.push(
				`**Required artifact(s)**: ${r.candidate.draft.expectedEvidence
					.filter((e) => e.required)
					.map((e) => `\`${e.artifactId}\``)
					.join(", ")}`,
			);
			lines.push("");
			lines.push(
				`**Probe**: goldRank=${r.probe.goldRank ?? "null"} traceHops=${r.probe.traceHopCount} reqTypeCov=${r.probe.requiredTypeCoverage} traceReached=${r.probe.goldReachedByTrace}`,
			);
			lines.push("");
			lines.push(
				`**Reasons**: ${r.reasons.length > 0 ? r.reasons.map((rr) => `\`${rr.code}\` (${rr.detail})`).join("; ") : "_(keeper — no reject reason)_"}`,
			);
			lines.push("");
			if (r.probe.topResults.length > 0) {
				lines.push("**Top-5 retrieval**:");
				for (const t of r.probe.topResults) {
					lines.push(`- ${t.rank}. \`${t.artifactId}\` (${t.sourceType}, score ${t.score.toFixed(2)})`);
				}
				lines.push("");
			}
		}
	}
	return lines.join("\n");
}

interface CliArgs {
	candidates: string;
	output: string;
	report: string;
	collection: string;
	embedderUrl: string;
	embedderModel: string;
}

function parseCliArgs(argv: ReadonlyArray<string>): CliArgs {
	const out: Partial<CliArgs> = {};
	const required = ["candidates", "output", "report", "collection", "embedderUrl", "embedderModel"];
	const map: Record<string, keyof CliArgs> = {
		"--candidates": "candidates",
		"--output": "output",
		"--report": "report",
		"--collection": "collection",
		"--embedder-url": "embedderUrl",
		"--embedder-model": "embedderModel",
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = argv[i + 1];
		if (a && a in map && next) {
			out[map[a] as keyof CliArgs] = next;
			i++;
		} else if (a !== undefined) {
			throw new Error(`unknown / malformed flag: "${a}"`);
		}
	}
	for (const r of required) {
		if (!(r in out)) throw new Error(`missing required arg: --${r.replace(/([A-Z])/g, "-$1").toLowerCase()}`);
	}
	return out as CliArgs;
}

async function main(): Promise<void> {
	const args = parseCliArgs(process.argv.slice(2));
	const raw = await readFile(args.candidates, "utf-8");
	const file = JSON.parse(raw) as CandidatesFile;
	if (file.collection !== args.collection) {
		throw new Error(
			`candidates file collection "${file.collection}" mismatches --collection "${args.collection}"`,
		);
	}
	console.log(`[recipe-validate] ${file.candidates.length} candidate(s) to probe`);

	const store = createStore({ storage: "local" });
	const head = await store.manifests.getHead(args.collection);
	if (!head) throw new Error(`collection "${args.collection}" not found`);

	const segments: Segment[] = [];
	for (const segSummary of head.manifest.segments) {
		const blob = await store.storage.download(segSummary.id);
		segments.push(JSON.parse(new TextDecoder().decode(blob)) as Segment);
	}

	const vectorIndex = new InMemoryVectorIndex();
	await mountCollection(head.manifest, store.storage, vectorIndex);
	const embedder = new OpenAIEmbedder({
		apiKey: process.env.WTFOC_EMBEDDER_KEY ?? "",
		model: args.embedderModel,
		baseUrl: args.embedderUrl,
	});
	const storageToDoc = buildStorageToDocMap(segments);

	const records: ValidationRecord[] = [];
	for (const candidate of file.candidates) {
		try {
			const probe = await probeCandidate(candidate, {
				embedder,
				vectorIndex,
				segments,
				storageToDoc,
			});
			const { label, reasons } = classifyValidation(candidate, probe);
			records.push({ candidate, label, reasons, probe });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[recipe-validate] probe failed for ${candidate.draft.id ?? "?"}: ${msg}`);
			records.push({
				candidate,
				label: "human-review",
				reasons: [{ code: "retrieval-failure", detail: `probe-error: ${msg.slice(0, 120)}` }],
				probe: {
					goldRank: null,
					widerK: 100,
					requiredTypeCoverage: false,
					traceHopCount: 0,
					goldReachedByTrace: false,
					topResults: [],
				},
			});
		}
	}

	const enriched: EnrichedCandidatesFile = {
		...file,
		validation: { labelCounts: summarizeLabels(records), records },
	};
	await writeFile(args.output, JSON.stringify(enriched, null, 2), "utf-8");
	const report = renderTriageReport(args.collection, records);
	await writeFile(args.report, report, "utf-8");

	const counts = summarizeLabels(records);
	console.log(
		`[recipe-validate] keeper=${counts["keeper-candidate"]} human=${counts["human-review"]} fix=${counts["needs-fix"]} trivial=${counts["trivial-suspect"]} reject=${counts["auto-reject"]}`,
	);
	console.log(`[recipe-validate] enriched JSON: ${args.output}`);
	console.log(`[recipe-validate] triage report: ${args.report}`);
}

const entryPath = process.argv[1] ?? "";
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
	main().catch((err) => {
		console.error("[recipe-validate] FATAL:", err);
		process.exit(1);
	});
}
