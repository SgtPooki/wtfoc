import { createHash } from "node:crypto";
import type { Edge } from "@wtfoc/common";
import { loadAllOverlayEdges } from "@wtfoc/ingest";
import { validateManifestSchema } from "@wtfoc/store";
import type { Command } from "commander";
import { getFormat, getManifestDir, getStore } from "../helpers.js";

export interface TrustCheck {
	name: string;
	status: "pass" | "fail" | "warn" | "skip";
	detail: string;
}

export interface TrustReport {
	collection: string;
	checks: TrustCheck[];
	verdict: "LOCALLY CONSISTENT" | "INCONSISTENT";
}

/**
 * Classify overlay edges against a known chunk-id set.
 * Pure — testable without filesystem.
 */
export function classifyEdgeIntegrity(
	edges: Array<Pick<Edge, "sourceId" | "targetId">>,
	chunkIds: ReadonlySet<string>,
): {
	orphanSources: string[];
	chunkAddressableTargets: number;
	chunkAddressableTargetsResolved: number;
} {
	const orphanSources: string[] = [];
	let chunkAddressableTargets = 0;
	let chunkAddressableTargetsResolved = 0;
	for (const edge of edges) {
		if (!chunkIds.has(edge.sourceId)) orphanSources.push(edge.sourceId);
		if (/^[a-f0-9]{64}$/.test(edge.targetId)) {
			chunkAddressableTargets++;
			if (chunkIds.has(edge.targetId)) chunkAddressableTargetsResolved++;
		}
	}
	return { orphanSources, chunkAddressableTargets, chunkAddressableTargetsResolved };
}

export function registerVerifyTrustCommand(program: Command): void {
	program
		.command("verify-trust <collection>")
		.description(
			"Local trust report: manifest schema, segment reachability + sha256 match, edge source integrity. No network, no CID pull.",
		)
		.action(async (collection: string) => {
			const store = getStore(program);
			const format = getFormat(program.opts());
			const checks: TrustCheck[] = [];

			const stored = await store.manifests.getHead(collection);
			if (!stored) {
				console.error(`Error: collection "${collection}" not found`);
				process.exit(1);
			}

			// Check 1: Manifest schema
			try {
				validateManifestSchema(stored.manifest);
				checks.push({
					name: "manifest-schema",
					status: "pass",
					detail: `schemaVersion=${stored.manifest.schemaVersion}`,
				});
			} catch (err) {
				checks.push({
					name: "manifest-schema",
					status: "fail",
					detail: err instanceof Error ? err.message : String(err),
				});
			}

			// Check 2 + 3: segment reachability + sha256 match
			const segments = stored.manifest.segments;
			let reachable = 0;
			let hashMatch = 0;
			const missingSegments: string[] = [];
			const hashMismatches: string[] = [];
			const allChunkIds = new Set<string>();

			for (const seg of segments) {
				let data: Uint8Array;
				try {
					data = await store.storage.download(seg.id);
				} catch {
					missingSegments.push(seg.id);
					continue;
				}
				reachable++;
				const actual = createHash("sha256").update(data).digest("hex");
				if (actual === seg.id) {
					hashMatch++;
				} else {
					hashMismatches.push(`${seg.id} (got ${actual})`);
				}
				try {
					const segJson = JSON.parse(new TextDecoder().decode(data)) as {
						chunks?: Array<{ id: string }>;
					};
					for (const chunk of segJson.chunks ?? []) allChunkIds.add(chunk.id);
				} catch {
					// segment JSON parse failure surfaces via hash check already; keep going
				}
			}

			checks.push({
				name: "segments-reachable",
				status: missingSegments.length === 0 ? "pass" : "fail",
				detail:
					missingSegments.length === 0
						? `${reachable}/${segments.length} segments reachable`
						: `${reachable}/${segments.length} reachable, missing: ${missingSegments.slice(0, 3).join(", ")}${missingSegments.length > 3 ? ` (+${missingSegments.length - 3} more)` : ""}`,
			});
			checks.push({
				name: "segment-sha256",
				status: hashMismatches.length === 0 ? "pass" : "fail",
				detail:
					hashMismatches.length === 0
						? `${hashMatch}/${reachable} segment bytes match recorded id`
						: `${hashMismatches.length} mismatches: ${hashMismatches.slice(0, 2).join("; ")}`,
			});

			// Check 4: edge source integrity (sourceId must resolve to a chunk).
			// Edge target resolution is informational — targetIds are usually
			// external repo refs ("org/repo#N"), not chunk ids, and cross-
			// collection unresolved targets are expected in a federated graph.
			const manifestDir = getManifestDir(store);
			const overlayEdges = await loadAllOverlayEdges(manifestDir, collection);
			const edgeIntegrity = classifyEdgeIntegrity(overlayEdges as Edge[], allChunkIds);
			checks.push({
				name: "edge-source-integrity",
				status: edgeIntegrity.orphanSources.length === 0 ? "pass" : "fail",
				detail:
					edgeIntegrity.orphanSources.length === 0
						? `${overlayEdges.length}/${overlayEdges.length} edges have a resolvable sourceId`
						: `${edgeIntegrity.orphanSources.length} edges reference missing chunks: ${edgeIntegrity.orphanSources.slice(0, 3).join(", ")}`,
			});

			// Edge target resolution count (chunk-id-addressed targets only).
			// Non-chunk-id targets ("org/repo#N", "node:fs", slack URLs) are
			// external references and not our concern at the local-trust tier.
			checks.push({
				name: "chunk-addressable-targets",
				status:
					edgeIntegrity.chunkAddressableTargets === 0 ||
					edgeIntegrity.chunkAddressableTargetsResolved === edgeIntegrity.chunkAddressableTargets
						? "pass"
						: "warn",
				detail:
					edgeIntegrity.chunkAddressableTargets === 0
						? "no chunk-id-addressed edge targets (all external refs)"
						: `${edgeIntegrity.chunkAddressableTargetsResolved}/${edgeIntegrity.chunkAddressableTargets} chunk-id-addressed targets resolve`,
			});

			const failed = checks.some((c) => c.status === "fail");
			const report: TrustReport = {
				collection,
				checks,
				verdict: failed ? "INCONSISTENT" : "LOCALLY CONSISTENT",
			};

			if (format === "json") {
				console.log(JSON.stringify(report, null, 2));
			} else if (format !== "quiet") {
				console.log(`Collection: ${collection}`);
				for (const c of checks) {
					const icon =
						c.status === "pass"
							? "✅"
							: c.status === "fail"
								? "❌"
								: c.status === "warn"
									? "⚠️ "
									: "⏭️ ";
					console.log(`${icon} ${c.name}: ${c.detail}`);
				}
				console.log(
					`\nVerdict: ${failed ? "❌ INCONSISTENT" : "✅ LOCALLY CONSISTENT (not a trust claim about publisher identity or remote availability)"}`,
				);
			}

			if (failed) process.exit(1);
		});
}
