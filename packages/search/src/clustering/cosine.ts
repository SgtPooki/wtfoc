/**
 * Optimized cosine similarity utilities for clustering.
 * Pre-normalizes vectors so similarity reduces to a dot product.
 */

/** Compute the L2 norm of a vector. */
function l2Norm(vec: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < vec.length; i++) {
		const v = vec[i] ?? 0;
		sum += v * v;
	}
	return Math.sqrt(sum);
}

/** Normalize a vector in-place and return it. */
export function normalize(vec: Float32Array): Float32Array {
	const norm = l2Norm(vec);
	if (norm === 0) return vec;
	for (let i = 0; i < vec.length; i++) {
		vec[i] = (vec[i] ?? 0) / norm;
	}
	return vec;
}

/** Dot product of two same-length vectors (cosine sim when pre-normalized). */
export function dot(a: Float32Array, b: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		sum += (a[i] ?? 0) * (b[i] ?? 0);
	}
	return sum;
}

/** Compute the mean (centroid) of a set of vectors. */
export function centroid(vectors: Float32Array[]): Float32Array {
	if (vectors.length === 0) {
		return new Float32Array(0);
	}
	const dim = vectors[0]?.length ?? 0;
	const result = new Float32Array(dim);
	for (const vec of vectors) {
		for (let i = 0; i < dim; i++) {
			result[i] = (result[i] ?? 0) + (vec[i] ?? 0);
		}
	}
	const n = vectors.length;
	for (let i = 0; i < dim; i++) {
		result[i] = (result[i] ?? 0) / n;
	}
	return result;
}
