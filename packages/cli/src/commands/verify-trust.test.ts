import { describe, expect, it } from "vitest";
import { classifyEdgeIntegrity } from "./verify-trust.js";

describe("classifyEdgeIntegrity", () => {
	const chunkA = "a".repeat(64);
	const chunkB = "b".repeat(64);
	const chunks = new Set([chunkA, chunkB]);

	it("flags edges whose sourceId is not in the chunk set", () => {
		const orphan = "c".repeat(64);
		const result = classifyEdgeIntegrity(
			[
				{ sourceId: chunkA, targetId: "FilOzone/synapse-sdk#1" },
				{ sourceId: orphan, targetId: "node:fs" },
			],
			chunks,
		);
		expect(result.orphanSources).toEqual([orphan]);
	});

	it("counts chunk-id-addressed targets separately from external refs", () => {
		const result = classifyEdgeIntegrity(
			[
				{ sourceId: chunkA, targetId: chunkB }, // resolvable chunk-id target
				{ sourceId: chunkA, targetId: "d".repeat(64) }, // chunk-id shape but missing
				{ sourceId: chunkA, targetId: "node:fs" }, // external ref (ignored)
				{ sourceId: chunkA, targetId: "FilOzone/x#1" }, // external ref (ignored)
			],
			chunks,
		);
		expect(result.chunkAddressableTargets).toBe(2);
		expect(result.chunkAddressableTargetsResolved).toBe(1);
		expect(result.orphanSources).toEqual([]);
	});

	it("returns zeros when no edges given", () => {
		const result = classifyEdgeIntegrity([], chunks);
		expect(result.orphanSources).toEqual([]);
		expect(result.chunkAddressableTargets).toBe(0);
		expect(result.chunkAddressableTargetsResolved).toBe(0);
	});
});
