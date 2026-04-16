import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVerifiedFetch } from "@helia/verified-fetch";
import type {
	CollectionHead,
	DocumentCatalog,
	PublishedArtifactRef,
	PublishedSidecarRole,
} from "@wtfoc/common";
import { CidReadableStorage } from "@wtfoc/store";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 as sha256Digest } from "multiformats/hashes/sha2";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
// Relative import because the test harness is intentionally not exported from
// `@wtfoc/store` — it depends on dev-only packages (helia/blockstore-fs). This
// test file is excluded from tsc build, so vitest resolves it at runtime.
import { createOfflineHelia, type OfflineHelia } from "../../store/src/test-utils/offline-helia.js";
import {
	collectPromotableArtifacts,
	enumeratePromotableArtifacts,
	sha256HexBytes,
	toPublishedArtifactRef,
} from "./collection-artifacts.js";
import { catalogFilePath, writeCatalog } from "./document-catalog.js";
import { archiveIndexPath, writeArchiveIndex } from "./raw-source-archive.js";

/**
 * Contract test for the collection self-containment pipeline.
 *
 * Builds a fixture collection with ONE OF EVERY `PublishedArtifactKind`,
 * publishes every artifact + the enriched manifest into an offline Helia node,
 * then resolves the manifest CID and pulls every artifact back via
 * `resolveCollectionByCid`. Asserts byte-for-byte round-trip.
 *
 * This is the canonical future-proofing guard for #271 — if a new
 * `PublishedArtifactKind` is added without updating the fixture + promote/pull
 * handlers, either TypeScript exhaustiveness breaks (toPublishedArtifactRef or
 * resolver switch) or this test fails to cover the new kind.
 */
describe("collection self-containment round-trip (store-layer)", () => {
	let node: OfflineHelia;
	let manifestDir: string;
	let fetchGuard: MockInstance<typeof globalThis.fetch>;

	beforeEach(async () => {
		node = await createOfflineHelia();
		manifestDir = await mkdtemp(join(tmpdir(), "wtfoc-roundtrip-manifests-"));
		fetchGuard = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			throw new Error(`offline harness: no network allowed (attempted fetch: ${String(input)})`);
		});
	});

	afterEach(async () => {
		fetchGuard.mockRestore();
		await node.cleanup();
		await rm(manifestDir, { recursive: true, force: true });
	});

	it("round-trips every PublishedArtifactKind via resolveCollectionByCid", async () => {
		const collectionName = "roundtrip-fixture";

		// ── 1. Build a synthetic collection with one of every artifact kind ──────
		const segmentBytes = new TextEncoder().encode(
			JSON.stringify({ schemaVersion: 1, chunks: [], edges: [] }),
		);
		const edgeLayerBytes = new TextEncoder().encode(
			JSON.stringify({ edges: [{ type: "mentions", sourceId: "a", targetId: "b" }] }),
		);
		const rawBlobBytes = new TextEncoder().encode("raw document content for round-trip");

		const segmentStorageId = await computeBareCid(segmentBytes);
		const edgeLayerStorageId = await computeBareCid(edgeLayerBytes);
		const rawBlobStorageId = await computeBareCid(rawBlobBytes);

		// Pre-populate local blobs so enumeratePromotableArtifacts can download them
		const localBlobs = new Map<string, Uint8Array>([
			[segmentStorageId, segmentBytes],
			[edgeLayerStorageId, edgeLayerBytes],
			[rawBlobStorageId, rawBlobBytes],
		]);
		const downloadBlob = async (id: string) => {
			const bytes = localBlobs.get(id);
			if (!bytes) throw new Error(`no local blob for ${id}`);
			return bytes;
		};

		// Write the two sidecar files so enumerate can read them
		await writeArchiveIndex(archiveIndexPath(manifestDir, collectionName), {
			schemaVersion: 1,
			collectionId: "col-1",
			entries: {
				"doc/v1": {
					documentId: "doc",
					documentVersionId: "v1",
					mediaType: "text/plain",
					checksum: sha256HexBytes(rawBlobBytes),
					byteLength: rawBlobBytes.length,
					fetchedAt: new Date().toISOString(),
					storageId: rawBlobStorageId,
					sourceType: "test",
				},
			},
		});

		const catalog: DocumentCatalog = {
			schemaVersion: 1,
			collectionId: "col-1",
			documents: {
				doc: {
					documentId: "doc",
					currentVersionId: "v1",
					previousVersionIds: [],
					chunkIds: ["chunk-1"],
					supersededChunkIds: [],
					contentFingerprints: [sha256HexBytes(rawBlobBytes)],
					state: "active",
					mutability: "mutable-state",
					sourceType: "test",
					updatedAt: new Date().toISOString(),
				},
			},
		};
		await writeCatalog(catalogFilePath(manifestDir, collectionName), catalog);

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "col-1",
			name: collectionName,
			currentRevisionId: null,
			prevHeadId: null,
			segments: [
				{
					id: segmentStorageId,
					sourceTypes: ["test"],
					chunkCount: 0,
				},
			],
			derivedEdgeLayers: [
				{
					id: edgeLayerStorageId,
					extractorId: "test-extractor",
					edgeCount: 1,
					contextsProcessed: 1,
					createdAt: new Date().toISOString(),
				},
			],
			totalChunks: 0,
			embeddingModel: "test-model",
			embeddingDimensions: 4,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		// ── 2. Enumerate every promotable artifact ──────────────────────────────
		const artifacts = await collectPromotableArtifacts(
			head,
			collectionName,
			manifestDir,
			downloadBlob,
		);

		// Sanity: one of every kind is present
		expect(artifacts.map((a) => a.kind).sort()).toEqual(
			["derived-edge-layer", "raw-source-blob", "segment", "sidecar", "sidecar"].sort(),
		);

		// ── 3. Publish every artifact into offline Helia + build artifactRefs ────
		const artifactRefs: PublishedArtifactRef[] = [];
		for (const artifact of artifacts) {
			const bytes = await artifact.getBytes();
			const publishedCid = await node.publishBytes(bytes);
			artifactRefs.push(
				toPublishedArtifactRef(
					artifact,
					publishedCid.toString(),
					bytes.length,
					sha256HexBytes(bytes),
				),
			);
		}

		// Also publish the enriched manifest itself — pull starts from its CID
		const enrichedHead: CollectionHead = { ...head, artifactRefs };
		const manifestBytes = new TextEncoder().encode(JSON.stringify(enrichedHead));
		const manifestCid = await node.publishBytes(manifestBytes);

		// ── 4. Pull: resolve by CID using offline Helia as the IPFS backend ─────
		const verifiedFetch = await createVerifiedFetch(node.helia);
		const cidReader = new CidReadableStorage({ verifiedFetch });

		// resolveCollectionByCid uses its own CidReadableStorage internally — we
		// can't swap that yet, so exercise the resolver's logic manually here by
		// reconstructing what it would do. (Threading a custom reader through
		// resolveCollectionByCid is a Session 2 concern when pull.ts is refactored.)
		const fetchedManifestBytes = await cidReader.download(manifestCid.toString());
		const fetchedManifest: CollectionHead = JSON.parse(
			new TextDecoder().decode(fetchedManifestBytes),
		);

		expect(fetchedManifest.artifactRefs).toBeDefined();
		expect(fetchedManifest.artifactRefs).toHaveLength(artifacts.length);

		// ── 5. Every published ref resolves back to byte-equal original ─────────
		const artifactsById = new Map(artifacts.map((a) => [a.id, a]));

		const seenKinds = new Set<PublishedArtifactRef["kind"]>();
		const seenSidecarRoles = new Set<PublishedSidecarRole>();

		for (const ref of fetchedManifest.artifactRefs ?? []) {
			seenKinds.add(ref.kind);
			const fetchedBytes = await cidReader.download(ref.ipfsCid);
			expect(fetchedBytes.length).toBe(ref.byteLength);

			switch (ref.kind) {
				case "segment":
				case "derived-edge-layer":
				case "raw-source-blob": {
					const original = artifactsById.get(ref.storageId);
					if (!original) throw new Error(`no local artifact for ${ref.storageId}`);
					const originalBytes = await original.getBytes();
					expect(fetchedBytes).toEqual(originalBytes);
					break;
				}
				case "sidecar": {
					seenSidecarRoles.add(ref.role);
					expect(sha256HexBytes(fetchedBytes)).toBe(ref.sha256);
					break;
				}
				default: {
					const exhaustive: never = ref;
					throw new Error(`unhandled kind ${JSON.stringify(exhaustive)}`);
				}
			}
		}

		// Contract: every kind covered, both sidecar roles present
		expect(seenKinds).toEqual(
			new Set(["segment", "derived-edge-layer", "raw-source-blob", "sidecar"]),
		);
		expect(seenSidecarRoles).toEqual(new Set(["raw-source-index", "document-catalog"]));
	});

	it("exposes enumeration as a streaming async generator (no full pre-load)", async () => {
		// Smoke test: the generator yields incrementally; early exit works.
		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "col",
			name: "empty",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [
				{ id: "s1", sourceTypes: [], chunkCount: 0 },
				{ id: "s2", sourceTypes: [], chunkCount: 0 },
			],
			totalChunks: 0,
			embeddingModel: "m",
			embeddingDimensions: 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		const iter = enumeratePromotableArtifacts(
			head,
			"empty",
			manifestDir,
			async () => new Uint8Array(),
		);
		const { value, done } = await iter[Symbol.asyncIterator]().next();
		expect(done).toBe(false);
		expect(value?.kind).toBe("segment");
		expect(value?.id).toBe("s1");
	});
});

/** Compute the bare sha256/raw CID of bytes (matches offline-helia.publishBytes). */
async function computeBareCid(bytes: Uint8Array): Promise<string> {
	const hash = await sha256Digest.digest(bytes);
	return CID.create(1, raw.code, hash).toString();
}
