/**
 * GPU rerank-mode variant of `retrieval-baseline`. Targets the homelab
 * single-GPU vllm cluster running in `rerank-gpu` mode. Drives the BGE
 * cross-encoder for off/on A/B over the same v12 + v3 corpus pair.
 *
 * Pre-conditions (cron wrapper handles):
 *   - WTFOC_VLLM_AUTOSWAP=1 in cron env
 *   - WTFOC_VLLM_ADMIN_URL points at the homelab admin
 *   - Embedder + extractor stay on always-on tiers (cloud + local proxy)
 *     so the GPU is free to host rerank-gpu for the duration of the sweep
 *
 * The wrapper switches GPU → rerank-gpu before sweep, then back to chat
 * for analysis LLM. `gpuPhase` is set explicitly (not relying on the
 * URL-substring heuristic) to make the dependency obvious.
 */

import type { Matrix } from "../matrix.js";

const matrix: Matrix = {
	name: "retrieval-gpu-rerank",
	description:
		"Cross-corpus retrieval-knob sweep with homelab BGE GPU reranker (vs reranker-off baseline).",
	productionVariantId: "noar_div_rrOff",
	gpuPhase: "rerank-gpu",
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
				type: "bge",
				url: process.env.WTFOC_RERANKER_URL ?? "https://reranker-gpu.bt.sgtpooki.com",
			},
		],
	},
};

export default matrix;
