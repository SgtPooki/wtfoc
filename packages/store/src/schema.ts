import type { CollectionHead, Segment } from "@wtfoc/common";
import { SchemaUnknownError, WtfocError } from "@wtfoc/common";

/** Latest persisted manifest / segment format version. */
export const MAX_SUPPORTED_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaInvalid(kind: "headManifest" | "segment", msg: string, field?: string): WtfocError {
	const prefix = kind === "headManifest" ? "Invalid head manifest" : "Invalid segment";
	return new WtfocError(`${prefix}: ${msg}`, "SCHEMA_INVALID", field ? { field } : undefined);
}

function requireString(v: unknown): v is string {
	return typeof v === "string";
}

function requireNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.length > 0;
}

function requireNonNegInt(v: unknown): v is number {
	return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function requirePositiveInt(v: unknown): v is number {
	return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function requireStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every(requireString);
}

function requireNumberArray(v: unknown): v is number[] {
	return Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

function requireStringRecord(v: unknown): v is Record<string, string> {
	if (!isRecord(v)) return false;
	for (const k of Object.keys(v)) {
		if (typeof v[k] !== "string") return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// Schema-version gate (shared by both validators)
// ---------------------------------------------------------------------------

function validateSchemaVersion(
	data: Record<string, unknown>,
	kind: "headManifest" | "segment",
): number {
	const sv = data.schemaVersion;
	if (typeof sv !== "number" || !Number.isInteger(sv)) {
		throw schemaInvalid(kind, "schemaVersion must be an integer", "schemaVersion");
	}
	if (sv < 1 || sv > MAX_SUPPORTED_SCHEMA_VERSION) {
		throw new SchemaUnknownError(sv, MAX_SUPPORTED_SCHEMA_VERSION);
	}
	return sv;
}

// ---------------------------------------------------------------------------
// Manifest sub-validators (valibot-style inline, hand-tuned error messages)
// ---------------------------------------------------------------------------

import * as v from "valibot";

// ---- SegmentSummary --------------------------------------------------------

const TimeRangeSchema = v.object({
	from: v.string(),
	to: v.string(),
});

const SegmentSummarySchema = v.object({
	id: v.pipe(v.string(), v.nonEmpty()),
	sourceTypes: v.array(v.string()),
	chunkCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
	ipfsCid: v.optional(v.string()),
	pieceCid: v.optional(v.string()),
	timeRange: v.optional(TimeRangeSchema),
	repoIds: v.optional(v.array(v.string())),
});

function validateSegmentSummary(
	raw: unknown,
	index: number,
): ReturnType<typeof v.parse<typeof SegmentSummarySchema>> {
	if (!isRecord(raw)) {
		throw schemaInvalid(
			"headManifest",
			`segments[${index}] must be an object`,
			`segments[${index}]`,
		);
	}

	// Validate individual fields with exact error messages
	if (!requireNonEmptyString(raw.id)) {
		throw schemaInvalid(
			"headManifest",
			`segments[${index}].id must be a non-empty string`,
			`segments[${index}].id`,
		);
	}
	if (!requireStringArray(raw.sourceTypes)) {
		throw schemaInvalid(
			"headManifest",
			`segments[${index}].sourceTypes must be an array of strings`,
			`segments[${index}].sourceTypes`,
		);
	}
	if (!requireNonNegInt(raw.chunkCount)) {
		throw schemaInvalid(
			"headManifest",
			`segments[${index}].chunkCount must be a non-negative integer`,
			`segments[${index}].chunkCount`,
		);
	}

	const result = v.parse(SegmentSummarySchema, {
		id: raw.id,
		sourceTypes: raw.sourceTypes,
		chunkCount: raw.chunkCount,
	});

	if ("ipfsCid" in raw && raw.ipfsCid !== undefined) {
		if (!requireString(raw.ipfsCid)) {
			throw schemaInvalid(
				"headManifest",
				`segments[${index}].ipfsCid must be a string`,
				`segments[${index}].ipfsCid`,
			);
		}
		result.ipfsCid = raw.ipfsCid;
	}
	if ("pieceCid" in raw && raw.pieceCid !== undefined) {
		if (!requireString(raw.pieceCid)) {
			throw schemaInvalid(
				"headManifest",
				`segments[${index}].pieceCid must be a string`,
				`segments[${index}].pieceCid`,
			);
		}
		result.pieceCid = raw.pieceCid;
	}
	if ("timeRange" in raw && raw.timeRange !== undefined) {
		if (!isRecord(raw.timeRange)) {
			throw schemaInvalid(
				"headManifest",
				`segments[${index}].timeRange must be an object`,
				`segments[${index}].timeRange`,
			);
		}
		if (!requireString(raw.timeRange.from)) {
			throw schemaInvalid(
				"headManifest",
				`segments[${index}].timeRange.from must be a string`,
				`segments[${index}].timeRange.from`,
			);
		}
		if (!requireString(raw.timeRange.to)) {
			throw schemaInvalid(
				"headManifest",
				`segments[${index}].timeRange.to must be a string`,
				`segments[${index}].timeRange.to`,
			);
		}
		result.timeRange = v.parse(TimeRangeSchema, raw.timeRange);
	}
	if ("repoIds" in raw && raw.repoIds !== undefined) {
		if (!Array.isArray(raw.repoIds) || !raw.repoIds.every(requireString)) {
			throw schemaInvalid(
				"headManifest",
				`segments[${index}].repoIds must be an array of strings`,
				`segments[${index}].repoIds`,
			);
		}
		result.repoIds = raw.repoIds as string[];
	}

	return result;
}

// ---- BatchRecord -----------------------------------------------------------

const BatchRecordSchema = v.object({
	pieceCid: v.pipe(v.string(), v.nonEmpty()),
	carRootCid: v.pipe(v.string(), v.nonEmpty()),
	segmentIds: v.pipe(v.array(v.pipe(v.string(), v.nonEmpty())), v.minLength(1)),
	createdAt: v.string(),
});

function validateBatchRecord(raw: unknown, index: number): v.InferOutput<typeof BatchRecordSchema> {
	if (!isRecord(raw)) {
		throw schemaInvalid("headManifest", `batches[${index}] must be an object`, `batches[${index}]`);
	}
	if (!requireNonEmptyString(raw.pieceCid)) {
		throw schemaInvalid(
			"headManifest",
			`batches[${index}].pieceCid must be a non-empty string`,
			`batches[${index}].pieceCid`,
		);
	}
	if (!requireNonEmptyString(raw.carRootCid)) {
		throw schemaInvalid(
			"headManifest",
			`batches[${index}].carRootCid must be a non-empty string`,
			`batches[${index}].carRootCid`,
		);
	}
	if (
		!Array.isArray(raw.segmentIds) ||
		raw.segmentIds.length === 0 ||
		!raw.segmentIds.every(requireNonEmptyString)
	) {
		throw schemaInvalid(
			"headManifest",
			`batches[${index}].segmentIds must be a non-empty array of non-empty strings`,
			`batches[${index}].segmentIds`,
		);
	}
	if (!requireString(raw.createdAt) || Number.isNaN(Date.parse(raw.createdAt as string))) {
		throw schemaInvalid(
			"headManifest",
			`batches[${index}].createdAt must be a valid ISO 8601 date string`,
			`batches[${index}].createdAt`,
		);
	}

	return v.parse(BatchRecordSchema, raw);
}

// ---- Manifest top-level schema ---------------------------------------------

const ManifestCoreSchema = v.object({
	schemaVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
	collectionId: v.pipe(v.string(), v.nonEmpty()),
	name: v.pipe(v.string(), v.nonEmpty()),
	currentRevisionId: v.nullable(v.string()),
	prevHeadId: v.nullable(v.string()),
	segments: v.array(SegmentSummarySchema),
	totalChunks: v.pipe(v.number(), v.integer(), v.minValue(0)),
	embeddingModel: v.pipe(v.string(), v.nonEmpty()),
	embeddingDimensions: v.pipe(v.number(), v.integer(), v.minValue(0)),
	createdAt: v.string(),
	updatedAt: v.string(),
	batches: v.optional(v.array(BatchRecordSchema)),
});

/**
 * Validates unknown JSON-compatible data as a {@link CollectionHead}.
 * Rejects unknown `schemaVersion` with {@link SchemaUnknownError}.
 */
export function validateManifestSchema(data: unknown): CollectionHead {
	if (!isRecord(data)) {
		throw new WtfocError("Invalid head manifest: expected an object", "SCHEMA_INVALID");
	}

	const sv = validateSchemaVersion(data, "headManifest");

	if (!requireNonEmptyString(data.name)) {
		throw schemaInvalid("headManifest", "name must be a non-empty string", "name");
	}

	// prevHeadId: required, must be string | null
	if (data.prevHeadId === undefined) {
		throw schemaInvalid("headManifest", "prevHeadId is required (string or null)", "prevHeadId");
	}
	if (data.prevHeadId !== null && typeof data.prevHeadId !== "string") {
		throw schemaInvalid("headManifest", "prevHeadId must be string or null", "prevHeadId");
	}

	if (!Array.isArray(data.segments)) {
		throw schemaInvalid("headManifest", "segments must be an array", "segments");
	}
	const segments = (data.segments as unknown[]).map((item, i) => validateSegmentSummary(item, i));

	if (!requireNonNegInt(data.totalChunks)) {
		throw schemaInvalid(
			"headManifest",
			"totalChunks must be a non-negative integer",
			"totalChunks",
		);
	}
	if (!requireNonEmptyString(data.embeddingModel)) {
		throw schemaInvalid(
			"headManifest",
			"embeddingModel must be a non-empty string",
			"embeddingModel",
		);
	}
	if (!requireNonNegInt(data.embeddingDimensions)) {
		throw schemaInvalid(
			"headManifest",
			"embeddingDimensions must be a non-negative integer",
			"embeddingDimensions",
		);
	}
	if (!requireString(data.createdAt)) {
		throw schemaInvalid("headManifest", "createdAt must be a string", "createdAt");
	}
	if (!requireString(data.updatedAt)) {
		throw schemaInvalid("headManifest", "updatedAt must be a string", "updatedAt");
	}
	if (!requireNonEmptyString(data.collectionId)) {
		throw schemaInvalid("headManifest", "collectionId must be a non-empty string", "collectionId");
	}

	// currentRevisionId: required, must be string | null
	if (data.currentRevisionId !== null && typeof data.currentRevisionId !== "string") {
		throw schemaInvalid(
			"headManifest",
			"currentRevisionId must be string or null",
			"currentRevisionId",
		);
	}
	if (data.currentRevisionId === undefined) {
		throw schemaInvalid(
			"headManifest",
			"currentRevisionId is required (string or null)",
			"currentRevisionId",
		);
	}

	// Build the validated manifest via valibot core schema (struct check)
	const manifest: CollectionHead = v.parse(ManifestCoreSchema, {
		schemaVersion: sv,
		collectionId: data.collectionId,
		name: data.name,
		currentRevisionId: data.currentRevisionId,
		prevHeadId: data.prevHeadId,
		segments,
		totalChunks: data.totalChunks,
		embeddingModel: data.embeddingModel,
		embeddingDimensions: data.embeddingDimensions,
		createdAt: data.createdAt,
		updatedAt: data.updatedAt,
	});

	// Batches (optional)
	if ("batches" in data && data.batches !== undefined) {
		if (!Array.isArray(data.batches)) {
			throw schemaInvalid("headManifest", "batches must be an array", "batches");
		}
		manifest.batches = (data.batches as unknown[]).map((item, i) => validateBatchRecord(item, i));

		// Cross-reference: segmentIds must reference actual manifest segments
		const segmentIdSet = new Set(manifest.segments.map((s) => s.id));
		const seenSegmentIds = new Set<string>();
		const batches = manifest.batches;
		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			if (!batch) continue;
			for (const sid of batch.segmentIds) {
				if (!segmentIdSet.has(sid)) {
					throw new WtfocError(
						`Invalid head manifest: batches[${i}].segmentIds references unknown segment "${sid}"`,
						"SCHEMA_INVALID",
						{ field: `batches[${i}].segmentIds` },
					);
				}
				if (seenSegmentIds.has(sid)) {
					throw new WtfocError(
						`Invalid head manifest: segment "${sid}" appears in multiple batch records`,
						"SCHEMA_INVALID",
						{ field: `batches[${i}].segmentIds` },
					);
				}
				seenSegmentIds.add(sid);
			}
		}
	}

	return manifest;
}

// ---------------------------------------------------------------------------
// Segment validation
// ---------------------------------------------------------------------------

const ChunkSchema = v.object({
	id: v.pipe(v.string(), v.nonEmpty()),
	storageId: v.pipe(v.string(), v.nonEmpty()),
	content: v.string(),
	embedding: v.array(v.number()),
	terms: v.array(v.string()),
	source: v.pipe(v.string(), v.nonEmpty()),
	sourceType: v.pipe(v.string(), v.nonEmpty()),
	sourceUrl: v.optional(v.string()),
	timestamp: v.optional(v.string()),
	metadata: v.record(v.string(), v.string()),
});

const EdgeSchema = v.object({
	type: v.pipe(v.string(), v.nonEmpty()),
	sourceId: v.pipe(v.string(), v.nonEmpty()),
	targetType: v.pipe(v.string(), v.nonEmpty()),
	targetId: v.pipe(v.string(), v.nonEmpty()),
	evidence: v.string(),
	confidence: v.pipe(v.number(), v.finite()),
});

const SegmentSchema = v.object({
	schemaVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
	embeddingModel: v.pipe(v.string(), v.nonEmpty()),
	embeddingDimensions: v.pipe(v.number(), v.integer(), v.minValue(1)),
	chunks: v.array(ChunkSchema),
	edges: v.array(EdgeSchema),
});

function validateChunk(
	raw: unknown,
	index: number,
	embeddingDimensions: number,
): Segment["chunks"][number] {
	if (!isRecord(raw)) {
		throw schemaInvalid("segment", `chunks[${index}] must be an object`, `chunks[${index}]`);
	}
	if (!requireNonEmptyString(raw.id)) {
		throw schemaInvalid(
			"segment",
			`chunks[${index}].id must be a non-empty string`,
			`chunks[${index}].id`,
		);
	}
	if (!requireNonEmptyString(raw.storageId)) {
		throw schemaInvalid(
			"segment",
			`chunks[${index}].storageId must be a non-empty string`,
			`chunks[${index}].storageId`,
		);
	}
	if (!requireNumberArray(raw.embedding)) {
		throw schemaInvalid(
			"segment",
			`chunks[${index}].embedding must be a number array`,
			`chunks[${index}].embedding`,
		);
	}
	if ((raw.embedding as number[]).length !== embeddingDimensions) {
		throw schemaInvalid(
			"segment",
			`chunks[${index}].embedding length must equal embeddingDimensions (${embeddingDimensions})`,
			`chunks[${index}].embedding`,
		);
	}
	if (!requireStringArray(raw.terms)) {
		throw schemaInvalid(
			"segment",
			`chunks[${index}].terms must be an array of strings`,
			`chunks[${index}].terms`,
		);
	}
	if (!requireNonEmptyString(raw.source)) {
		throw schemaInvalid(
			"segment",
			`chunks[${index}].source must be a non-empty string`,
			`chunks[${index}].source`,
		);
	}
	if (!requireNonEmptyString(raw.sourceType)) {
		throw schemaInvalid(
			"segment",
			`chunks[${index}].sourceType must be a non-empty string`,
			`chunks[${index}].sourceType`,
		);
	}
	if (!requireString(raw.content)) {
		throw schemaInvalid(
			"segment",
			`chunks[${index}].content must be a string`,
			`chunks[${index}].content`,
		);
	}
	if (!requireStringRecord(raw.metadata)) {
		throw schemaInvalid(
			"segment",
			`chunks[${index}].metadata must be a string record`,
			`chunks[${index}].metadata`,
		);
	}

	const chunk: Segment["chunks"][number] = v.parse(ChunkSchema, {
		id: raw.id,
		storageId: raw.storageId,
		content: raw.content,
		embedding: raw.embedding,
		terms: raw.terms,
		source: raw.source,
		sourceType: raw.sourceType,
		metadata: raw.metadata,
	});

	if ("sourceUrl" in raw && raw.sourceUrl !== undefined) {
		if (!requireString(raw.sourceUrl)) {
			throw schemaInvalid(
				"segment",
				`chunks[${index}].sourceUrl must be a string`,
				`chunks[${index}].sourceUrl`,
			);
		}
		chunk.sourceUrl = raw.sourceUrl;
	}
	if ("timestamp" in raw && raw.timestamp !== undefined) {
		if (!requireString(raw.timestamp)) {
			throw schemaInvalid(
				"segment",
				`chunks[${index}].timestamp must be a string`,
				`chunks[${index}].timestamp`,
			);
		}
		chunk.timestamp = raw.timestamp;
	}

	return chunk;
}

function validateEdge(raw: unknown, index: number): Segment["edges"][number] {
	if (!isRecord(raw)) {
		throw schemaInvalid("segment", `edges[${index}] must be an object`, `edges[${index}]`);
	}
	if (!requireNonEmptyString(raw.type)) {
		throw schemaInvalid(
			"segment",
			`edges[${index}].type must be a non-empty string`,
			`edges[${index}].type`,
		);
	}
	if (!requireNonEmptyString(raw.sourceId)) {
		throw schemaInvalid(
			"segment",
			`edges[${index}].sourceId must be a non-empty string`,
			`edges[${index}].sourceId`,
		);
	}
	if (!requireNonEmptyString(raw.targetType)) {
		throw schemaInvalid(
			"segment",
			`edges[${index}].targetType must be a non-empty string`,
			`edges[${index}].targetType`,
		);
	}
	if (!requireNonEmptyString(raw.targetId)) {
		throw schemaInvalid(
			"segment",
			`edges[${index}].targetId must be a non-empty string`,
			`edges[${index}].targetId`,
		);
	}
	if (!requireString(raw.evidence)) {
		throw schemaInvalid(
			"segment",
			`edges[${index}].evidence must be a string`,
			`edges[${index}].evidence`,
		);
	}
	const conf = raw.confidence;
	if (typeof conf !== "number" || !Number.isFinite(conf)) {
		throw schemaInvalid(
			"segment",
			`edges[${index}].confidence must be a finite number`,
			`edges[${index}].confidence`,
		);
	}

	return v.parse(EdgeSchema, raw);
}

/**
 * Validates unknown JSON-compatible data as a {@link Segment} per `@wtfoc/common`
 * (segment blobs do not include manifest-level fields such as `id` or `sourceTypes` on {@link SegmentSummary}).
 * Rejects unknown `schemaVersion` with {@link SchemaUnknownError}.
 */
export function validateSegmentSchema(data: unknown): Segment {
	if (!isRecord(data)) {
		throw new WtfocError("Invalid segment: expected an object", "SCHEMA_INVALID");
	}

	const sv = validateSchemaVersion(data, "segment");

	if (!requireNonEmptyString(data.embeddingModel)) {
		throw schemaInvalid("segment", "embeddingModel must be a non-empty string", "embeddingModel");
	}
	if (!requirePositiveInt(data.embeddingDimensions)) {
		throw schemaInvalid(
			"segment",
			"embeddingDimensions must be a positive integer",
			"embeddingDimensions",
		);
	}

	if (!Array.isArray(data.chunks)) {
		throw schemaInvalid("segment", "chunks must be an array", "chunks");
	}
	const chunks = (data.chunks as unknown[]).map((c, i) =>
		validateChunk(c, i, data.embeddingDimensions as number),
	);

	if (!Array.isArray(data.edges)) {
		throw schemaInvalid("segment", "edges must be an array", "edges");
	}
	const edges = (data.edges as unknown[]).map((e, i) => validateEdge(e, i));

	return v.parse(SegmentSchema, {
		schemaVersion: sv,
		embeddingModel: data.embeddingModel,
		embeddingDimensions: data.embeddingDimensions,
		chunks,
		edges,
	});
}
