import { describe, expect, it, vi } from "vitest";
import { fetchOpenIssues, openIssuesToPromptLines } from "./open-issues.js";

describe("fetchOpenIssues", () => {
	it("parses gh issue list JSON output", () => {
		const fake = vi.fn(() =>
			JSON.stringify([
				{
					number: 42,
					title: "test issue",
					labels: [{ name: "bug" }, { name: "P1" }],
					body: "lorem ipsum",
					createdAt: "2026-04-01T00:00:00Z",
				},
			]),
		);
		const issues = fetchOpenIssues({ spawnFn: fake });
		expect(issues).toHaveLength(1);
		expect(issues[0]?.number).toBe(42);
		expect(issues[0]?.labels).toContain("bug");
	});

	it("returns [] when gh fails", () => {
		const fake = vi.fn(() => {
			throw new Error("gh not found");
		});
		expect(fetchOpenIssues({ spawnFn: fake })).toEqual([]);
	});

	it("returns [] on malformed JSON", () => {
		const fake = vi.fn(() => "not json");
		expect(fetchOpenIssues({ spawnFn: fake })).toEqual([]);
	});

	it("truncates long bodies", () => {
		const longBody = "x".repeat(5000);
		const fake = vi.fn(() =>
			JSON.stringify([
				{
					number: 1,
					title: "t",
					labels: [],
					body: longBody,
					createdAt: "2026-04-01T00:00:00Z",
				},
			]),
		);
		const issues = fetchOpenIssues({ spawnFn: fake, bodyPreviewChars: 100 });
		expect(issues[0]?.bodyPreview.length).toBeLessThanOrEqual(101);
	});
});

describe("openIssuesToPromptLines", () => {
	it("renders one line per issue with labels + preview", () => {
		const lines = openIssuesToPromptLines([
			{
				number: 1,
				title: "title A",
				labels: ["bug"],
				bodyPreview: "preview body",
				createdAt: "2026",
			},
		]);
		expect(lines.some((l) => l.includes("#1 title A"))).toBe(true);
		expect(lines.some((l) => l.includes("[bug]"))).toBe(true);
	});

	it("emits placeholder when no issues", () => {
		expect(openIssuesToPromptLines([])).toEqual([
			"(no open issues fetched — gh unavailable or no matches)",
		]);
	});
});
