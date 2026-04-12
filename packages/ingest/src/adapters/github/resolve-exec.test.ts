import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveGitHubExecFn } from "./http-transport.js";

const GITHUB_ENV_KEYS = [
	"GITHUB_APP_ID",
	"GITHUB_PRIVATE_KEY",
	"GITHUB_INSTALLATION_ID",
	"GITHUB_TOKEN",
	"WTFOC_GITHUB_TOKEN",
] as const;

describe("resolveGitHubExecFn", () => {
	const saved: Record<string, string | undefined> = {};

	beforeEach(() => {
		// Save and clear all GitHub-related env vars
		for (const key of GITHUB_ENV_KEYS) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		// Restore by mutating the existing process.env object
		for (const key of GITHUB_ENV_KEYS) {
			if (saved[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = saved[key];
			}
		}
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

	it("falls back to PAT when GITHUB_INSTALLATION_ID is not a number", () => {
		process.env.GITHUB_APP_ID = "12345";
		process.env.GITHUB_PRIVATE_KEY = "fake-key";
		process.env.GITHUB_INSTALLATION_ID = "not-a-number";
		process.env.GITHUB_TOKEN = "ghp_fallback";

		const result = resolveGitHubExecFn();
		expect(result._transport).toBe("pat");
	});

	it("falls back to WTFOC_GITHUB_TOKEN when GITHUB_TOKEN is empty string", () => {
		process.env.GITHUB_TOKEN = "";
		process.env.WTFOC_GITHUB_TOKEN = "ghp_wtfoc_fallback";

		const result = resolveGitHubExecFn();
		expect(result._transport).toBe("pat");
	});
});
