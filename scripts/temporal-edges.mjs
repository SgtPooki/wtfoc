#!/usr/bin/env node
/**
 * Run the TemporalEdgeExtractor against a collection and write edges to the overlay.
 *
 * Usage: node scripts/temporal-edges.mjs -c <collection> [--window 12] [--dry-run]
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { TemporalEdgeExtractor } from "../packages/ingest/dist/index.js";

const PROJECTS_DIR = join(homedir(), ".wtfoc", "projects");
const DATA_DIR = join(homedir(), ".wtfoc", "data");

const args = process.argv.slice(2);
function getArg(flag) {
	const idx = args.indexOf(flag);
	return idx !== -1 ? args[idx + 1] : undefined;
}
const collection = getArg("-c");
const windowHours = Number(getArg("--window") ?? 12);
const dryRun = args.includes("--dry-run");

if (!collection) {
	console.error("Usage: node scripts/temporal-edges.mjs -c <collection> [--window 12] [--dry-run]");
	process.exit(2);
}

async function main() {
	const manifestPath = join(PROJECTS_DIR, `${collection}.json`);
	const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

	console.error(`Loading ${manifest.segments.length} segments...`);

	// Load all chunks from segments
	const allChunks = [];
	for (const segRef of manifest.segments) {
		const segData = await readFile(join(DATA_DIR, segRef.id));
		const seg = JSON.parse(segData.toString());
		for (const chunk of seg.chunks) {
			allChunks.push(chunk);
		}
	}
	console.error(`Loaded ${allChunks.length} chunks`);

	// Run the extractor
	const extractor = new TemporalEdgeExtractor({ windowHours });
	const edges = await extractor.extract(allChunks);

	console.error(`Generated ${edges.length} temporal-proximity edges (±${windowHours}h window)`);

	if (dryRun) {
		const sorted = edges.sort((a, b) => b.confidence - a.confidence);
		for (const edge of sorted.slice(0, 30)) {
			console.log(`  [${edge.confidence}] ${edge.evidence}`);
		}
		if (edges.length > 30) console.log(`  ... and ${edges.length - 30} more`);
		return;
	}

	// Write to overlay
	const overlayPath = join(PROJECTS_DIR, `${collection}.edges-overlay.json`);
	let existing = { collectionId: manifest.collectionId, edges: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
	try {
		existing = JSON.parse(await readFile(overlayPath, "utf-8"));
	} catch { /* no existing overlay */ }

	const existingKeys = new Set(existing.edges.map(e => `${e.type}|${e.sourceId}|${e.targetId}`));
	let added = 0;
	for (const edge of edges) {
		const key = `${edge.type}|${edge.sourceId}|${edge.targetId}`;
		if (!existingKeys.has(key)) {
			existing.edges.push(edge);
			existingKeys.add(key);
			added++;
		}
	}

	existing.updatedAt = new Date().toISOString();
	await writeFile(overlayPath, JSON.stringify(existing, null, 2));
	console.error(`Wrote ${added} new temporal edges to overlay (${existing.edges.length} total)`);
	console.error(`Run: node packages/cli/dist/cli.js materialize-edges -c ${collection}`);
}

main().catch(err => {
	console.error(`Error: ${err.message}`);
	process.exit(1);
});
