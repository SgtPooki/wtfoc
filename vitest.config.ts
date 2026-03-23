import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@wtfoc/common": "/packages/common/src/index.ts",
			"@wtfoc/store": "/packages/store/src/index.ts",
			"@wtfoc/ingest": "/packages/ingest/src/index.ts",
			"@wtfoc/search": "/packages/search/src/index.ts",
		},
	},
	test: {
		include: ["packages/*/src/**/*.test.ts"],
	},
});
