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

/** Word-count for a w-word shingle window. */
const SHINGLE_SIZE = 5;
/** Minimum batch size before dedup is meaningful. */
const MIN_BATCH_SIZE = 3;
/**
 * A shingle is "common" if it appears in at least this fraction of chunks.
 * 0.6 = shared by >= 60% of the batch. Set high enough that page-unique
 * sentences don't get flagged across similar pages.
 */
const COMMON_SHINGLE_THRESHOLD = 0.6;
/**
 * A chunk is "boilerplate" when this fraction of its shingles are common
 * across the batch. 0.6 = more than half of the chunk's content is shared
 * chrome. Tight enough to avoid false positives on legitimately similar
 * pages while still catching nav-dominated chunks.
 */
const CHUNK_BOILERPLATE_THRESHOLD = 0.6;

/**
 * Tokenize content into simple lowercase words for shingling. Deliberately
 * minimal — strips markdown link targets and URLs so shared link lists don't
 * dominate the shingle set (link TEXT still counts, just not the URLs).
 */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/\]\([^)]+\)/g, "]") // strip `(url)` parts of markdown links
		.replace(/https?:\/\/\S+/g, "") // strip bare URLs
		.split(/\W+/)
		.filter((t) => t.length > 0);
}

function shinglesOf(content: string): Set<string> {
	const tokens = tokenize(content);
	if (tokens.length < SHINGLE_SIZE) return new Set();
	const shingles = new Set<string>();
	for (let i = 0; i <= tokens.length - SHINGLE_SIZE; i++) {
		shingles.add(tokens.slice(i, i + SHINGLE_SIZE).join(" "));
	}
	return shingles;
}

/**
 * Identify chunk indices whose content is mostly boilerplate shared with
 * other chunks in the batch. Two-pass:
 *   1. Build a frequency map of all w-word shingles across the batch.
 *   2. For each chunk, compute the fraction of its shingles that are
 *      "common" (appear in >= COMMON_SHINGLE_THRESHOLD of the batch).
 *      If that fraction > CHUNK_BOILERPLATE_THRESHOLD, flag it.
 *
 * Returns a Set of indices; the caller is expected to exclude those chunks
 * from ingestion. Batches smaller than MIN_BATCH_SIZE get no flags (not
 * enough data to decide what's boilerplate vs unique content).
 */
export function findBoilerplateChunks(contents: string[]): Set<number> {
	const out = new Set<number>();
	if (contents.length < MIN_BATCH_SIZE) return out;

	const shinglesPerChunk = contents.map(shinglesOf);

	// Count how many chunks each shingle appears in (chunk-frequency).
	const shingleChunkCount = new Map<string, number>();
	for (const shingles of shinglesPerChunk) {
		for (const s of shingles) {
			shingleChunkCount.set(s, (shingleChunkCount.get(s) ?? 0) + 1);
		}
	}

	const commonThresholdCount = Math.ceil(contents.length * COMMON_SHINGLE_THRESHOLD);

	for (let i = 0; i < shinglesPerChunk.length; i++) {
		const shingles = shinglesPerChunk[i] as Set<string>;
		if (shingles.size === 0) continue;
		let commonCount = 0;
		for (const s of shingles) {
			if ((shingleChunkCount.get(s) ?? 0) >= commonThresholdCount) commonCount++;
		}
		if (commonCount / shingles.size > CHUNK_BOILERPLATE_THRESHOLD) {
			out.add(i);
		}
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

		// Pre-compute all chunks for all pages so we can shingle-dedup across
		// the entire crawl before yielding (#257 Phase C(c)). This memory-bound
		// buffer is fine for typical crawls (a few thousand chunks); oversized
		// crawls should switch to a streaming variant.
		type PreparedChunk = {
			chunk: ReturnType<typeof chunkMarkdown>[number];
			pageUrl: string;
		};
		const prepared: PreparedChunk[] = [];
		for (const page of pages) {
			if (!page.markdown.trim()) continue;
			const documentId = page.url;
			const documentVersionId = sha256Hex(page.markdown);
			const pageChunks = chunkMarkdown(page.markdown, {
				source: deriveSourceFromUrl(page.url),
				sourceUrl: page.url,
				metadata: {
					url: page.url,
					title: page.title,
				},
				documentId,
				documentVersionId,
			});
			for (const chunk of pageChunks) {
				prepared.push({ chunk, pageUrl: page.url });
			}
		}

		// Find chunks that are mostly shared boilerplate across the crawl —
		// typically nav/footer remnants that survived HTML stripping because
		// they're rendered as text rather than inside a `<nav>` tag.
		const boilerplateIndices = findBoilerplateChunks(prepared.map((p) => p.chunk.content));
		if (boilerplateIndices.size > 0 && !config.quiet) {
			console.error(
				`   ⊘ dropping ${boilerplateIndices.size} boilerplate chunk(s) (shared across crawl)`,
			);
		}

		for (let i = 0; i < prepared.length; i++) {
			if (boilerplateIndices.has(i)) continue;
			const entry = prepared[i] as PreparedChunk;
			yield {
				...entry.chunk,
				sourceType: "doc-page",
			};
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
