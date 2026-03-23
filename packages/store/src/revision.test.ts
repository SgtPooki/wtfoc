import type { CollectionRevision } from "@wtfoc/common";
import { RevisionSchemaUnknownError, WtfocError } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { createCollectionHead, createCollectionRevision } from "./collection.js";
import { deserializeRevision, serializeRevision } from "./revision.js";

function makeRevision(overrides?: Partial<CollectionRevision>): CollectionRevision {
	const head = createCollectionHead("test-proj");
	head.segments = [{ id: "seg-1", sourceTypes: ["repo"], chunkCount: 5 }];
	const rev = createCollectionRevision(head);
	return { ...rev, ...overrides };
}

describe("revision serialization", () => {
	it("round-trips a valid revision through serialize/deserialize", () => {
		const rev = makeRevision();
		const bytes = serializeRevision(rev);
		const deserialized = deserializeRevision(bytes);

		expect(deserialized.revisionId).toBe(rev.revisionId);
		expect(deserialized.collectionId).toBe(rev.collectionId);
		expect(deserialized.prevRevisionId).toBeNull();
		expect(deserialized.segmentRefs).toEqual(["seg-1"]);
	});

	it("preserves revision lineage through serialization", () => {
		const head = createCollectionHead("lineage-test");
		head.segments = [{ id: "seg-1", sourceTypes: ["repo"], chunkCount: 1 }];

		const rev1 = createCollectionRevision(head);
		head.currentRevisionId = rev1.revisionId;
		head.segments.push({ id: "seg-2", sourceTypes: ["slack"], chunkCount: 2 });
		head.updatedAt = new Date().toISOString();

		const rev2 = createCollectionRevision(head);

		const bytes2 = serializeRevision(rev2);
		const deserialized2 = deserializeRevision(bytes2);

		expect(deserialized2.prevRevisionId).toBe(rev1.revisionId);
		expect(deserialized2.segmentRefs).toEqual(["seg-1", "seg-2"]);
	});

	it("preserves provenance records through serialization", () => {
		const rev = makeRevision({
			provenance: [
				{
					artifactId: "seg-1",
					artifactKind: "segment",
					derivedFrom: ["source-file-1"],
					primarySource: "repo:main",
					activityId: "ingest-001",
					activityType: "ingest",
					actorId: "wtfoc-cli",
					actorType: "software",
					derivationChain: ["source-file-1", "seg-1"],
				},
			],
		});

		const bytes = serializeRevision(rev);
		const deserialized = deserializeRevision(bytes);

		expect(deserialized.provenance).toHaveLength(1);
		expect(deserialized.provenance[0].primarySource).toBe("repo:main");
		expect(deserialized.provenance[0].actorType).toBe("software");
	});

	it("rejects unknown schema version with RevisionSchemaUnknownError", () => {
		const rev = makeRevision({ schemaVersion: 99 });
		const bytes = serializeRevision(rev);

		expect(() => deserializeRevision(bytes)).toThrow(RevisionSchemaUnknownError);
		try {
			deserializeRevision(bytes);
		} catch (e) {
			expect((e as RevisionSchemaUnknownError).code).toBe("REVISION_SCHEMA_UNKNOWN");
		}
	});

	it("rejects invalid JSON", () => {
		const bytes = new TextEncoder().encode("not json");
		expect(() => deserializeRevision(bytes)).toThrow(WtfocError);
	});

	it("rejects missing required fields", () => {
		const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1 }));
		expect(() => deserializeRevision(bytes)).toThrow(WtfocError);
	});
});

describe("revision provenance", () => {
	it("revision distinguishes source from derived artifacts via artifactRole", () => {
		const rev = makeRevision();
		for (const summary of rev.artifactSummaries) {
			expect(summary.artifactRole).toBe("segment");
		}
	});

	it("revision records bundle refs from head batches", () => {
		const head = createCollectionHead("bundle-test");
		head.segments = [{ id: "seg-1", sourceTypes: ["repo"], chunkCount: 1 }];
		head.batches = [
			{
				pieceCid: "piece-1",
				carRootCid: "car-root-1",
				segmentIds: ["seg-1"],
				createdAt: new Date().toISOString(),
			},
		];

		const rev = createCollectionRevision(head);
		expect(rev.bundleRefs).toEqual(["car-root-1"]);
	});

	it("revision has empty bundleRefs when no batches", () => {
		const head = createCollectionHead("no-batch");
		head.segments = [{ id: "seg-1", sourceTypes: ["repo"], chunkCount: 1 }];

		const rev = createCollectionRevision(head);
		expect(rev.bundleRefs).toEqual([]);
	});
});
