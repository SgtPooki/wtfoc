import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveGitHubExecFn } from "./http-transport.js";

describe("resolveGitHubExecFn", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Clear all GitHub-related env vars
		delete process.env.GITHUB_APP_ID;
		delete process.env.GITHUB_PRIVATE_KEY;
		delete process.env.GITHUB_INSTALLATION_ID;
		delete process.env.GITHUB_TOKEN;
		delete process.env.WTFOC_GITHUB_TOKEN;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("returns gh CLI exec when no env vars are set", () => {
		const result = resolveGitHubExecFn();
		// The default exec function should be a function (gh CLI based)
		expect(typeof result).toBe("function");
		// Tag should indicate CLI fallback
		expect(result._transport).toBe("cli");
	});

	it("returns HTTP exec with GitHub App provider when all app env vars are set", () => {
		process.env.GITHUB_APP_ID = "12345";
		process.env.GITHUB_PRIVATE_KEY = "fake-key";
		process.env.GITHUB_INSTALLATION_ID = "99";

		const result = resolveGitHubExecFn();
		expect(typeof result).toBe("function");
		expect(result._transport).toBe("github-app");
	});

	it("returns HTTP exec with PAT provider when GITHUB_TOKEN is set", () => {
		process.env.GITHUB_TOKEN = "ghp_test123";

		const result = resolveGitHubExecFn();
		expect(typeof result).toBe("function");
		expect(result._transport).toBe("pat");
	});

	it("returns HTTP exec with PAT provider when WTFOC_GITHUB_TOKEN is set", () => {
		process.env.WTFOC_GITHUB_TOKEN = "ghp_wtfoc123";

		const result = resolveGitHubExecFn();
		expect(typeof result).toBe("function");
		expect(result._transport).toBe("pat");
	});

	it("prefers GitHub App over PAT when both are configured", () => {
		process.env.GITHUB_APP_ID = "12345";
		process.env.GITHUB_PRIVATE_KEY = "fake-key";
		process.env.GITHUB_INSTALLATION_ID = "99";
		process.env.GITHUB_TOKEN = "ghp_also_set";

		const result = resolveGitHubExecFn();
		expect(result._transport).toBe("github-app");
	});

	it("falls back to PAT when GitHub App config is incomplete (missing installation ID)", () => {
		process.env.GITHUB_APP_ID = "12345";
		process.env.GITHUB_PRIVATE_KEY = "fake-key";
		// No GITHUB_INSTALLATION_ID
		process.env.GITHUB_TOKEN = "ghp_fallback";

		const result = resolveGitHubExecFn();
		expect(result._transport).toBe("pat");
	});

	it("falls back to CLI when GitHub App config is incomplete and no PAT", () => {
		process.env.GITHUB_APP_ID = "12345";
		// Missing GITHUB_PRIVATE_KEY and GITHUB_INSTALLATION_ID

		const result = resolveGitHubExecFn();
		expect(result._transport).toBe("cli");
	});

	it("prefers GITHUB_TOKEN over WTFOC_GITHUB_TOKEN", () => {
		process.env.GITHUB_TOKEN = "ghp_primary";
		process.env.WTFOC_GITHUB_TOKEN = "ghp_secondary";

		const result = resolveGitHubExecFn();
		expect(result._transport).toBe("pat");
	});
});
