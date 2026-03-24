import { SchemaUnknownError, WtfocError } from "@wtfoc/common";

/** Latest persisted manifest / segment format version. */
export const MAX_SUPPORTED_SCHEMA_VERSION = 1;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function schemaInvalid(
	kind: "headManifest" | "segment",
	msg: string,
	field?: string,
): WtfocError {
	const prefix = kind === "headManifest" ? "Invalid head manifest" : "Invalid segment";
	return new WtfocError(`${prefix}: ${msg}`, "SCHEMA_INVALID", field ? { field } : undefined);
}

export function requireString(v: unknown): v is string {
	return typeof v === "string";
}

export function requireNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.length > 0;
}

export function requireNonNegInt(v: unknown): v is number {
	return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export function requirePositiveInt(v: unknown): v is number {
	return typeof v === "number" && Number.isInteger(v) && v > 0;
}

export function requireStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every(requireString);
}

export function requireNumberArray(v: unknown): v is number[] {
	return Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

export function requireStringRecord(v: unknown): v is Record<string, string> {
	if (!isRecord(v)) return false;
	for (const key of Object.keys(v)) {
		if (typeof v[key] !== "string") return false;
	}
	return true;
}

export function validateSchemaVersion(
	data: Record<string, unknown>,
	kind: "headManifest" | "segment",
): number {
	const schemaVersion = data.schemaVersion;
	if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
		throw schemaInvalid(kind, "schemaVersion must be an integer", "schemaVersion");
	}
	if (schemaVersion < 1 || schemaVersion > MAX_SUPPORTED_SCHEMA_VERSION) {
		throw new SchemaUnknownError(schemaVersion, MAX_SUPPORTED_SCHEMA_VERSION);
	}
	return schemaVersion;
}
