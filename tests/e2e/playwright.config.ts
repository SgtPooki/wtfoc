import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env["WTFOC_TEST_PORT"] ?? "3599");

export default defineConfig({
	testDir: "./tests/ui",
	globalSetup: "./tests/ui/global-setup.ts",
	timeout: 30_000,
	retries: 0,
	use: {
		baseURL: `http://localhost:${port}`,
		...devices["Desktop Chrome"],
	},
	// Server lifecycle handled in globalSetup (needs seed step first)
});
