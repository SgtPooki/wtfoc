import type { Segment } from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";
import * as v from "valibot";
import {
	isRecord,
	requireNonEmptyString,
	requireNumberArray,
	requirePositiveInt,
	requireString,
	requireStringArray,
	requireStringRecord,
	schemaInvalid,
	validateSchemaVersion,
} from "./shared.js";

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
	if (raw.embedding.length !== embeddingDimensions) {
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
	if (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence)) {
		throw schemaInvalid(
			"segment",
			`edges[${index}].confidence must be a finite number`,
			`edges[${index}].confidence`,
		);
	}

	return v.parse(EdgeSchema, raw);
}

export function validateSegmentSchema(data: unknown): Segment {
	if (!isRecord(data)) {
		throw new WtfocError("Invalid segment: expected an object", "SCHEMA_INVALID");
	}

	const schemaVersion = validateSchemaVersion(data, "segment");
	const embeddingDimensions = data.embeddingDimensions;

	if (!requireNonEmptyString(data.embeddingModel)) {
		throw schemaInvalid("segment", "embeddingModel must be a non-empty string", "embeddingModel");
	}
	if (!requirePositiveInt(embeddingDimensions)) {
		throw schemaInvalid(
			"segment",
			"embeddingDimensions must be a positive integer",
			"embeddingDimensions",
		);
	}
	if (!Array.isArray(data.chunks)) {
		throw schemaInvalid("segment", "chunks must be an array", "chunks");
	}
	const chunks = data.chunks.map((chunk, index) =>
		validateChunk(chunk, index, embeddingDimensions),
	);

	if (!Array.isArray(data.edges)) {
		throw schemaInvalid("segment", "edges must be an array", "edges");
	}
	const edges = data.edges.map((edge, index) => validateEdge(edge, index));

	return v.parse(SegmentSchema, {
		schemaVersion,
		embeddingModel: data.embeddingModel,
		embeddingDimensions,
		chunks,
		edges,
	});
}
