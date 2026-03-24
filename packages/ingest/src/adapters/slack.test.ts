import { describe, expect, it } from "vitest";
import { SlackAdapter } from "./slack.js";

describe("SlackAdapter: parseConfig", () => {
	it("accepts a channel name with token", () => {
		const adapter = new SlackAdapter();
		const config = adapter.parseConfig({ source: "foc-support", token: "xoxb-fake" });
		expect(config.source).toBe("foc-support");
		expect(config.token).toBe("xoxb-fake");
		expect(config.limit).toBe(1000);
	});

	it("reads token from SLACK_BOT_TOKEN env var", () => {
		const adapter = new SlackAdapter();
		const original = process.env.SLACK_BOT_TOKEN;
		process.env.SLACK_BOT_TOKEN = "xoxb-from-env";
		try {
			const config = adapter.parseConfig({ source: "general" });
			expect(config.token).toBe("xoxb-from-env");
		} finally {
			if (original !== undefined) {
				process.env.SLACK_BOT_TOKEN = original;
			} else {
				delete process.env.SLACK_BOT_TOKEN;
			}
		}
	});

	it("throws when source is missing", () => {
		const adapter = new SlackAdapter();
		expect(() => adapter.parseConfig({})).toThrow("slack source required");
	});

	it("throws when source is empty", () => {
		const adapter = new SlackAdapter();
		expect(() => adapter.parseConfig({ source: "" })).toThrow("slack source required");
	});

	it("throws when no token available", () => {
		const adapter = new SlackAdapter();
		const original = process.env.SLACK_BOT_TOKEN;
		delete process.env.SLACK_BOT_TOKEN;
		try {
			expect(() => adapter.parseConfig({ source: "general" })).toThrow("Slack bot token required");
		} finally {
			if (original !== undefined) {
				process.env.SLACK_BOT_TOKEN = original;
			}
		}
	});

	it("respects custom limit", () => {
		const adapter = new SlackAdapter();
		const config = adapter.parseConfig({ source: "general", token: "xoxb-fake", limit: 500 });
		expect(config.limit).toBe(500);
	});

	it("parses since option", () => {
		const adapter = new SlackAdapter();
		const config = adapter.parseConfig({
			source: "general",
			token: "xoxb-fake",
			since: "2026-03-01",
		});
		expect(config.since).toBe("2026-03-01");
	});
});

describe("SlackAdapter: extractEdges", () => {
	const adapter = new SlackAdapter();

	it("extracts GitHub issue references via RegexEdgeExtractor", () => {
		const chunks = [
			{
				id: "chunk-1",
				content: "See https://github.com/FilOzone/synapse-sdk/issues/42 for context",
				sourceType: "slack-message",
				source: "#foc-support",
				chunkIndex: 0,
				totalChunks: 1,
				metadata: {},
			},
		];

		const edges = adapter.extractEdges(chunks);
		expect(edges.length).toBeGreaterThanOrEqual(1);
		const ghEdge = edges.find((e) => e.targetId === "FilOzone/synapse-sdk#42");
		expect(ghEdge).toBeDefined();
		expect(ghEdge?.type).toBe("references");
		expect(ghEdge?.confidence).toBe(1.0);
	});

	it("extracts Slack channel cross-references with IDs", () => {
		const chunks = [
			{
				id: "chunk-2",
				content: "Check <#C12345ABC|foc-dev> for the latest updates",
				sourceType: "slack-message",
				source: "#foc-support",
				chunkIndex: 0,
				totalChunks: 1,
				metadata: {},
			},
		];

		const edges = adapter.extractEdges(chunks);
		const channelEdge = edges.find((e) => e.targetType === "slack-channel");
		expect(channelEdge).toBeDefined();
		expect(channelEdge?.targetId).toBe("slack://C12345ABC");
		expect(channelEdge?.evidence).toContain("foc-dev");
	});

	it("extracts plain #channel references", () => {
		const chunks = [
			{
				id: "chunk-3",
				content: "Also discussed in #foc-dev yesterday",
				sourceType: "slack-message",
				source: "#foc-support",
				chunkIndex: 0,
				totalChunks: 1,
				metadata: {},
			},
		];

		const edges = adapter.extractEdges(chunks);
		const channelEdge = edges.find(
			(e) => e.targetType === "slack-channel" && e.targetId === "#foc-dev",
		);
		expect(channelEdge).toBeDefined();
	});

	it("skips numeric-only channel refs (likely GitHub issue refs)", () => {
		const chunks = [
			{
				id: "chunk-4",
				content: "Fixed in #42",
				sourceType: "slack-message",
				source: "#foc-support",
				chunkIndex: 0,
				totalChunks: 1,
				metadata: {},
			},
		];

		const edges = adapter.extractEdges(chunks);
		const channelEdges = edges.filter((e) => e.targetType === "slack-channel");
		expect(channelEdges.length).toBe(0);
	});

	it("extracts Slack message permalink references", () => {
		const chunks = [
			{
				id: "chunk-5",
				content: "See https://myworkspace.slack.com/archives/C12345ABC/p1234567890123456",
				sourceType: "slack-message",
				source: "#foc-support",
				chunkIndex: 0,
				totalChunks: 1,
				metadata: {},
			},
		];

		const edges = adapter.extractEdges(chunks);
		const msgEdge = edges.find((e) => e.targetType === "slack-message");
		expect(msgEdge).toBeDefined();
		expect(msgEdge?.targetId).toBe("slack://C12345ABC/p1234567890123456");
	});
});

describe("SlackAdapter: sourceType", () => {
	it("has sourceType 'slack'", () => {
		const adapter = new SlackAdapter();
		expect(adapter.sourceType).toBe("slack");
	});
});
