/**
 * Retrieval-knob sweep over the v12 + v3 corpus pair. 8 variants:
 *   autoRoute × diversityEnforce × reranker
 *
 * Cross-corpus: primary = filoz-ecosystem-2026-04-v12 (production),
 * secondary = wtfoc-dogfood-2026-04-v3 (independent corpus). Headline
 * scalar = sqrt(portable_v12 × portable_v3) — generalization signal,
 * not a v12-only metric.
 *
 * Cheap by Phase 2 standards — no embedder swap, no chunker swap.
 * Each variant reuses the embedder cache (same fingerprint subdir per
 * identical embedder config) so the fan-out cost is mostly query +
 * trace work, multiplied across both corpora.
 *
 * Reranker URL is env-driven via `WTFOC_RERANKER_URL` (BGE
 * cross-encoder protocol — `{query, candidates, top_n}` →
 * `{results: [{id, score}]}`). When unset, the LLM-as-reranker
 * variant is dropped from the matrix and only the rrOff variants
 * run. Set the env to a BGE-protocol endpoint to enable rerank
 * variants. The earlier iteration of this matrix hardcoded a
 * `claude-direct-proxy` URL that routed through the Anthropic API
 * (paid + ~5-10s per call) — removed in favor of the env-driven
 * BGE path.
 */

import type { Matrix, RerankerSpec } from "../matrix.js";

const RERANKER_URL = process.env.WTFOC_RERANKER_URL ?? "";
const EXTRACTOR_URL = process.env.WTFOC_EXTRACTOR_URL ?? "";
const EXTRACTOR_MODEL = process.env.WTFOC_EXTRACTOR_MODEL ?? "";
const EMBEDDER_URL = process.env.WTFOC_EMBEDDER_URL ?? "";
const EMBEDDER_MODEL = process.env.WTFOC_EMBEDDER_MODEL ?? "";

const rerankerVariants: RerankerSpec[] = ["off"];
if (RERANKER_URL) {
	rerankerVariants.push({ type: "bge", url: RERANKER_URL });
}

const matrix: Matrix = {
	name: "retrieval-baseline",
	description:
		"Cross-corpus retrieval-knob sweep on v12 + v3 (autoRoute × diversityEnforce × reranker on/off).",
	productionVariantId: "noar_div_rrOff",
	baseConfig: {
		collections: {
			primary: "filoz-ecosystem-2026-04-v12",
			secondary: "wtfoc-dogfood-2026-04-v3",
		},
		embedderUrl: EMBEDDER_URL,
		embedderModel: EMBEDDER_MODEL,
		embedderKey: process.env.OPENROUTER_API_KEY ?? "",
		extractorUrl: EXTRACTOR_URL,
		extractorModel: EXTRACTOR_MODEL,
	},
	axes: {
		autoRoute: [false, true],
		diversityEnforce: [false, true],
		reranker: rerankerVariants,
	},
};

export default matrix;
