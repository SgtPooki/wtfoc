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

export class VectorDimensionMismatchError extends WtfocError {
	constructor(expected: number, actual: number, target: "entry" | "query") {
		const subject = target === "query" ? "Query vector" : "Vector";
		super(
			`${subject} dimension mismatch: expected ${expected}, received ${actual}`,
			"VECTOR_DIMENSION_MISMATCH",
			{ expected, actual, target },
		);
		this.name = "VectorDimensionMismatchError";
	}
}

export class StorageNotFoundError extends WtfocError {
	constructor(id: string, backend: string) {
		super(`Artifact not found: ${id} (backend: ${backend})`, "STORAGE_NOT_FOUND", {
			id,
			backend,
		});
		this.name = "StorageNotFoundError";
	}
}

export class StorageInsufficientBalanceError extends WtfocError {
	constructor(backend: string, cause?: unknown) {
		super(
			`Insufficient balance for storage operation (backend: ${backend})`,
			"STORAGE_INSUFFICIENT_BALANCE",
			{
				backend,
				cause,
			},
		);
		this.name = "StorageInsufficientBalanceError";
	}
}

export class RevisionSchemaUnknownError extends WtfocError {
	constructor(found: number, maxSupported: number) {
		super(
			`Unknown collection revision schema version ${found} (max supported: ${maxSupported})`,
			"REVISION_SCHEMA_UNKNOWN",
			{ found, maxSupported },
		);
		this.name = "RevisionSchemaUnknownError";
	}
}

export class CollectionHeadConflictError extends WtfocError {
	constructor(collectionId: string, expected: string | null, actual: string | null) {
		super(
			`Collection head conflict for "${collectionId}": expected prevHeadId "${expected}", got "${actual}"`,
			"COLLECTION_HEAD_CONFLICT",
			{ collectionId, expected, actual },
		);
		this.name = "CollectionHeadConflictError";
	}
}

export class PublishFailedError extends WtfocError {
	constructor(collectionId: string, revisionId: string, cause?: unknown) {
		super(
			`Publish failed for collection "${collectionId}": revision "${revisionId}" uploaded but head advancement failed`,
			"PUBLISH_FAILED",
			{ collectionId, revisionId, cause },
		);
		this.name = "PublishFailedError";
	}
}

export class GitHubRateLimitError extends WtfocError {
	constructor(repo: string, retryAfterSeconds?: number) {
		super(
			`GitHub API rate limit exceeded for "${repo}"${retryAfterSeconds ? ` (retry after ${retryAfterSeconds}s)` : ""}`,
			"GITHUB_RATE_LIMIT",
			{ repo, retryAfterSeconds },
		);
		this.name = "GitHubRateLimitError";
	}
}

export class GitHubNotFoundError extends WtfocError {
	constructor(repo: string) {
		super(`GitHub repository not found: "${repo}"`, "GITHUB_NOT_FOUND", { repo });
		this.name = "GitHubNotFoundError";
	}
}

export class GitHubCliMissingError extends WtfocError {
	constructor() {
		super(
			"gh CLI not found. Install it from https://cli.github.com/ and run `gh auth login`",
			"GITHUB_CLI_MISSING",
		);
		this.name = "GitHubCliMissingError";
	}
}

export class GitHubApiError extends WtfocError {
	constructor(message: string, repo: string, cause?: unknown) {
		super(`GitHub API error for "${repo}": ${message}`, "GITHUB_API_ERROR", { repo, cause });
		this.name = "GitHubApiError";
	}
}

export class ConfigParseError extends WtfocError {
	constructor(filePath: string, parseError: string) {
		super(`Failed to parse config file "${filePath}": ${parseError}`, "CONFIG_PARSE", {
			filePath,
			parseError,
		});
		this.name = "ConfigParseError";
	}
}

export class ConfigValidationError extends WtfocError {
	constructor(filePath: string, field: string, expected: string, got: string) {
		super(
			`Invalid config in "${filePath}": ${field} must be ${expected}, got ${got}`,
			"CONFIG_VALIDATION",
			{ filePath, field, expected, got },
		);
		this.name = "ConfigValidationError";
	}
}

export class SchemaUnknownError extends WtfocError {
	constructor(found: number, maxSupported: number) {
		super(`Unknown schema version ${found} (max supported: ${maxSupported})`, "SCHEMA_UNKNOWN", {
			found,
			maxSupported,
		});
		this.name = "SchemaUnknownError";
	}
}

export class SessionExpiredError extends WtfocError {
	constructor(walletAddress: string) {
		super(`Session expired for wallet ${walletAddress}`, "SESSION_EXPIRED", { walletAddress });
		this.name = "SessionExpiredError";
	}
}

export class SessionKeyRevokedError extends WtfocError {
	constructor(walletAddress: string) {
		super(`Session key revoked for wallet ${walletAddress}`, "SESSION_KEY_REVOKED", { walletAddress });
		this.name = "SessionKeyRevokedError";
	}
}

export class WalletVerificationError extends WtfocError {
	constructor(address: string, reason: string) {
		super(`Wallet verification failed for ${address}: ${reason}`, "WALLET_VERIFICATION_FAILED", {
			address,
			reason,
		});
		this.name = "WalletVerificationError";
	}
}

export class RateLimitError extends WtfocError {
	constructor(identifier: string, limit: number, windowSeconds: number) {
		super(
			`Rate limit exceeded for ${identifier}: ${limit} requests per ${windowSeconds}s`,
			"RATE_LIMIT_EXCEEDED",
			{ identifier, limit, windowSeconds },
		);
		this.name = "RateLimitError";
	}
}
