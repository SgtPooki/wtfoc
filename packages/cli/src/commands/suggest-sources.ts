import type { Segment } from "@wtfoc/common";
import type { Command } from "commander";
import { getFirstMatchGroup, getFormat, getStore } from "../helpers.js";

export function registerSuggestSourcesCommand(program: Command): void {
	program
		.command("suggest-sources")
		.description("Discover repos and websites referenced in content that could be ingested")
		.requiredOption("-c, --collection <name>", "Collection name")
		.option("--limit <number>", "Max suggestions to show", "30")
		.action(async (opts: { collection: string; limit: string }) => {
			const store = getStore(program);
			const format = getFormat(program.opts());

			const head = await store.manifests.getHead(opts.collection);
			if (!head) {
				console.error(`Error: collection "${opts.collection}" not found`);
				process.exit(1);
			}

			if (format === "human") console.error("⏳ Scanning collection for external references...");

			// Track what's already ingested
			const ingestedRepos = new Set<string>();
			const ingestedSites = new Set<string>();
			const allSegments: Segment[] = [];

			for (const segSummary of head.manifest.segments) {
				// Pre-populate repos from manifest-level metadata
				if (segSummary.repoIds) {
					for (const repo of segSummary.repoIds) ingestedRepos.add(repo.toLowerCase());
				}

				const segBytes = await store.storage.download(segSummary.id);
				const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
				allSegments.push(segment);
				for (const c of segment.chunks) {
					// Track ingested GitHub repos (from source field like "owner/repo#N" or "owner/repo/path")
					const repoMatch = c.source.match(/^([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)/);
					const repoId = repoMatch ? getFirstMatchGroup(repoMatch) : null;
					if (repoId && c.sourceType.startsWith("github-")) ingestedRepos.add(repoId.toLowerCase());
					if (c.sourceType === "code" || c.sourceType === "markdown") {
						const codeRepo = c.source.match(/^([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)/);
						const codeRepoId = codeRepo ? getFirstMatchGroup(codeRepo) : null;
						if (codeRepoId) ingestedRepos.add(codeRepoId.toLowerCase());
					}
					// Track ingested websites
					if (c.sourceUrl?.startsWith("http")) {
						try {
							const host = new URL(c.sourceUrl).hostname;
							ingestedSites.add(host);
						} catch {}
					}
				}
			}

			// Scan content and edges for external references
			const GITHUB_REPO_URL = /https?:\/\/github\.com\/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)/g;
			const DOCS_SITE_URL =
				/https?:\/\/((?:docs\.[a-z0-9.-]+|[a-z0-9.-]+\.(?:dev|io|cloud|org|com)))\//g;

			const repoRefs = new Map<string, number>();
			const siteRefs = new Map<string, number>();

			for (const seg of allSegments) {
				for (const chunk of seg.chunks) {
					// GitHub repo references in content
					for (const match of chunk.content.matchAll(GITHUB_REPO_URL)) {
						const repo = getFirstMatchGroup(match);
						if (!repo) continue;
						if (!ingestedRepos.has(repo.toLowerCase())) {
							repoRefs.set(repo, (repoRefs.get(repo) ?? 0) + 1);
						}
					}
					// Docs site references in content
					for (const match of chunk.content.matchAll(DOCS_SITE_URL)) {
						const host = getFirstMatchGroup(match);
						if (!host) continue;
						if (!ingestedSites.has(host)) {
							siteRefs.set(host, (siteRefs.get(host) ?? 0) + 1);
						}
					}
				}
				// Also check edge targetIds for unresolved repos
				for (const edge of seg.edges) {
					const repoMatch = edge.targetId.match(/^([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)#/);
					const repo = repoMatch ? getFirstMatchGroup(repoMatch) : null;
					if (!repo || ingestedRepos.has(repo.toLowerCase())) continue;
					repoRefs.set(repo, (repoRefs.get(repo) ?? 0) + 1);
				}
			}

			const maxShow = Number.parseInt(opts.limit, 10) || 30;
			const sortedRepos = [...repoRefs.entries()].sort((a, b) => b[1] - a[1]);
			const sortedSites = [...siteRefs.entries()].sort((a, b) => b[1] - a[1]);

			if (format === "json") {
				console.log(
					JSON.stringify({
						ingestedRepos: [...ingestedRepos],
						ingestedSites: [...ingestedSites],
						suggestedRepos: Object.fromEntries(sortedRepos),
						suggestedSites: Object.fromEntries(sortedSites),
					}),
				);
			} else {
				console.log(`\n📦 Collection "${opts.collection}" — already ingested:`);
				console.log(`   ${ingestedRepos.size} GitHub repos, ${ingestedSites.size} websites`);

				if (sortedRepos.length > 0) {
					console.log(
						`\n🔍 GitHub repos referenced but not ingested (${sortedRepos.length} found):`,
					);
					for (const [repo, count] of sortedRepos.slice(0, maxShow)) {
						console.log(`   ${String(count).padStart(4)} refs  ${repo}`);
					}
					if (sortedRepos.length > maxShow) {
						console.log(`   ... and ${sortedRepos.length - maxShow} more`);
					}
				}

				if (sortedSites.length > 0) {
					console.log(`\n🌐 Websites referenced but not ingested (${sortedSites.length} found):`);
					for (const [site, count] of sortedSites.slice(0, 10)) {
						console.log(`   ${String(count).padStart(4)} refs  ${site}`);
					}
				}

				if (sortedRepos.length > 0) {
					console.log(
						`\n   To ingest a repo:    wtfoc ingest github <owner/repo> -c ${opts.collection}`,
					);
					console.log(`   To ingest a website: wtfoc ingest website <url> -c ${opts.collection}`);
				}
			}
		});
}
