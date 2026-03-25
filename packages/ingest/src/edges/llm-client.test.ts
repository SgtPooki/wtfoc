import { describe, expect, it } from "vitest";
import { parseJsonResponse } from "./llm-client.js";

describe("parseJsonResponse", () => {
	it("parses direct JSON", () => {
		const result = parseJsonResponse<number[]>("[1, 2, 3]");
		expect(result).toEqual([1, 2, 3]);
	});

	it("parses fenced JSON block", () => {
		const result = parseJsonResponse<number[]>("Some text\n```json\n[1, 2, 3]\n```\nMore text");
		expect(result).toEqual([1, 2, 3]);
	});

	it("parses fenced block without json label", () => {
		const result = parseJsonResponse<number[]>("Text\n```\n[1, 2, 3]\n```");
		expect(result).toEqual([1, 2, 3]);
	});

	it("extracts first JSON array from text", () => {
		const result = parseJsonResponse<number[]>("Here are the results: [1, 2, 3] done.");
		expect(result).toEqual([1, 2, 3]);
	});

	it("extracts JSON object from text", () => {
		const result = parseJsonResponse<{ a: number }>('Result: {"a": 1}');
		expect(result).toEqual({ a: 1 });
	});

	it("returns null for non-JSON content", () => {
		expect(parseJsonResponse("just plain text")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(parseJsonResponse("")).toBeNull();
	});

	it("handles nested JSON in fenced block", () => {
		const json = JSON.stringify([
			{
				type: "references",
				sourceId: "c1",
				targetType: "issue",
				targetId: "#42",
				evidence: "ref",
				confidence: 0.7,
			},
		]);
		const result = parseJsonResponse<unknown[]>(`\`\`\`json\n${json}\n\`\`\``);
		expect(result).toHaveLength(1);
	});
});
