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
 * Minimum content length (chars) for a web chunk to be a credible edge source (#257).
 * Chunks below this are typically nav/footer remnants, breadcrumbs, or menu lists
 * that produce low-signal "references" edges that just pollute trace. 100 chars is
 * intentionally conservative — a single meaningful sentence is typically >= 60 chars
 * and a useful paragraph is >= 200.
 */
const MIN_WEB_CHUNK_CHARS = 100;

/**
 * Upper bound on link-density (links ÷ non-link-text ratio approximation).
 * Chunks above this threshold are almost always navigation lists, TOCs, or
 * link farms — not prose worth extracting edges from.
 */
const MAX_LINK_DENSITY = 0.5;

/**
 * Heuristic: is this web chunk too low-signal to be a credible edge source?
 *
 * A chunk is flagged when EITHER:
 *   - content length is below `MIN_WEB_CHUNK_CHARS`, OR
 *   - link density (total chars inside `[text](url)` tokens / total chars) is
 *     above `MAX_LINK_DENSITY`.
 *
 * Used by `extractEdges` to skip edge emission from pages like nav/footer
 * remnants, breadcrumb strips, and TOC pages. Orthogonal to `#257` chunking
 * — we keep the chunk in the index (it may still help retrieval), we just
 * don't let it pollute the edge graph.
 */
export function isLowQualityWebChunk(content: string): boolean {
	const trimmed = content.trim();
	if (trimmed.length < MIN_WEB_CHUNK_CHARS) return true;

	// Approximate link density: total chars inside markdown link tokens
	// `[text](url)` divided by total chunk chars. Not perfect (doesn't
	// handle bare URLs or HTML links), but cheap and directional.
	const linkMatches = trimmed.matchAll(/\[([^\]]+)\]\([^)]+\)/g);
	let linkChars = 0;
	for (const m of linkMatches) linkChars += m[0].length;
	const density = linkChars / trimmed.length;
	return density > MAX_LINK_DENSITY;
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

/**
 * True when `url`'s pathname contains any of the given deny patterns (#257).
 *
 * Used to skip crawling categories that reliably produce low-signal content
 * (marketing blog, tag/archive pages, legal, search results). Simple
 * substring match on the pathname — not a regex or glob, so callers can
 * pass intuitive values like `/blog`, `/tag/`, `/legal/privacy`.
 *
 * Only pathname is matched — hostname is not consulted. Matching is
 * case-sensitive per RFC 3986 (paths are case-sensitive; authority is not).
 */
export function isPathDenied(url: string, patterns?: string[]): boolean {
	if (!patterns || patterns.length === 0) return false;
	try {
		const path = new URL(url).pathname;
		return patterns.some((p) => path.includes(p));
	} catch {
		return false;
	}
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
	/**
	 * Path substrings that skip a URL from being processed (#257).
	 * Matches any pattern (logical OR). Case-sensitive on the URL pathname.
	 * Example: ["/blog", "/tag/", "/archive", "/legal"] — excludes marketing
	 * blog, tag aggregation pages, archive listings, and legal pages.
	 */
	denyPathPatterns?: string[];
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
			denyPathPatterns: Array.isArray(raw.denyPathPatterns)
				? raw.denyPathPatterns.filter((p): p is string => typeof p === "string")
				: undefined,
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
			// Skip edge extraction from low-signal web chunks (nav/footer remnants,
			// TOC pages, link farms). Keeps the chunk searchable but prevents it
			// from polluting the edge graph. (#257 web-edge suppression)
			if (isLowQualityWebChunk(chunk.content)) continue;

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

						// Skip URLs whose path matches a deny pattern (#257). Applied
						// here (not just at enqueue time) so the seed URL itself is
						// also respected.
						if (isPathDenied(request.url, config.denyPathPatterns)) {
							if (!config.quiet) {
								console.error(`   ⊘ skipped (deny pattern): ${request.url}`);
							}
							return;
						}

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
