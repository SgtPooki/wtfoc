import type { CollectionHead } from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";
import * as v from "valibot";
import {
	isRecord,
	requireNonEmptyString,
	requireNonNegInt,
	requireString,
	requireStringArray,
	schemaInvalid,
	validateSchemaVersion,
} from "./shared.js";

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
		if (!requireStringArray(raw.repoIds)) {
			throw schemaInvalid(
				"headManifest",
				`segments[${index}].repoIds must be an array of strings`,
				`segments[${index}].repoIds`,
			);
		}
		result.repoIds = raw.repoIds;
	}

	return result;
}

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
	if (!requireString(raw.createdAt) || Number.isNaN(Date.parse(raw.createdAt))) {
		throw schemaInvalid(
			"headManifest",
			`batches[${index}].createdAt must be a valid ISO 8601 date string`,
			`batches[${index}].createdAt`,
		);
	}

	return v.parse(BatchRecordSchema, raw);
}

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

export function validateManifestSchema(data: unknown): CollectionHead {
	if (!isRecord(data)) {
		throw new WtfocError("Invalid head manifest: expected an object", "SCHEMA_INVALID");
	}

	const schemaVersion = validateSchemaVersion(data, "headManifest");

	if (!requireNonEmptyString(data.name)) {
		throw schemaInvalid("headManifest", "name must be a non-empty string", "name");
	}
	if (data.prevHeadId === undefined) {
		throw schemaInvalid("headManifest", "prevHeadId is required (string or null)", "prevHeadId");
	}
	if (data.prevHeadId !== null && typeof data.prevHeadId !== "string") {
		throw schemaInvalid("headManifest", "prevHeadId must be string or null", "prevHeadId");
	}
	if (!Array.isArray(data.segments)) {
		throw schemaInvalid("headManifest", "segments must be an array", "segments");
	}
	const segments = data.segments.map((item, index) => validateSegmentSummary(item, index));

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
	if (data.currentRevisionId === undefined) {
		throw schemaInvalid(
			"headManifest",
			"currentRevisionId is required (string or null)",
			"currentRevisionId",
		);
	}
	if (data.currentRevisionId !== null && typeof data.currentRevisionId !== "string") {
		throw schemaInvalid(
			"headManifest",
			"currentRevisionId must be string or null",
			"currentRevisionId",
		);
	}

	const manifest: CollectionHead = v.parse(ManifestCoreSchema, {
		schemaVersion,
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

	if ("batches" in data && data.batches !== undefined) {
		if (!Array.isArray(data.batches)) {
			throw schemaInvalid("headManifest", "batches must be an array", "batches");
		}
		manifest.batches = data.batches.map((item, index) => validateBatchRecord(item, index));

		// Batch segmentIds contain IPFS CIDs (from bundleAndUpload), not local segment IDs.
		// Build a lookup from any known identifier (local ID or IPFS CID) to the canonical
		// segment ID, so we can validate membership and detect duplicates consistently.
		const idToCanonical = new Map<string, string>();
		for (const segment of manifest.segments) {
			idToCanonical.set(segment.id, segment.id);
			if (segment.ipfsCid) idToCanonical.set(segment.ipfsCid, segment.id);
		}
		const seenCanonicalIds = new Set<string>();
		for (let index = 0; index < manifest.batches.length; index++) {
			const batch = manifest.batches[index];
			if (!batch) continue;
			for (const segmentId of batch.segmentIds) {
				const canonical = idToCanonical.get(segmentId);
				if (canonical === undefined) {
					throw new WtfocError(
						`Invalid head manifest: batches[${index}].segmentIds references unknown segment "${segmentId}"`,
						"SCHEMA_INVALID",
						{ field: `batches[${index}].segmentIds` },
					);
				}
				if (seenCanonicalIds.has(canonical)) {
					throw new WtfocError(
						`Invalid head manifest: segment "${segmentId}" appears in multiple batch records`,
						"SCHEMA_INVALID",
						{ field: `batches[${index}].segmentIds` },
					);
				}
				seenCanonicalIds.add(canonical);
			}
		}
	}

	return manifest;
}
