import type { Segment } from "@wtfoc/common";
import { validateSegmentSchema } from "./schema.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");

/** Serializes a segment to UTF-8 JSON bytes. */
export function serializeSegment(segment: Segment): Uint8Array {
	return textEncoder.encode(JSON.stringify(segment));
}

/** Parses segment bytes and validates schema (including `schemaVersion`). */
export function deserializeSegment(data: Uint8Array): Segment {
	const text = textDecoder.decode(data);
	const parsed: unknown = JSON.parse(text);
	return validateSegmentSchema(parsed);
}
