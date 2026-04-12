import type { Segment } from "@wtfoc/common";
import { analyzeEdgeResolution, buildSourceIndex } from "@wtfoc/search";
import type { Command } from "commander";
import { getFormat, getStore } from "../helpers.js";

export function registerUnresolvedEdgesCommand(program: Command): void {
	program
		.command("unresolved-edges")
		.description("Show edge targets that don't resolve to any chunk in the collection")
		.requiredOption("-c, --collection <name>", "Collection name")
		.option("--limit <number>", "Max repos to show", "20")
		.action(async (opts: { collection: string; limit: string }) => {
			const store = getStore(program);
			const format = getFormat(program.opts());

			const head = await store.manifests.getHead(opts.collection);
			if (!head) {
				console.error(`Error: collection "${opts.collection}" not found`);
				process.exit(1);
			}

			if (format === "human") console.error("⏳ Loading segments...");

			const allSegments: Segment[] = [];
			for (const segSummary of head.manifest.segments) {
				const segBytes = await store.storage.download(segSummary.id);
				const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
				allSegments.push(segment);
			}

			// Use shared edge resolution logic (same as trace engine)
			const sourceIndex = buildSourceIndex(allSegments);
			const stats = analyzeEdgeResolution(allSegments, sourceIndex);
			const {
				totalEdges,
				resolvedEdges,
				bareRefs,
				unresolvedEdges: unresolvedCount,
				unresolvedByRepo,
			} = stats;
			const sorted = [...unresolvedByRepo.entries()].sort((a, b) => b[1] - a[1]);
			const maxShow = Number.parseInt(opts.limit, 10) || 20;

			if (format === "json") {
				console.log(
					JSON.stringify({
						totalEdges,
						resolvedEdges,
						bareRefs,
						unresolvedEdges: unresolvedCount,
						unresolvedByRepo: Object.fromEntries(unresolvedByRepo),
					}),
				);
			} else {
				console.log(`\n📊 Edge resolution for "${opts.collection}"`);
				console.log(`   Total edges: ${totalEdges}`);
				console.log(
					`   Resolved:    ${resolvedEdges} (${Math.round((resolvedEdges / totalEdges) * 100)}%)`,
				);
				console.log(`   Bare #N:     ${bareRefs} (no repo context)`);
				console.log(`   Unresolved:  ${unresolvedCount}`);

				if (sorted.length > 0) {
					console.log(`\n⚠️  Unresolved edge targets by repo:`);
					for (const [repo, count] of sorted.slice(0, maxShow)) {
						console.log(`   ${String(count).padStart(4)}  ${repo}`);
					}
					if (sorted.length > maxShow) {
						console.log(`   ... and ${sorted.length - maxShow} more repos`);
					}
					console.log(`\n   Run \`wtfoc ingest github <repo> -c ${opts.collection}\` to add them.`);
				}
			}
		});
}
