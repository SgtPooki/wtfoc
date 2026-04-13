#!/usr/bin/env tsx
/**
 * Guided setup for a dogfood-ready collection.
 *
 * A proper dogfood collection requires:
 * 1. Code repo ingest (with tree-sitter for AST edges)
 * 2. GitHub issues/PRs ingest (for cross-source edges)
 * 3. LLM edge extraction (for semantic edges)
 * 4. Themes clustering
 *
 * This script checks what's been done and tells you what's missing.
 *
 * Usage: pnpm dogfood:setup --collection <name> [--repo <owner/repo>]
 */

import { parseArgs } from "node:util";
import { createStore } from "@wtfoc/store";

const { values } = parseArgs({
	options: {
		collection: { type: "string", short: "c" },
		repo: { type: "string" },
		help: { type: "boolean", short: "h", default: false },
	},
	strict: true,
});

if (values.help || !values.collection) {
	console.log(`
Dogfood Collection Setup Guide
===============================

Usage: pnpm dogfood:setup --collection <name> [--repo <owner/repo>]

Checks your collection's readiness for dogfood evaluation and prints
the commands needed to build a complete collection.

A well-built dogfood collection needs:

  1. CODE REPO INGEST (with tree-sitter)
     Tree-sitter produces precise import/dependency edges from AST analysis.
     Without it, code→code edges use regex which misses most relationships.

     Requires: tree-sitter sidecar running (docker)
       docker compose -f docker/compose.yml up -d tree-sitter-parser

     Command:
       wtfoc ingest repo -c <name> <owner/repo> \\
         --embedder api --embedder-url <url> --embedder-model <model> \\
         --embedder-key <key> --tree-sitter-url http://localhost:8384

  2. GITHUB ISSUES/PRs INGEST
     Adds discussion context so code edges can resolve to issues/PRs.
     This is what enables "why was this file changed?" traces.

     Command:
       wtfoc ingest github -c <name> <owner/repo> \\
         --embedder api --embedder-url <url> --embedder-model <model> \\
         --embedder-key <key>

  3. LLM EDGE EXTRACTION
     Semantic edge discovery beyond pattern matching.
     Use any OpenAI-compatible endpoint.

     Command:
       wtfoc extract-edges -c <name> \\
         --extractor-url <url> --extractor-model <model>

  4. THEMES CLUSTERING
     Discovers semantic groupings across the collection.

     Command:
       wtfoc themes -c <name>

  5. DOGFOOD EVALUATION
     Run after all above steps are complete.

     Command:
       pnpm dogfood --collection <name> [options]
`);
	process.exit(values.help ? 0 : 1);
}

async function main() {
	const store = createStore({ storage: "local" });
	const head = await store.manifests.getHead(values.collection!);

	if (!head) {
		console.log(`\n❌ Collection "${values.collection}" not found.`);
		console.log(`   Create it first: wtfoc init ${values.collection}`);
		process.exit(1);
	}

	const manifest = head.manifest;
	const checks: Array<{ name: string; done: boolean; detail: string; command?: string }> = [];

	// Check 1: Has chunks at all
	const hasChunks = manifest.totalChunks > 0;
	checks.push({
		name: "Code repo ingested",
		done: hasChunks,
		detail: hasChunks
			? `${manifest.totalChunks} chunks in ${manifest.segments.length} segments`
			: "No chunks — run ingest first",
		command: !hasChunks
			? `wtfoc ingest repo -c ${values.collection} ${values.repo ?? "<owner/repo>"} --tree-sitter-url http://localhost:8384 --embedder api --embedder-url <url> --embedder-model <model> --embedder-key <key>`
			: undefined,
	});

	// Check 2: Has tree-sitter edges (imports from AST)
	let importEdges = 0;
	let totalEdges = 0;
	const sourceTypes = new Set<string>();
	for (const segSummary of manifest.segments) {
		try {
			const raw = await store.storage.download(segSummary.id);
			const seg = JSON.parse(new TextDecoder().decode(raw));
			totalEdges += seg.edges.length;
			for (const edge of seg.edges) {
				if (edge.type === "imports") importEdges++;
			}
			for (const chunk of seg.chunks) {
				sourceTypes.add(chunk.sourceType);
			}
		} catch { /* skip */ }
	}

	const hasTreeSitter = importEdges > 50;
	checks.push({
		name: "Tree-sitter AST edges",
		done: hasTreeSitter,
		detail: hasTreeSitter
			? `${importEdges} import edges from AST analysis`
			: `Only ${importEdges} import edges — tree-sitter likely not used`,
		command: !hasTreeSitter
			? `wtfoc reingest -c ${values.collection} --tree-sitter-url http://localhost:8384 --embedder api --embedder-url <url> --embedder-model <model> --embedder-key <key>`
			: undefined,
	});

	// Check 3: Has GitHub issues/PRs
	const hasGitHub = sourceTypes.has("github-issue") || sourceTypes.has("github-pr");
	checks.push({
		name: "GitHub issues/PRs ingested",
		done: hasGitHub,
		detail: hasGitHub
			? `Source types include: ${[...sourceTypes].filter(s => s.startsWith("github")).join(", ")}`
			: "No GitHub issues/PRs — code-only collection limits cross-source tracing",
		command: !hasGitHub
			? `wtfoc ingest github -c ${values.collection} ${values.repo ?? "<owner/repo>"} --embedder api --embedder-url <url> --embedder-model <model> --embedder-key <key>`
			: undefined,
	});

	// Check 4: Has LLM-extracted edges (overlay or derived layers)
	const hasLlmEdges = (manifest.derivedEdgeLayers?.length ?? 0) > 0;
	const llmEdgeCount = manifest.derivedEdgeLayers?.reduce((sum, l) => sum + l.edgeCount, 0) ?? 0;
	checks.push({
		name: "LLM edge extraction",
		done: hasLlmEdges,
		detail: hasLlmEdges
			? `${llmEdgeCount} LLM edges in ${manifest.derivedEdgeLayers?.length} layer(s)`
			: "No LLM-extracted edges — semantic relationships missing",
		command: !hasLlmEdges
			? `wtfoc extract-edges -c ${values.collection} --extractor-url <url> --extractor-model <model>`
			: undefined,
	});

	// Check 5: Has themes
	const hasThemes = !!manifest.themes;
	checks.push({
		name: "Themes clustering",
		done: hasThemes,
		detail: hasThemes
			? `${manifest.themes!.clusters.length} clusters, ${manifest.themes!.noise.length} noise`
			: "No themes computed",
		command: !hasThemes
			? `wtfoc themes -c ${values.collection}`
			: undefined,
	});

	// Print report
	const allDone = checks.every(c => c.done);
	console.log(`\nDOGFOOD READINESS: ${values.collection}`);
	console.log("═".repeat(60));

	for (const check of checks) {
		const icon = check.done ? "✅" : "❌";
		console.log(`  ${icon} ${check.name}`);
		console.log(`     ${check.detail}`);
		if (check.command) {
			console.log(`     → ${check.command}`);
		}
	}

	console.log("═".repeat(60));

	if (allDone) {
		console.log(`\n✅ Collection is ready for dogfood evaluation!`);
		console.log(`   Run: pnpm dogfood --collection ${values.collection} [options]\n`);
	} else {
		const missing = checks.filter(c => !c.done).length;
		console.log(`\n⚠️  ${missing} step(s) missing. Complete them in order above.\n`);
	}
}

main().catch((err) => {
	console.error("Error:", err.message);
	process.exit(1);
});
