import type { Segment } from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";
import { validateSegmentSchema } from "./schema.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");

/**
 * Serializes a segment to UTF-8 JSON bytes.
 * Runs {@link validateSegmentSchema} first so only schema-valid segments are persisted (writers use latest schema).
 *
 * Head manifests are validated with {@link validateManifestSchema} at load/save sites; there is no `serializeManifest`
 * helper here because manifest I/O is handled by the manifest store, while segment blobs use this JSON codec.
 */
export function serializeSegment(segment: Segment): Uint8Array {
	const validated = validateSegmentSchema(segment);
	return textEncoder.encode(JSON.stringify(validated));
}

/** Parses segment bytes and validates schema (including `schemaVersion` and embedding lengths). */
export function deserializeSegment(data: Uint8Array): Segment {
	const text = textDecoder.decode(data);
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (e) {
		const detail = e instanceof Error ? e.message : String(e);
		throw new WtfocError(`Invalid segment JSON: ${detail}`, "SCHEMA_INVALID");
	}
	return validateSegmentSchema(parsed);
}
