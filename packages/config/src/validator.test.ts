import { ConfigValidationError } from "@wtfoc/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateProjectConfig } from "./validator.js";

describe("validateProjectConfig", () => {
	const filePath = "/test/.wtfoc.json";

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("accepts a valid complete config", () => {
		const config = {
			embedder: { url: "lmstudio", model: "nomic-embed-text", key: "test-key" },
			extractor: {
				enabled: true,
				url: "http://localhost:8000/v1",
				model: "qwen",
				apiKey: "k",
				timeout: 30000,
				concurrency: 2,
			},
			ignore: ["dist/**", "*.log"],
		};
		const result = validateProjectConfig(config, filePath);
		expect(result).toEqual(config);
	});

	it("accepts an empty object", () => {
		const result = validateProjectConfig({}, filePath);
		expect(result).toEqual({});
	});

	it("accepts a partial config with only embedder", () => {
		const config = { embedder: { url: "ollama", model: "llama3" } };
		const result = validateProjectConfig(config, filePath);
		expect(result).toEqual(config);
	});

	it("throws on non-object root", () => {
		expect(() => validateProjectConfig("string", filePath)).toThrow(ConfigValidationError);
		expect(() => validateProjectConfig(null, filePath)).toThrow(ConfigValidationError);
		expect(() => validateProjectConfig([], filePath)).toThrow(ConfigValidationError);
	});

	it("throws when embedder.url is not a string", () => {
		expect(() => validateProjectConfig({ embedder: { url: 123 } }, filePath)).toThrow(
			/embedder\.url must be a string/,
		);
	});

	it("throws when embedder.url is set but model is missing (FR-015)", () => {
		expect(() => validateProjectConfig({ embedder: { url: "lmstudio" } }, filePath)).toThrow(
			/embedder\.model must be a string \(required when embedder\.url is set\)/,
		);
	});

	it("throws when extractor.timeout is not a positive integer", () => {
		expect(() => validateProjectConfig({ extractor: { timeout: -5 } }, filePath)).toThrow(
			/extractor\.timeout must be a positive integer/,
		);

		expect(() => validateProjectConfig({ extractor: { timeout: 1.5 } }, filePath)).toThrow(
			/extractor\.timeout must be a positive integer/,
		);
	});

	it("throws when extractor.enabled=true but url and model are missing", () => {
		expect(() => validateProjectConfig({ extractor: { enabled: true } }, filePath)).toThrow(
			/extractor\.url must be a string \(required when extractor\.enabled is true\)/,
		);
	});

	it("throws when extractor.enabled=true with url but no model", () => {
		expect(() =>
			validateProjectConfig(
				{ extractor: { enabled: true, url: "http://localhost:8000/v1" } },
				filePath,
			),
		).toThrow(/extractor\.model must be a string \(required when extractor\.enabled is true\)/);
	});

	it("warns on unknown top-level key via stderr", () => {
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		validateProjectConfig({ unknownKey: "value" }, filePath);
		expect(stderrSpy).toHaveBeenCalledWith(
			expect.stringContaining('unrecognized key "unknownKey"'),
		);
	});

	it("throws when concurrency is out of range", () => {
		expect(() => validateProjectConfig({ extractor: { concurrency: 0 } }, filePath)).toThrow(
			/extractor\.concurrency must be a positive integer \(1-32\)/,
		);

		expect(() => validateProjectConfig({ extractor: { concurrency: 33 } }, filePath)).toThrow(
			/extractor\.concurrency must be a positive integer \(1-32\)/,
		);
	});

	it("throws when ignore is not an array", () => {
		expect(() => validateProjectConfig({ ignore: "not-array" }, filePath)).toThrow(
			/ignore must be an array of strings/,
		);
	});

	it("throws when ignore array contains non-strings", () => {
		expect(() => validateProjectConfig({ ignore: ["valid", 123] }, filePath)).toThrow(
			/ignore\[1\] must be a string/,
		);
	});
});
