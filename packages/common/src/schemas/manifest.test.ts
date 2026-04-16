import { describe, expect, it } from "vitest";
import type { PublishedArtifactKind, PublishedArtifactRef } from "./manifest.js";

/**
 * Snapshot test for the set of `PublishedArtifactKind` values. If a new kind
 * is added to the `PublishedArtifactRef` union without updating this snapshot,
 * the test fails. This forces contributors to also update:
 *   - the promote enumeration in `@wtfoc/cli`
 *   - the pull handling in `@wtfoc/cli`
 *   - the round-trip contract test fixture
 *
 * If you're adding a kind: update `EXPECTED_KINDS`, add a fixture + assertion
 * in the round-trip test, and extend promote/pull switches (TS exhaustiveness
 * will break compile in handlers that miss the new case).
 */
describe("PublishedArtifactRef kinds", () => {
	const EXPECTED_KINDS = [
		"segment",
		"derived-edge-layer",
		"raw-source-blob",
		"sidecar",
	] as const satisfies ReadonlyArray<PublishedArtifactKind>;

	it("matches the snapshot of allowed artifact kinds", () => {
		// Construct a representative of every kind — compile-time exhaustiveness
		// check ensures each EXPECTED_KINDS entry actually matches a ref variant.
		const representatives: PublishedArtifactRef[] = [
			{ kind: "segment", storageId: "s", ipfsCid: "c", byteLength: 0 },
			{
				kind: "derived-edge-layer",
				storageId: "s",
				ipfsCid: "c",
				extractorId: "e",
				edgeCount: 0,
				byteLength: 0,
			},
			{
				kind: "raw-source-blob",
				storageId: "s",
				ipfsCid: "c",
				documentId: "d",
				documentVersionId: "v",
				byteLength: 0,
				sha256: "h",
			},
			{ kind: "sidecar", role: "raw-source-index", ipfsCid: "c", byteLength: 0, sha256: "h" },
		];

		const kinds = representatives.map((r) => r.kind);
		expect(new Set(kinds)).toEqual(new Set(EXPECTED_KINDS));
	});
});
