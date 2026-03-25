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
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
