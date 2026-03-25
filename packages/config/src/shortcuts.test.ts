import { describe, expect, it } from "vitest";
import { resolveUrlShortcut } from "./shortcuts.js";

describe("resolveUrlShortcut", () => {
	it("resolves lmstudio shortcut", () => {
		expect(resolveUrlShortcut("lmstudio")).toBe("http://localhost:1234/v1");
	});

	it("resolves ollama shortcut", () => {
		expect(resolveUrlShortcut("ollama")).toBe("http://localhost:11434/v1");
	});

	it("passes through unknown strings unchanged", () => {
		expect(resolveUrlShortcut("http://custom:8000/v1")).toBe("http://custom:8000/v1");
	});

	it("passes through empty string unchanged", () => {
		expect(resolveUrlShortcut("")).toBe("");
	});

	it("passes through arbitrary non-shortcut strings", () => {
		expect(resolveUrlShortcut("https://vllm.k8s.local:8000/v1")).toBe(
			"https://vllm.k8s.local:8000/v1",
		);
	});
});
