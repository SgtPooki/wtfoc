import { describe, expect, it } from "vitest";
import { centroid, dot, normalize } from "./cosine.js";

describe("normalize", () => {
	it("normalizes a vector to unit length", () => {
		const vec = new Float32Array([3, 4]);
		const result = normalize(vec);
		const magnitude = Math.sqrt(dot(result, result));
		expect(magnitude).toBeCloseTo(1.0, 5);
	});

	it("handles zero vector gracefully", () => {
		const vec = new Float32Array([0, 0, 0]);
		const result = normalize(vec);
		expect(result[0]).toBe(0);
		expect(result[1]).toBe(0);
		expect(result[2]).toBe(0);
	});

	it("modifies vector in place", () => {
		const vec = new Float32Array([3, 4]);
		const result = normalize(vec);
		expect(result).toBe(vec);
	});
});

describe("dot", () => {
	it("computes dot product of two vectors", () => {
		const a = new Float32Array([1, 2, 3]);
		const b = new Float32Array([4, 5, 6]);
		expect(dot(a, b)).toBe(32); // 4+10+18
	});

	it("returns 1 for identical unit vectors", () => {
		const a = normalize(new Float32Array([1, 0, 0]));
		expect(dot(a, a)).toBeCloseTo(1.0, 5);
	});

	it("returns 0 for orthogonal vectors", () => {
		const a = new Float32Array([1, 0]);
		const b = new Float32Array([0, 1]);
		expect(dot(a, b)).toBe(0);
	});
});

describe("centroid", () => {
	it("computes mean of vectors", () => {
		const vectors = [new Float32Array([2, 4]), new Float32Array([4, 6])];
		const c = centroid(vectors);
		expect(c[0]).toBeCloseTo(3, 5);
		expect(c[1]).toBeCloseTo(5, 5);
	});

	it("returns empty array for empty input", () => {
		const c = centroid([]);
		expect(c.length).toBe(0);
	});

	it("returns the vector itself for single input", () => {
		const c = centroid([new Float32Array([1, 2, 3])]);
		expect(c[0]).toBeCloseTo(1, 5);
		expect(c[1]).toBeCloseTo(2, 5);
		expect(c[2]).toBeCloseTo(3, 5);
	});
});
