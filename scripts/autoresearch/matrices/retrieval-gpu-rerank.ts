/**
 * GPU rerank-mode variant of `retrieval-baseline`. Targets a vllm-admin
 * managed cluster running in `rerank-gpu` mode. Drives a BGE
 * cross-encoder for off/on A/B over the same v12 + v3 corpus pair.
 *
 * Pre-conditions (cron wrapper handles):
 *   - `WTFOC_VLLM_AUTOSWAP=1` in cron env
 *   - `WTFOC_VLLM_ADMIN_URL` points at the cluster admin endpoint
 *   - `WTFOC_RERANKER_URL` points at the rerank-gpu workload (BGE
 *     protocol)
 *   - Embedder + extractor stay on always-on tiers so the GPU is free
 *     to host rerank-gpu for the duration of the sweep
 *
 * The wrapper switches GPU → rerank-gpu before sweep, then back to chat
 * for analysis LLM. `gpuPhase` is set explicitly (not relying on the
 * URL-substring heuristic) to make the dependency obvious.
 */

import type { Matrix } from "../matrix.js";

const RERANKER_URL = process.env.WTFOC_RERANKER_URL ?? "";
const EMBEDDER_URL = process.env.WTFOC_EMBEDDER_URL ?? "";
const EMBEDDER_MODEL = process.env.WTFOC_EMBEDDER_MODEL ?? "";
const EXTRACTOR_URL = process.env.WTFOC_EXTRACTOR_URL ?? "";
const EXTRACTOR_MODEL = process.env.WTFOC_EXTRACTOR_MODEL ?? "";

if (!RERANKER_URL) {
	throw new Error(
		"retrieval-gpu-rerank matrix requires WTFOC_RERANKER_URL to be set " +
			"(BGE-protocol endpoint for the GPU reranker workload).",
	);
}

const matrix: Matrix = {
	name: "retrieval-gpu-rerank",
	description:
		"Cross-corpus retrieval-knob sweep with BGE GPU reranker (vs reranker-off baseline).",
	productionVariantId: "noar_div_rrOff",
	gpuPhase: "rerank-gpu",
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
		reranker: [
			"off",
			{
				type: "bge",
				url: RERANKER_URL,
			},
		],
	},
};

export default matrix;
