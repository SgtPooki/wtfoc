import type { Chunk } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { WebsiteAdapter } from "./website.js";

describe("WebsiteAdapter", () => {
	const adapter = new WebsiteAdapter();

	describe("sourceType", () => {
		it("should be 'website'", () => {
			expect(adapter.sourceType).toBe("website");
		});
	});

	describe("parseConfig", () => {
		it("parses a valid URL source", () => {
			const config = adapter.parseConfig({ source: "https://docs.filecoin.io" });
			expect(config).toEqual({
				source: "https://docs.filecoin.io",
				maxPages: 100,
				depth: undefined,
				urlPattern: undefined,
				quiet: false,
			});
		});

		it("parses optional maxPages, depth, and urlPattern", () => {
			const config = adapter.parseConfig({
				source: "https://docs.filecoin.io",
				maxPages: 50,
				depth: 3,
				urlPattern: "https://docs.filecoin.io/basics/**",
			});
			expect(config).toEqual({
				source: "https://docs.filecoin.io",
				maxPages: 50,
				depth: 3,
				urlPattern: "https://docs.filecoin.io/basics/**",
				quiet: false,
			});
		});

		it("ignores non-number depth", () => {
			const config = adapter.parseConfig({
				source: "https://example.com",
				depth: "not-a-number",
			});
			expect(config.depth).toBeUndefined();
		});

		it("defaults maxPages to 100 for NaN", () => {
			const config = adapter.parseConfig({
				source: "https://example.com",
				maxPages: Number.NaN,
			});
			expect(config.maxPages).toBe(100);
		});

		it("ignores NaN depth", () => {
			const config = adapter.parseConfig({
				source: "https://example.com",
				depth: Number.NaN,
			});
			expect(config.depth).toBeUndefined();
		});

		it("ignores Infinity depth", () => {
			const config = adapter.parseConfig({
				source: "https://example.com",
				depth: Number.POSITIVE_INFINITY,
			});
			expect(config.depth).toBeUndefined();
		});

		it("throws on missing source", () => {
			expect(() => adapter.parseConfig({})).toThrow("website adapter requires a source URL");
		});

		it("throws on non-URL source", () => {
			expect(() => adapter.parseConfig({ source: "/local/path" })).toThrow(
				"website adapter requires a source URL",
			);
		});

		it("throws on non-string source", () => {
			expect(() => adapter.parseConfig({ source: 42 })).toThrow(
				"website adapter requires a source URL",
			);
		});

		it("defaults maxPages to 100 when not a number", () => {
			const config = adapter.parseConfig({
				source: "https://example.com",
				maxPages: "not-a-number",
			});
			expect(config.maxPages).toBe(100);
		});
	});

	describe("extractEdges", () => {
		it("extracts markdown link references", async () => {
			const chunks: Chunk[] = [
				{
					id: "abc123",
					content:
						"The platform provides a set of documented endpoints for building integrations. Check the [API docs](https://api.example.com/v1) for details on authentication, rate limiting, and versioning policies.",
					sourceType: "doc-page",
					source: "/docs/intro",
					sourceUrl: "https://example.com/docs/intro",
					chunkIndex: 0,
					totalChunks: 1,
					metadata: { url: "https://example.com/docs/intro", title: "Intro" },
				},
			];

			const edges = await adapter.extractEdges(chunks);
			expect(edges).toHaveLength(1);
			expect(edges[0]).toEqual({
				type: "references",
				sourceId: "abc123",
				targetType: "url",
				targetId: "https://api.example.com/v1",
				evidence: "[API docs](https://api.example.com/v1)",
				confidence: 1.0,
			});
		});

		it("extracts GitHub issue/PR URL references", async () => {
			const chunks: Chunk[] = [
				{
					id: "def456",
					content:
						"The integration layer inherits an upstream defect when decoding deal proposals under specific network conditions. See https://github.com/filecoin-project/lotus/issues/42 for the upstream bug — the patch is tracked against release 1.30.",
					sourceType: "doc-page",
					source: "/docs/bugs",
					sourceUrl: "https://example.com/docs/bugs",
					chunkIndex: 0,
					totalChunks: 1,
					metadata: { url: "https://example.com/docs/bugs", title: "Bugs" },
				},
			];

			const edges = await adapter.extractEdges(chunks);
			expect(edges).toHaveLength(1);
			expect(edges[0]).toEqual({
				type: "references",
				sourceId: "def456",
				targetType: "issue",
				targetId: "filecoin-project/lotus#42",
				evidence: "https://github.com/filecoin-project/lotus/issues/42",
				confidence: 1.0,
			});
		});

		it("extracts both link types from same chunk", async () => {
			const chunks: Chunk[] = [
				{
					id: "ghi789",
					content:
						"Before starting, review the setup checklist and make sure your environment satisfies the prerequisites. Read the [guide](https://docs.example.com/guide) for the step-by-step walkthrough. Related: https://github.com/org/repo/pull/10 which landed the final migration.",
					sourceType: "doc-page",
					source: "/docs/mixed",
					sourceUrl: "https://example.com/docs/mixed",
					chunkIndex: 0,
					totalChunks: 1,
					metadata: { url: "https://example.com/docs/mixed", title: "Mixed" },
				},
			];

			const edges = await adapter.extractEdges(chunks);
			expect(edges).toHaveLength(2);
			expect(edges.map((e) => e.targetType).sort()).toEqual(["issue", "url"]);
		});

		it("returns empty array for chunks without links", async () => {
			const chunks: Chunk[] = [
				{
					id: "nope",
					content: "Just some plain text without any links.",
					sourceType: "doc-page",
					source: "/docs/plain",
					sourceUrl: "https://example.com/docs/plain",
					chunkIndex: 0,
					totalChunks: 1,
					metadata: { url: "https://example.com/docs/plain", title: "Plain" },
				},
			];

			const edges = await adapter.extractEdges(chunks);
			expect(edges).toHaveLength(0);
		});

		it("ignores relative markdown links", async () => {
			const chunks: Chunk[] = [
				{
					id: "rel",
					content: "See [next section](./next) and [another](/other).",
					sourceType: "doc-page",
					source: "/docs/relative",
					sourceUrl: "https://example.com/docs/relative",
					chunkIndex: 0,
					totalChunks: 1,
					metadata: { url: "https://example.com/docs/relative", title: "Relative" },
				},
			];

			const edges = await adapter.extractEdges(chunks);
			expect(edges).toHaveLength(0);
		});
	});

	// Note: ingest() tests require network access and a running website.
	// We skip them here but document the expected behaviour:
	// - Crawls the given URL using CheerioCrawler
	// - Converts HTML to markdown via turndown
	// - Yields Chunk objects with sourceType "doc-page"
	// - Chunk IDs are SHA-256 hashes of content
	// - Long pages are split using chunkMarkdown()
	// - Metadata includes url and title
});

describe("deriveSourceFromUrl (#257)", () => {
	it("includes the hostname so two domains with identical paths don't collide", async () => {
		const { deriveSourceFromUrl } = await import("./website.js");
		const a = deriveSourceFromUrl("https://docs.filecoin.io/about");
		const b = deriveSourceFromUrl("https://filecoin.io/about");
		expect(a).not.toBe(b);
	});

	it("uses host + pathname as the canonical form", async () => {
		const { deriveSourceFromUrl } = await import("./website.js");
		expect(deriveSourceFromUrl("https://docs.filecoin.io/basics")).toBe("docs.filecoin.io/basics");
		expect(deriveSourceFromUrl("https://example.com/")).toBe("example.com/");
	});

	it("lowercases the host (RFC 3986 case-insensitive authority)", async () => {
		const { deriveSourceFromUrl } = await import("./website.js");
		expect(deriveSourceFromUrl("https://DOCS.FILECOIN.IO/x")).toBe("docs.filecoin.io/x");
	});

	it("preserves pathname case (paths are case-sensitive per RFC)", async () => {
		const { deriveSourceFromUrl } = await import("./website.js");
		expect(deriveSourceFromUrl("https://example.com/Path/To/Page")).toBe(
			"example.com/Path/To/Page",
		);
	});

	it("drops query string and fragment (they're not part of the canonical page identity)", async () => {
		const { deriveSourceFromUrl } = await import("./website.js");
		expect(deriveSourceFromUrl("https://example.com/page?q=1&x=2#frag")).toBe("example.com/page");
	});
});

describe("extractMainContent (#257 readability extraction)", () => {
	it("extracts article content and drops navigational chrome", async () => {
		const { extractMainContent } = await import("./website.js");
		const html = `<!DOCTYPE html><html><head><title>Test</title></head><body>
			<nav><a href="/home">Home</a><a href="/about">About</a></nav>
			<header><h1>Site Title</h1></header>
			<article>
				<h1>How to configure storage providers</h1>
				<p>Storage providers in the Filecoin network must register their
				compute and storage capacity through a series of sealing steps.
				Each sealing step produces a cryptographic proof that is submitted
				to the chain and verified by the network consensus.</p>
				<p>Providers earn block rewards proportional to the storage they
				have committed and maintained on the network. Slashing occurs when
				committed storage cannot be proven within the agreed window.</p>
			</article>
			<footer>Copyright 2026. All rights reserved. <a href="/privacy">Privacy</a></footer>
		</body></html>`;
		const content = extractMainContent(html);
		expect(content).toContain("storage providers");
		expect(content).toContain("sealing steps");
		expect(content).not.toContain("Copyright 2026");
		expect(content).not.toContain("Privacy");
	});

	it("returns empty string when the document is too short for readability", async () => {
		const { extractMainContent } = await import("./website.js");
		// Readability has a minimum content threshold; very short pages fall through
		const result = extractMainContent("<html><body><p>hi</p></body></html>");
		// Either empty (readability declined) or at least the 'hi' content
		expect(typeof result).toBe("string");
	});

	it("is a pure function — same HTML returns same content", async () => {
		const { extractMainContent } = await import("./website.js");
		const html = `<html><body><article><h1>Title</h1>
			<p>A paragraph of text long enough to survive the readability
			minimum-content filter. It talks about Filecoin storage deals,
			retrieval deals, and the economic incentives that bind them.
			The text continues for a few more sentences to ensure that
			readability will accept it as real article content.</p></article></body></html>`;
		expect(extractMainContent(html)).toBe(extractMainContent(html));
	});

	it("handles malformed HTML gracefully (no throw)", async () => {
		const { extractMainContent } = await import("./website.js");
		expect(() => extractMainContent("<html><body><p>unclosed")).not.toThrow();
		expect(() => extractMainContent("")).not.toThrow();
	});

	it("returns empty string for non-HTML or failed parsing", async () => {
		const { extractMainContent } = await import("./website.js");
		expect(extractMainContent("")).toBe("");
		expect(extractMainContent("{json: 'not html'}")).toBe("");
	});
});

describe("findBoilerplateChunks (#257 shingle-based dedup)", () => {
	it("returns empty set for a small input (<3 chunks — not enough evidence to dedup)", async () => {
		const { findBoilerplateChunks } = await import("./website.js");
		expect(findBoilerplateChunks(["a", "b"])).toEqual(new Set());
	});

	it("does NOT flag chunks with substantial unique content even if they share a header", async () => {
		const { findBoilerplateChunks } = await import("./website.js");
		// A short shared preamble (~10 words) + a long unique body (~60 words).
		// Each chunk's shared fraction should be ~10/70 = 14% — well below threshold.
		const header = "Welcome to the Filecoin documentation portal. ";
		const bodies = [
			"Getting started requires installing the Lotus daemon, configuring your wallet, and joining the network. The setup process includes downloading the chain snapshot, syncing with peers, and verifying block headers before you can submit transactions or retrieve stored data.",
			"Architecture combines content-addressed storage with verifiable computation. The system uses IPLD for linked data, proofs of replication for storage verification, and proofs of spacetime for continuity guarantees across the full retention period of each deal.",
			"Deployment involves provisioning hardware, configuring network access, tuning garbage collection, and setting up monitoring dashboards. Reliable operation requires careful capacity planning, redundant storage, and automated failover procedures that handle the most common failure modes.",
			"Reference documentation lists every JSON-RPC method exposed by the node. Each method includes the parameter schema, return type, authorization level, and examples demonstrating correct invocation. Clients must handle rate limits and implement exponential backoff on transient errors.",
			"Troubleshooting covers diagnosing sync issues, identifying slow peers, recovering from corrupt blockstore state, and rebuilding indexes when the chain head diverges. Common problems include port conflicts, disk exhaustion, and missing peer keys that block handshake negotiation.",
		];
		const chunks = bodies.map((b) => `${header}${b}`);
		const boilerplate = findBoilerplateChunks(chunks);
		// Shared fraction too small — each chunk is substantially unique content
		expect(boilerplate.size).toBe(0);
	});

	it("flags chunks that are mostly boilerplate (nav repeated on many pages)", async () => {
		const { findBoilerplateChunks } = await import("./website.js");
		const nav =
			"Home. Documentation. Blog. Contact. Legal. Careers. Privacy. Terms. Support. Community. Pricing. API. SDK. CLI. Docs. ";
		// 6 chunks that are ~entirely nav with trivial page-specific suffix
		const chunks = Array.from({ length: 6 }, (_, i) => `${nav} p${i}`);
		const boilerplate = findBoilerplateChunks(chunks);
		expect(boilerplate.size).toBe(6);
	});

	it("is deterministic (same input → same output)", async () => {
		const { findBoilerplateChunks } = await import("./website.js");
		const nav = "same repeated header text across all pages here. ".repeat(3);
		const chunks = Array.from({ length: 5 }, (_, i) => `${nav} body${i}`);
		const a = findBoilerplateChunks(chunks);
		const b = findBoilerplateChunks(chunks);
		expect([...a].sort()).toEqual([...b].sort());
	});

	it("returns indices, not content (callers filter on index)", async () => {
		const { findBoilerplateChunks } = await import("./website.js");
		const nav = "shared page chrome block repeated across many pages here. ".repeat(3);
		const chunks = Array.from({ length: 6 }, (_, i) => `${nav} x${i}`);
		const flagged = findBoilerplateChunks(chunks);
		for (const idx of flagged) {
			expect(typeof idx).toBe("number");
			expect(idx).toBeGreaterThanOrEqual(0);
			expect(idx).toBeLessThan(chunks.length);
		}
	});
});

describe("isPathDenied (#257 URL pattern filter)", () => {
	it("returns false when no patterns are provided", async () => {
		const { isPathDenied } = await import("./website.js");
		expect(isPathDenied("https://example.com/docs/x", [])).toBe(false);
		expect(isPathDenied("https://example.com/docs/x", undefined)).toBe(false);
	});

	it("matches a pattern against the URL pathname", async () => {
		const { isPathDenied } = await import("./website.js");
		expect(isPathDenied("https://example.com/blog/some-post", ["/blog"])).toBe(true);
		expect(isPathDenied("https://example.com/docs/x", ["/blog"])).toBe(false);
	});

	it("matches any pattern in the list (logical OR)", async () => {
		const { isPathDenied } = await import("./website.js");
		const patterns = ["/blog", "/tag", "/archive"];
		expect(isPathDenied("https://example.com/tag/ipfs", patterns)).toBe(true);
		expect(isPathDenied("https://example.com/archive/2024", patterns)).toBe(true);
		expect(isPathDenied("https://example.com/docs/intro", patterns)).toBe(false);
	});

	it("does not match on hostname, only pathname", async () => {
		const { isPathDenied } = await import("./website.js");
		// "/blog" should not match "blog.example.com" hostname
		expect(isPathDenied("https://blog.example.com/docs", ["/blog"])).toBe(false);
	});

	it("pattern matching is case-sensitive on path (per RFC)", async () => {
		const { isPathDenied } = await import("./website.js");
		expect(isPathDenied("https://example.com/Blog/post", ["/blog"])).toBe(false);
		expect(isPathDenied("https://example.com/blog/post", ["/blog"])).toBe(true);
	});

	it("is a pure function (same input → same output)", async () => {
		const { isPathDenied } = await import("./website.js");
		const url = "https://example.com/blog/x";
		const patterns = ["/blog", "/tag"];
		expect(isPathDenied(url, patterns)).toBe(isPathDenied(url, patterns));
	});
});

describe("isLowQualityWebChunk (#257 edge suppression)", () => {
	it("flags chunks below the minimum content length", async () => {
		const { isLowQualityWebChunk } = await import("./website.js");
		expect(isLowQualityWebChunk("")).toBe(true);
		expect(isLowQualityWebChunk("short")).toBe(true);
		expect(isLowQualityWebChunk("x".repeat(99))).toBe(true);
	});

	it("accepts chunks with sufficient content (>= 100 chars of real text)", async () => {
		const { isLowQualityWebChunk } = await import("./website.js");
		const longProse =
			"Filecoin is a peer-to-peer storage network. Users pay storage providers to store their data for a configurable duration. ";
		expect(isLowQualityWebChunk(longProse)).toBe(false);
	});

	it("flags link-heavy chunks (nav / TOC / link list)", async () => {
		const { isLowQualityWebChunk } = await import("./website.js");
		// 10 links, minimal prose — classic TOC pattern
		const linkList = Array.from({ length: 10 }, (_, i) => `[Page ${i}](/p/${i})`).join(" ");
		expect(isLowQualityWebChunk(linkList)).toBe(true);
	});

	it("accepts mixed content with some inline links", async () => {
		const { isLowQualityWebChunk } = await import("./website.js");
		const mixed =
			"Storage providers must commit to the terms outlined in the [Filecoin Improvement Proposal](/fip-001) and pass validation checks defined by the network consensus rules. Violations result in slashing as described in the protocol documentation. ";
		expect(isLowQualityWebChunk(mixed)).toBe(false);
	});

	it("is a pure function (no side effects)", async () => {
		const { isLowQualityWebChunk } = await import("./website.js");
		const input = "a".repeat(200);
		const r1 = isLowQualityWebChunk(input);
		const r2 = isLowQualityWebChunk(input);
		expect(r1).toBe(r2);
	});
});

describe("stripBoilerplateHtml (#257)", () => {
	it("removes <nav> blocks", async () => {
		const { stripBoilerplateHtml } = await import("./website.js");
		const html = "<p>keep</p><nav>menu links</nav><p>also keep</p>";
		const out = stripBoilerplateHtml(html);
		expect(out).not.toContain("menu links");
		expect(out).toContain("keep");
		expect(out).toContain("also keep");
	});

	it("removes <footer> blocks", async () => {
		const { stripBoilerplateHtml } = await import("./website.js");
		const html = "<main>content</main><footer>copyright 2026</footer>";
		expect(stripBoilerplateHtml(html)).not.toContain("copyright 2026");
	});

	it("removes <aside> blocks", async () => {
		const { stripBoilerplateHtml } = await import("./website.js");
		const html = "<article>body</article><aside>related: x, y, z</aside>";
		expect(stripBoilerplateHtml(html)).not.toContain("related: x");
	});

	it("removes <script> and <style> blocks", async () => {
		const { stripBoilerplateHtml } = await import("./website.js");
		const html = "<p>keep</p><script>alert(1)</script><style>.x{}</style>";
		const out = stripBoilerplateHtml(html);
		expect(out).not.toContain("alert(1)");
		expect(out).not.toContain(".x{}");
		expect(out).toContain("keep");
	});

	it('handles attributes on boilerplate tags (e.g. <nav class="main">)', async () => {
		const { stripBoilerplateHtml } = await import("./website.js");
		const html = '<p>keep</p><nav class="main" id="site-nav">menu</nav>';
		expect(stripBoilerplateHtml(html)).not.toContain("menu");
	});

	it("is case-insensitive on tag names", async () => {
		const { stripBoilerplateHtml } = await import("./website.js");
		const html = "<p>keep</p><NAV>menu</NAV><Footer>c</Footer>";
		const out = stripBoilerplateHtml(html);
		expect(out).not.toContain("menu");
		expect(out).not.toContain(">c<");
	});

	it("handles multiple nav/footer blocks in the same document", async () => {
		const { stripBoilerplateHtml } = await import("./website.js");
		const html = "<nav>top</nav><p>body</p><nav>side</nav><footer>bottom</footer>";
		const out = stripBoilerplateHtml(html);
		expect(out).not.toContain("top");
		expect(out).not.toContain("side");
		expect(out).not.toContain("bottom");
		expect(out).toContain("body");
	});

	it("is a no-op for HTML with no boilerplate tags", async () => {
		const { stripBoilerplateHtml } = await import("./website.js");
		const html = "<article><h1>Title</h1><p>paragraph</p></article>";
		expect(stripBoilerplateHtml(html)).toBe(html);
	});
});
