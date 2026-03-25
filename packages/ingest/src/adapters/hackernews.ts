import { createHash } from "node:crypto";
import type { Chunk, Edge, SourceAdapter } from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";
import { RegexEdgeExtractor } from "../edges/extractor.js";

// ─── Algolia Search API response shapes ─────────────────────────────────────

interface AlgoliaHit {
	objectID: string;
	title?: string;
	url?: string;
	story_text?: string;
	comment_text?: string;
	author: string;
	created_at: string;
	story_id?: number;
	parent_id?: number;
	points?: number;
	num_comments?: number;
	_tags?: string[];
}

interface AlgoliaResponse {
	hits: AlgoliaHit[];
	nbPages: number;
	page: number;
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface HackerNewsAdapterConfig {
	/** Search query (e.g., "filecoin", "IPFS storage") */
	query: string;
	/** Max pages to fetch from Algolia (default: 5, ~100 results) */
	maxPages?: number;
	/** Filter by tag: "story", "comment", or both (default: both) */
	tags?: Array<"story" | "comment">;
}

const ALGOLIA_BASE = "https://hn.algolia.com/api/v1";
const DEFAULT_MAX_PAGES = 5;
const RATE_LIMIT_DELAY_MS = 500;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}

function sha256(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

function stripHtml(html: string): string {
	return html
		.replace(/<p>/g, "\n\n")
		.replace(/<br\s*\/?>/g, "\n")
		.replace(/<a\s+href="([^"]*)"[^>]*>[^<]*<\/a>/g, "$1")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&#x2F;/g, "/")
		.trim();
}

// ─── Adapter ────────────────────────────────────────────────────────────────

export class HackerNewsAdapter implements SourceAdapter<HackerNewsAdapterConfig> {
	readonly sourceType = "hackernews";

	parseConfig(raw: Record<string, unknown>): HackerNewsAdapterConfig {
		const source = raw.source;
		if (typeof source !== "string" || !source.trim()) {
			throw new WtfocError(
				"HackerNews adapter requires a search query as the source argument",
				"INVALID_CONFIG",
				{ source },
			);
		}
		return {
			query: source.trim(),
			maxPages: typeof raw.maxPages === "number" ? raw.maxPages : undefined,
			tags: Array.isArray(raw.tags) ? (raw.tags as HackerNewsAdapterConfig["tags"]) : undefined,
		};
	}

	async *ingest(config: HackerNewsAdapterConfig, signal?: AbortSignal): AsyncIterable<Chunk> {
		const maxPages = config.maxPages ?? DEFAULT_MAX_PAGES;
		const tags = config.tags ?? ["story", "comment"];

		for (const tag of tags) {
			yield* this.#searchAndIngest(config.query, tag, maxPages, signal);
		}
	}

	async extractEdges(chunks: Chunk[]): Promise<Edge[]> {
		const extractor = new RegexEdgeExtractor();
		const edges = await extractor.extract(chunks);

		// Add reply-to-parent edges for comments
		for (const chunk of chunks) {
			if (chunk.sourceType === "hn-comment" && chunk.metadata.parentId) {
				edges.push({
					type: "references",
					sourceId: chunk.id,
					targetType: "hn-item",
					targetId: `hn:${chunk.metadata.parentId}`,
					evidence: `reply to hn:${chunk.metadata.parentId}`,
					confidence: 1.0,
				});
			}
		}

		return edges;
	}

	async *#searchAndIngest(
		query: string,
		tag: "story" | "comment",
		maxPages: number,
		signal?: AbortSignal,
	): AsyncIterable<Chunk> {
		for (let page = 0; page < maxPages; page++) {
			signal?.throwIfAborted();

			const url = `${ALGOLIA_BASE}/search?query=${encodeURIComponent(query)}&tags=${tag}&page=${page}&hitsPerPage=20`;

			let data: AlgoliaResponse;
			try {
				const response = await fetch(url, { signal });
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}
				data = (await response.json()) as AlgoliaResponse;
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") throw err;
				throw new WtfocError(
					`HN Algolia API error: ${err instanceof Error ? err.message : String(err)}`,
					"HN_API_ERROR",
					{ query, page, cause: err },
				);
			}

			for (const hit of data.hits) {
				const chunk = tag === "story" ? this.#storyToChunk(hit) : this.#commentToChunk(hit);
				if (chunk) yield chunk;
			}

			// Stop if we've reached the last page
			if (page >= data.nbPages - 1) break;

			// Rate limit courtesy
			if (page < maxPages - 1) {
				await sleep(RATE_LIMIT_DELAY_MS, signal);
			}
		}
	}

	#storyToChunk(hit: AlgoliaHit): Chunk | null {
		const title = hit.title ?? "";
		const body = hit.story_text ? stripHtml(hit.story_text) : "";
		const externalUrl = hit.url ?? "";

		const content = externalUrl
			? `# ${title}\n\n${externalUrl}${body ? `\n\n${body}` : ""}`
			: `# ${title}${body ? `\n\n${body}` : ""}`;

		if (!content.trim()) return null;

		return {
			id: sha256(content),
			content,
			sourceType: "hn-story",
			source: `hn:${hit.objectID}`,
			sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
			timestamp: hit.created_at,
			chunkIndex: 0,
			totalChunks: 1,
			metadata: {
				author: hit.author,
				points: String(hit.points ?? 0),
				numComments: String(hit.num_comments ?? 0),
				...(externalUrl ? { externalUrl } : {}),
				...(hit.story_id ? { storyId: String(hit.story_id) } : {}),
			},
		};
	}

	#commentToChunk(hit: AlgoliaHit): Chunk | null {
		const text = hit.comment_text ? stripHtml(hit.comment_text) : "";
		if (!text.trim()) return null;

		return {
			id: sha256(text),
			content: text,
			sourceType: "hn-comment",
			source: `hn:${hit.objectID}`,
			sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
			timestamp: hit.created_at,
			chunkIndex: 0,
			totalChunks: 1,
			metadata: {
				author: hit.author,
				...(hit.parent_id ? { parentId: String(hit.parent_id) } : {}),
				...(hit.story_id ? { storyId: String(hit.story_id) } : {}),
			},
		};
	}
}
