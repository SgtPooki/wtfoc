import { describe, expect, it } from "vitest";
import {
	createCollectionDescriptor,
	createCollectionHead,
	createCollectionRevision,
	generateCollectionId,
	validateRoutingMetadata,
} from "./collection.js";

describe("generateCollectionId", () => {
	it("produces a deterministic 32-char hex ID", () => {
		const id1 = generateCollectionId("my-collection");
		const id2 = generateCollectionId("my-collection");
		expect(id1).toBe(id2);
		expect(id1).toHaveLength(32);
		expect(id1).toMatch(/^[a-f0-9]+$/);
	});

	it("produces different IDs for different names", () => {
		const id1 = generateCollectionId("alpha");
		const id2 = generateCollectionId("beta");
		expect(id1).not.toBe(id2);
	});

	it("produces different IDs for same name in different namespaces", () => {
		const id1 = generateCollectionId("project", "ns-a");
		const id2 = generateCollectionId("project", "ns-b");
		expect(id1).not.toBe(id2);
	});

	it("handles slug-like names that could collide without namespace", () => {
		const id1 = generateCollectionId("foc-ecosystem", "team-a");
		const id2 = generateCollectionId("foc-ecosystem", "team-b");
		expect(id1).not.toBe(id2);
	});

	it("defaults to 'default' namespace", () => {
		const explicit = generateCollectionId("test", "default");
		const implicit = generateCollectionId("test");
		expect(explicit).toBe(implicit);
	});
});

describe("validateRoutingMetadata", () => {
	it("accepts valid routing metadata", () => {
		expect(() =>
			validateRoutingMetadata({
				collectionId: "abc123",
				artifactKind: "collection",
				sourceNamespace: "default",
				indexingFlags: {},
			}),
		).not.toThrow();
	});

	it("rejects metadata missing collectionId", () => {
		expect(() =>
			validateRoutingMetadata({
				collectionId: "",
				artifactKind: "collection",
				sourceNamespace: "default",
				indexingFlags: {},
			}),
		).toThrow(/collectionId/);
	});
});

describe("createCollectionDescriptor", () => {
	it("creates a descriptor with deterministic collectionId", () => {
		const desc = createCollectionDescriptor("test-proj");
		expect(desc.collectionId).toBe(generateCollectionId("test-proj"));
		expect(desc.name).toBe("test-proj");
		expect(desc.storageNamespace).toBe("default");
		expect(desc.routingMetadata.collectionId).toBe(desc.collectionId);
	});

	it("uses provided namespace", () => {
		const desc = createCollectionDescriptor("proj", "custom-ns");
		expect(desc.storageNamespace).toBe("custom-ns");
		expect(desc.collectionId).toBe(generateCollectionId("proj", "custom-ns"));
	});
});

describe("createCollectionHead", () => {
	it("creates an empty head with deterministic collectionId", () => {
		const head = createCollectionHead("my-proj");
		expect(head.collectionId).toBe(generateCollectionId("my-proj"));
		expect(head.name).toBe("my-proj");
		expect(head.currentRevisionId).toBeNull();
		expect(head.segments).toEqual([]);
		expect(head.totalChunks).toBe(0);
	});

	it("sets initial embedding model to pending", () => {
		const head = createCollectionHead("test");
		expect(head.embeddingModel).toBe("pending");
		expect(head.embeddingDimensions).toBe(0);
	});

	it("includes description when opts.description is provided", () => {
		const head = createCollectionHead("test", "default", { description: "Test collection" });
		expect(head.description).toBe("Test collection");
	});

	it("omits description key when not provided", () => {
		const head = createCollectionHead("test");
		expect("description" in head).toBe(false);
	});
});

describe("createCollectionRevision", () => {
	it("creates a revision from a head with segments", () => {
		const head = createCollectionHead("test");
		head.segments = [
			{ id: "seg-1", sourceTypes: ["repo"], chunkCount: 5 },
			{ id: "seg-2", sourceTypes: ["slack"], chunkCount: 3 },
		];
		head.batches = [
			{
				pieceCid: "piece-1",
				carRootCid: "car-root-1",
				segmentIds: ["seg-1", "seg-2"],
				createdAt: new Date().toISOString(),
			},
		];

		const rev = createCollectionRevision(head);

		expect(rev.collectionId).toBe(head.collectionId);
		expect(rev.prevRevisionId).toBeNull();
		expect(rev.segmentRefs).toEqual(["seg-1", "seg-2"]);
		expect(rev.bundleRefs).toEqual(["car-root-1"]);
		expect(rev.artifactSummaries).toHaveLength(2);
		expect(rev.artifactSummaries[0].artifactRole).toBe("segment");
		expect(rev.revisionId).toHaveLength(32);
	});

	it("links to previous revision when head has currentRevisionId", () => {
		const head = createCollectionHead("test");
		head.currentRevisionId = "prev-rev-123";
		head.segments = [{ id: "seg-1", sourceTypes: ["repo"], chunkCount: 1 }];

		const rev = createCollectionRevision(head);
		expect(rev.prevRevisionId).toBe("prev-rev-123");
	});

	it("produces deterministic revisionId for same inputs", () => {
		const head = createCollectionHead("test");
		head.updatedAt = "2026-03-23T12:00:00.000Z";
		head.segments = [{ id: "seg-1", sourceTypes: ["repo"], chunkCount: 1 }];

		const rev1 = createCollectionRevision(head);
		const rev2 = createCollectionRevision(head);
		expect(rev1.revisionId).toBe(rev2.revisionId);
	});

	it("uses segment ipfsCid as contentIdentity when available", () => {
		const head = createCollectionHead("test");
		head.segments = [{ id: "seg-1", ipfsCid: "bafyipfs123", sourceTypes: ["repo"], chunkCount: 1 }];

		const rev = createCollectionRevision(head);
		expect(rev.artifactSummaries[0].contentIdentity).toBe("bafyipfs123");
	});

	it("uses SHA-256 of segment id for contentIdentity when no ipfsCid (local backend)", () => {
		const head = createCollectionHead("test");
		head.segments = [{ id: "local-seg-1", sourceTypes: ["repo"], chunkCount: 1 }];

		const rev = createCollectionRevision(head);
		expect(rev.artifactSummaries[0]?.contentIdentity).toMatch(/^[a-f0-9]{64}$/);
		expect(rev.artifactSummaries[0]?.contentIdentity).not.toBe("local-seg-1");
	});

	it("produces distinct revisionIds for heads with same timestamp/count but different segments", () => {
		const head1 = createCollectionHead("test");
		head1.updatedAt = "2026-03-23T12:00:00.000Z";
		head1.segments = [{ id: "seg-alpha", sourceTypes: ["repo"], chunkCount: 1 }];

		const head2 = createCollectionHead("test");
		head2.updatedAt = "2026-03-23T12:00:00.000Z";
		head2.segments = [{ id: "seg-beta", sourceTypes: ["repo"], chunkCount: 1 }];

		const rev1 = createCollectionRevision(head1);
		const rev2 = createCollectionRevision(head2);
		expect(rev1.revisionId).not.toBe(rev2.revisionId);
	});
});
