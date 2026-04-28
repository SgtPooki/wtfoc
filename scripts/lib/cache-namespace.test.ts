import { describe, expect, it } from "vitest";
import { namespacedCacheDir } from "./cache-namespace.js";

describe("namespacedCacheDir", () => {
	it("appends the fingerprint as a subdirectory", () => {
		const dir = namespacedCacheDir("/tmp/wtfoc-cache", "abc123");
		expect(dir.endsWith("/abc123")).toBe(true);
	});

	it("returns disjoint paths for different fingerprints", () => {
		const a = namespacedCacheDir("/tmp/wtfoc-cache", "fp-a");
		const b = namespacedCacheDir("/tmp/wtfoc-cache", "fp-b");
		expect(a).not.toBe(b);
		// Critical invariant: neither path is a prefix of the other, so
		// listing/clearing one variant cannot affect the other.
		expect(a.startsWith(b)).toBe(false);
		expect(b.startsWith(a)).toBe(false);
	});

	it("returns identical paths for the same fingerprint (cache hit reuse)", () => {
		const a = namespacedCacheDir("/tmp/wtfoc-cache", "same");
		const b = namespacedCacheDir("/tmp/wtfoc-cache", "same");
		expect(a).toBe(b);
	});

	it("rejects empty fingerprints to prevent variant collapse", () => {
		expect(() => namespacedCacheDir("/tmp", "")).toThrow();
		expect(() => namespacedCacheDir("/tmp", "   ")).toThrow();
	});

	it("resolves to an absolute path", () => {
		const dir = namespacedCacheDir("./relative", "fp");
		expect(dir.startsWith("/")).toBe(true);
	});
});
