import type { BatchRecord, HeadManifest, Segment, SegmentSummary } from "@wtfoc/common";
import { SchemaUnknownError, WtfocError } from "@wtfoc/common";

/** Latest persisted manifest / segment format version. */
export const MAX_SUPPORTED_SCHEMA_VERSION = 1;

type SchemaKind = "headManifest" | "segment";

function errorPrefix(kind: SchemaKind): string {
	return kind === "headManifest" ? "Invalid head manifest" : "Invalid segment";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(v: unknown): v is unknown[] {
	return Array.isArray(v);
}

function requireField<T>(
	record: Record<string, unknown>,
	key: string,
	predicate: (v: unknown) => v is T,
	label: string,
	kind: SchemaKind,
	fieldPath?: string,
): T {
	const v = record[key];
	if (!predicate(v)) {
		throw new WtfocError(`${errorPrefix(kind)}: ${label}`, "SCHEMA_INVALID", {
			field: fieldPath ?? key,
		});
	}
	return v;
}

function isNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.length > 0;
}

function isString(v: unknown): v is string {
	return typeof v === "string";
}

function isFiniteNonNegativeInt(v: unknown): v is number {
	return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isPositiveFiniteInt(v: unknown): v is number {
	return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function validateSegmentSummary(raw: unknown, index: number): SegmentSummary {
	if (!isRecord(raw)) {
		throw new WtfocError(
			`Invalid head manifest: segments[${index}] must be an object`,
			"SCHEMA_INVALID",
			{ field: `segments[${index}]` },
		);
	}
	const id = requireField(
		raw,
		"id",
		isNonEmptyString,
		`segments[${index}].id must be a non-empty string`,
		"headManifest",
		`segments[${index}].id`,
	);
	const sourceTypes = requireField(
		raw,
		"sourceTypes",
		(v): v is string[] => Array.isArray(v) && v.every(isString),
		`segments[${index}].sourceTypes must be an array of strings`,
		"headManifest",
		`segments[${index}].sourceTypes`,
	);
	const chunkCount = requireField(
		raw,
		"chunkCount",
		isFiniteNonNegativeInt,
		`segments[${index}].chunkCount must be a non-negative integer`,
		"headManifest",
		`segments[${index}].chunkCount`,
	);

	const summary: SegmentSummary = { id, sourceTypes, chunkCount };

	if ("ipfsCid" in raw && raw.ipfsCid !== undefined) {
		if (!isString(raw.ipfsCid)) {
			throw new WtfocError(
				`Invalid head manifest: segments[${index}].ipfsCid must be a string`,
				"SCHEMA_INVALID",
				{ field: `segments[${index}].ipfsCid` },
			);
		}
		summary.ipfsCid = raw.ipfsCid;
	}
	if ("pieceCid" in raw && raw.pieceCid !== undefined) {
		if (!isString(raw.pieceCid)) {
			throw new WtfocError(
				`Invalid head manifest: segments[${index}].pieceCid must be a string`,
				"SCHEMA_INVALID",
				{ field: `segments[${index}].pieceCid` },
			);
		}
		summary.pieceCid = raw.pieceCid;
	}
	if ("timeRange" in raw && raw.timeRange !== undefined) {
		if (!isRecord(raw.timeRange)) {
			throw new WtfocError(
				`Invalid head manifest: segments[${index}].timeRange must be an object`,
				"SCHEMA_INVALID",
				{ field: `segments[${index}].timeRange` },
			);
		}
		const from = requireField(
			raw.timeRange,
			"from",
			isString,
			`segments[${index}].timeRange.from must be a string`,
			"headManifest",
			`segments[${index}].timeRange.from`,
		);
		const to = requireField(
			raw.timeRange,
			"to",
			isString,
			`segments[${index}].timeRange.to must be a string`,
			"headManifest",
			`segments[${index}].timeRange.to`,
		);
		summary.timeRange = { from, to };
	}
	if ("repoIds" in raw && raw.repoIds !== undefined) {
		if (!Array.isArray(raw.repoIds) || !raw.repoIds.every(isString)) {
			throw new WtfocError(
				`Invalid head manifest: segments[${index}].repoIds must be an array of strings`,
				"SCHEMA_INVALID",
				{ field: `segments[${index}].repoIds` },
			);
		}
		summary.repoIds = raw.repoIds;
	}

	return summary;
}

function validateBatchRecord(raw: unknown, index: number): BatchRecord {
	if (!isRecord(raw)) {
		throw new WtfocError(
			`Invalid head manifest: batches[${index}] must be an object`,
			"SCHEMA_INVALID",
			{ field: `batches[${index}]` },
		);
	}
	const pieceCid = requireField(
		raw,
		"pieceCid",
		isNonEmptyString,
		`batches[${index}].pieceCid must be a non-empty string`,
		"headManifest",
		`batches[${index}].pieceCid`,
	);
	const carRootCid = requireField(
		raw,
		"carRootCid",
		isNonEmptyString,
		`batches[${index}].carRootCid must be a non-empty string`,
		"headManifest",
		`batches[${index}].carRootCid`,
	);
	const segmentIds = requireField(
		raw,
		"segmentIds",
		(v): v is string[] => Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString),
		`batches[${index}].segmentIds must be a non-empty array of non-empty strings`,
		"headManifest",
		`batches[${index}].segmentIds`,
	);
	const createdAt = requireField(
		raw,
		"createdAt",
		(v): v is string => isString(v) && !Number.isNaN(Date.parse(v)),
		`batches[${index}].createdAt must be a valid ISO 8601 date string`,
		"headManifest",
		`batches[${index}].createdAt`,
	);
	return { pieceCid, carRootCid, segmentIds, createdAt };
}

/**
 * Validates unknown JSON-compatible data as a {@link HeadManifest}.
 * Rejects unknown `schemaVersion` with {@link SchemaUnknownError}.
 */
export function validateManifestSchema(data: unknown): HeadManifest {
	if (!isRecord(data)) {
		throw new WtfocError("Invalid head manifest: expected an object", "SCHEMA_INVALID");
	}

	const sv = data.schemaVersion;
	if (typeof sv !== "number" || !Number.isInteger(sv)) {
		throw new WtfocError(
			"Invalid head manifest: schemaVersion must be an integer",
			"SCHEMA_INVALID",
			{
				field: "schemaVersion",
			},
		);
	}
	if (sv < 1 || sv > MAX_SUPPORTED_SCHEMA_VERSION) {
		throw new SchemaUnknownError(sv, MAX_SUPPORTED_SCHEMA_VERSION);
	}

	const name = requireField(
		data,
		"name",
		isNonEmptyString,
		"name must be a non-empty string",
		"headManifest",
	);

	const prevHeadId = data.prevHeadId;
	if (prevHeadId === undefined) {
		throw new WtfocError(
			"Invalid head manifest: prevHeadId is required (string or null)",
			"SCHEMA_INVALID",
			{ field: "prevHeadId" },
		);
	}
	if (prevHeadId !== null && typeof prevHeadId !== "string") {
		throw new WtfocError(
			"Invalid head manifest: prevHeadId must be string or null",
			"SCHEMA_INVALID",
			{
				field: "prevHeadId",
			},
		);
	}

	const segmentsRaw = requireField(
		data,
		"segments",
		isUnknownArray,
		"segments must be an array",
		"headManifest",
	);
	const segments = segmentsRaw.map((item, i) => validateSegmentSummary(item, i));

	const totalChunks = requireField(
		data,
		"totalChunks",
		isFiniteNonNegativeInt,
		"totalChunks must be a non-negative integer",
		"headManifest",
	);
	const embeddingModel = requireField(
		data,
		"embeddingModel",
		isNonEmptyString,
		"embeddingModel must be a non-empty string",
		"headManifest",
	);
	const embeddingDimensions = requireField(
		data,
		"embeddingDimensions",
		isPositiveFiniteInt,
		"embeddingDimensions must be a positive integer",
		"headManifest",
	);
	const createdAt = requireField(
		data,
		"createdAt",
		isString,
		"createdAt must be a string",
		"headManifest",
	);
	const updatedAt = requireField(
		data,
		"updatedAt",
		isString,
		"updatedAt must be a string",
		"headManifest",
	);

	const manifest: HeadManifest = {
		schemaVersion: sv,
		name,
		prevHeadId,
		segments,
		totalChunks,
		embeddingModel,
		embeddingDimensions,
		createdAt,
		updatedAt,
	};

	if ("batches" in data && data.batches !== undefined) {
		const batchesRaw = requireField(
			data,
			"batches",
			isUnknownArray,
			"batches must be an array",
			"headManifest",
		);
		manifest.batches = batchesRaw.map((item, i) => validateBatchRecord(item, i));

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

function isNumberArray(v: unknown): v is number[] {
	return Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

function isStringRecord(v: unknown): v is Record<string, string> {
	if (!isRecord(v)) {
		return false;
	}
	for (const k of Object.keys(v)) {
		if (typeof v[k] !== "string") {
			return false;
		}
	}
	return true;
}

function validateChunk(
	raw: unknown,
	index: number,
	embeddingDimensions: number,
): Segment["chunks"][number] {
	if (!isRecord(raw)) {
		throw new WtfocError(`Invalid segment: chunks[${index}] must be an object`, "SCHEMA_INVALID", {
			field: `chunks[${index}]`,
		});
	}
	const id = requireField(
		raw,
		"id",
		isNonEmptyString,
		`chunks[${index}].id must be a non-empty string`,
		"segment",
		`chunks[${index}].id`,
	);
	const storageId = requireField(
		raw,
		"storageId",
		isNonEmptyString,
		`chunks[${index}].storageId must be a non-empty string`,
		"segment",
		`chunks[${index}].storageId`,
	);
	const embedding = requireField(
		raw,
		"embedding",
		isNumberArray,
		`chunks[${index}].embedding must be a number array`,
		"segment",
		`chunks[${index}].embedding`,
	);
	if (embedding.length !== embeddingDimensions) {
		throw new WtfocError(
			`Invalid segment: chunks[${index}].embedding length must equal embeddingDimensions (${embeddingDimensions})`,
			"SCHEMA_INVALID",
			{ field: `chunks[${index}].embedding` },
		);
	}
	const terms = requireField(
		raw,
		"terms",
		(v): v is string[] => Array.isArray(v) && v.every(isString),
		`chunks[${index}].terms must be an array of strings`,
		"segment",
		`chunks[${index}].terms`,
	);
	const source = requireField(
		raw,
		"source",
		isNonEmptyString,
		`chunks[${index}].source must be a non-empty string`,
		"segment",
		`chunks[${index}].source`,
	);
	const sourceType = requireField(
		raw,
		"sourceType",
		isNonEmptyString,
		`chunks[${index}].sourceType must be a non-empty string`,
		"segment",
		`chunks[${index}].sourceType`,
	);
	const content = requireField(
		raw,
		"content",
		isString,
		`chunks[${index}].content must be a string`,
		"segment",
		`chunks[${index}].content`,
	);
	const metadata = requireField(
		raw,
		"metadata",
		isStringRecord,
		`chunks[${index}].metadata must be a string record`,
		"segment",
		`chunks[${index}].metadata`,
	);

	const chunk: Segment["chunks"][number] = {
		id,
		storageId,
		content,
		embedding,
		terms,
		source,
		sourceType,
		metadata,
	};

	if ("sourceUrl" in raw && raw.sourceUrl !== undefined) {
		if (!isString(raw.sourceUrl)) {
			throw new WtfocError(
				`Invalid segment: chunks[${index}].sourceUrl must be a string`,
				"SCHEMA_INVALID",
				{ field: `chunks[${index}].sourceUrl` },
			);
		}
		chunk.sourceUrl = raw.sourceUrl;
	}
	if ("timestamp" in raw && raw.timestamp !== undefined) {
		if (!isString(raw.timestamp)) {
			throw new WtfocError(
				`Invalid segment: chunks[${index}].timestamp must be a string`,
				"SCHEMA_INVALID",
				{ field: `chunks[${index}].timestamp` },
			);
		}
		chunk.timestamp = raw.timestamp;
	}

	return chunk;
}

function validateEdge(raw: unknown, index: number): Segment["edges"][number] {
	if (!isRecord(raw)) {
		throw new WtfocError(`Invalid segment: edges[${index}] must be an object`, "SCHEMA_INVALID", {
			field: `edges[${index}]`,
		});
	}
	const type = requireField(
		raw,
		"type",
		isNonEmptyString,
		`edges[${index}].type must be a non-empty string`,
		"segment",
		`edges[${index}].type`,
	);
	const sourceId = requireField(
		raw,
		"sourceId",
		isNonEmptyString,
		`edges[${index}].sourceId must be a non-empty string`,
		"segment",
		`edges[${index}].sourceId`,
	);
	const targetType = requireField(
		raw,
		"targetType",
		isNonEmptyString,
		`edges[${index}].targetType must be a non-empty string`,
		"segment",
		`edges[${index}].targetType`,
	);
	const targetId = requireField(
		raw,
		"targetId",
		isNonEmptyString,
		`edges[${index}].targetId must be a non-empty string`,
		"segment",
		`edges[${index}].targetId`,
	);
	const evidence = requireField(
		raw,
		"evidence",
		isString,
		`edges[${index}].evidence must be a string`,
		"segment",
		`edges[${index}].evidence`,
	);
	const confidence = requireField(
		raw,
		"confidence",
		(v): v is number => typeof v === "number" && Number.isFinite(v),
		`edges[${index}].confidence must be a finite number`,
		"segment",
		`edges[${index}].confidence`,
	);

	return { type, sourceId, targetType, targetId, evidence, confidence };
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

	const sv = data.schemaVersion;
	if (typeof sv !== "number" || !Number.isInteger(sv)) {
		throw new WtfocError("Invalid segment: schemaVersion must be an integer", "SCHEMA_INVALID", {
			field: "schemaVersion",
		});
	}
	if (sv < 1 || sv > MAX_SUPPORTED_SCHEMA_VERSION) {
		throw new SchemaUnknownError(sv, MAX_SUPPORTED_SCHEMA_VERSION);
	}

	const embeddingModel = requireField(
		data,
		"embeddingModel",
		isNonEmptyString,
		"embeddingModel must be a non-empty string",
		"segment",
	);
	const embeddingDimensions = requireField(
		data,
		"embeddingDimensions",
		isPositiveFiniteInt,
		"embeddingDimensions must be a positive integer",
		"segment",
	);

	const chunksRaw = requireField(
		data,
		"chunks",
		isUnknownArray,
		"chunks must be an array",
		"segment",
	);
	const chunks = chunksRaw.map((c, i) => validateChunk(c, i, embeddingDimensions));

	const edgesRaw = requireField(data, "edges", isUnknownArray, "edges must be an array", "segment");
	const edges = edgesRaw.map((e, i) => validateEdge(e, i));

	return {
		schemaVersion: sv,
		embeddingModel,
		embeddingDimensions,
		chunks,
		edges,
	};
}
