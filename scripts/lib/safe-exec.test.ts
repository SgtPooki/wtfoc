import { describe, expect, it } from "vitest";
import { redactSecrets } from "./safe-exec.js";

describe("redactSecrets", () => {
	it("redacts OpenRouter keys", () => {
		const r = redactSecrets("error: pnpm tsx ... --embedder-key sk-or-v1-abc123def456ghi789jkl012 --extractor-url ...");
		expect(r).not.toContain("sk-or-v1-abc123def456ghi789jkl012");
		expect(r).toContain("<redacted>");
	});

	it("redacts Anthropic keys", () => {
		const r = redactSecrets("Bearer sk-ant-api03-AbCdEfGhIjKlMnOpQrSt");
		expect(r).not.toContain("sk-ant-api03");
	});

	it("redacts GitHub PATs", () => {
		const r = redactSecrets("Authorization: token ghp_AbCdEfGhIjKlMnOpQrSt12345");
		expect(r).not.toContain("ghp_AbCdEfGhIjKlMnOpQrSt12345");
	});

	it("redacts Bearer tokens", () => {
		const r = redactSecrets("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
		expect(r).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
		expect(r).toContain("<redacted>");
	});

	it("redacts --foo-key argv pairs", () => {
		const r = redactSecrets("Command failed: pnpm tsx --embedder-key supersecretvalue --output foo");
		expect(r).not.toContain("supersecretvalue");
		expect(r).toContain("<redacted>");
		expect(r).toContain("--output foo");
	});

	it("redacts --foo-key=value form", () => {
		const r = redactSecrets("--api-key=supersecretvalue");
		expect(r).not.toContain("supersecretvalue");
		expect(r).toContain("--api-key=<redacted>");
	});

	it("redacts --foo-token argv pairs", () => {
		const r = redactSecrets("--gh-token tokenvalue123");
		expect(r).not.toContain("tokenvalue123");
	});

	it("leaves non-secret content untouched", () => {
		const r = redactSecrets("normal log line with no secrets");
		expect(r).toBe("normal log line with no secrets");
	});
});
