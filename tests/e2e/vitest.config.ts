import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));
const monoRoot = resolve(rootDir, "../..");

export default defineConfig({
	root: rootDir,
	resolve: {
		alias: {
			"@wtfoc/common": resolve(monoRoot, "packages/common/src/index.ts"),
			"@wtfoc/store": resolve(monoRoot, "packages/store/src/index.ts"),
			"@wtfoc/ingest": resolve(monoRoot, "packages/ingest/src/index.ts"),
			"@wtfoc/search": resolve(monoRoot, "packages/search/src/index.ts"),
		},
	},
	test: {
		include: ["tests/api/**/*.test.ts"],
		testTimeout: 60_000,
		hookTimeout: 60_000,
		// Run test files sequentially — each file spawns a web server and
		// initializes TransformersEmbedder which downloads/caches the ONNX model.
		// Parallel file execution causes model cache corruption on CI.
		fileParallelism: false,
	},
});
