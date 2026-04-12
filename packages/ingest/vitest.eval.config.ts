import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

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
		include: ["src/edges/eval.test.ts"],
	},
});
