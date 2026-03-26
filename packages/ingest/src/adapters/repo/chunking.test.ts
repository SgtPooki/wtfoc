import { describe, expect, it } from "vitest";
import { chunkCode, MANIFEST_FILENAMES } from "./chunking.js";

describe("chunkCode", () => {
	describe("manifest files as single chunks", () => {
		it("emits package.json as a single chunk regardless of size", () => {
			const largePackageJson = JSON.stringify({
				name: "test-pkg",
				dependencies: Object.fromEntries(
					Array.from({ length: 50 }, (_, i) => [`dep-${i}`, `^${i}.0.0`]),
				),
			});
			expect(largePackageJson.length).toBeGreaterThan(512);

			const chunks = chunkCode(
				largePackageJson,
				"package.json",
				"test/repo",
				"https://example.com",
			);
			expect(chunks).toHaveLength(1);
			expect(chunks[0]?.content).toBe(largePackageJson);
			expect(chunks[0]?.chunkIndex).toBe(0);
			expect(chunks[0]?.totalChunks).toBe(1);
		});

		it("emits go.mod as a single chunk", () => {
			const goMod = [
				"module github.com/user/app",
				"",
				"go 1.21",
				"",
				"require (",
				...Array.from({ length: 30 }, (_, i) => `\tgithub.com/pkg/dep-${i} v1.${i}.0`),
				")",
			].join("\n");
			expect(goMod.length).toBeGreaterThan(512);

			const chunks = chunkCode(goMod, "go.mod", "test/repo", "https://example.com");
			expect(chunks).toHaveLength(1);
			expect(chunks[0]?.content).toBe(goMod);
		});

		it("emits requirements.txt as a single chunk", () => {
			const reqs = Array.from({ length: 50 }, (_, i) => `package-${i}==${i}.0.0`).join("\n");
			expect(reqs.length).toBeGreaterThan(512);

			const chunks = chunkCode(reqs, "requirements.txt", "test/repo", "https://example.com");
			expect(chunks).toHaveLength(1);
		});

		it("handles nested path manifest files", () => {
			const content = JSON.stringify({ dependencies: { express: "^4.0.0" } });
			const chunks = chunkCode(
				content,
				"packages/core/package.json",
				"test/repo",
				"https://example.com",
			);
			expect(chunks).toHaveLength(1);
		});

		it("returns empty array for empty manifest", () => {
			const chunks = chunkCode("   ", "package.json", "test/repo", "https://example.com");
			expect(chunks).toHaveLength(0);
		});

		for (const filename of MANIFEST_FILENAMES) {
			it(`treats ${filename} as a manifest`, () => {
				const content = `content for ${filename} that is long enough to test`;
				const chunks = chunkCode(content, filename, "test/repo", "https://example.com");
				expect(chunks).toHaveLength(1);
			});
		}
	});

	describe("normal code files still chunk", () => {
		it("splits large code files into multiple chunks", () => {
			const code = 'import { foo } from "bar";\n'.repeat(100);
			expect(code.length).toBeGreaterThan(512);

			const chunks = chunkCode(code, "src/main.ts", "test/repo", "https://example.com");
			expect(chunks.length).toBeGreaterThan(1);
		});
	});
});
