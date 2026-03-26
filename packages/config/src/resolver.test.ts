import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "./resolver.js";

describe("resolveConfig", () => {
	const savedEnv: Record<string, string | undefined> = {};
	const envKeys = [
		"WTFOC_EMBEDDER_URL",
		"WTFOC_EMBEDDER_MODEL",
		"WTFOC_EMBEDDER_KEY",
		"WTFOC_EMBEDDER_PROFILE",
		"WTFOC_EMBEDDER_DIMENSIONS",
		"WTFOC_EMBEDDER_POOLING",
		"WTFOC_OPENAI_API_KEY",
		"WTFOC_EXTRACTOR_URL",
		"WTFOC_EXTRACTOR_MODEL",
		"WTFOC_EXTRACTOR_API_KEY",
		"WTFOC_EXTRACTOR_ENABLED",
		"WTFOC_EXTRACTOR_TIMEOUT_MS",
		"WTFOC_EXTRACTOR_MAX_CONCURRENCY",
	];

	beforeEach(() => {
		for (const key of envKeys) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of envKeys) {
			if (savedEnv[key] !== undefined) {
				process.env[key] = savedEnv[key];
			} else {
				delete process.env[key];
			}
		}
	});

	it("returns defaults when no sources provided", () => {
		const result = resolveConfig({});
		expect(result.embedder.url).toBeUndefined();
		expect(result.embedder.model).toBeUndefined();
		expect(result.embedder.key).toBeUndefined();
		expect(result.embedder.profile).toBeUndefined();
		expect(result.embedder.profiles).toEqual({});
		expect(result.embedder.dimensions).toBeUndefined();
		expect(result.embedder.pooling).toBeUndefined();
		expect(result.embedder.prefix).toBeUndefined();
		expect(result.extractor.enabled).toBe(false);
		expect(result.extractor.timeout).toBe(20000);
		expect(result.extractor.concurrency).toBe(4);
		expect(result.ignore).toEqual([]);
	});

	it("CLI overrides file config", () => {
		const result = resolveConfig({
			cli: { embedderUrl: "http://cli:8000/v1" },
			file: { embedder: { url: "lmstudio", model: "file-model" } },
		});
		expect(result.embedder.url).toBe("http://cli:8000/v1");
	});

	it("file config overrides env vars", () => {
		process.env.WTFOC_EMBEDDER_URL = "ollama";
		const result = resolveConfig({
			file: { embedder: { url: "lmstudio", model: "file-model" } },
		});
		expect(result.embedder.url).toBe("http://localhost:1234/v1");
	});

	it("env vars used when no CLI or file config", () => {
		process.env.WTFOC_EMBEDDER_URL = "ollama";
		const result = resolveConfig({});
		expect(result.embedder.url).toBe("http://localhost:11434/v1");
	});

	it("resolves URL shortcuts in final output", () => {
		const result = resolveConfig({
			file: { embedder: { url: "lmstudio", model: "nomic" } },
		});
		expect(result.embedder.url).toBe("http://localhost:1234/v1");
	});

	it("passes through custom non-shortcut URLs unchanged (FR-014)", () => {
		const result = resolveConfig({
			file: { embedder: { url: "http://vllm.k8s.local:8000/v1", model: "nomic" } },
		});
		expect(result.embedder.url).toBe("http://vllm.k8s.local:8000/v1");
	});

	it("uses extractor defaults", () => {
		const result = resolveConfig({});
		expect(result.extractor.enabled).toBe(false);
		expect(result.extractor.timeout).toBe(20000);
		expect(result.extractor.concurrency).toBe(4);
	});

	it("uses WTFOC_OPENAI_API_KEY as fallback for embedder key", () => {
		process.env.WTFOC_OPENAI_API_KEY = "openai-fallback-key";
		const result = resolveConfig({});
		expect(result.embedder.key).toBe("openai-fallback-key");
	});

	it("WTFOC_EMBEDDER_KEY takes precedence over WTFOC_OPENAI_API_KEY", () => {
		process.env.WTFOC_EMBEDDER_KEY = "primary-key";
		process.env.WTFOC_OPENAI_API_KEY = "fallback-key";
		const result = resolveConfig({});
		expect(result.embedder.key).toBe("primary-key");
	});

	it("parses WTFOC_EXTRACTOR_ENABLED=true from env", () => {
		process.env.WTFOC_EXTRACTOR_ENABLED = "true";
		const result = resolveConfig({});
		expect(result.extractor.enabled).toBe(true);
	});

	it("parses WTFOC_EXTRACTOR_TIMEOUT_MS from env", () => {
		process.env.WTFOC_EXTRACTOR_TIMEOUT_MS = "45000";
		const result = resolveConfig({});
		expect(result.extractor.timeout).toBe(45000);
	});

	it("passes through ignore patterns from file", () => {
		const result = resolveConfig({
			file: { ignore: ["dist/**", "*.log"] },
		});
		expect(result.ignore).toEqual(["dist/**", "*.log"]);
	});

	it("falls back to default timeout when env var is non-numeric", () => {
		process.env.WTFOC_EXTRACTOR_TIMEOUT_MS = "not-a-number";
		const result = resolveConfig({});
		expect(result.extractor.timeout).toBe(20000);
	});

	it("falls back to default concurrency when env var is non-numeric", () => {
		process.env.WTFOC_EXTRACTOR_MAX_CONCURRENCY = "abc";
		const result = resolveConfig({});
		expect(result.extractor.concurrency).toBe(4);
	});

	it("resolves embedder profile from file config", () => {
		const result = resolveConfig({
			file: { embedder: { profile: "nomic" } },
		});
		expect(result.embedder.profile).toBe("nomic");
	});

	it("resolves WTFOC_EMBEDDER_PROFILE from env", () => {
		process.env.WTFOC_EMBEDDER_PROFILE = "minilm";
		const result = resolveConfig({});
		expect(result.embedder.profile).toBe("minilm");
	});

	it("resolves embedder profiles from file config", () => {
		const profiles = {
			nomic: { model: "nomic-embed-text", dimensions: 768, pooling: "mean" as const },
		};
		const result = resolveConfig({
			file: { embedder: { profiles } },
		});
		expect(result.embedder.profiles).toEqual(profiles);
	});

	it("defaults profiles to empty object when not provided", () => {
		const result = resolveConfig({});
		expect(result.embedder.profiles).toEqual({});
	});

	it("resolves embedder dimensions from file config", () => {
		const result = resolveConfig({
			file: { embedder: { dimensions: 768 } },
		});
		expect(result.embedder.dimensions).toBe(768);
	});

	it("resolves WTFOC_EMBEDDER_DIMENSIONS from env", () => {
		process.env.WTFOC_EMBEDDER_DIMENSIONS = "1024";
		const result = resolveConfig({});
		expect(result.embedder.dimensions).toBe(1024);
	});

	it("resolves embedder pooling from file config", () => {
		const result = resolveConfig({
			file: { embedder: { pooling: "last_token" } },
		});
		expect(result.embedder.pooling).toBe("last_token");
	});

	it("resolves WTFOC_EMBEDDER_POOLING from env", () => {
		process.env.WTFOC_EMBEDDER_POOLING = "cls";
		const result = resolveConfig({});
		expect(result.embedder.pooling).toBe("cls");
	});

	it("resolves embedder prefix from file config", () => {
		const result = resolveConfig({
			file: {
				embedder: {
					prefix: { query: "search_query: ", document: "search_document: " },
				},
			},
		});
		expect(result.embedder.prefix).toEqual({
			query: "search_query: ",
			document: "search_document: ",
		});
	});

	it("ignores invalid pooling strategy from env", () => {
		process.env.WTFOC_EMBEDDER_POOLING = "bogus";
		const result = resolveConfig({});
		expect(result.embedder.pooling).toBeUndefined();
	});
});
