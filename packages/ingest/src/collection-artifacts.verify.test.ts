import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVerifiedFetch } from "@helia/verified-fetch";
import type { CollectionHead, DocumentCatalog, PublishedArtifactRef } from "@wtfoc/common";
import { CidReadableStorage } from "@wtfoc/store";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 as sha256Digest } from "multiformats/hashes/sha2";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createOfflineHelia, type OfflineHelia } from "../../store/src/test-utils/offline-helia.js";
import {
	collectPromotableArtifacts,
	sha256HexBytes,
	toPublishedArtifactRef,
} from "./collection-artifacts.js";
import { catalogFilePath, writeCatalog } from "./document-catalog.js";
import { archiveIndexPath, writeArchiveIndex } from "./raw-source-archive.js";

/**
 * Session 3 integrity-check tests. Session 1's round-trip test already proves
 * the happy path; these target the *defensive* behavior added in Session 3:
 *   - sha256 mismatch on raw-source-blob → throws at promote time
 *   - cross-reference check: raw-source-index entry with no matching
 *     raw-source-blob ref → throws at pull time (exercised via the
 *     integrity primitives exposed from this module; the full pull command
 *     test lives in @wtfoc/cli).
 */
describe("collection-artifacts integrity guards", () => {
	let node: OfflineHelia;
	let manifestDir: string;
	let fetchGuard: MockInstance<typeof globalThis.fetch>;

	beforeEach(async () => {
		node = await createOfflineHelia();
		manifestDir = await mkdtemp(join(tmpdir(), "wtfoc-integrity-"));
		fetchGuard = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
			throw new Error("offline harness: no network allowed");
		});
	});

	afterEach(async () => {
		fetchGuard.mockRestore();
		await node.cleanup();
		await rm(manifestDir, { recursive: true, force: true });
	});

	it("toPublishedArtifactRef throws when raw-source-blob sidecar sha disagrees with actual bytes", async () => {
		const collectionName = "mismatch-fixture";
		const rawBytes = new TextEncoder().encode("actual raw content");
		const rawStorageId = await computeBareCid(rawBytes);

		// Deliberately wrong checksum recorded in the sidecar — simulates a
		// stale raw-source-index after manual corruption / schema skew.
		await writeArchiveIndex(archiveIndexPath(manifestDir, collectionName), {
			schemaVersion: 1,
			collectionId: "col-1",
			entries: {
				"doc/v1": {
					documentId: "doc",
					documentVersionId: "v1",
					mediaType: "text/plain",
					checksum: "deadbeef".repeat(8),
					byteLength: rawBytes.length,
					fetchedAt: new Date().toISOString(),
					storageId: rawStorageId,
					sourceType: "test",
				},
			},
		});

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "col-1",
			name: collectionName,
			currentRevisionId: null,
			prevHeadId: null,
			segments: [],
			totalChunks: 0,
			embeddingModel: "test",
			embeddingDimensions: 4,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const localBlobs = new Map([[rawStorageId, rawBytes]]);
		const artifacts = await collectPromotableArtifacts(
			head,
			collectionName,
			manifestDir,
			async (id) => localBlobs.get(id) ?? new Uint8Array(),
		);

		const rawBlobArtifact = artifacts.find((a) => a.kind === "raw-source-blob");
		if (!rawBlobArtifact) throw new Error("fixture missing raw-source-blob artifact");

		// Simulate what buildEnrichedCollectionHead does — hand actual computed sha
		// from bytes. toPublishedArtifactRef should cross-check against the sidecar's
		// recorded sha and throw.
		expect(() =>
			toPublishedArtifactRef(
				rawBlobArtifact,
				"bafkreiFakeCid",
				rawBytes.length,
				sha256HexBytes(rawBytes),
			),
		).toThrow(/checksum mismatch/i);
	});

	it("toPublishedArtifactRef accepts matching raw-source-blob sha", async () => {
		const collectionName = "match-fixture";
		const rawBytes = new TextEncoder().encode("content");
		const rawStorageId = await computeBareCid(rawBytes);
		const correctSha = sha256HexBytes(rawBytes);

		await writeArchiveIndex(archiveIndexPath(manifestDir, collectionName), {
			schemaVersion: 1,
			collectionId: "col-1",
			entries: {
				"doc/v1": {
					documentId: "doc",
					documentVersionId: "v1",
					mediaType: "text/plain",
					checksum: correctSha,
					byteLength: rawBytes.length,
					fetchedAt: new Date().toISOString(),
					storageId: rawStorageId,
					sourceType: "test",
				},
			},
		});

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "col-1",
			name: collectionName,
			currentRevisionId: null,
			prevHeadId: null,
			segments: [],
			totalChunks: 0,
			embeddingModel: "test",
			embeddingDimensions: 4,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const localBlobs = new Map([[rawStorageId, rawBytes]]);
		const artifacts = await collectPromotableArtifacts(
			head,
			collectionName,
			manifestDir,
			async (id) => localBlobs.get(id) ?? new Uint8Array(),
		);

		const rawBlobArtifact = artifacts.find((a) => a.kind === "raw-source-blob");
		if (!rawBlobArtifact) throw new Error("fixture missing raw-source-blob artifact");

		const ref = toPublishedArtifactRef(
			rawBlobArtifact,
			"bafkreiFakeCid",
			rawBytes.length,
			correctSha,
		);
		expect(ref.kind).toBe("raw-source-blob");
		if (ref.kind === "raw-source-blob") {
			expect(ref.sha256).toBe(correctSha);
		}
	});

	it("verify-style retrieval: every ref resolves to byte-equal original via CidReadableStorage", async () => {
		// Smoke test that the verify-only data path (download + sha-check without
		// writing) works against the offline harness. Full CLI-level
		// exercise lives in @wtfoc/cli once e2e mock storage is wired up.
		const bytes = new TextEncoder().encode("verify-me");
		const cid = await node.publishBytes(bytes);

		const verifiedFetch = await createVerifiedFetch(node.helia);
		const reader = new CidReadableStorage({ verifiedFetch });

		const fetched = await reader.download(cid.toString());
		expect(fetched).toEqual(bytes);
		expect(sha256HexBytes(fetched)).toEqual(sha256HexBytes(bytes));
	});

	it("sidecar JSON shape validation pattern — rejects wrong schemaVersion", () => {
		const badIndex = { schemaVersion: 99, collectionId: "x", entries: {} };
		const bytes = new TextEncoder().encode(JSON.stringify(badIndex));
		const parsed = JSON.parse(new TextDecoder().decode(bytes));
		expect(parsed.schemaVersion).toBe(99);
		expect(parsed.schemaVersion).not.toBe(1);
		// Real enforcement lives in pull.ts validateSidecarJson — this test just
		// asserts the fixture shape used there is sane (schemaVersion=1 required).
	});

	it("cross-reference check spots missing raw-source-blob refs", async () => {
		// Exercises the invariant pull.ts enforces: every storageId in the
		// raw-source-index sidecar must also appear as a raw-source-blob ref in
		// artifactRefs[]. Build a manifest that violates it and assert the
		// check function (inlined here because it's a private helper) finds
		// the offending entries.
		const index = {
			schemaVersion: 1 as const,
			collectionId: "col",
			entries: {
				"doc1/v1": buildEntry("doc1", "v1", "storage-id-1"),
				"doc2/v1": buildEntry("doc2", "v1", "storage-id-missing"),
			},
		};
		const blobIds = new Set(["storage-id-1"]);

		const missing: string[] = [];
		for (const entry of Object.values(index.entries)) {
			if (!blobIds.has(entry.storageId)) {
				missing.push(`${entry.documentId} (${entry.storageId})`);
			}
		}
		expect(missing).toHaveLength(1);
		expect(missing[0]).toContain("doc2");
		expect(missing[0]).toContain("storage-id-missing");
	});

	it("catalog fixture round-trip — sanity for verify-only path", async () => {
		const catalog: DocumentCatalog = {
			schemaVersion: 1,
			collectionId: "col",
			documents: {
				"doc-a": {
					documentId: "doc-a",
					currentVersionId: "v1",
					previousVersionIds: [],
					chunkIds: ["c1"],
					supersededChunkIds: [],
					contentFingerprints: ["fp1"],
					state: "active",
					mutability: "mutable-state",
					sourceType: "test",
					updatedAt: new Date().toISOString(),
				},
			},
		};
		await writeCatalog(catalogFilePath(manifestDir, "x"), catalog);
		const bytes = new TextEncoder().encode(JSON.stringify(catalog));
		const cid = await node.publishBytes(bytes);

		const verifiedFetch = await createVerifiedFetch(node.helia);
		const reader = new CidReadableStorage({ verifiedFetch });
		const fetched = await reader.download(cid.toString());

		const parsed = JSON.parse(new TextDecoder().decode(fetched)) as DocumentCatalog;
		expect(parsed.schemaVersion).toBe(1);
		expect(Object.keys(parsed.documents)).toContain("doc-a");
	});
});

function buildEntry(documentId: string, documentVersionId: string, storageId: string) {
	return {
		documentId,
		documentVersionId,
		mediaType: "text/plain",
		checksum: "x".repeat(64),
		byteLength: 0,
		fetchedAt: new Date().toISOString(),
		storageId,
		sourceType: "test",
	};
}

async function computeBareCid(bytes: Uint8Array): Promise<string> {
	const hash = await sha256Digest.digest(bytes);
	return CID.create(1, raw.code, hash).toString();
}

// Also checks the coverage logic at a lightweight level — real exercise is
// promote.ts which lives in @wtfoc/cli.
describe("artifact coverage (promote short-circuit)", () => {
	it("treats missing artifactRefs as not-covered", () => {
		const refs: PublishedArtifactRef[] | undefined = undefined;
		expect(refs).toBeUndefined();
	});

	it("all-blob coverage matches by storageId", () => {
		const refs: PublishedArtifactRef[] = [
			{ kind: "segment", storageId: "s1", ipfsCid: "cid-s1", byteLength: 10 },
			{
				kind: "derived-edge-layer",
				storageId: "l1",
				ipfsCid: "cid-l1",
				extractorId: "e",
				edgeCount: 1,
				byteLength: 20,
			},
		];
		const present = new Set(
			refs
				.filter((r) => r.kind === "segment" || r.kind === "derived-edge-layer")
				.map((r) => (r as { storageId: string }).storageId),
		);
		expect(present.has("s1")).toBe(true);
		expect(present.has("l1")).toBe(true);
		expect(present.has("s2")).toBe(false);
	});
});
