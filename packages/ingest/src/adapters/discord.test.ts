import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DiscordAdapter } from "./discord.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE_PATH = join(__dirname, "__fixtures__", "discord-export.json");

describe("DiscordAdapter: parseConfig", () => {
	it("detects json mode for .json paths", () => {
		const adapter = new DiscordAdapter();
		const config = adapter.parseConfig({ source: "/path/to/export.json" });
		expect(config.mode).toBe("json");
		expect(config.source).toBe("/path/to/export.json");
	});

	it("detects bot mode for server/channel sources", () => {
		const adapter = new DiscordAdapter();
		// Bot mode requires a token
		const config = adapter.parseConfig({
			source: "my-server/general",
			token: "fake-token",
		});
		expect(config.mode).toBe("bot");
		expect(config.source).toBe("my-server/general");
		expect(config.token).toBe("fake-token");
	});

	it("throws when source is missing", () => {
		const adapter = new DiscordAdapter();
		expect(() => adapter.parseConfig({})).toThrow("discord source required");
	});

	it("throws when source is empty", () => {
		const adapter = new DiscordAdapter();
		expect(() => adapter.parseConfig({ source: "" })).toThrow("discord source required");
	});

	it("throws when bot mode has no token", () => {
		const adapter = new DiscordAdapter();
		// Ensure env var is not set for this test
		const original = process.env.WTFOC_DISCORD_TOKEN;
		delete process.env.WTFOC_DISCORD_TOKEN;
		try {
			expect(() => adapter.parseConfig({ source: "server/channel" })).toThrow(
				"Discord bot token required",
			);
		} finally {
			if (original !== undefined) {
				process.env.WTFOC_DISCORD_TOKEN = original;
			}
		}
	});

	it("uses WTFOC_DISCORD_TOKEN env var as fallback", () => {
		const adapter = new DiscordAdapter();
		const original = process.env.WTFOC_DISCORD_TOKEN;
		process.env.WTFOC_DISCORD_TOKEN = "env-token";
		try {
			const config = adapter.parseConfig({ source: "server/channel" });
			expect(config.token).toBe("env-token");
		} finally {
			if (original !== undefined) {
				process.env.WTFOC_DISCORD_TOKEN = original;
			} else {
				delete process.env.WTFOC_DISCORD_TOKEN;
			}
		}
	});

	it("respects limit and since options", () => {
		const adapter = new DiscordAdapter();
		const config = adapter.parseConfig({
			source: "/path/to/export.json",
			limit: 500,
			since: "2026-01-01T00:00:00Z",
		});
		expect(config.limit).toBe(500);
		expect(config.since).toBe("2026-01-01T00:00:00Z");
	});

	it("defaults limit to 1000", () => {
		const adapter = new DiscordAdapter();
		const config = adapter.parseConfig({ source: "/path/to/export.json" });
		expect(config.limit).toBe(1000);
	});
});

describe("DiscordAdapter: JSON ingestion", () => {
	it("ingests messages from a DiscordChatExporter JSON file", async () => {
		const adapter = new DiscordAdapter();
		const config = adapter.parseConfig({ source: FIXTURE_PATH });

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}

		// Messages 1001+1002 grouped (same author, within 5 min), 1003 separate, 1004 separate
		expect(chunks.length).toBe(3);
	});

	it("groups consecutive messages from same author within 5 minutes", async () => {
		const adapter = new DiscordAdapter();
		const config = adapter.parseConfig({ source: FIXTURE_PATH });

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}

		// First chunk should be Alice's grouped messages
		const aliceGrouped = chunks[0];
		if (!aliceGrouped) throw new Error("Expected grouped Discord messages");
		expect(aliceGrouped.metadata.author).toBe("Alice");
		expect(aliceGrouped.metadata.messageCount).toBe("2");
		expect(aliceGrouped.content).toContain("https://github.com/FilOzone/synapse-sdk/issues/42");
		expect(aliceGrouped.content).toContain("rate limiter");
	});

	it("produces chunks with correct sourceType and source", async () => {
		const adapter = new DiscordAdapter();
		const config = adapter.parseConfig({ source: FIXTURE_PATH });

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}

		for (const chunk of chunks) {
			expect(chunk.sourceType).toBe("discord-message");
			expect(chunk.source).toBe("TestServer/#general");
			expect(chunk.sourceUrl).toMatch(/^https:\/\/discord\.com\/channels\//);
		}
	});

	it("sets metadata fields as strings", async () => {
		const adapter = new DiscordAdapter();
		const config = adapter.parseConfig({ source: FIXTURE_PATH });

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}

		for (const chunk of chunks) {
			for (const [_key, value] of Object.entries(chunk.metadata)) {
				expect(typeof value).toBe("string");
			}
			expect(chunk.metadata.channel).toBe("general");
			expect(chunk.metadata.server).toBe("TestServer");
		}
	});

	it("filters by since date", async () => {
		const adapter = new DiscordAdapter();
		const config = adapter.parseConfig({
			source: FIXTURE_PATH,
			since: "2026-03-23T11:00:00Z",
		});

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}

		// Only the 12:00 message should pass the filter
		expect(chunks.length).toBe(1);
		expect(chunks[0]?.content).toBe("Separate conversation much later");
	});

	it("generates deterministic chunk IDs from content hash", async () => {
		const adapter = new DiscordAdapter();
		const config = adapter.parseConfig({ source: FIXTURE_PATH });

		const chunks1 = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks1.push(chunk);
		}

		const chunks2 = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks2.push(chunk);
		}

		expect(chunks1.map((c) => c.id)).toEqual(chunks2.map((c) => c.id));
	});
});

describe("DiscordAdapter: edge extraction", () => {
	it("extracts GitHub URL references via RegexEdgeExtractor", async () => {
		const adapter = new DiscordAdapter();
		const config = adapter.parseConfig({ source: FIXTURE_PATH });

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}

		const edges = await adapter.extractEdges(chunks);
		const githubEdges = edges.filter((e) => e.targetId.includes("FilOzone/synapse-sdk"));
		// Golden count: 1 GitHub URL reference in discord-export.json fixture
		expect(githubEdges.length).toBe(1);
		expect(githubEdges[0]?.type).toBe("references");
	});

	it("extracts #channel cross-references", async () => {
		const adapter = new DiscordAdapter();
		const config = adapter.parseConfig({ source: FIXTURE_PATH });

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}

		const edges = await adapter.extractEdges(chunks);
		const channelEdges = edges.filter((e) => e.targetType === "discord-channel");
		// Golden count: 1 #channel reference in discord-export.json fixture
		expect(channelEdges.length).toBe(1);
		expect(channelEdges[0]?.targetId).toBe("#dev-chat");
	});

	it("extracts Discord message URL cross-references", async () => {
		const adapter = new DiscordAdapter();
		const config = adapter.parseConfig({ source: FIXTURE_PATH });

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}

		const edges = await adapter.extractEdges(chunks);
		const discordMsgEdges = edges.filter((e) => e.targetType === "discord-message");
		// Golden count: 1 Discord message URL in discord-export.json fixture
		expect(discordMsgEdges.length).toBe(1);
		expect(discordMsgEdges[0]?.targetId).toMatch(/^discord:\/\//);
	});
});

describe("DiscordAdapter: sourceType property", () => {
	it("has sourceType of 'discord'", () => {
		const adapter = new DiscordAdapter();
		expect(adapter.sourceType).toBe("discord");
	});
});
