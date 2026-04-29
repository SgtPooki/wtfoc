/**
 * Retrieval-only sweep over the v12 corpus. 8 variants:
 *   autoRoute × diversityEnforce × reranker
 *
 * Cheap by Phase 2 standards — no embedder swap, no chunker swap.
 * Useful for confirming the sweep harness end-to-end before reaching
 * for expensive sweeps. Each variant should reuse the embedder cache
 * (same fingerprint subdir per identical embedder config) so the
 * fan-out cost is mostly query+trace work.
 *
 * Reranker LLM points at the local Claude direct proxy (haiku) so
 * cost is locally-zero. No paid models in this matrix.
 */

import type { Matrix } from "../matrix.js";

const matrix: Matrix = {
	name: "retrieval-baseline",
	description:
		"Confirm sweep-harness end-to-end on cheap retrieval knobs (autoRoute / diversityEnforce / reranker on-off). No re-ingest, no embedder swap.",
	baseConfig: {
		collection: "filoz-ecosystem-2026-04-v12",
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
