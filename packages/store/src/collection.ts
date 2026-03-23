import { createHash } from "node:crypto";
import type {
	CollectionDescriptor,
	CollectionHead,
	CollectionRevision,
	DatasetRoutingMetadata,
} from "@wtfoc/common";
import { CURRENT_SCHEMA_VERSION, WtfocError } from "@wtfoc/common";

/**
 * Generate a deterministic collection ID by hashing {namespace}/{name}.
 * Collision-free for distinct namespaced names.
 */
export function generateCollectionId(name: string, namespace = "default"): string {
	return createHash("sha256").update(`${namespace}/${name}`).digest("hex").slice(0, 32);
}

/** Allowed keys in dataset routing metadata */
const ROUTING_METADATA_KEYS = new Set([
	"collectionId",
	"artifactKind",
	"sourceNamespace",
	"indexingFlags",
]);

/** Validate that dataset routing metadata contains only allowed keys */
export function validateRoutingMetadata(metadata: DatasetRoutingMetadata): void {
	const keys = Object.keys(metadata);
	for (const key of keys) {
		if (!ROUTING_METADATA_KEYS.has(key)) {
			throw new WtfocError(
				`Dataset routing metadata contains disallowed key "${key}". Only ${[...ROUTING_METADATA_KEYS].join(", ")} are permitted.`,
				"ROUTING_METADATA_INVALID",
				{ key },
			);
		}
	}
	if (!metadata.collectionId) {
		throw new WtfocError(
			"Dataset routing metadata must include collectionId",
			"ROUTING_METADATA_INVALID",
			{ field: "collectionId" },
		);
	}
}

/** Create an initial CollectionDescriptor for a new collection */
export function createCollectionDescriptor(
	name: string,
	namespace = "default",
	createdBy = "wtfoc-cli",
): CollectionDescriptor {
	const colId = generateCollectionId(name, namespace);
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		collectionId: colId,
		name,
		storageNamespace: namespace,
		createdAt: new Date().toISOString(),
		createdBy,
		routingMetadata: {
			collectionId: colId,
			artifactKind: "collection",
			sourceNamespace: namespace,
			indexingFlags: {},
		},
	};
}

/** Create an initial (empty) CollectionHead for a new collection */
export function createCollectionHead(name: string, namespace = "default"): CollectionHead {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		collectionId: generateCollectionId(name, namespace),
		name,
		currentRevisionId: null,
		prevHeadId: null,
		segments: [],
		totalChunks: 0,
		embeddingModel: "pending",
		embeddingDimensions: 0,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

/** Create an immutable CollectionRevision from current collection state */
export function createCollectionRevision(
	head: CollectionHead,
	publishedBy = "wtfoc-cli",
): CollectionRevision {
	const revisionId = createHash("sha256")
		.update(`${head.collectionId}/${head.updatedAt}/${head.segments.length}`)
		.digest("hex")
		.slice(0, 32);

	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		revisionId,
		collectionId: head.collectionId,
		prevRevisionId: head.currentRevisionId,
		artifactSummaries: head.segments.map((seg) => ({
			artifactId: seg.id,
			artifactRole: "segment" as const,
			sourceScope: seg.sourceTypes.join(","),
			contentIdentity: seg.ipfsCid ?? seg.id,
			storageId: seg.id,
			ipfsCid: seg.ipfsCid,
			pieceCid: seg.pieceCid,
		})),
		segmentRefs: head.segments.map((s) => s.id),
		bundleRefs: (head.batches ?? []).map((b) => b.carRootCid),
		provenance: [],
		createdAt: new Date().toISOString(),
		publishedBy,
	};
}
