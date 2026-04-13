import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			"@wtfoc/common": resolve(rootDir, "packages/common/src/index.ts"),
			"@wtfoc/store": resolve(rootDir, "packages/store/src/index.ts"),
			"@wtfoc/ingest": resolve(rootDir, "packages/ingest/src/index.ts"),
			"@wtfoc/search": resolve(rootDir, "packages/search/src/index.ts"),
			"@wtfoc/config": resolve(rootDir, "packages/config/src/index.ts"),
		},
	},
	test: {
		include: ["packages/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
		// Exclude e2e tests from the default `pnpm test` run.
		// Use `pnpm test:e2e` to run them separately.
		exclude: ["**/node_modules/**", "tests/**", "**/eval.test.ts"],
	},
});
