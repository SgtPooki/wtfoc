/**
 * Shared test helpers for @wtfoc/search tests.
 * Test-only — NOT exported from the package public API.
 */
import type { Embedder } from "@wtfoc/common";

/**
 * Creates an embedder that returns a known vector for each input string.
 * Throws if called with an unmapped key — forces tests to be explicit about inputs.
 */
export function deterministicEmbedder(mapping: Record<string, number[]>): Embedder {
	const dimensions = Object.values(mapping)[0]?.length ?? 3;
	return {
		dimensions,
		async embed(text: string): Promise<Float32Array> {
			const vec = mapping[text];
			if (!vec) throw new Error(`deterministicEmbedder: unmapped key "${text}"`);
			return new Float32Array(vec);
		},
		async embedBatch(texts: string[]): Promise<Float32Array[]> {
			return Promise.all(texts.map((t) => this.embed(t)));
		},
	};
}

/**
 * Creates an embedder that produces deterministic vectors from a hash of the input.
 * Useful when you need consistent but non-trivial vectors for many strings.
 */
export function hashEmbedder(dimensions = 3): Embedder {
	return {
		dimensions,
		async embed(text: string): Promise<Float32Array> {
			return hashToVector(text, dimensions);
		},
		async embedBatch(texts: string[]): Promise<Float32Array[]> {
			return texts.map((t) => hashToVector(t, dimensions));
		},
	};
}

function hashToVector(text: string, dimensions: number): Float32Array {
	const vec = new Float32Array(dimensions);
	// Simple deterministic hash → vector using character codes
	for (let i = 0; i < text.length; i++) {
		const idx = i % dimensions;
		vec[idx] = (vec[idx] ?? 0) + text.charCodeAt(i);
	}
	// Normalize to unit vector
	let magnitude = 0;
	for (let i = 0; i < dimensions; i++) {
		const v = vec[i] ?? 0;
		magnitude += v * v;
	}
	magnitude = Math.sqrt(magnitude);
	if (magnitude > 0) {
		for (let i = 0; i < dimensions; i++) {
			vec[i] = (vec[i] ?? 0) / magnitude;
		}
	}
	return vec;
}
