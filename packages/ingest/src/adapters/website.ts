import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Chunk, Edge, SourceAdapter } from "@wtfoc/common";
import { CheerioCrawler, Configuration } from "crawlee";
import TurndownService from "turndown";
import { chunkMarkdown, sha256Hex } from "../chunker.js";

/**
 * Canonical `chunk.source` for a website document (#257).
 *
 * Two crawled domains (e.g. `filecoin.io` and `docs.filecoin.io`) can share
 * identical paths; using only pathname as the source string collapsed both
 * sites into the same edge-resolution bucket. Including the host prevents
 * that while staying URL-ish and human-readable.
 *
 * Rules:
 *   - lowercase the host (authority is case-insensitive per RFC 3986)
 *   - preserve pathname case (paths are case-sensitive)
 *   - drop query and fragment (not part of page identity for retrieval)
 */
export function deriveSourceFromUrl(url: string): string {
	const parsed = new URL(url);
	return `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
}

/**
 * Tags whose entire subtree is stripped before HTML → markdown conversion.
 * Conservative first pass at #257: no role/class-based heuristics yet, just
 * the obvious structural-chrome tags every modern site has. Expanding this
 * list further risks stripping meaningful content on docs sites that abuse
 * `<aside>` for callouts — better to grow the set once we have dogfood data.
 */
const BOILERPLATE_TAGS = ["nav", "footer", "aside", "script", "style", "noscript"] as const;

/**
 * Remove boilerplate tag subtrees from an HTML string using a tolerant regex.
 * Not a full parser — intentionally conservative and string-based so the
 * ingest path doesn't grow a new dependency. Handles nested attributes,
 * mixed case, and repeated blocks. Does NOT handle deeply nested instances
 * of the same boilerplate tag inside itself (rare in practice).
 */
export function stripBoilerplateHtml(html: string): string {
	let out = html;
	for (const tag of BOILERPLATE_TAGS) {
		// Non-greedy match from opening tag (with optional attributes) through closing tag.
		const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "gi");
		out = out.replace(re, "");
	}
	return out;
}

export interface WebsiteAdapterConfig {
	/** The URL to crawl (e.g., "https://docs.filecoin.io") */
	source: string;
	/** Max pages to crawl (default: 100) */
	maxPages?: number;
	/** Max link-following depth from the start URL (default: unlimited) */
	depth?: number;
	/** Glob pattern to stay within (e.g., "https://docs.filecoin.io/**") */
	urlPattern?: string;
	/** Suppress progress logging (default: false) */
	quiet?: boolean;
}

function isFiniteInt(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v);
}

function isNonNegativeInt(v: unknown): v is number {
	return isFiniteInt(v) && v >= 0;
}

interface CrawledPage {
	url: string;
	title: string;
	markdown: string;
}

/**
 * Website source adapter. Crawls a website using CheerioCrawler (lightweight,
 * no browser binary needed) and converts HTML to markdown via turndown.
 *
 * sourceType on chunks: "doc-page"
 */
export class WebsiteAdapter implements SourceAdapter<WebsiteAdapterConfig> {
	readonly sourceType = "website";

	parseConfig(raw: Record<string, unknown>): WebsiteAdapterConfig {
		const source = raw.source;
		if (typeof source !== "string" || !source.startsWith("http")) {
			throw new Error("website adapter requires a source URL (e.g., https://docs.filecoin.io)");
		}
		return {
			source,
			maxPages: isFiniteInt(raw.maxPages) ? raw.maxPages : 100,
			depth: isNonNegativeInt(raw.depth) ? raw.depth : undefined,
			urlPattern: typeof raw.urlPattern === "string" ? raw.urlPattern : undefined,
			quiet: raw.quiet === true,
		};
	}

	async *ingest(config: WebsiteAdapterConfig, signal?: AbortSignal): AsyncIterable<Chunk> {
		const pages = await this.#crawl(config, signal);

		for (const page of pages) {
			if (!page.markdown.trim()) continue;

			const documentId = page.url;
			const documentVersionId = sha256Hex(page.markdown);

			const chunks = chunkMarkdown(page.markdown, {
				source: deriveSourceFromUrl(page.url),
				sourceUrl: page.url,
				metadata: {
					url: page.url,
					title: page.title,
				},
				documentId,
				documentVersionId,
			});

			for (const chunk of chunks) {
				yield {
					...chunk,
					sourceType: "doc-page",
				};
			}
		}
	}

	async extractEdges(chunks: Chunk[]): Promise<Edge[]> {
		const edges: Edge[] = [];

		for (const chunk of chunks) {
			// Extract markdown link references
			const mdLinks = chunk.content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
			for (const match of mdLinks) {
				const url = match[2] ?? "";
				if (url.startsWith("http")) {
					edges.push({
						type: "references",
						sourceId: chunk.id,
						targetType: "url",
						targetId: url,
						evidence: `[${match[1]}](${url})`,
						confidence: 1.0,
					});
				}
			}

			// Extract GitHub issue/PR URL references
			const ghUrls = chunk.content.matchAll(
				/https?:\/\/github\.com\/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)\/(?:issues|pull)\/(\d+)/g,
			);
			for (const match of ghUrls) {
				edges.push({
					type: "references",
					sourceId: chunk.id,
					targetType: "issue",
					targetId: `${match[1]}#${match[2]}`,
					evidence: match[0],
					confidence: 1.0,
				});
			}
		}

		return edges;
	}

	async #crawl(config: WebsiteAdapterConfig, signal?: AbortSignal): Promise<CrawledPage[]> {
		const pages: CrawledPage[] = [];
		const turndown = new TurndownService({
			headingStyle: "atx",
			codeBlockStyle: "fenced",
		});

		// maxPages < 0 means unlimited (crawl everything within the url pattern)
		const maxPages = config.maxPages ?? 100;
		const unlimited = maxPages < 0;
		const crawleeMaxRequests = unlimited ? undefined : maxPages;

		// Use a temp directory for crawlee storage and clean up after
		const storageDir = await mkdtemp(join(tmpdir(), "wtfoc-crawl-"));

		try {
			const crawleeConfig = new Configuration({
				persistStorage: false,
				storageClientOptions: {
					localDataDirectory: storageDir,
				},
			});

			const origin = new URL(config.source).origin;
			const defaultGlob = `${origin}/**`;

			const crawler = new CheerioCrawler(
				{
					maxRequestsPerCrawl: crawleeMaxRequests,
					async requestHandler({ request, $, enqueueLinks }) {
						signal?.throwIfAborted();

						const title = $("title").text().trim();

						// Extract main content — try common selectors first
						const rawContent =
							$("main").html() ??
							$("article").html() ??
							$("[role='main']").html() ??
							$("body").html() ??
							"";

						// Strip nav/footer/aside/script/style before markdown conversion
						// so boilerplate doesn't pollute retrieval (#257).
						const content = stripBoilerplateHtml(rawContent);

						const markdown = turndown.turndown(content);
						pages.push({ url: request.url, title, markdown });

						// Progress reporting
						if (!config.quiet && (pages.length % 10 === 0 || pages.length === 1)) {
							const depthInfo =
								config.depth != null ? ` (depth ${request.crawlDepth}/${config.depth})` : "";
							const limitInfo = unlimited ? "" : `/${maxPages}`;
							console.error(`   Crawled ${pages.length}${limitInfo} pages${depthInfo}...`);
						}

						// Only follow links if we haven't exceeded the depth limit
						if (config.depth == null || request.crawlDepth < config.depth) {
							await enqueueLinks({
								globs: [config.urlPattern ?? defaultGlob],
							});
						}
					},
				},
				crawleeConfig,
			);

			await crawler.run([config.source]);

			// Summary message
			if (!config.quiet) {
				const hitLimit = !unlimited && pages.length >= maxPages;
				if (hitLimit) {
					console.error(
						`   ⚠️  Stopped at --max-pages limit (${maxPages}). Increase with --max-pages or use --max-pages -1 for unlimited.`,
					);
				} else {
					console.error(`   Crawled ${pages.length} pages total.`);
				}
			}
		} finally {
			// Clean up temp storage
			await rm(storageDir, { recursive: true, force: true }).catch(() => {});
		}

		return pages;
	}
}
