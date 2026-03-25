import type { Chunk, Edge, EdgeExtractor } from "@wtfoc/common";

const SLACK_PERMALINK_PATTERN =
	/https?:\/\/([a-zA-Z0-9-]+)\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)/g;

const JIRA_KEY_PATTERN = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g;

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

/**
 * Known non-Jira uppercase patterns that look like Jira keys but aren't.
 * Expand as needed to reduce false positives.
 */
const JIRA_FALSE_POSITIVES = new Set([
	"UTF-8",
	"SHA-256",
	"SHA-512",
	"ISO-8601",
	"HTTP-1",
	"HTTP-2",
	"TCP-IP",
	"BASE-64",
	"JSON-LD",
	"ECMA-262",
	"RFC-2119",
	"ES-2015",
	"ES-2020",
	"US-ASCII",
]);

/**
 * Heuristic edge extractor for non-GitHub link patterns.
 *
 * Detects:
 * - Slack message permalinks (slack.com/archives/...)
 * - Jira ticket keys (PROJ-123)
 * - Markdown hyperlinks ([text](url))
 *
 * Confidence: 0.8-0.9 (heuristic structural match)
 */
export class HeuristicEdgeExtractor implements EdgeExtractor {
	async extract(chunks: Chunk[], signal?: AbortSignal): Promise<Edge[]> {
		signal?.throwIfAborted();

		const edges: Edge[] = [];
		for (const chunk of chunks) {
			signal?.throwIfAborted();
			edges.push(...this.#extractSlackPermalinks(chunk));
			edges.push(...this.#extractJiraKeys(chunk));
			edges.push(...this.#extractMarkdownLinks(chunk));
		}
		return edges;
	}

	#extractSlackPermalinks(chunk: Chunk): Edge[] {
		const edges: Edge[] = [];
		for (const match of chunk.content.matchAll(SLACK_PERMALINK_PATTERN)) {
			const workspace = match[1];
			const channelId = match[2];
			const timestamp = match[3];
			if (!workspace || !channelId || !timestamp) continue;

			edges.push({
				type: "references",
				sourceId: chunk.id,
				targetType: "slack-message",
				targetId: `${workspace}/${channelId}/p${timestamp}`,
				evidence: match[0],
				confidence: 0.85,
			});
		}
		return edges;
	}

	#extractJiraKeys(chunk: Chunk): Edge[] {
		const edges: Edge[] = [];
		const seen = new Set<string>();

		for (const match of chunk.content.matchAll(JIRA_KEY_PATTERN)) {
			const key = match[0];
			if (!key) continue;
			if (JIRA_FALSE_POSITIVES.has(key)) continue;
			if (seen.has(key)) continue;
			seen.add(key);

			edges.push({
				type: "references",
				sourceId: chunk.id,
				targetType: "jira-ticket",
				targetId: key,
				evidence: key,
				confidence: 0.85,
			});
		}
		return edges;
	}

	#extractMarkdownLinks(chunk: Chunk): Edge[] {
		const edges: Edge[] = [];
		const seen = new Set<string>();

		for (const match of chunk.content.matchAll(MARKDOWN_LINK_PATTERN)) {
			const text = match[1];
			const url = match[2];
			if (!url) continue;
			if (seen.has(url)) continue;
			seen.add(url);

			// Skip GitHub URLs — regex extractor handles those
			if (url.includes("github.com")) continue;

			edges.push({
				type: "references",
				sourceId: chunk.id,
				targetType: "url",
				targetId: url,
				evidence: text ? `[${text}](${url})` : url,
				confidence: 0.8,
			});
		}
		return edges;
	}
}
