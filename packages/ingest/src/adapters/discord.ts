import { readFile } from "node:fs/promises";
import type { Chunk, Edge, SourceAdapter } from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";
import { sha256Hex } from "../chunker.js";
import { RegexEdgeExtractor } from "../edges/extractor.js";
import { type ChatGroupingAccessors, groupChatMessages } from "./chat-utils.js";

// ─── DiscordChatExporter JSON shape ──────────────────────────────────────────

interface DceMessage {
	id: string;
	type: string;
	timestamp: string;
	content: string;
	author: { id: string; name: string; discriminator?: string };
}

interface DceExport {
	guild: { id: string; name: string };
	channel: { id: string; name: string; type?: string };
	messages: DceMessage[];
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface DiscordAdapterConfig {
	/** Channel identifier: "server/channel-name" or path to JSON file */
	source: string;
	/** Discord bot token (env: WTFOC_DISCORD_TOKEN) */
	token?: string;
	/** Auto-detected based on source: "json" for .json files, "bot" otherwise */
	mode: "json" | "bot";
	/** ISO date string — only ingest messages after this date */
	since?: string;
	/** Max messages to fetch in bot mode (default: 1000) */
	limit: number;
}

const dceAccessors: ChatGroupingAccessors<DceMessage> = {
	authorId: (m) => m.author.id,
	timestampMs: (m) => new Date(m.timestamp).getTime(),
	text: (m) => m.content,
};

// ─── Discord-specific edge patterns ─────────────────────────────────────────

/** Discord message link: https://discord.com/channels/<server>/<channel>/<message> */
const DISCORD_MSG_URL_PATTERN = /https?:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/g;

/** #channel-name cross-reference */
const CHANNEL_REF_PATTERN = /#([a-z0-9_-]+)/gi;

function getMatchGroup(match: RegExpMatchArray | RegExpExecArray, index: number): string | null {
	return typeof match[index] === "string" ? match[index] : null;
}

/** GitHub issue/PR URL — extracted by RegexEdgeExtractor, listed here for docs */
// const GITHUB_URL_PATTERN = /https?:\/\/github\.com\/.../ — handled by RegexEdgeExtractor

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class DiscordAdapter implements SourceAdapter<DiscordAdapterConfig> {
	readonly sourceType = "discord";

	parseConfig(raw: Record<string, unknown>): DiscordAdapterConfig {
		const source = raw.source;
		if (typeof source !== "string" || source.length === 0) {
			throw new WtfocError(
				"discord source required (path to JSON export or server/channel)",
				"INVALID_CONFIG",
				{ source },
			);
		}

		// Auto-detect mode: if source ends in .json, use json mode
		const mode = source.endsWith(".json") ? "json" : "bot";
		const token = (raw.token as string) ?? process.env.WTFOC_DISCORD_TOKEN;

		if (mode === "bot" && !token) {
			throw new WtfocError(
				"Discord bot token required. Set WTFOC_DISCORD_TOKEN or pass --token",
				"INVALID_CONFIG",
				{ source },
			);
		}

		return {
			source,
			mode,
			token,
			since: typeof raw.since === "string" ? raw.since : undefined,
			limit: typeof raw.limit === "number" ? raw.limit : 1000,
		};
	}

	async *ingest(config: DiscordAdapterConfig, signal?: AbortSignal): AsyncIterable<Chunk> {
		if (config.mode === "json") {
			yield* this.ingestFromJson(config);
		} else {
			yield* this.ingestFromBot(config, signal);
		}
	}

	async extractEdges(chunks: Chunk[]): Promise<Edge[]> {
		// Use the shared RegexEdgeExtractor for GitHub URL / issue references
		const extractor = new RegexEdgeExtractor();
		const edges = await extractor.extract(chunks);

		// Add Discord-specific edges
		for (const chunk of chunks) {
			// Discord message URL cross-references
			for (const match of chunk.content.matchAll(DISCORD_MSG_URL_PATTERN)) {
				edges.push({
					type: "references",
					sourceId: chunk.id,
					targetType: "discord-message",
					targetId: `discord://${match[1]}/${match[2]}/${match[3]}`,
					evidence: match[0],
					confidence: 1.0,
				});
			}

			// #channel cross-references (only for discord-message chunks)
			if (chunk.sourceType === "discord-message") {
				for (const match of chunk.content.matchAll(CHANNEL_REF_PATTERN)) {
					const channelName = getMatchGroup(match, 1);
					if (!channelName) continue;
					// Skip if it looks like a GitHub issue ref (pure digits)
					if (/^\d+$/.test(channelName)) continue;
					edges.push({
						type: "references",
						sourceId: chunk.id,
						targetType: "discord-channel",
						targetId: `#${channelName}`,
						evidence: match[0],
						confidence: 0.8,
					});
				}
			}
		}

		return edges;
	}

	// ─── JSON import mode ────────────────────────────────────────────────────

	private async *ingestFromJson(config: DiscordAdapterConfig): AsyncIterable<Chunk> {
		const raw = await readFile(config.source, "utf-8");
		const data: DceExport = JSON.parse(raw) as DceExport;

		const serverName = data.guild?.name ?? "unknown-server";
		const channelName = data.channel?.name ?? "unknown-channel";
		const serverId = data.guild?.id ?? "0";
		const channelId = data.channel?.id ?? "0";
		const sinceDate = config.since ? new Date(config.since) : undefined;

		// Group consecutive messages from the same author within GROUPING_WINDOW_MS
		const groups = groupChatMessages(data.messages, dceAccessors, sinceDate?.getTime());

		for (const group of groups) {
			const content = group.messages.map((m) => m.content).join("\n");
			if (!content.trim()) continue;

			const firstMsg = group.messages[0];
			const lastMsg = group.messages.at(-1);
			if (!firstMsg || !lastMsg) continue;
			const sourceUrl = `https://discord.com/channels/${serverId}/${channelId}/${firstMsg.id}`;

			const contentFingerprint = sha256Hex(content);
			const documentId = `discord:${channelId}:${firstMsg.id}`;
			const documentVersionId = lastMsg.id;

			yield {
				id: sha256Hex(`${documentVersionId}:0:${content}`),
				content,
				sourceType: "discord-message",
				source: `${serverName}/#${channelName}`,
				sourceUrl,
				timestamp: firstMsg.timestamp,
				chunkIndex: 0,
				totalChunks: 1,
				metadata: {
					author: firstMsg.author.name,
					channel: channelName,
					server: serverName,
					messageId: firstMsg.id,
					lastMessageId: lastMsg.id,
					messageCount: String(group.messages.length),
				},
				documentId,
				documentVersionId,
				contentFingerprint,
			};
		}
	}

	// ─── Bot mode ────────────────────────────────────────────────────────────

	private async *ingestFromBot(
		config: DiscordAdapterConfig,
		signal?: AbortSignal,
	): AsyncIterable<Chunk> {
		// Lazy-import discord.js so JSON mode works even if discord.js has issues
		const { Client, GatewayIntentBits } = await import("discord.js");

		const client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
			],
		});

		try {
			await client.login(config.token);

			// Parse "server/channel-name" or just "channelId"
			const channel = await this.resolveChannel(client, config.source);
			if (!channel || !("messages" in channel)) {
				throw new WtfocError(
					`Could not resolve text channel from source: ${config.source}`,
					"INVALID_CONFIG",
					{ source: config.source },
				);
			}

			const textChannel = channel as import("discord.js").TextChannel;
			const guild = textChannel.guild;
			const serverName = guild?.name ?? "unknown-server";
			const channelName = textChannel.name ?? "unknown-channel";
			const serverId = guild?.id ?? "0";
			const channelId = textChannel.id;
			const sinceDate = config.since ? new Date(config.since) : undefined;

			const allMessages: DceMessage[] = [];
			let lastId: string | undefined;
			let fetched = 0;

			while (fetched < config.limit) {
				signal?.throwIfAborted();
				const batchSize = Math.min(100, config.limit - fetched);
				const options: { limit: number; before?: string } = { limit: batchSize };
				if (lastId) options.before = lastId;

				const batch = await textChannel.messages.fetch(options);
				if (batch.size === 0) break;

				for (const msg of batch.values()) {
					const msgDate = new Date(msg.createdTimestamp);
					if (sinceDate && msgDate < sinceDate) {
						// We've gone past the since boundary — stop
						fetched = config.limit; // break outer loop
						break;
					}

					allMessages.push({
						id: msg.id,
						type: "Default",
						timestamp: msg.createdAt.toISOString(),
						content: msg.content,
						author: {
							id: msg.author.id,
							name: msg.author.username,
						},
					});
					fetched++;
				}

				lastId = batch.last()?.id;
			}

			// Messages come newest-first from Discord API — reverse for chronological order
			allMessages.reverse();

			const groups = groupChatMessages(allMessages, dceAccessors);

			for (const group of groups) {
				const content = group.messages.map((m) => m.content).join("\n");
				if (!content.trim()) continue;

				const firstMsg = group.messages[0];
				const lastMsg = group.messages.at(-1);
				if (!firstMsg || !lastMsg) continue;
				const sourceUrl = `https://discord.com/channels/${serverId}/${channelId}/${firstMsg.id}`;

				const contentFingerprint = sha256Hex(content);
				const documentId = `discord:${channelId}:${firstMsg.id}`;
				const documentVersionId = lastMsg.id;

				yield {
					id: sha256Hex(`${documentVersionId}:0:${content}`),
					content,
					sourceType: "discord-message",
					source: `${serverName}/#${channelName}`,
					sourceUrl,
					timestamp: firstMsg.timestamp,
					chunkIndex: 0,
					totalChunks: 1,
					metadata: {
						author: firstMsg.author.name,
						channel: channelName,
						server: serverName,
						messageId: firstMsg.id,
						lastMessageId: lastMsg.id,
						messageCount: String(group.messages.length),
					},
					documentId,
					documentVersionId,
					contentFingerprint,
				};
			}
		} finally {
			client.destroy();
		}
	}

	private async resolveChannel(
		client: import("discord.js").Client,
		source: string,
	): Promise<import("discord.js").Channel | null> {
		// Try "server/channel-name" format
		if (source.includes("/")) {
			const [serverName, channelName] = source.split("/", 2);
			if (!serverName || !channelName) return null;
			const guild = client.guilds.cache.find(
				(g) => g.name.toLowerCase() === serverName.toLowerCase(),
			);
			if (guild) {
				const channel = guild.channels.cache.find(
					(c) => c.name.toLowerCase() === channelName.toLowerCase(),
				);
				if (channel) return channel;
			}
		}

		// Try as a raw channel ID
		try {
			return await client.channels.fetch(source);
		} catch {
			return null;
		}
	}
}
