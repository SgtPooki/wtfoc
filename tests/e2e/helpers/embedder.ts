/**
 * Shared embedder for e2e tests.
 *
 * Uses the q8 quantized model (22MB) instead of fp32 (86MB)
 * for faster downloads and smaller CI cache footprint.
 */
import { TransformersEmbedder } from "@wtfoc/search";

export function createTestEmbedder(): TransformersEmbedder {
	return new TransformersEmbedder(undefined, { dtype: "q8" });
}
