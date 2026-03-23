import type { HeadManifest, Segment, SegmentSummary } from "@wtfoc/common";
import { SchemaUnknownError, WtfocError } from "@wtfoc/common";

/** Latest persisted manifest / segment format version. */
export const MAX_SUPPORTED_SCHEMA_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireField<T>(
	record: Record<string, unknown>,
	key: string,
	predicate: (v: unknown) => v is T,
	label: string,
): T {
	const v = record[key];
	if (!predicate(v)) {
		throw new WtfocError(`Invalid head manifest: ${label}`, "SCHEMA_INVALID", { field: key });
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
	const id = requireField(raw, "id", isNonEmptyString, `segments[${index}].id must be a non-empty string`);
	const sourceTypes = requireField(
		raw,
		"sourceTypes",
		(v): v is string[] => Array.isArray(v) && v.every(isString),
		`segments[${index}].sourceTypes must be an array of strings`,
	);
	const chunkCount = requireField(
		raw,
		"chunkCount",
		isFiniteNonNegativeInt,
		`segments[${index}].chunkCount must be a non-negative integer`,
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
		);
		const to = requireField(
			raw.timeRange,
			"to",
			isString,
			`segments[${index}].timeRange.to must be a string`,
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
		throw new WtfocError("Invalid head manifest: schemaVersion must be an integer", "SCHEMA_INVALID", {
			field: "schemaVersion",
		});
	}
	if (sv < 1 || sv > MAX_SUPPORTED_SCHEMA_VERSION) {
		throw new SchemaUnknownError(sv, MAX_SUPPORTED_SCHEMA_VERSION);
	}

	const name = requireField(data, "name", isNonEmptyString, "name must be a non-empty string");
	const prevHeadId = data.prevHeadId;
	if (prevHeadId !== null && typeof prevHeadId !== "string") {
		throw new WtfocError("Invalid head manifest: prevHeadId must be string or null", "SCHEMA_INVALID", {
			field: "prevHeadId",
		});
	}

	const segmentsRaw = requireField(data, "segments", Array.isArray, "segments must be an array");
	const segments = segmentsRaw.map((item, i) => validateSegmentSummary(item, i));

	const totalChunks = requireField(
		data,
		"totalChunks",
		isFiniteNonNegativeInt,
		"totalChunks must be a non-negative integer",
	);
	const embeddingModel = requireField(
		data,
		"embeddingModel",
		isNonEmptyString,
		"embeddingModel must be a non-empty string",
	);
	const embeddingDimensions = requireField(
		data,
		"embeddingDimensions",
		isPositiveFiniteInt,
		"embeddingDimensions must be a positive integer",
	);
	const createdAt = requireField(data, "createdAt", isString, "createdAt must be a string");
	const updatedAt = requireField(data, "updatedAt", isString, "updatedAt must be a string");

	return {
		schemaVersion: sv,
		name,
		prevHeadId: prevHeadId as string | null,
		segments,
		totalChunks,
		embeddingModel,
		embeddingDimensions,
		createdAt,
		updatedAt,
	};
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

function validateChunk(raw: unknown, index: number): Segment["chunks"][number] {
	if (!isRecord(raw)) {
		throw new WtfocError(`Invalid segment: chunks[${index}] must be an object`, "SCHEMA_INVALID", {
			field: `chunks[${index}]`,
		});
	}
	const id = requireField(raw, "id", isNonEmptyString, `chunks[${index}].id must be a non-empty string`);
	const storageId = requireField(
		raw,
		"storageId",
		isNonEmptyString,
		`chunks[${index}].storageId must be a non-empty string`,
	);
	const embedding = requireField(
		raw,
		"embedding",
		isNumberArray,
		`chunks[${index}].embedding must be a number array`,
	);
	const terms = requireField(
		raw,
		"terms",
		(v): v is string[] => Array.isArray(v) && v.every(isString),
		`chunks[${index}].terms must be an array of strings`,
	);
	const source = requireField(
		raw,
		"source",
		isNonEmptyString,
		`chunks[${index}].source must be a non-empty string`,
	);
	const sourceType = requireField(
		raw,
		"sourceType",
		isNonEmptyString,
		`chunks[${index}].sourceType must be a non-empty string`,
	);
	const metadata = requireField(
		raw,
		"metadata",
		isStringRecord,
		`chunks[${index}].metadata must be a string record`,
	);

	const chunk: Segment["chunks"][number] = {
		id,
		storageId,
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
	const type = requireField(raw, "type", isNonEmptyString, `edges[${index}].type must be a non-empty string`);
	const sourceId = requireField(
		raw,
		"sourceId",
		isNonEmptyString,
		`edges[${index}].sourceId must be a non-empty string`,
	);
	const targetType = requireField(
		raw,
		"targetType",
		isNonEmptyString,
		`edges[${index}].targetType must be a non-empty string`,
	);
	const targetId = requireField(
		raw,
		"targetId",
		isNonEmptyString,
		`edges[${index}].targetId must be a non-empty string`,
	);
	const evidence = requireField(
		raw,
		"evidence",
		isString,
		`edges[${index}].evidence must be a string`,
	);
	const confidence = requireField(
		raw,
		"confidence",
		(v): v is number => typeof v === "number" && Number.isFinite(v),
		`edges[${index}].confidence must be a finite number`,
	);

	return { type, sourceId, targetType, targetId, evidence, confidence };
}

/**
 * Validates unknown JSON-compatible data as a {@link Segment}.
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
	);
	const embeddingDimensions = requireField(
		data,
		"embeddingDimensions",
		isPositiveFiniteInt,
		"embeddingDimensions must be a positive integer",
	);

	const chunksRaw = requireField(data, "chunks", Array.isArray, "chunks must be an array");
	const chunks = chunksRaw.map((c, i) => validateChunk(c, i));

	const edgesRaw = requireField(data, "edges", Array.isArray, "edges must be an array");
	const edges = edgesRaw.map((e, i) => validateEdge(e, i));

	return {
		schemaVersion: sv,
		embeddingModel,
		embeddingDimensions,
		chunks,
		edges,
	};
}
