import type { CollectionRevision } from "@wtfoc/common";
import { RevisionSchemaUnknownError, WtfocError } from "@wtfoc/common";
import { MAX_SUPPORTED_SCHEMA_VERSION } from "./schema.js";

/** Serialize a CollectionRevision to bytes for storage */
export function serializeRevision(revision: CollectionRevision): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(revision));
}

/** Deserialize bytes back to a CollectionRevision with schema validation */
export function deserializeRevision(data: Uint8Array): CollectionRevision {
	const text = new TextDecoder().decode(data);
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new WtfocError("Invalid revision: not valid JSON", "SCHEMA_INVALID");
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new WtfocError("Invalid revision: expected an object", "SCHEMA_INVALID");
	}

	const record = parsed as Record<string, unknown>;
	const sv = record.schemaVersion;
	if (typeof sv !== "number" || !Number.isInteger(sv)) {
		throw new WtfocError("Invalid revision: schemaVersion must be an integer", "SCHEMA_INVALID", {
			field: "schemaVersion",
		});
	}
	if (sv < 1 || sv > MAX_SUPPORTED_SCHEMA_VERSION) {
		throw new RevisionSchemaUnknownError(sv, MAX_SUPPORTED_SCHEMA_VERSION);
	}

	if (typeof record.revisionId !== "string" || record.revisionId.length === 0) {
		throw new WtfocError(
			"Invalid revision: revisionId must be a non-empty string",
			"SCHEMA_INVALID",
		);
	}
	if (typeof record.collectionId !== "string" || record.collectionId.length === 0) {
		throw new WtfocError(
			"Invalid revision: collectionId must be a non-empty string",
			"SCHEMA_INVALID",
		);
	}
	if (record.prevRevisionId !== null && typeof record.prevRevisionId !== "string") {
		throw new WtfocError(
			"Invalid revision: prevRevisionId must be string or null",
			"SCHEMA_INVALID",
		);
	}
	if (!Array.isArray(record.artifactSummaries)) {
		throw new WtfocError("Invalid revision: artifactSummaries must be an array", "SCHEMA_INVALID");
	}
	if (!Array.isArray(record.segmentRefs)) {
		throw new WtfocError("Invalid revision: segmentRefs must be an array", "SCHEMA_INVALID");
	}
	if (!Array.isArray(record.bundleRefs)) {
		throw new WtfocError("Invalid revision: bundleRefs must be an array", "SCHEMA_INVALID");
	}

	return parsed as CollectionRevision;
}
