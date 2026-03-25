import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigParseError, ConfigValidationError } from "@wtfoc/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProjectConfig } from "./loader.js";

describe("loadProjectConfig", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "wtfoc-config-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns undefined when .wtfoc.json does not exist", () => {
		const result = loadProjectConfig(tempDir);
		expect(result).toBeUndefined();
	});

	it("parses valid JSON and returns validated config", () => {
		writeFileSync(
			join(tempDir, ".wtfoc.json"),
			JSON.stringify({ embedder: { url: "lmstudio", model: "nomic" } }),
		);
		const result = loadProjectConfig(tempDir);
		expect(result).toEqual({ embedder: { url: "lmstudio", model: "nomic" } });
	});

	it("throws ConfigParseError on invalid JSON", () => {
		writeFileSync(join(tempDir, ".wtfoc.json"), "not valid json {{{");
		expect(() => loadProjectConfig(tempDir)).toThrow(ConfigParseError);
	});

	it("includes file path in ConfigParseError", () => {
		writeFileSync(join(tempDir, ".wtfoc.json"), "{bad}");
		try {
			loadProjectConfig(tempDir);
			expect.fail("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ConfigParseError);
			const configErr = err as ConfigParseError;
			expect(configErr.context?.filePath).toContain(".wtfoc.json");
		}
	});

	it("throws ConfigValidationError when validation fails", () => {
		writeFileSync(join(tempDir, ".wtfoc.json"), JSON.stringify({ embedder: { url: 123 } }));
		expect(() => loadProjectConfig(tempDir)).toThrow(ConfigValidationError);
	});

	it("throws ConfigParseError on empty file", () => {
		writeFileSync(join(tempDir, ".wtfoc.json"), "");
		expect(() => loadProjectConfig(tempDir)).toThrow(ConfigParseError);
	});
});
