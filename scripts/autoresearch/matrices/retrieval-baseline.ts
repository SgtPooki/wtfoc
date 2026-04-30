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
 * Reranker LLM points at the local Claude direct proxy (haiku) so
 * per-variant cost is locally-zero. No paid models in this matrix.
 */

import type { Matrix } from "../matrix.js";

const matrix: Matrix = {
	name: "retrieval-baseline",
	description:
		"Cross-corpus retrieval-knob sweep on v12 + v3 (autoRoute × diversityEnforce × reranker on/off).",
	baseConfig: {
		collections: {
			primary: "filoz-ecosystem-2026-04-v12",
			secondary: "wtfoc-dogfood-2026-04-v3",
		},
		embedderUrl: "https://openrouter.ai/api/v1",
		embedderModel: "baai/bge-base-en-v1.5",
		embedderKey: process.env.OPENROUTER_API_KEY ?? "",
		extractorUrl: "http://127.0.0.1:4523/v1",
		extractorModel: "haiku",
	},
	axes: {
		autoRoute: [false, true],
		diversityEnforce: [false, true],
		reranker: [
			"off",
			{
				type: "llm",
				url: "http://127.0.0.1:4523/v1",
				model: "haiku",
			},
		],
	},
};

export default matrix;
