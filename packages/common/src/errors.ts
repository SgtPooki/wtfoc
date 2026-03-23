/**
 * Base error class for wtfoc. All errors have a stable `code` field
 * for programmatic handling — never parse the message string.
 */
export class WtfocError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly context?: Record<string, unknown>,
	) {
		super(message);
		this.name = "WtfocError";
	}
}

export class ManifestConflictError extends WtfocError {
	constructor(expected: string | null, actual: string | null) {
		super(
			`Manifest conflict: expected prevHeadId "${expected}", got "${actual}"`,
			"MANIFEST_CONFLICT",
			{ expected, actual },
		);
		this.name = "ManifestConflictError";
	}
}

export class StorageUnreachableError extends WtfocError {
	constructor(backend: string, cause?: unknown) {
		super(`Storage backend unreachable: ${backend}`, "STORAGE_UNREACHABLE", {
			backend,
			cause,
		});
		this.name = "StorageUnreachableError";
	}
}

export class EmbedFailedError extends WtfocError {
	constructor(model: string, cause?: unknown) {
		super(`Embedding failed with model: ${model}`, "EMBED_FAILED", {
			model,
			cause,
		});
		this.name = "EmbedFailedError";
	}
}

export class SchemaUnknownError extends WtfocError {
	constructor(found: number, maxSupported: number) {
		super(
			`Unknown schema version ${found} (max supported: ${maxSupported})`,
			"SCHEMA_UNKNOWN",
			{ found, maxSupported },
		);
		this.name = "SchemaUnknownError";
	}
}
