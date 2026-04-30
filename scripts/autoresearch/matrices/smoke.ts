/**
 * Smallest possible sweep — 2 variants, only diversityEnforce on/off.
 * For end-to-end harness verification, not retrieval research.
 *
 * Use:
 *   OPENROUTER_API_KEY=... pnpm autoresearch:sweep smoke
 */

import type { Matrix } from "../matrix.js";

const matrix: Matrix = {
	name: "smoke",
	description: "Two-variant smoke sweep — diversityEnforce off vs on. Verifies harness wiring.",
	baseConfig: {
		collection: "filoz-ecosystem-2026-04-v12",
		embedderUrl: "https://openrouter.ai/api/v1",
		embedderModel: "baai/bge-base-en-v1.5",
		embedderKey: process.env.OPENROUTER_API_KEY ?? "",
		extractorUrl: "http://127.0.0.1:4523/v1",
		extractorModel: "haiku",
	},
	axes: {
		diversityEnforce: [false, true],
	},
};

export default matrix;
