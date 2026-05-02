/**
 * Smallest possible sweep — 2 variants, only diversityEnforce on/off.
 * For end-to-end harness verification, not retrieval research.
 *
 * Required env:
 *   WTFOC_EMBEDDER_URL / WTFOC_EMBEDDER_MODEL (+ key, e.g. OPENROUTER_API_KEY)
 *   WTFOC_EXTRACTOR_URL / WTFOC_EXTRACTOR_MODEL
 */

import type { Matrix } from "../matrix.js";

const matrix: Matrix = {
	name: "smoke",
	description: "Two-variant smoke sweep — diversityEnforce off vs on. Verifies harness wiring.",
	baseConfig: {
		collection: "filoz-ecosystem-2026-04-v12",
		embedderUrl: process.env.WTFOC_EMBEDDER_URL ?? "",
		embedderModel: process.env.WTFOC_EMBEDDER_MODEL ?? "",
		embedderKey: process.env.OPENROUTER_API_KEY ?? "",
		extractorUrl: process.env.WTFOC_EXTRACTOR_URL ?? "",
		extractorModel: process.env.WTFOC_EXTRACTOR_MODEL ?? "",
	},
	axes: {
		diversityEnforce: [false, true],
	},
};

export default matrix;
