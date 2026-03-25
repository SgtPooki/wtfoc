import { createHash } from "node:crypto";
import type { Chunk, Edge, SourceAdapter } from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";
import { RegexEdgeExtractor } from "../edges/extractor.js";
import { type ChatGroupingAccessors, groupChatMessages } from "./chat-utils.js";

// ─── Slack API response shapes ──────────────────────────────────────────────

interface SlackMessage {
	type: string;
	ts: string;
	user?: string;
	text: string;
	thread_ts?: string;
	reply_count?: number;
}

interface SlackChannel {
	id: string;
	name: string;
	is_member: boolean;
}

interface SlackUser {
	id: string;
	name: string;
	real_name?: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface SlackAdapterConfig {
	/** Channel name (e.g. "foc-support") or channel ID */
	source: string;
	/** Slack bot token (env: SLACK_BOT_TOKEN) */
	token: string;
	/** ISO date string — only ingest messages after this date */
	since?: string;
	/** Max messages to fetch (default: 1000) */
	limit: number;
}

// ─── Slack-specific edge patterns ───────────────────────────────────────────

/** Slack channel reference: <#C1234|channel-name> or #channel-name */
const SLACK_CHANNEL_REF_PATTERN = /(?:<#(C[A-Z0-9]+)\|([a-z0-9_-]+)>|#([a-z0-9_-]+))/g;

/** Slack message permalink pattern */
const SLACK_MSG_URL_PATTERN =
	/https?:\/\/([a-z0-9-]+)\.slack\.com\/archives\/(C[A-Z0-9]+)\/p(\d+)/g;

// ─── Adapter ────────────────────────────────────────────────────────────────

export class SlackAdapter implements SourceAdapter<SlackAdapterConfig> {
	readonly sourceType = "slack";

	parseConfig(raw: Record<string, unknown>): SlackAdapterConfig {
		const source = raw.source;
		if (typeof source !== "string" || source.length === 0) {
			throw new WtfocError("slack source required (channel name or channel ID)", "INVALID_CONFIG", {
				source,
			});
		}

		const rawToken = raw.token;
		const token =
			(typeof rawToken === "string" ? rawToken : undefined) ?? process.env.SLACK_BOT_TOKEN;
		if (!token) {
			throw new WtfocError(
				"Slack bot token required. Set SLACK_BOT_TOKEN or pass --token",
				"INVALID_CONFIG",
				{ source },
			);
		}

		return {
			source,
			token,
			since: typeof raw.since === "string" ? raw.since : undefined,
			limit: typeof raw.limit === "number" ? raw.limit : 1000,
		};
	}

	async *ingest(config: SlackAdapterConfig, signal?: AbortSignal): AsyncIterable<Chunk> {
		const channelId = await this.resolveChannel(config.source, config.token, signal);
		const channelName = /^C[A-Z0-9]+$/.test(config.source)
			? await this.getChannelName(channelId, config.token, signal)
			: config.source.replace(/^#/, "");

		// Fetch user cache for resolving display names
		const userCache = new Map<string, string>();

		const sinceTs = config.since ? String(new Date(config.since).getTime() / 1000) : undefined;
		const allMessages: Array<SlackMessage & { authorName: string }> = [];
		let cursor: string | undefined;
		let fetched = 0;

		while (fetched < config.limit) {
			signal?.throwIfAborted();

			const params = new URLSearchParams({
				channel: channelId,
				limit: String(Math.min(200, config.limit - fetched)),
			});
			if (cursor) params.set("cursor", cursor);
			if (sinceTs) params.set("oldest", sinceTs);

			const resp = await this.slackApi("conversations.history", params, config.token, signal);

			const messages = (resp.messages ?? []) as SlackMessage[];
			if (messages.length === 0) break;

			for (const msg of messages) {
				if (fetched >= config.limit) break;
				if (msg.type !== "message" || !msg.text?.trim()) continue;

				// Resolve author name
				const userId = msg.user ?? "unknown";
				if (userId !== "unknown" && !userCache.has(userId)) {
					const name = await this.resolveUser(userId, config.token, signal);
					userCache.set(userId, name);
				}

				allMessages.push({
					...msg,
					authorName: userCache.get(userId) ?? userId,
				});
				fetched++;
			}

			cursor = (resp.response_metadata as Record<string, string> | undefined)?.next_cursor;
			if (!cursor) break;
		}

		// Slack returns newest first — reverse for chronological
		allMessages.reverse();

		// Group consecutive messages from same author within window
		const slackAccessors: ChatGroupingAccessors<SlackMessage & { authorName: string }> = {
			authorId: (m) => m.user ?? "unknown",
			timestampMs: (m) => Number.parseFloat(m.ts) * 1000,
			text: (m) => m.text,
		};
		const groups = groupChatMessages(allMessages, slackAccessors);

		for (const group of groups) {
			const content = group.messages.map((m) => m.text).join("\n");
			if (!content.trim()) continue;

			const firstMsg = group.messages[0];
			const lastMsg = group.messages[group.messages.length - 1];
			if (!firstMsg || !lastMsg) continue;

			yield {
				id: createHash("sha256").update(content).digest("hex"),
				content,
				sourceType: "slack-message",
				source: `#${channelName}`,
				sourceUrl: `https://slack.com/archives/${channelId}/p${firstMsg.ts.replace(".", "")}`,
				timestamp: new Date(Number.parseFloat(firstMsg.ts) * 1000).toISOString(),
				chunkIndex: 0,
				totalChunks: 1,
				metadata: {
					author: firstMsg.authorName,
					channel: channelName,
					channelId,
					messageTs: firstMsg.ts,
					lastMessageTs: lastMsg.ts,
					messageCount: String(group.messages.length),
				},
			};
		}
	}

	async extractEdges(chunks: Chunk[]): Promise<Edge[]> {
		// Use shared RegexEdgeExtractor for GitHub URL / issue references
		const extractor = new RegexEdgeExtractor();
		const edges = await extractor.extract(chunks);

		// Add Slack-specific edges
		for (const chunk of chunks) {
			// Slack channel cross-references
			for (const match of chunk.content.matchAll(SLACK_CHANNEL_REF_PATTERN)) {
				const channelName = match[2] ?? match[3];
				if (!channelName) continue;
				// Skip if it looks like a GitHub issue ref (pure digits)
				if (/^\d+$/.test(channelName)) continue;
				edges.push({
					type: "references",
					sourceId: chunk.id,
					targetType: "slack-channel",
					targetId: match[1] ? `slack://${match[1]}` : `#${channelName}`,
					evidence: match[0],
					confidence: 1.0,
				});
			}

			// Slack message permalink cross-references
			for (const match of chunk.content.matchAll(SLACK_MSG_URL_PATTERN)) {
				edges.push({
					type: "references",
					sourceId: chunk.id,
					targetType: "slack-message",
					targetId: `slack://${match[2]}/p${match[3]}`,
					evidence: match[0],
					confidence: 1.0,
				});
			}
		}

		return edges;
	}

	// ─── Slack API helpers ──────────────────────────────────────────────────

	private async slackApi(
		method: string,
		params: URLSearchParams,
		token: string,
		signal?: AbortSignal,
	): Promise<Record<string, unknown>> {
		const url = `https://slack.com/api/${method}?${params.toString()}`;

		for (let attempt = 0; attempt < 3; attempt++) {
			signal?.throwIfAborted();

			const resp = await fetch(url, {
				headers: { Authorization: `Bearer ${token}` },
				signal,
			});

			// Retry on rate limit with Retry-After header
			if (resp.status === 429) {
				const retryAfter = Number(resp.headers.get("Retry-After") ?? "1");
				await new Promise((r) => setTimeout(r, retryAfter * 1000));
				continue;
			}

			if (!resp.ok) {
				throw new WtfocError(`Slack API ${method} failed: ${resp.status}`, "ADAPTER_ERROR", {
					method,
					status: String(resp.status),
				});
			}

			// biome-ignore lint/suspicious/noExplicitAny: Slack API returns dynamic shapes
			const data = (await resp.json()) as any;
			if (!data.ok) {
				throw new WtfocError(`Slack API ${method} error: ${data.error}`, "ADAPTER_ERROR", {
					method,
					error: data.error,
				});
			}

			return data;
		}

		throw new WtfocError(`Slack API ${method} rate limited after 3 retries`, "ADAPTER_ERROR", {
			method,
		});
	}

	private async resolveChannel(
		source: string,
		token: string,
		signal?: AbortSignal,
	): Promise<string> {
		// If it looks like a channel ID, use it directly
		if (/^C[A-Z0-9]+$/.test(source)) return source;

		// Strip leading # if present
		const channelName = source.replace(/^#/, "").toLowerCase();

		// List channels to find by name
		let cursor: string | undefined;
		do {
			const params = new URLSearchParams({ limit: "200", types: "public_channel" });
			if (cursor) params.set("cursor", cursor);

			const resp = await this.slackApi("conversations.list", params, token, signal);
			const channels = (resp.channels ?? []) as SlackChannel[];

			for (const ch of channels) {
				if (ch.name.toLowerCase() === channelName) return ch.id;
			}

			cursor = (resp.response_metadata as Record<string, string> | undefined)?.next_cursor;
		} while (cursor);

		throw new WtfocError(`Could not find Slack channel: ${source}`, "INVALID_CONFIG", {
			source,
		});
	}

	private async getChannelName(
		channelId: string,
		token: string,
		signal?: AbortSignal,
	): Promise<string> {
		const params = new URLSearchParams({ channel: channelId });
		const resp = await this.slackApi("conversations.info", params, token, signal);
		return (resp.channel as SlackChannel | undefined)?.name ?? channelId;
	}

	private async resolveUser(userId: string, token: string, signal?: AbortSignal): Promise<string> {
		try {
			const params = new URLSearchParams({ user: userId });
			const resp = await this.slackApi("users.info", params, token, signal);
			const user = resp.user as SlackUser | undefined;
			return user?.real_name ?? user?.name ?? userId;
		} catch {
			return userId;
		}
	}
}
